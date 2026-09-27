import childProcessAsync from "promisify-child-process";
import { DockgeServer } from "./dockge-server";
import { Stack } from "./stack";
import { log } from "./log";
import { dockerPsHostPorts, hostPort, hostPortNumbers, stackComposePorts } from "../common/compose-ports";

export interface PortUser {
    name : string;
    running : boolean;
    // "stack": a compose project; "container": a container started outside compose
    kind : "stack" | "container";
}

export interface PortConflict {
    // Host port or range as written in the edited stack
    port : string;
    users : PortUser[];
}

/**
 * Collects who else uses the host ports an edited stack wants, grouped by the edited stack's port entries.
 */
class PortClaims {
    // Host port -> the edited stack's entries ("8080", "9000-9010") that bind it
    protected wanted = new Map<number, Set<string>>();
    // Entry -> users by name
    protected users = new Map<string, Map<string, PortUser>>();
    // Entry -> position in the compose file
    protected order = new Map<string, number>();

    constructor(entries : string[]) {
        for (const entry of entries) {
            const display = hostPort(entry);
            for (const port of hostPortNumbers(entry)) {
                let displays = this.wanted.get(port);
                if (!displays) {
                    displays = new Set();
                    this.wanted.set(port, displays);
                }
                displays.add(display);
                if (!this.order.has(display)) {
                    this.order.set(display, this.order.size);
                }
            }
        }
    }

    get isEmpty() : boolean {
        return this.wanted.size === 0;
    }

    claim(port : number, user : PortUser) {
        for (const display of this.wanted.get(port) ?? []) {
            let users = this.users.get(display);
            if (!users) {
                users = new Map();
                this.users.set(display, users);
            }
            const known = users.get(user.name);
            if (known) {
                known.running ||= user.running;
            } else {
                users.set(user.name, { ...user });
            }
        }
    }

    conflicts() : PortConflict[] {
        return [ ...this.users.entries() ]
            .sort(([ a ], [ b ]) => (this.order.get(a) ?? 0) - (this.order.get(b) ?? 0))
            .map(([ port, users ]) => ({
                port,
                users: [ ...users.values() ].sort((a, b) => Number(b.running) - Number(a.running) || a.name.localeCompare(b.name)),
            }));
    }
}

/**
 * Host ports that an edited (not yet saved) stack would publish and that something else on this host already
 * claims: another stack's compose files (running or not), or any running container.
 * @param {DockgeServer} server Server
 * @param {string} stackName Name of the edited stack; its own containers and files are not conflicts
 * @param {string} composeYAML Edited compose.yaml
 * @param {string} composeENV Edited .env
 * @param {string} composeOverrideYAML Edited compose.override.yaml
 * @returns {Promise<PortConflict[]>} Conflicts, in compose order
 */
export async function findPortConflicts(server : DockgeServer, stackName : string, composeYAML : string, composeENV : string, composeOverrideYAML : string) : Promise<PortConflict[]> {
    const edited = new Stack(server, stackName, composeYAML, composeENV, composeOverrideYAML, true);
    const claims = new PortClaims(stackComposePorts(composeYAML, composeOverrideYAML, edited.composeVariables(composeENV)));
    if (claims.isEmpty) {
        return [];
    }
    await claimFromStacks(server, stackName, claims);
    await claimFromContainers(stackName, claims);
    return claims.conflicts();
}

/**
 * Ports in the compose files of every other stack, running or not.
 * @param {DockgeServer} server Server
 * @param {string} stackName Edited stack, skipped
 * @param {PortClaims} claims Collector
 * @returns {Promise<void>}
 */
async function claimFromStacks(server : DockgeServer, stackName : string, claims : PortClaims) {
    const stackList = await Stack.getStackList(server, true);
    for (const stack of stackList.values()) {
        if (stack.name === stackName) {
            continue;
        }
        const user : PortUser = { name: stack.name, running: stack.isStarted, kind: "stack" };
        for (const port of stack.extractPorts().flatMap(hostPortNumbers)) {
            claims.claim(port, user);
        }
    }
}

/**
 * Ports of running containers. This catches what compose files cannot show: stacks not managed by Dockge and plain
 * `docker run` containers.
 * @param {string} stackName Edited stack, whose own containers are skipped
 * @param {PortClaims} claims Collector
 * @returns {Promise<void>}
 */
async function claimFromContainers(stackName : string, claims : PortClaims) {
    let stdout = "";
    try {
        const res = await childProcessAsync.spawn("docker", [ "ps", "--format", "{{.Names}}\t{{.Label \"com.docker.compose.project\"}}\t{{.Ports}}" ], {
            encoding: "utf-8",
        });
        stdout = res.stdout?.toString() ?? "";
    } catch (e) {
        log.warn("findPortConflicts", `docker ps failed: ${e instanceof Error ? e.message : e}`);
        return;
    }
    for (const line of stdout.split("\n")) {
        const [ containerName, project, ports ] = line.split("\t");
        if (!containerName || !ports || project === stackName) {
            continue;
        }
        const user : PortUser = project ? { name: project, running: true, kind: "stack" } : { name: containerName, running: true, kind: "container" };
        for (const port of dockerPsHostPorts(ports)) {
            claims.claim(port, user);
        }
    }
}
