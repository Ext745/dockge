import childProcessAsync from "promisify-child-process";
import { promises as fsAsync } from "fs";
import path from "path";
import { isMap, isScalar, isSeq, parseDocument, Document, Scalar, YAMLMap } from "yaml";
import { DockgeServer } from "./dockge-server";
import { DockgeSocket, fileExists, ValidationError } from "./util-server";
import { acceptedComposeFileNames } from "../common/util-common";
import { Stack } from "./stack";
import { validateCompose } from "./compose-validate";
import { log } from "./log";
import { detectIndent } from "../common/yaml-indent";

// Dockge stack names; compose project names that don't fit can't become a Dockge folder
const VALID_NAME = /^[a-z0-9][a-z0-9_-]*$/;
// Small image used to read host files Dockge can't see (it usually runs in a container)
const HELPER_IMAGE = "busybox:stable";

export interface ImportCandidate {
    name : string;
    // "running": a compose project Docker knows about; "folder": a compose file found by a folder scan
    source : "running" | "folder";
    status : string;
    workingDir : string;
    configFiles : string[];
    importable : boolean;
    reason? : string;
}

export interface ImportRecord {
    id : string;
    name : string;
    importedAt : string;
    workingDir : string;
    configFiles : string[];
    targetDir : string;
    redeployed : boolean;
    notes : string[];
}

export interface ImportResult {
    name : string;
    ok : boolean;
    msg : string;
    notes : string[];
}

/**
 * Read a host file. Dockge normally runs in a container that only sees its own mounts, so if the file
 * isn't visible here, read it through a short-lived helper container on the same Docker daemon.
 * @param file Absolute host path
 * @returns File content
 */
export async function readHostFile(file : string) : Promise<string> {
    if (await fileExists(file)) {
        return fsAsync.readFile(file, "utf-8");
    }
    const res = await childProcessAsync.spawn("docker", [
        "run", "--rm", "--pull", "missing", "--network", "none",
        "-v", `${path.dirname(file)}:/src:ro`,
        HELPER_IMAGE, "cat", `/src/${path.basename(file)}`,
    ], { encoding: "utf-8",
        maxBuffer: 16 * 1024 * 1024 });
    return String(res.stdout ?? "");
}

/**
 * Whether a host file exists, through the helper container if Dockge can't see it.
 * @param file Absolute host path
 * @returns Exists
 */
async function hostFileExists(file : string) : Promise<boolean> {
    if (await fileExists(file)) {
        return true;
    }
    try {
        await childProcessAsync.spawn("docker", [
            "run", "--rm", "--pull", "missing", "--network", "none",
            "-v", `${path.dirname(file)}:/src:ro`,
            HELPER_IMAGE, "test", "-f", `/src/${path.basename(file)}`,
        ], { encoding: "utf-8" });
        return true;
    } catch {
        return false;
    }
}

/**
 * Compose's own project-name normalisation for a folder name.
 * @param raw Folder name
 * @returns Project name
 */
function projectNameFromDir(raw : string) : string {
    return raw.toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

/**
 * Compose projects and compose files that Dockge doesn't manage yet.
 * @param server Server
 * @param scanDir Optional host folder to search for compose files (3 levels deep)
 * @returns Candidates
 */
export async function listImportCandidates(server : DockgeServer, scanDir? : string) : Promise<ImportCandidate[]> {
    const candidates : ImportCandidate[] = [];
    const seenFiles = new Set<string>();

    // 1. Compose projects Docker knows about, whose files live outside the stacks folder
    const res = await childProcessAsync.spawn("docker", [ "compose", "ls", "--all", "--format", "json" ], { encoding: "utf-8" });
    const projects = JSON.parse(String(res.stdout || "[]")) as { Name : string, Status : string, ConfigFiles : string }[];
    for (const project of projects) {
        if (await fileExists(path.join(server.stacksDir, project.Name))) {
            continue;
        }
        const configFiles = (project.ConfigFiles || "").split(",").map((f) => f.trim()).filter(Boolean);
        configFiles.forEach((f) => seenFiles.add(f));
        const workingDir = await projectWorkingDir(project.Name) || (configFiles[0] ? path.dirname(configFiles[0]) : "");
        const candidate = await checkImportable(server, {
            name: project.Name,
            source: "running",
            status: project.Status,
            workingDir,
            configFiles,
            importable: true,
        });
        candidates.push(await isSelfProject(project.Name) ? { ...candidate,
            importable: false,
            reason: "This is Dockge itself." } : candidate);
    }

    // 2. Compose files in a folder the user chose
    if (scanDir) {
        if (!path.isAbsolute(scanDir)) {
            throw new ValidationError("The folder to scan must be an absolute path");
        }
        for (const file of await findComposeFiles(scanDir)) {
            if (seenFiles.has(file) || file.startsWith(server.stacksDir + path.sep)) {
                continue;
            }
            const dir = path.dirname(file);
            let name = projectNameFromDir(path.basename(dir));
            try {
                const declared = parseDocument(await readHostFile(file)).toJS()?.name;
                if (typeof declared === "string" && declared.trim()) {
                    name = declared.trim();
                }
            } catch {
                // An unreadable file still shows up; the import itself will report the problem
            }
            if (candidates.some((c) => c.name === name)) {
                continue;
            }
            candidates.push(await checkImportable(server, {
                name,
                source: "folder",
                status: "not deployed",
                workingDir: dir,
                configFiles: [ file ],
                importable: true,
            }));
        }
    }

    return candidates.sort((a, b) => Number(b.importable) - Number(a.importable) || a.name.localeCompare(b.name));
}

async function checkImportable(server : DockgeServer, c : ImportCandidate) : Promise<ImportCandidate> {
    const no = (reason : string) : ImportCandidate => ({ ...c,
        importable: false,
        reason });
    if (!VALID_NAME.test(c.name)) {
        return no(`"${c.name}" isn't a valid Dockge stack name (lowercase letters, digits, - and _).`);
    }
    if (await fileExists(path.join(server.stacksDir, c.name))) {
        return no("A stack with this name already exists in Dockge.");
    }
    if (c.configFiles.length === 0) {
        return no("Docker doesn't know where this project's compose file is.");
    }
    if (c.configFiles.length > 2) {
        return no("Projects started with more than two -f files aren't supported yet.");
    }
    const inStacksDir = c.configFiles.filter((f) => f.startsWith(server.stacksDir + path.sep));
    if (inStacksDir.length > 0) {
        for (const f of inStacksDir) {
            if (!await fileExists(f)) {
                return no(`Its compose file (${f}) no longer exists - the stack's folder was removed while it kept running. Run "docker compose -p ${c.name} down" to stop it, or restore the folder.`);
            }
        }
        return no("Its files are already inside Dockge's stacks folder.");
    }
    return c;
}

/**
 * Whether Dockge's own container belongs to a compose project (importing that would move Dockge itself).
 * @param project Compose project name
 * @returns Is Dockge
 */
async function isSelfProject(project : string) : Promise<boolean> {
    const hostname = process.env.HOSTNAME;
    if (!hostname) {
        return false;
    }
    try {
        const res = await childProcessAsync.spawn("docker", [ "ps", "-q", "--filter", `label=com.docker.compose.project=${project}` ], { encoding: "utf-8" });
        return String(res.stdout || "").split("\n").some((id) => id.trim() && hostname.startsWith(id.trim()));
    } catch {
        return false;
    }
}

async function projectWorkingDir(project : string) : Promise<string> {
    try {
        const res = await childProcessAsync.spawn("docker", [
            "ps", "-a", "--filter", `label=com.docker.compose.project=${project}`,
            "--format", "{{.Label \"com.docker.compose.project.working_dir\"}}",
        ], { encoding: "utf-8" });
        return String(res.stdout || "").split("\n").map((l) => l.trim()).find(Boolean) || "";
    } catch {
        return "";
    }
}

async function findComposeFiles(dir : string) : Promise<string[]> {
    const nameArgs = acceptedComposeFileNames.flatMap((n, i) => (i ? [ "-o", "-name", n ] : [ "-name", n ]));
    let output : string;
    if (await fileExists(dir)) {
        const res = await childProcessAsync.spawn("find", [ dir, "-maxdepth", "3", "(", ...nameArgs, ")", "-type", "f" ], { encoding: "utf-8" });
        output = String(res.stdout || "");
    } else {
        const res = await childProcessAsync.spawn("docker", [
            "run", "--rm", "--pull", "missing", "--network", "none", "-v", `${dir}:/scan:ro`,
            HELPER_IMAGE, "find", "/scan", "-maxdepth", "3", "(", ...nameArgs, ")", "-type", "f",
        ], { encoding: "utf-8" });
        output = String(res.stdout || "").replace(/^\/scan/gm, dir.replace(/\/$/, ""));
    }
    return output.split("\n").map((l) => l.trim()).filter(Boolean).sort();
}

const isRelative = (p : string) => p === "." || p.startsWith("./") || p.startsWith("../");

/**
 * Make a moved compose file keep pointing at the same host paths, editing the parsed document in place
 * so the rest of the file keeps its formatting.
 * - bind mount sources and build contexts -> absolute paths into the original folder (data stays put)
 * - env_file entries stay relative; the files are listed in `copy` so they move with the stack, since
 *   the compose CLI (inside Dockge) has to read them on every deploy
 * @param doc Parsed compose file
 * @param workingDir Original project folder
 * @returns Notes for the user, and env files to copy (relative paths)
 */
export function rewriteForMove(doc : Document, workingDir : string) : { notes : string[], copy : string[] } {
    const notes : string[] = [];
    const copy : string[] = [];
    const abs = (p : string) => path.resolve(workingDir, p);
    const services = doc.get("services", true);
    if (!isMap(services)) {
        return { notes,
            copy };
    }

    for (const servicePair of services.items) {
        const service = servicePair.value;
        const serviceName = String(isScalar(servicePair.key) ? servicePair.key.value : servicePair.key);
        if (!isMap(service)) {
            continue;
        }

        const volumes = service.get("volumes", true);
        if (isSeq(volumes)) {
            for (const item of volumes.items) {
                if (isScalar(item) && typeof item.value === "string") {
                    const [ source, ...rest ] = item.value.split(":");
                    if (isRelative(source)) {
                        item.value = [ abs(source), ...rest ].join(":");
                        notes.push(`${serviceName}: bind mount ${source} → ${abs(source)} (data stays where it is)`);
                    } else if (source.includes("$")) {
                        notes.push(`${serviceName}: volume "${item.value}" uses a variable; check it still points to the right place`);
                    }
                } else if (isMap(item)) {
                    const source = item.get("source", true);
                    if (isScalar(source) && typeof source.value === "string" && isRelative(source.value)) {
                        notes.push(`${serviceName}: bind mount ${source.value} → ${abs(source.value)} (data stays where it is)`);
                        source.value = abs(source.value);
                    }
                }
            }
        }

        const build = service.get("build", true);
        const context = isScalar(build) ? build : isMap(build) ? (build as YAMLMap).get("context", true) : undefined;
        if (isScalar(context) && typeof context.value === "string" && isRelative(context.value)) {
            notes.push(`${serviceName}: build context ${context.value} → ${abs(context.value)} (Dockge can only build it if that folder is visible to Dockge)`);
            context.value = abs(context.value);
        }

        const envFile = service.get("env_file", true);
        const envItems = isSeq(envFile) ? envFile.items : envFile ? [ envFile ] : [];
        for (const entry of envItems) {
            const node = isMap(entry) ? entry.get("path", true) : entry;
            if (isScalar(node) && typeof node.value === "string") {
                const p = node.value;
                if (isRelative(p) && !path.relative(workingDir, abs(p)).startsWith("..")) {
                    copy.push(path.relative(workingDir, abs(p)));
                } else if (isRelative(p)) {
                    notes.push(`${serviceName}: env_file ${p} is outside the project folder → ${abs(p)}; Dockge must be able to read it to deploy`);
                    (node as Scalar).value = abs(p);
                }
            }
        }

        if (service.has("extends")) {
            notes.push(`${serviceName}: uses "extends"; check the referenced file is still reachable`);
        }
    }

    for (const section of [ "configs", "secrets" ]) {
        const map = doc.get(section, true);
        if (isMap(map)) {
            for (const pair of map.items) {
                const file = isMap(pair.value) ? pair.value.get("file", true) : undefined;
                if (isScalar(file) && typeof file.value === "string" && isRelative(file.value)) {
                    notes.push(`${section}: ${file.value} → ${abs(file.value)}`);
                    file.value = abs(file.value);
                }
            }
        }
    }
    if (doc.has("include")) {
        notes.push("Uses \"include\"; check the included files are still reachable");
    }
    return { notes,
        copy: [ ...new Set(copy) ] };
}

function backupRoot(server : DockgeServer) : string {
    return path.join(server.config.dataDir, "import-backups");
}

/**
 * Bring a compose project under Dockge: copy its compose files into the stacks folder under the same
 * project name (so named volumes and networks carry over), keep every path pointing at the original
 * host folder, and record a backup. The original folder is never modified.
 * @param server Server
 * @param socket Socket, for the deploy terminal
 * @param name Compose project name, as listed by listImportCandidates
 * @param scanDir The folder that was scanned, if the stack came from a folder scan
 * @param redeploy Recreate the containers from the new location right away
 * @returns Result for the UI
 */
export async function importStack(server : DockgeServer, socket : DockgeSocket, name : string, scanDir : string | undefined, redeploy : boolean) : Promise<ImportResult> {
    // Only ever act on what the server itself found (never on paths sent by the browser)
    const candidate = (await listImportCandidates(server, scanDir)).find((c) => c.name === name);
    if (!candidate) {
        throw new ValidationError(`${name} is no longer available to import`);
    }
    if (!candidate.importable) {
        throw new ValidationError(candidate.reason ?? "Can't import this stack");
    }
    const { workingDir, configFiles } = candidate;
    const targetDir = path.join(server.stacksDir, name);
    if (await fileExists(targetDir)) {
        throw new ValidationError(`A folder named ${name} already exists in the stacks folder.`);
    }

    // Read everything first, so nothing is written if a file can't be read
    const mainText = await readHostFile(configFiles[0]);
    const overrideText = configFiles[1] ? await readHostFile(configFiles[1]) : "";
    const envPath = path.join(workingDir, ".env");
    const envText = await hostFileExists(envPath) ? await readHostFile(envPath) : "";

    const mainDoc = parseDocument(mainText);
    if (mainDoc.errors.length > 0) {
        throw new ValidationError(`${path.basename(configFiles[0])} isn't valid YAML: ${mainDoc.errors[0].message}`);
    }
    const rewrite = rewriteForMove(mainDoc, workingDir);
    let overrideOut = "";
    if (overrideText) {
        const overrideDoc = parseDocument(overrideText);
        if (overrideDoc.errors.length > 0) {
            throw new ValidationError(`${path.basename(configFiles[1])} isn't valid YAML: ${overrideDoc.errors[0].message}`);
        }
        const r = rewriteForMove(overrideDoc, workingDir);
        rewrite.notes.push(...r.notes);
        rewrite.copy.push(...r.copy.filter((c) => !rewrite.copy.includes(c)));
        overrideOut = overrideDoc.toString({ indent: detectIndent(overrideText),
            lineWidth: 0,
            flowCollectionPadding: false });
    }
    const envCopies : [ string, string ][] = [];
    for (const rel of rewrite.copy) {
        envCopies.push([ rel, await readHostFile(path.join(workingDir, rel)) ]);
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=\.\.?\//m.test(envText)) {
        rewrite.notes.push(".env has values starting with ./ - if they are used as paths in the compose file, they now resolve from Dockge's stack folder");
    }

    // Backup: the original files as read, what Docker currently runs, and how to find the original
    const id = `${name}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    const backupDir = path.join(backupRoot(server), id);
    await fsAsync.mkdir(path.join(backupDir, "original"), { recursive: true });
    await fsAsync.writeFile(path.join(backupDir, "original", path.basename(configFiles[0])), mainText);
    if (overrideText) {
        await fsAsync.writeFile(path.join(backupDir, "original", path.basename(configFiles[1])), overrideText);
    }
    if (envText) {
        await fsAsync.writeFile(path.join(backupDir, "original", ".env"), envText);
    }
    try {
        const ids = await childProcessAsync.spawn("docker", [ "ps", "-aq", "--filter", `label=com.docker.compose.project=${name}` ], { encoding: "utf-8" });
        const list = String(ids.stdout || "").split("\n").filter(Boolean);
        if (list.length > 0) {
            const inspect = await childProcessAsync.spawn("docker", [ "inspect", ...list ], { encoding: "utf-8",
                maxBuffer: 64 * 1024 * 1024 });
            await fsAsync.writeFile(path.join(backupDir, "containers.inspect.json"), String(inspect.stdout || ""));
        }
    } catch (e) {
        log.warn("stack-import", `Could not record docker inspect for ${name}: ${e}`);
    }
    const record : ImportRecord = {
        id,
        name,
        importedAt: new Date().toISOString(),
        workingDir,
        configFiles,
        targetDir,
        redeployed: false,
        notes: rewrite.notes,
    };
    const saveRecord = () => fsAsync.writeFile(path.join(backupDir, "import.json"), JSON.stringify(record, null, 4));
    await saveRecord();

    // Write the Dockge copy
    const composeOut = mainDoc.toString({ indent: detectIndent(mainText),
        lineWidth: 0,
        flowCollectionPadding: false });
    try {
        await fsAsync.mkdir(targetDir, { recursive: true });
        await fsAsync.writeFile(path.join(targetDir, "compose.yaml"), composeOut);
        if (overrideOut) {
            await fsAsync.writeFile(path.join(targetDir, "compose.override.yaml"), overrideOut);
        }
        if (envText) {
            await fsAsync.writeFile(path.join(targetDir, ".env"), envText);
        }
        for (const [ rel, content ] of envCopies) {
            await fsAsync.mkdir(path.dirname(path.join(targetDir, rel)), { recursive: true });
            await fsAsync.writeFile(path.join(targetDir, rel), content);
        }

        const validation = await validateCompose(server, name, composeOut, envText, overrideOut);
        if (!validation.valid) {
            throw new ValidationError(`The imported files aren't valid compose, so nothing was changed:\n${validation.message}`);
        }
    } catch (e) {
        await fsAsync.rm(targetDir, { recursive: true,
            force: true });
        await fsAsync.rm(backupDir, { recursive: true,
            force: true });
        throw e;
    }

    if (redeploy) {
        const stack = await Stack.getStack(server, name);
        try {
            // Force a recreate: the moved file means the same thing, so a plain "up" would leave the
            // containers labelled with (and later redeployed from) the old folder
            await stack.deploy(socket, true);
            record.redeployed = true;
            await saveRecord();
        } catch (e) {
            // The originals are untouched; keep the Dockge copy out of the way so nothing is half-done
            await fsAsync.rm(targetDir, { recursive: true,
                force: true });
            await fsAsync.rm(backupDir, { recursive: true,
                force: true });
            throw new Error(`Imported, but redeploying from Dockge failed, so the import was undone: ${e instanceof Error ? e.message : e}`);
        }
    }

    server.sendStackList();
    return {
        name,
        ok: true,
        msg: record.redeployed ? "Imported and redeployed from Dockge" : "Imported",
        notes: rewrite.notes,
    };
}

/**
 * Imports that can still be rolled back.
 * @param server Server
 * @returns Records, newest first
 */
export async function listImports(server : DockgeServer) : Promise<ImportRecord[]> {
    const root = backupRoot(server);
    if (!await fileExists(root)) {
        return [];
    }
    const records : ImportRecord[] = [];
    for (const id of await fsAsync.readdir(root)) {
        try {
            records.push(JSON.parse(await fsAsync.readFile(path.join(root, id, "import.json"), "utf-8")));
        } catch {
            // Not an import record
        }
    }
    return records.sort((a, b) => b.importedAt.localeCompare(a.importedAt));
}

async function getRecord(server : DockgeServer, id : string) : Promise<ImportRecord> {
    if (!/^[a-z0-9_-]+-[0-9T-]+Z$/.test(id)) {
        throw new ValidationError("Invalid import id");
    }
    const file = path.join(backupRoot(server), id, "import.json");
    if (!await fileExists(file)) {
        throw new ValidationError("That import no longer exists");
    }
    return JSON.parse(await fsAsync.readFile(file, "utf-8"));
}

/**
 * Undo an import: remove Dockge's copy of the stack. Running containers are left alone, and the
 * original folder was never changed, so the stack keeps running from wherever it runs now.
 * @param server Server
 * @param id Import id
 * @returns A message for the user
 */
export async function rollbackImport(server : DockgeServer, id : string) : Promise<string> {
    const record = await getRecord(server, id);
    await fsAsync.rm(record.targetDir, { recursive: true,
        force: true });
    await fsAsync.rm(path.join(backupRoot(server), id), { recursive: true,
        force: true });
    server.sendStackList();
    return record.redeployed
        ? `Removed ${record.name} from Dockge. Its containers keep running; to run it from its original files again, run "docker compose up -d" in ${record.workingDir}.`
        : `Removed ${record.name} from Dockge. It's back to how it was.`;
}

/**
 * Keep an import for good: drop its rollback record (the stack stays in Dockge).
 * @param server Server
 * @param id Import id
 * @returns void
 */
export async function finalizeImport(server : DockgeServer, id : string) : Promise<void> {
    await getRecord(server, id);
    await fsAsync.rm(path.join(backupRoot(server), id), { recursive: true,
        force: true });
}
