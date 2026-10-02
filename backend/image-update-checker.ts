import childProcessAsync from "promisify-child-process";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { parseDocument } from "yaml";
import { DockgeServer } from "./dockge-server";
import { Stack } from "./stack";
import { Settings } from "./settings";
import { interpolate } from "../common/compose-ports";
import { log } from "./log";

/*
 * "Update available" detection: for each image a Dockge stack uses, ask the image's registry for the
 * digest its tag points at now and compare it with the digests Docker recorded when the local copy
 * was pulled (RepoDigests). Talks to the registry's HTTP API directly (HEAD on the manifest), so no
 * skopeo is needed; Docker Hub doesn't count HEAD requests against its pull rate limit.
 *
 * Images that can't be compared are skipped, never reported as updates: not pulled yet, built
 * locally (a `build:` service, or no RepoDigests), pinned by digest, `pull_policy: build/never`, or
 * a registry that fails or doesn't know the image (Docker Hub answers 401 for a missing repository).
 * Docker 29's containerd store records a digest even for images built with `docker build`, so an
 * image built outside compose is only skipped when its name isn't on a registry.
 */

export const DEFAULT_CHECK_INTERVAL_HOURS = 6;
const TICK_MS = 10 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 15 * 1000;
const CONCURRENCY = 4;

const MANIFEST_ACCEPT = [
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

export interface ImageRef {
    // Registry host to call ("registry-1.docker.io" for Docker Hub)
    host : string;
    // Repository path on that registry ("library/nginx")
    repository : string;
    tag : string;
}

export interface ImageCheckResult {
    updateAvailable : boolean;
    // Why the image couldn't be compared, if it couldn't
    skipped? : string;
    checkedAt : number;
}

export interface CheckSummary {
    images : number;
    updates : number;
    skipped : number;
    checkedAt : number;
}

/**
 * Split an image reference into registry host, repository and tag, the way Docker resolves it.
 * @param ref Image reference ("nginx", "ghcr.io/owner/app:1.2", "localhost:5000/x")
 * @returns The parts, or null for a reference pinned by digest (it can never have an update)
 */
export function parseImageRef(ref : string) : ImageRef | null {
    ref = ref.trim();
    if (!ref || ref.includes("@")) {
        return null;
    }
    let name = ref;
    let tag = "latest";
    const lastSlash = name.lastIndexOf("/");
    const lastColon = name.lastIndexOf(":");
    if (lastColon > lastSlash) {
        tag = name.slice(lastColon + 1);
        name = name.slice(0, lastColon);
    }
    let host = "docker.io";
    const firstSlash = name.indexOf("/");
    if (firstSlash > 0) {
        const first = name.slice(0, firstSlash);
        if (first.includes(".") || first.includes(":") || first === "localhost") {
            host = first;
            name = name.slice(firstSlash + 1);
        }
    }
    if (host === "docker.io" || host === "index.docker.io") {
        host = "registry-1.docker.io";
        if (!name.includes("/")) {
            name = "library/" + name;
        }
    }
    return { host,
        repository: name,
        tag };
}

/**
 * Credentials from the Docker CLI config (`docker login`), if any. Credential helpers aren't
 * supported; without credentials the registry is called anonymously, which works for public images.
 * @param host Registry host
 * @returns "user:password" base64, as stored in config.json
 */
function registryAuth(host : string) : string | undefined {
    try {
        const dir = process.env.DOCKER_CONFIG || path.join(os.homedir(), ".docker");
        const auths = JSON.parse(fs.readFileSync(path.join(dir, "config.json"), "utf-8"))?.auths ?? {};
        const keys = host === "registry-1.docker.io"
            ? [ "https://index.docker.io/v1/", "index.docker.io", "docker.io", "registry-1.docker.io" ]
            : [ host, `https://${host}`, `https://${host}/v1/`, `https://${host}/v2/` ];
        for (const key of keys) {
            if (typeof auths[key]?.auth === "string" && auths[key].auth) {
                return auths[key].auth;
            }
        }
    } catch {
        // No config, or unreadable: anonymous
    }
    return undefined;
}

/**
 * Parse a WWW-Authenticate header: `Bearer realm="...",service="...",scope="..."`.
 * @param header Header value
 * @returns Scheme and parameters
 */
function parseChallenge(header : string) : { scheme : string, params : Record<string, string> } {
    const space = header.indexOf(" ");
    const scheme = (space > 0 ? header.slice(0, space) : header).toLowerCase();
    const params : Record<string, string> = {};
    for (const m of header.slice(space + 1).matchAll(/(\w+)="([^"]*)"/g)) {
        params[m[1]] = m[2];
    }
    return { scheme,
        params };
}

/**
 * The digest the registry currently serves for an image tag (a multi-platform index digest for
 * multi-platform images, which is also what Docker records in RepoDigests on pull).
 * @param image Parsed reference
 * @returns Digest ("sha256:...")
 */
export async function remoteDigest(image : ImageRef) : Promise<string> {
    const url = `https://${image.host}/v2/${image.repository}/manifests/${encodeURIComponent(image.tag)}`;
    const basic = registryAuth(image.host);
    const request = (method : string, authorization? : string) => fetch(url, {
        method,
        headers: { Accept: MANIFEST_ACCEPT,
            ...(authorization ? { Authorization: authorization } : {}) },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    let authorization : string | undefined;
    let res = await request("HEAD");
    if (res.status === 401) {
        const { scheme, params } = parseChallenge(res.headers.get("www-authenticate") ?? "");
        if (scheme === "bearer" && params.realm) {
            const tokenUrl = new URL(params.realm);
            if (params.service) {
                tokenUrl.searchParams.set("service", params.service);
            }
            tokenUrl.searchParams.set("scope", params.scope || `repository:${image.repository}:pull`);
            const tokenRes = await fetch(tokenUrl, {
                headers: basic ? { Authorization: `Basic ${basic}` } : {},
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
            if (!tokenRes.ok) {
                throw new Error(tokenRes.status === 401 || tokenRes.status === 403 ? "not on the registry, or needs credentials" : `registry token request failed (HTTP ${tokenRes.status})`);
            }
            const body = await tokenRes.json() as { token? : string, access_token? : string };
            const token = body.token || body.access_token;
            if (!token) {
                throw new Error("registry returned no token");
            }
            authorization = `Bearer ${token}`;
        } else if (scheme === "basic" && basic) {
            authorization = `Basic ${basic}`;
        } else {
            throw new Error("not on the registry, or needs credentials");
        }
        res = await request("HEAD", authorization);
    }
    if (!res.ok) {
        throw new Error(res.status === 401 || res.status === 403 || res.status === 404 ? "not on the registry, or needs credentials" : `registry answered HTTP ${res.status}`);
    }
    const digest = res.headers.get("docker-content-digest");
    if (digest) {
        return digest;
    }
    // Some registries leave the header off HEAD responses: hash the manifest itself
    const get = await request("GET", authorization);
    if (!get.ok) {
        throw new Error(`registry answered HTTP ${get.status}`);
    }
    return "sha256:" + crypto.createHash("sha256").update(Buffer.from(await get.arrayBuffer())).digest("hex");
}

/**
 * Digests Docker recorded for the local image when it was pulled.
 * @param ref Image reference
 * @returns Digests, empty for a locally built image, or null if the image isn't present locally
 */
async function localDigests(ref : string) : Promise<string[] | null> {
    try {
        const res = await childProcessAsync.spawn("docker", [ "image", "inspect", "--format", "{{json .RepoDigests}}", ref ], {
            encoding: "utf-8",
        });
        const list = JSON.parse(String(res.stdout ?? "").trim() || "null");
        if (!Array.isArray(list)) {
            return [];
        }
        return list.map((d : string) => d.slice(d.indexOf("@") + 1)).filter((d : string) => d.startsWith("sha256:"));
    } catch {
        return null;
    }
}

/**
 * Compare one image's local copy with its registry.
 * @param ref Image reference
 * @returns Result
 */
export async function checkImage(ref : string) : Promise<ImageCheckResult> {
    const checkedAt = Date.now();
    const parsed = parseImageRef(ref);
    if (!parsed) {
        return { updateAvailable: false,
            skipped: "pinned by digest",
            checkedAt };
    }
    const local = await localDigests(ref);
    if (local === null) {
        return { updateAvailable: false,
            skipped: "not pulled",
            checkedAt };
    }
    if (local.length === 0) {
        return { updateAvailable: false,
            skipped: "built locally",
            checkedAt };
    }
    try {
        const remote = await remoteDigest(parsed);
        return { updateAvailable: !local.includes(remote),
            checkedAt };
    } catch (e) {
        return { updateAvailable: false,
            skipped: e instanceof Error ? (e.name === "TimeoutError" ? "registry timed out" : e.message) : "registry error",
            checkedAt };
    }
}

/**
 * The image each service of a stack runs, with the stack's .env and global.env applied; the
 * override file's image wins. Services that are built locally or never pulled are left out.
 * @param stack Stack
 * @returns Service name -> image reference
 */
export function stackServiceImages(stack : Stack) : Record<string, string> {
    const env = stack.composeVariables();
    const images : Record<string, string> = {};
    const skip = new Set<string>();
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
        for (const [ name, service ] of Object.entries(services as Record<string, { image? : unknown, build? : unknown, pull_policy? : unknown }>)) {
            // Built here: its image name may exist on a registry, but that isn't where it comes from
            if (service?.build !== undefined || service?.pull_policy === "build" || service?.pull_policy === "never") {
                skip.add(name);
            }
            if (typeof service?.image !== "string") {
                continue;
            }
            const resolved = interpolate(service.image, env).trim();
            if (resolved && !resolved.includes("$")) {
                images[name] = resolved;
            }
        }
    }
    for (const name of skip) {
        delete images[name];
    }
    return images;
}

async function mapLimit<T>(items : T[], limit : number, fn : (item : T) => Promise<void>) {
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            await fn(items[next++]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export class ImageUpdateChecker {
    static readonly INSTANCE = new ImageUpdateChecker();

    // Image reference -> last result
    protected results = new Map<string, ImageCheckResult>();
    // Stack name -> service name -> image reference, from the last time the stack was checked
    protected stackImages = new Map<string, Record<string, string>>();
    protected lastFullCheck = 0;
    protected lastSummaryValue : CheckSummary | null = null;
    protected running : Promise<CheckSummary> | null = null;
    protected timer? : NodeJS.Timeout;

    /** Whether any service of the stack has a newer image on its registry */
    stackHasUpdate(stackName : string) : boolean {
        return Object.keys(this.serviceUpdates(stackName)).length > 0;
    }

    /** Services of the stack with a newer image on their registry (service -> true) */
    serviceUpdates(stackName : string) : Record<string, boolean> {
        const out : Record<string, boolean> = {};
        for (const [ service, ref ] of Object.entries(this.stackImages.get(stackName) ?? {})) {
            if (this.results.get(ref)?.updateAvailable) {
                out[service] = true;
            }
        }
        return out;
    }

    /** Result of the last check of every stack */
    get lastSummary() : CheckSummary | null {
        return this.lastSummaryValue;
    }

    /** When the last check of every stack finished (0 = never) */
    get lastCheckedAt() : number {
        return this.lastFullCheck;
    }

    static async isEnabled() : Promise<boolean> {
        return await Settings.get("imageUpdateCheck") !== false;
    }

    static async intervalHours() : Promise<number> {
        const hours = Number(await Settings.get("imageUpdateCheckInterval"));
        return Number.isFinite(hours) && hours >= 1 ? hours : DEFAULT_CHECK_INTERVAL_HOURS;
    }

    /**
     * Check every Dockge-managed stack. Runs once at a time; a call during a check gets its result.
     * @param server Server
     * @returns Summary
     */
    checkAll(server : DockgeServer) : Promise<CheckSummary> {
        if (!this.running) {
            this.running = this.doCheckAll(server).finally(() => {
                this.running = null;
            });
        }
        return this.running;
    }

    protected async doCheckAll(server : DockgeServer) : Promise<CheckSummary> {
        const stackImages = new Map<string, Record<string, string>>();
        for (const stack of (await Stack.getStackList(server)).values()) {
            if (stack.isManagedByDockge) {
                stackImages.set(stack.name, stackServiceImages(stack));
            }
        }
        const summary = await this.checkRefs(stackImages);
        this.stackImages = stackImages;
        this.lastFullCheck = summary.checkedAt;
        this.lastSummaryValue = summary;
        log.info("imageUpdates", `Checked ${summary.images} image(s): ${summary.updates} update(s) available, ${summary.skipped} skipped`);
        return summary;
    }

    /**
     * Check one stack again, e.g. after it was updated or its compose file changed.
     * @param stack Stack
     */
    async checkStack(stack : Stack) : Promise<void> {
        if (!await ImageUpdateChecker.isEnabled()) {
            return;
        }
        const images = stackServiceImages(stack);
        await this.checkRefs(new Map([[ stack.name, images ]]));
        this.stackImages.set(stack.name, images);
    }

    /**
     * checkStack() without waiting for it; pushes the stack list when done so the badge updates.
     * @param server Server
     * @param stack Stack
     */
    recheckInBackground(server : DockgeServer, stack : Stack) {
        this.checkStack(stack)
            .then(() => server.sendStackList(true))
            .catch((e) => log.warn("imageUpdates", `Check of ${stack.name} failed: ${e instanceof Error ? e.message : e}`));
    }

    /** Drop every result, so no badges show (checking was turned off) */
    clear() {
        this.stackImages.clear();
        this.results.clear();
        this.lastFullCheck = 0;
        this.lastSummaryValue = null;
    }

    /** Forget a stack (deleted) */
    forgetStack(stackName : string) {
        this.stackImages.delete(stackName);
    }

    protected async checkRefs(stackImages : Map<string, Record<string, string>>) : Promise<CheckSummary> {
        const refs = [ ...new Set([ ...stackImages.values() ].flatMap(images => Object.values(images))) ];
        let updates = 0;
        let skipped = 0;
        await mapLimit(refs, CONCURRENCY, async (ref) => {
            const result = await checkImage(ref);
            this.results.set(ref, result);
            if (result.updateAvailable) {
                updates++;
            }
            if (result.skipped) {
                skipped++;
                log.debug("imageUpdates", `${ref}: skipped (${result.skipped})`);
            }
        });
        return { images: refs.length,
            updates,
            skipped,
            checkedAt: Date.now() };
    }

    /**
     * Check in the background, every `imageUpdateCheckInterval` hours while enabled, first a
     * minute after startup. Pushes the stack list afterwards so the badges show up.
     * @param server Server
     */
    startInterval(server : DockgeServer) {
        const tick = async () => {
            try {
                if (!await ImageUpdateChecker.isEnabled()) {
                    if (this.lastFullCheck) {
                        this.clear();
                        await server.sendStackList(true);
                    }
                    return;
                }
                const due = this.lastFullCheck + (await ImageUpdateChecker.intervalHours()) * 3600 * 1000;
                if (Date.now() >= due) {
                    await this.checkAll(server);
                    await server.sendStackList(true);
                }
            } catch (e) {
                log.warn("imageUpdates", `Check failed: ${e instanceof Error ? e.message : e}`);
            }
        };
        setTimeout(() => {
            tick();
            this.timer = setInterval(tick, TICK_MS);
        }, FIRST_CHECK_DELAY_MS);
    }
}
