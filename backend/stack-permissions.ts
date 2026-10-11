import fs from "fs";
import path from "path";
import yaml from "yaml";
import { log } from "./log";
import { interpolate } from "../common/compose-ports";

/** Stack and bind-mount folders: the same 0755 Docker uses when it creates a missing bind source */
export const STACK_DIR_MODE = 0o755;

/** .env / global.env usually hold secrets: owner only */
export const SECRET_FILE_MODE = 0o600;

export interface StackOwner {
    uid: number;
    gid: number;
}

const ID_PATTERN = /^\d+$/;

/**
 * Parse PUID/PGID. Both unset means "leave ownership alone".
 * @returns the owner, or undefined when neither is set
 * @throws Error when only one is set or a value is not a non-negative integer
 */
export function parseStackOwner(env: NodeJS.ProcessEnv = process.env): StackOwner | undefined {
    const puid = env.PUID?.trim();
    const pgid = env.PGID?.trim();

    if (!puid && !pgid) {
        return undefined;
    }
    if (!puid || !pgid) {
        throw new Error("PUID and PGID must be set together (only one of them is set)");
    }
    if (!ID_PATTERN.test(puid) || !ID_PATTERN.test(pgid)) {
        throw new Error(`PUID and PGID must be numeric ids (got PUID=${puid}, PGID=${pgid})`);
    }
    return {
        uid: Number(puid),
        gid: Number(pgid),
    };
}

let cachedOwner: StackOwner | undefined | null = null;

/**
 * The stack owner from PUID/PGID, cached after the first call. Invalid values are ignored
 * (ownership is left alone, as before 2.4.0); DockgeServer reports them at startup.
 * @returns the owner, or undefined when unset or invalid
 */
export function getStackOwner(): StackOwner | undefined {
    if (cachedOwner === null) {
        try {
            cachedOwner = parseStackOwner();
        } catch (e) {
            cachedOwner = undefined;
        }
    }
    return cachedOwner;
}

/** Set once the non-root chown warning has been logged */
let chownWarned = false;

/**
 * chown a path Dockge wrote to PUID/PGID, if configured. Never follows symlinks.
 * @param target Path to chown
 */
export function applyStackOwner(target: string) {
    const owner = getStackOwner();
    if (!owner) {
        return;
    }
    try {
        fs.lchownSync(target, owner.uid, owner.gid);
    } catch (e) {
        // Not root (started with `user:`): the file is already ours, so a save must not fail over its group
        const code = (e as NodeJS.ErrnoException)?.code;
        if (process.getuid?.() !== 0 && (code === "EPERM" || code === "EACCES")) {
            if (!chownWarned) {
                chownWarned = true;
                log.warn("stack", `Cannot set owner ${owner.uid}:${owner.gid} as ${processUser()}; files keep this user's ownership. `
                    + "Remove `user:` from Dockge's compose file to let it switch to PUID/PGID itself.");
            }
            return;
        }
        throw permissionError(e, `set owner ${owner.uid}:${owner.gid} on`, target);
    }
}

/**
 * Describe the user this process runs as, for messages
 * @returns e.g. "uid 1000 gid 989"
 */
export function processUser(): string {
    const uid = process.getuid?.();
    return uid === undefined ? "this process" : `uid ${uid} gid ${process.getgid?.()}`;
}

/**
 * Turn EACCES/EPERM into a message a user can act on; other errors pass through unchanged.
 * The message reaches the UI as an error toast through callbackError.
 * @param e The caught error
 * @param action What was being done, e.g. "write"
 * @param target The path involved
 * @returns The error to throw
 */
export function permissionError(e: unknown, action: string, target: string): unknown {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code !== "EACCES" && code !== "EPERM") {
        return e;
    }
    return new Error(`Permission denied: Dockge (${processUser()}) cannot ${action} ${target}. `
        + "Restart Dockge with PUID/PGID set so it fixes the ownership of its folders, or fix the owner of that folder on the host.");
}

/**
 * Write a file that may contain secrets: created 0600, and tightened to 0600 if it already existed.
 * @param target File path
 * @param content File content
 */
export function writeSecretFile(target: string, content: string) {
    try {
        fs.writeFileSync(target, content, { mode: SECRET_FILE_MODE });
        fs.chmodSync(target, SECRET_FILE_MODE);
    } catch (e) {
        throw permissionError(e, "write", target);
    }
    applyStackOwner(target);
}

/**
 * Split short volume syntax on ":", keeping "${VAR:-default}" in one piece
 * @param volume e.g. "${DATA:-./data}:/data:ro"
 * @returns The parts
 */
function splitShortVolume(volume: string): string[] {
    const parts: string[] = [];
    let current = "";
    let depth = 0;

    for (let i = 0; i < volume.length; i++) {
        const c = volume[i];
        if (c === "$" && volume[i + 1] === "{") {
            depth++;
        } else if (c === "}" && depth > 0) {
            depth--;
        } else if (c === ":" && depth === 0) {
            parts.push(current);
            current = "";
            continue;
        }
        current += c;
    }
    parts.push(current);
    return parts;
}

/**
 * Collect the bind-mount sources of every service, in short ("./data:/data") and long syntax.
 * @param composeDocs Parsed compose documents (compose.yaml, compose.override.yaml)
 * @returns Raw source strings
 */
export function collectBindSources(composeDocs: unknown[]): string[] {
    const sources: string[] = [];

    for (const doc of composeDocs) {
        const services = (doc as { services?: unknown } | null)?.services;
        if (!services || typeof services !== "object") {
            continue;
        }

        for (const service of Object.values(services as Record<string, unknown>)) {
            const volumes = (service as { volumes?: unknown } | null)?.volumes;
            if (!Array.isArray(volumes)) {
                continue;
            }

            for (const volume of volumes) {
                if (typeof volume === "string") {
                    // "SOURCE:TARGET[:MODE]". A lone path is a container path (anonymous volume),
                    // and a named volume ("data:/data") starts with neither "." nor "/" nor "$"
                    const parts = splitShortVolume(volume);
                    const source = parts[0];
                    if (parts.length > 1 && /^[./~$]/.test(source)) {
                        sources.push(source);
                    }
                } else if (volume && typeof volume === "object") {
                    const v = volume as { type?: unknown, source?: unknown, bind?: { create_host_path?: unknown } };
                    if (v.type === "bind" && typeof v.source === "string" && v.bind?.create_host_path !== false) {
                        sources.push(v.source);
                    }
                }
            }
        }
    }
    return sources;
}

/**
 * Create a directory path inside root one level at a time, refusing to pass through symlinks
 * or anything that is not a directory.
 * @param root Stack folder or bind root (must already exist)
 * @param relative Path relative to root, already checked not to escape it
 * @returns true when the full path now exists as a real directory tree
 */
function mkdirInside(root: string, relative: string): boolean {
    const base = path.resolve(root);
    const realBase = fs.realpathSync(base);
    let current = base;

    for (const part of relative.split(path.sep)) {
        if (part === "" || part === ".") {
            continue;
        }
        current = path.resolve(current, part);
        // Checked again here, right before the filesystem calls, not only by the caller
        if (!current.startsWith(base + path.sep)) {
            return false;
        }

        let stat: fs.Stats | undefined;
        try {
            stat = fs.lstatSync(current);
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
                throw e;
            }
        }

        if (stat) {
            if (!stat.isDirectory()) {
                // Symlink or file: never create through it
                return false;
            }
            continue;
        }

        fs.mkdirSync(current, { mode: STACK_DIR_MODE });

        // A path component swapped for a symlink after the lstat above would put the new folder
        // elsewhere: check where it really landed, and undo the mkdir if that's outside root
        const real = fs.realpathSync(current);
        if (real !== realBase && !real.startsWith(realBase + path.sep)) {
            fs.rmdirSync(current);
            return false;
        }
        applyStackOwner(current);
    }
    return true;
}

/**
 * Parse DOCKGE_BIND_ROOTS: absolute folders, separated by commas or colons, under which Dockge may
 * create missing absolute bind-mount folders. Each must be mounted into Dockge at the same path.
 * @param value DOCKGE_BIND_ROOTS
 * @returns Normalized absolute paths, never "/"
 */
export function parseBindRoots(value: string | undefined): string[] {
    const roots: string[] = [];
    for (const raw of (value ?? "").split(/[,:]/)) {
        const root = raw.trim();
        if (root === "" || !path.isAbsolute(root)) {
            continue;
        }
        const resolved = path.resolve(root);
        if (resolved !== path.parse(resolved).root && !roots.includes(resolved)) {
            roots.push(resolved);
        }
    }
    return roots;
}

/**
 * Substitute compose variables into a bind source. Unset variables without a default make the
 * path unknowable, so the source is skipped rather than guessed.
 * @param source Raw source from the compose file
 * @param env Variables (global.env, then the stack's .env)
 * @returns The substituted path, or undefined to skip it
 */
function resolveBindSource(source: string, env: Record<string, string>): string | undefined {
    if (!source.includes("$")) {
        return source;
    }
    for (const match of source.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)(:?[-?+])?/g)) {
        const hasDefault = match[2] === "-" || match[2] === ":-";
        if (!Object.hasOwn(env, match[1]) && !hasDefault) {
            return undefined;
        }
    }
    const resolved = interpolate(source, env);
    return resolved.includes("$") ? undefined : resolved;
}

/**
 * Where a bind source may be created: the folder to create inside, and the path relative to it.
 * @param stackDir Stack folder (relative sources resolve against it)
 * @param source Substituted bind source
 * @param bindRoots Allowed roots for absolute sources
 * @returns The root and relative path, or undefined when Dockge must not create it
 */
function bindTarget(stackDir: string, source: string, bindRoots: string[]): { root: string, relative: string } | undefined {
    if (source.startsWith("~")) {
        return undefined;
    }
    const target = path.resolve(stackDir, source);
    const roots = path.isAbsolute(source) ? bindRoots : [ stackDir ];

    for (const root of roots) {
        const relative = path.relative(root, target);
        if (relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)) {
            return { root,
                relative };
        }
    }
    return undefined;
}

/**
 * Pre-create missing bind-mount folders before `compose up`, so the Docker daemon doesn't create
 * them as root. Relative sources are created inside the stack folder; absolute ones only under a
 * bind root that exists inside Dockge. Anything else ("~", unknown variables, paths escaping their
 * root, symlinks on the way) is left to Docker, as before.
 * @param stackDir Stack folder (compose project directory)
 * @param composeYAMLs compose.yaml and compose.override.yaml contents
 * @param env Variables compose substitutes (global.env, then the stack's .env)
 * @param bindRoots Allowed roots for absolute sources (DOCKGE_BIND_ROOTS)
 * @returns Warnings for folders that could not be prepared, for the UI
 */
export function createBindMountDirs(stackDir: string, composeYAMLs: string[], env: Record<string, string> = {}, bindRoots: string[] = []): string[] {
    const root = path.resolve(stackDir);
    const docs: unknown[] = [];
    const warnings: string[] = [];

    for (const content of composeYAMLs) {
        if (content.trim() === "") {
            continue;
        }
        try {
            docs.push(yaml.parse(content));
        } catch (e) {
            // Invalid YAML: compose reports it properly on `up`
            return warnings;
        }
    }

    // A root that isn't mounted into Dockge would be created inside the container, where nobody sees it
    const mountedRoots = bindRoots.filter((r) => fs.existsSync(r) && fs.statSync(r).isDirectory());

    for (const rawSource of new Set(collectBindSources(docs))) {
        const source = resolveBindSource(rawSource, env);
        const target = source === undefined ? undefined : bindTarget(root, source, mountedRoots);
        if (!target) {
            continue;
        }

        try {
            if (!mkdirInside(target.root, target.relative)) {
                warnings.push(`Bind mount ${rawSource} was not prepared: part of the path is a symlink or a file. `
                    + "If Docker creates it, it will be owned by root.");
            }
        } catch (e) {
            // Never block a deploy over this; compose creates the folder itself as before
            const code = (e as NodeJS.ErrnoException)?.code ?? String(e);
            warnings.push(`Could not create bind-mount folder ${rawSource} as ${processUser()} (${code}). `
                + "Docker will create it as root, and the container may not be able to write to it.");
        }
    }

    for (const warning of warnings) {
        log.warn("stack", `${root}: ${warning}`);
    }
    return warnings;
}

/**
 * Startup check: a folder Dockge writes to must exist (or be creatable) and be writable by this process.
 * @param dir Folder to check
 * @param label What it is, for the message, e.g. "Stacks directory"
 * @param hint What to check, appended to the message
 * @returns An error message, or undefined when it's fine
 */
export function checkWritableDir(dir: string, label: string, hint: string): string | undefined {
    if (!fs.existsSync(dir)) {
        try {
            fs.mkdirSync(dir, { recursive: true });
        } catch (e) {
            return `${label} ${dir} does not exist and could not be created `
                + `(${(e as NodeJS.ErrnoException).code ?? e}). ${hint}`;
        }
    }

    if (!fs.statSync(dir).isDirectory()) {
        return `${label} ${dir} is not a directory. ${hint}`;
    }

    try {
        fs.accessSync(dir, fs.constants.W_OK | fs.constants.X_OK);
    } catch (e) {
        return `${label} ${dir} is not writable by ${processUser()}. ${hint}`;
    }
    return undefined;
}

/**
 * Startup check for DOCKGE_STACKS_DIR
 * @param stacksDir DOCKGE_STACKS_DIR
 * @returns An error message, or undefined when it's fine
 */
export function checkStacksDir(stacksDir: string): string | undefined {
    return checkWritableDir(stacksDir, "Stacks directory",
        "Check that DOCKGE_STACKS_DIR matches the container side of a mounted volume "
        + "(left and right paths identical), and that the host folder is writable by " + processUser() + ".");
}

/**
 * Startup check for the data directory (database, settings)
 * @param dataDir Data directory
 * @returns An error message, or undefined when it's fine
 */
export function checkDataDir(dataDir: string): string | undefined {
    return checkWritableDir(dataDir, "Data directory",
        "Check that the folder mounted at /app/data is writable by " + processUser() + ".");
}
