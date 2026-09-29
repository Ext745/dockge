import { promises as fsAsync } from "fs";

let cached : string | null | undefined;

/**
 * The id of the container Dockge itself runs in, or null when it isn't in one (bare install).
 *
 * Read from /proc/self/mountinfo first: the runtime bind-mounts the container's own hostname, hosts
 * and resolv.conf files from a folder named after its full id (Docker: .../containers/<id>/, Podman:
 * .../overlay-containers/<id>/), so this holds whatever the hostname is - including a custom
 * `hostname:` or `network_mode: host`, where $HOSTNAME is not the container id. $HOSTNAME is only
 * used as a fallback, and only when it looks like a container id.
 * @returns Full or short container id, or null
 */
export async function selfContainerId() : Promise<string | null> {
    if (cached !== undefined) {
        return cached;
    }
    cached = null;
    try {
        const mountinfo = await fsAsync.readFile("/proc/self/mountinfo", "utf-8");
        const match = mountinfo.match(/\/(?:overlay-)?containers\/([0-9a-f]{64})\//);
        if (match) {
            cached = match[1];
            return cached;
        }
    } catch {
        // Not Linux, or /proc unavailable
    }
    const hostname = process.env.HOSTNAME ?? "";
    if (/^[0-9a-f]{12,64}$/.test(hostname)) {
        cached = hostname;
    }
    return cached;
}

/**
 * Whether a container id (short or full) is Dockge's own container.
 * @param id Container id as printed by docker (12 or 64 hex characters)
 * @returns Is Dockge
 */
export async function isSelfContainer(id : string) : Promise<boolean> {
    const self = await selfContainerId();
    const other = id.trim();
    return Boolean(self && other && (self.startsWith(other) || other.startsWith(self)));
}
