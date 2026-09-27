import yaml from "yaml";

/**
 * Port parsing shared by the backend (stack list, save/deploy check) and the frontend (conflict banner).
 */

// Ranges wider than this are only matched on their first and last port, so a typo like 1-65535 stays cheap
export const MAX_EXPANDED_RANGE = 1024;

/**
 * Substitute ${VAR}, ${VAR:-default}, ${VAR-default}, ${VAR:+alt}, ${VAR+alt}, ${VAR:?err}, ${VAR?err}, $VAR and $$
 * the way docker compose does. Unset variables become "".
 * @param {string} value Raw value from a compose file
 * @param {Record<string, string>} env Variables
 * @returns {string} The substituted value
 */
export function interpolate(value : string, env : Record<string, string>) : string {
    let out = "";
    let i = 0;
    while (i < value.length) {
        const c = value[i];
        if (c !== "$") {
            out += c;
            i++;
            continue;
        }
        const next = value[i + 1];
        if (next === "$") {
            out += "$";
            i += 2;
        } else if (next === "{") {
            // Find the matching brace, allowing nested ${...} in defaults
            let depth = 1;
            let j = i + 2;
            while (j < value.length && depth > 0) {
                if (value[j] === "{") {
                    depth++;
                } else if (value[j] === "}") {
                    depth--;
                }
                j++;
            }
            if (depth > 0) {
                out += value.substring(i);
                break;
            }
            out += expandBraced(value.substring(i + 2, j - 1), env);
            i = j;
        } else {
            const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(value.substring(i + 1));
            if (match) {
                out += lookup(env, match[0]) ?? "";
                i += 1 + match[0].length;
            } else {
                out += c;
                i++;
            }
        }
    }
    return out;
}

/**
 * @param {Record<string, string>} env Variables
 * @param {string} name Variable name
 * @returns {string | undefined} Its value, if set (own keys only, so "constructor" is not Object's)
 */
function lookup(env : Record<string, string>, name : string) : string | undefined {
    return Object.prototype.hasOwnProperty.call(env, name) ? env[name] : undefined;
}

/**
 * @param {string} expr Contents of ${...}
 * @param {Record<string, string>} env Variables
 * @returns {string} The substituted value
 */
function expandBraced(expr : string, env : Record<string, string>) : string {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)(:?[-+?])?([\s\S]*)$/.exec(expr);
    if (!match) {
        return "";
    }
    const [ , name, op, rest ] = match;
    const isSet = lookup(env, name) !== undefined;
    const val = lookup(env, name) ?? "";
    const present = op?.startsWith(":") ? val !== "" : isSet;
    switch (op) {
        case ":-":
        case "-":
            return present ? val : interpolate(rest, env);
        case ":+":
        case "+":
            return present ? interpolate(rest, env) : "";
        default:
            // Plain ${VAR}, or ${VAR?err} where compose would fail; either way the value (or "") is what matters here
            return val;
    }
}

/**
 * Published port entries of a compose file, in short syntax ("8080:80", "127.0.0.1:53:53/udp"), with variables
 * substituted.
 * @param {string} composeYAML compose.yaml contents
 * @param {Record<string, string>} env Variables from global.env and the stack's .env
 * @returns {string[]} Port entries, in compose order
 */
export function composeFilePorts(composeYAML : string | undefined, env : Record<string, string>) : string[] {
    if (!composeYAML) {
        return [];
    }
    // Anything thrown here (invalid YAML, absurdly deep ${...} nesting) means "no ports", never a broken stack list
    try {
        return readPorts(yaml.parse(composeYAML, { logLevel: "silent" }), env);
    } catch (e) {
        return [];
    }
}

/**
 * @param {unknown} doc Parsed compose file
 * @param {Record<string, string>} env Variables
 * @returns {string[]} Port entries
 */
function readPorts(doc : { services?: unknown } | null, env : Record<string, string>) : string[] {
    if (!doc || typeof doc.services !== "object" || doc.services === null) {
        return [];
    }
    const ports : string[] = [];
    for (const service of Object.values(doc.services) as ({ ports?: unknown } | null)[]) {
        if (service && Array.isArray(service.ports)) {
            ports.push(...service.ports.map(port => portEntry(port, env)).filter((p) : p is string => !!p));
        }
    }
    return ports;
}

/**
 * @param {unknown} port One item of a service's ports list, short or long syntax
 * @param {Record<string, string>} env Variables
 * @returns {string | null} The entry in short syntax, or null when it publishes nothing
 */
function portEntry(item : unknown, env : Record<string, string>) : string | null {
    const sub = (v : unknown) => interpolate(String(v), env);
    if (typeof item === "string" || typeof item === "number") {
        return sub(item) || null;
    }
    if (!item || typeof item !== "object") {
        return null;
    }
    const port = item as { published?: unknown, target?: unknown, host_ip?: unknown, protocol?: unknown };
    if (port.published === undefined || port.published === "") {
        return null;
    }
    let entry = `${sub(port.published)}:${sub(port.target ?? port.published)}`;
    if (port.host_ip) {
        entry = `${sub(port.host_ip)}:${entry}`;
    }
    if (port.protocol) {
        entry += `/${sub(port.protocol)}`;
    }
    return entry;
}

/**
 * Published port entries of a stack: compose.yaml, then compose.override.yaml (compose merges the two lists).
 * @param {string} composeYAML compose.yaml contents
 * @param {string} overrideYAML compose.override.yaml contents
 * @param {Record<string, string>} env Variables
 * @returns {string[]} Port entries
 */
export function stackComposePorts(composeYAML : string | undefined, overrideYAML : string | undefined, env : Record<string, string>) : string[] {
    return [ ...composeFilePorts(composeYAML, env), ...composeFilePorts(overrideYAML, env) ];
}

/**
 * Reduce a compose port mapping ("8080:80", "127.0.0.1:8443:443/udp", "53") to its host port, as shown in the UI.
 * @param {string} raw Port entry
 * @returns {string} The host port (or range)
 */
export function hostPort(raw : string) : string {
    const stripped = raw.split("/")[0];
    const lastColon = stripped.lastIndexOf(":");
    if (lastColon === -1) {
        return stripped;
    }
    const hostPart = stripped.substring(0, lastColon);
    const ipColon = hostPart.lastIndexOf(":");
    if (ipColon !== -1) {
        return hostPart.substring(ipColon + 1);
    }
    return hostPart;
}

/**
 * Host port numbers a port entry binds. An entry without a host part ("80") gets a random host port, so it binds
 * nothing fixed. Ranges are expanded (up to MAX_EXPANDED_RANGE ports).
 * @param {string} raw Port entry
 * @returns {number[]} Host ports
 */
export function hostPortNumbers(raw : string) : number[] {
    if (!raw.split("/")[0].includes(":")) {
        return [];
    }
    return expandPortRange(hostPort(raw));
}

/**
 * @param {string} spec "8080" or "8000-8010"
 * @returns {number[]} The ports it covers; [] when it is not a valid port or range
 */
export function expandPortRange(spec : string) : number[] {
    const match = /^\s*(\d{1,5})(?:\s*-\s*(\d{1,5}))?\s*$/.exec(spec);
    if (!match) {
        return [];
    }
    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);
    if (start < 1 || end > 65535 || end < start) {
        return [];
    }
    if (end - start + 1 > MAX_EXPANDED_RANGE) {
        return [ start, end ];
    }
    const ports : number[] = [];
    for (let p = start; p <= end; p++) {
        ports.push(p);
    }
    return ports;
}

/**
 * Host ports published by running containers, from the Ports column of `docker ps`
 * ("0.0.0.0:8080->80/tcp, :::8080->80/tcp, 0.0.0.0:9000-9002->9000-9002/tcp").
 * @param {string} column Ports column
 * @returns {number[]} Host ports
 */
export function dockerPsHostPorts(column : string) : number[] {
    const ports = new Set<number>();
    for (const match of column.matchAll(/:(\d{1,5}(?:-\d{1,5})?)->/g)) {
        for (const p of expandPortRange(match[1])) {
            ports.add(p);
        }
    }
    return [ ...ports ];
}
