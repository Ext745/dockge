import childProcessAsync from "promisify-child-process";
import { parseDocument } from "yaml";
import { DockgeServer } from "./dockge-server";
import { Stack } from "./stack";
import { interpolate } from "../common/compose-ports";
import { log } from "./log";

export interface UnusedImageCleanup {
    removed : string[];
    // Unused images kept because a Dockge stack's compose file names their repository
    kept : string[];
    failed : string[];
}

/**
 * The repository part of an image reference, normalised the way `docker images` prints it
 * ("docker.io/library/nginx:1.27" -> "nginx", "espressif/idf:v6.1" -> "espressif/idf").
 * @param ref Image reference
 * @returns Repository
 */
export function imageRepository(ref : string) : string {
    let repo = ref.trim().split("@")[0];
    const lastSlash = repo.lastIndexOf("/");
    const lastColon = repo.lastIndexOf(":");
    if (lastColon > lastSlash) {
        repo = repo.slice(0, lastColon);
    }
    return repo.replace(/^docker\.io\//, "").replace(/^index\.docker\.io\//, "").replace(/^library\//, "");
}

/**
 * Repositories named by any Dockge stack's compose file (and override), with the stack's .env and
 * global.env applied. A stack that is only run on demand (like a build toolchain with a "manual"
 * profile) has no container between runs, so Docker considers its image unused; these are the images
 * Dockge's "prune all images" must keep. Every tag of such a repository is kept, since stacks often
 * switch tags through a variable (e.g. image: espressif/idf:${IDF_TAG:-v6.1}).
 * @param server Server
 * @returns Protected repositories, and image references that couldn't be resolved
 */
export async function protectedRepositories(server : DockgeServer) : Promise<{ repos : Set<string>, unresolved : string[] }> {
    const repos = new Set<string>();
    const unresolved : string[] = [];
    for (const stack of (await Stack.getStackList(server)).values()) {
        if (!stack.isManagedByDockge) {
            continue;
        }
        const env = stack.composeVariables();
        for (const text of [ stack.composeYAML, stack.composeOverrideYAML ]) {
            if (!text) {
                continue;
            }
            let services : unknown;
            try {
                services = parseDocument(text).toJS()?.services;
            } catch {
                continue;
            }
            if (!services || typeof services !== "object") {
                continue;
            }
            for (const service of Object.values(services as Record<string, { image? : unknown }>)) {
                if (typeof service?.image !== "string") {
                    continue;
                }
                const resolved = interpolate(service.image, env);
                if (resolved.includes("$") || !resolved.trim()) {
                    unresolved.push(`${stack.name}: ${service.image}`);
                    continue;
                }
                repos.add(imageRepository(resolved));
            }
        }
    }
    return { repos,
        unresolved };
}

async function docker(args : string[]) : Promise<string> {
    const res = await childProcessAsync.spawn("docker", args, { encoding: "utf-8",
        maxBuffer: 64 * 1024 * 1024 });
    return String(res.stdout ?? "");
}

/**
 * What `docker image prune -a` does, except images whose repository a Dockge stack uses are kept.
 * Images used by any container (running or stopped) are never touched, as with Docker's own prune.
 * @param server Server
 * @returns What was removed, kept and couldn't be removed
 */
export async function removeUnusedImages(server : DockgeServer) : Promise<UnusedImageCleanup> {
    const { repos } = await protectedRepositories(server);

    const containerIds = (await docker([ "ps", "-aq", "--no-trunc" ])).split("\n").filter(Boolean);
    const inUse = new Set<string>();
    if (containerIds.length) {
        for (const id of (await docker([ "inspect", "--format", "{{.Image}}", ...containerIds ])).split("\n")) {
            if (id.trim()) {
                inUse.add(id.trim());
            }
        }
    }

    const result : UnusedImageCleanup = { removed: [],
        kept: [],
        failed: [] };
    const lines = (await docker([ "images", "--no-trunc", "--format", "{{.ID}}\t{{.Repository}}\t{{.Tag}}" ])).split("\n").filter(Boolean);
    for (const line of lines) {
        const [ id, repo, tag ] = line.split("\t");
        if (inUse.has(id)) {
            continue;
        }
        const tagged = repo !== "<none>" && tag !== "<none>";
        const ref = tagged ? `${repo}:${tag}` : id;
        if (repo !== "<none>" && repos.has(imageRepository(repo))) {
            result.kept.push(tagged ? ref : `${repo}@${id.slice(7, 19)}`);
            continue;
        }
        try {
            await docker([ "rmi", ref ]);
            result.removed.push(tagged ? ref : id.slice(7, 19));
        } catch (e) {
            // e.g. an untagged parent of another image; Docker's own prune would skip it too
            log.debug("image-protection", `Couldn't remove ${ref}: ${e}`);
            result.failed.push(tagged ? ref : id.slice(7, 19));
        }
    }
    return result;
}

/**
 * A short summary for the terminal / API output.
 * @param r Cleanup result
 * @returns Text
 */
export function describeCleanup(r : UnusedImageCleanup) : string {
    const lines = [ `Removed ${r.removed.length} unused image(s).` ];
    if (r.kept.length) {
        lines.push(`Kept ${r.kept.length} unused image(s) because a Dockge stack uses them: ${r.kept.join(", ")}`);
    }
    if (r.failed.length) {
        lines.push(`Couldn't remove ${r.failed.length} image(s) (still referenced by another image): ${r.failed.join(", ")}`);
    }
    return lines.join("\n");
}
