import { CREATED_FILE, CREATED_STACK, EXITED, RUNNING, UNKNOWN } from "../../common/util-common";
import { hostPort, hostPortNumbers } from "../../common/compose-ports";

/**
 * Shared stack-list helpers for the desktop sidebar (StackList) and the mobile list (MobileStackList).
 */

// Stacks sort by status in this order, then by name
const STATUS_ORDER = [ RUNNING, EXITED, CREATED_STACK, CREATED_FILE, UNKNOWN ];

/**
 * @param {object} stack A stack from $root.completeStackList
 * @returns {string[]} Its host ports, in compose order
 */
export function stackPorts(stack) : string[] {
    if (!stack?.ports || stack.ports.length === 0) {
        return [];
    }
    return stack.ports.map(hostPort);
}

/**
 * Sort order: managed by Dockge first, then by status, then by name.
 * @param {object} a Stack
 * @param {object} b Stack
 * @returns {number} Comparator result
 */
export function compareStacks(a, b) : number {
    if (a.isManagedByDockge !== b.isManagedByDockge) {
        return a.isManagedByDockge ? -1 : 1;
    }
    if (a.status !== b.status) {
        const rank = (s) => {
            const i = STATUS_ORDER.indexOf(s);
            return i === -1 ? STATUS_ORDER.length : i;
        };
        const diff = rank(a.status) - rank(b.status);
        if (diff !== 0) {
            return diff;
        }
    }
    return a.name.localeCompare(b.name);
}

/**
 * Host ports (as shown on the stack cards) that overlap a port published by more than one running stack, per
 * endpoint ("current" for the local one). A range is included when any port in it conflicts.
 * @param {object[]} stacks All stacks
 * @returns {Record<string, Set<string>>} Conflicting host ports by endpoint
 */
export function conflictingPortsByEndpoint(stacks) : Record<string, Set<string>> {
    const users = portUsers(stacks);
    const result : Record<string, Set<string>> = {};
    for (const stack of stacks) {
        const endpoint = stack.endpoint || "current";
        const byPort = users[endpoint];
        if (!byPort) {
            continue;
        }
        for (const raw of stack.ports ?? []) {
            if (hostPortNumbers(raw).some(port => (byPort.get(port)?.length ?? 0) > 1)) {
                (result[endpoint] ??= new Set()).add(hostPort(raw));
            }
        }
    }
    return result;
}

/**
 * Split a stack's ports into the ones to show and a hidden overflow. Conflicting ports always come
 * first, so a conflict is never hidden behind the "+N" badge.
 * @param {string[]} ports Host ports
 * @param {Set<string>} conflicts Conflicting host ports
 * @param {number} max How many to show
 * @returns {{ visible: string[], hidden: string[] }} Ports to show, and the rest
 */
export function splitPorts(ports : string[], conflicts : Set<string>, max : number) {
    const unique = [ ...new Set(ports) ];
    const ordered = [
        ...unique.filter(p => conflicts.has(p)),
        ...unique.filter(p => !conflicts.has(p)),
    ];
    return {
        visible: ordered.slice(0, max),
        hidden: ordered.slice(max),
    };
}

/**
 * @param {object} stack Stack
 * @returns {string} Its route
 */
export function stackUrl(stack) : string {
    return stack.endpoint ? `/compose/${stack.name}/${stack.endpoint}` : `/compose/${stack.name}`;
}

/**
 * @param {object[]} stacks All stacks
 * @returns {Record<string, Map<number, string[]>>} Running stacks publishing each host port, per endpoint
 */
function portUsers(stacks) : Record<string, Map<number, string[]>> {
    const users : Record<string, Map<number, string[]>> = {};
    for (const stack of stacks) {
        if (stack.status !== RUNNING) {
            continue;
        }
        const byPort = users[stack.endpoint || "current"] ??= new Map();
        for (const port of new Set((stack.ports ?? []).flatMap(hostPortNumbers))) {
            let names = byPort.get(port);
            if (!names) {
                names = [];
                byPort.set(port, names);
            }
            names.push(stack.name);
        }
    }
    return users;
}

/**
 * Every host port published by more than one running stack, with the stacks that publish it. Consecutive ports
 * shared by the same stacks are merged into one range ("8000-8010").
 * @param {object[]} stacks All stacks
 * @returns {{ endpoint: string, port: string, stacks: string[] }[]} Conflicts, sorted by endpoint then port
 */
export function portConflicts(stacks) {
    const result : { endpoint: string, port: string, stacks: string[] }[] = [];
    for (const [ endpoint, byPort ] of Object.entries(portUsers(stacks))) {
        const shared = [ ...byPort.entries() ]
            .filter(([ , names ]) => names.length > 1)
            .map(([ port, names ]) => ({ port, names: names.sort() }))
            .sort((a, b) => a.port - b.port);
        let run : { start: number, end: number, names: string[] } | null = null;
        const flush = () => {
            if (run) {
                result.push({ endpoint, port: run.start === run.end ? String(run.start) : `${run.start}-${run.end}`, stacks: run.names });
            }
        };
        for (const { port, names } of shared) {
            if (run && port === run.end + 1 && names.join("\n") === run.names.join("\n")) {
                run.end = port;
            } else {
                flush();
                run = { start: port, end: port, names };
            }
        }
        flush();
    }
    return result.sort((a, b) => a.endpoint.localeCompare(b.endpoint) || parseInt(a.port) - parseInt(b.port));
}
