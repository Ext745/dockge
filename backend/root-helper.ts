import childProcessAsync from "promisify-child-process";
import { execFile } from "child_process";
import path from "path";
import { selfContainerId } from "./self-container";
import { log } from "./log";

/**
 * Root fallback for a Dockge that switched to PUID/PGID (DOCKGE_DROP_ROOT=true): containers often
 * write root-owned files into their stack folder (./data with a 0700 subfolder, a 0600 file), which
 * that user can't read or remove, so Delete and Transfer would fail half-way. Dockge already
 * controls Docker through docker.sock, so it runs the one step it can't do as a short-lived root
 * container of its own image, with only that stack folder mounted.
 */

interface SelfMount {
    Source : string;
    Destination : string;
}

/**
 * Whether an error is a permission problem the root helper can get around
 * @param e Caught error
 * @returns EACCES or EPERM, and Dockge isn't root itself
 */
export function needsRootHelper(e : unknown) : boolean {
    const code = (e as NodeJS.ErrnoException)?.code;
    return (code === "EACCES" || code === "EPERM") && process.getuid?.() !== 0;
}

/**
 * Dockge's own image and the host path of a folder Dockge sees at `dir`, from its container's mounts.
 * The host path is read from the mount, not assumed equal to `dir`.
 * @param dir Absolute path inside Dockge's container
 * @returns Image id and host path
 * @throws Error when Dockge isn't in a container or `dir` isn't on a bind mount
 */
async function locate(dir : string) : Promise<{ image : string; hostDir : string }> {
    const id = await selfContainerId();
    if (!id) {
        throw new Error("Dockge isn't running in a container, so it can't start a helper container");
    }
    const res = await childProcessAsync.spawn("docker", [ "inspect", "--format", "{{json .Image}} {{json .Mounts}}", id ], {
        encoding: "utf-8",
        timeout: 20000,
    });
    const out = String(res.stdout ?? "").trim();
    const space = out.indexOf(" ");
    const image = JSON.parse(out.slice(0, space)) as string;
    const mounts = (JSON.parse(out.slice(space + 1)) ?? []) as SelfMount[];

    const target = path.resolve(dir);
    let best : SelfMount | undefined;
    for (const m of mounts) {
        const dest = path.resolve(m.Destination);
        if ((target === dest || target.startsWith(dest + path.sep)) && (!best || dest.length > path.resolve(best.Destination).length)) {
            best = m;
        }
    }
    if (!best || !best.Source) {
        throw new Error(`${dir} isn't on a folder mounted from the host, so a helper container can't reach it`);
    }
    const hostDir = path.join(best.Source, path.relative(path.resolve(best.Destination), target));
    return {
        image,
        hostDir,
    };
}

/**
 * docker run arguments for a root helper with `dir` mounted at /target
 * @param dir Folder inside Dockge's container
 * @param readOnly Mount it read-only
 * @param entrypoint Program to run
 * @param args Its arguments
 * @returns Arguments for `docker`
 */
async function helperArgs(dir : string, readOnly : boolean, entrypoint : string, args : string[]) : Promise<string[]> {
    const { image, hostDir } = await locate(dir);
    return [
        "run", "--rm", "--user", "0:0", "--network", "none",
        "--security-opt", "no-new-privileges:true",
        "--label", "dockge.root-helper=true",
        "-v", `${hostDir}:/target${readOnly ? ":ro" : ""}`,
        "--entrypoint", entrypoint,
        image, ...args,
    ];
}

/**
 * Empty a folder as root (the folder itself is left for the caller to remove)
 * @param dir Folder inside Dockge's container
 */
export async function emptyDirAsRoot(dir : string) {
    log.info("root-helper", `Removing root-owned files in ${dir} with a helper container`);
    await childProcessAsync.spawn("docker", await helperArgs(dir, false, "find", [ "/target", "-mindepth", "1", "-delete" ]), {
        encoding: "utf-8",
        timeout: 300000,
    });
}

/**
 * Zip a folder as root, the same way the transfer zips it (adm-zip addLocalFolder)
 * @param dir Folder inside Dockge's container
 * @returns The zip
 */
export async function zipDirAsRoot(dir : string) : Promise<Buffer> {
    log.info("root-helper", `Reading root-owned files in ${dir} with a helper container`);
    const script = "const Z = require('/app/node_modules/adm-zip'); const z = new Z(); z.addLocalFolder('/target'); process.stdout.write(z.toBuffer());";
    const args = await helperArgs(dir, true, "node", [ "-e", script ]);
    return new Promise((resolve, reject) => {
        execFile("docker", args, {
            encoding: "buffer",
            maxBuffer: 2 * 1024 * 1024 * 1024,
            timeout: 600000,
        }, (err, stdout, stderr) => {
            if (err) {
                reject(new Error(`Helper container failed: ${stderr.toString().trim() || err.message}`, { cause: err }));
            } else {
                resolve(stdout);
            }
        });
    });
}
