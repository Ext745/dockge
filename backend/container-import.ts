import childProcessAsync from "promisify-child-process";
import { promises as fsAsync } from "fs";
import path from "path";
import { Document, isScalar, isSeq, Scalar } from "yaml";
import { DockgeServer } from "./dockge-server";
import { DockgeSocket, fileExists, ValidationError } from "./util-server";
import { Stack } from "./stack";
import { validateCompose } from "./compose-validate";
import { ImportRecord, ImportResult } from "./stack-import";
import { log } from "./log";

const VALID_NAME = /^[a-z0-9][a-z0-9_-]*$/;
// Suffix the original container gets while the imported stack runs in its place
export const PRE_DOCKGE_SUFFIX = "-pre-dockge";

export interface ContainerCandidate {
    id : string;
    name : string;
    image : string;
    state : string;
    status : string;
    // Suggested Dockge stack name
    stackName : string;
    importable : boolean;
    reason? : string;
}

export interface GeneratedCompose {
    stackName : string;
    composeYAML : string;
    notes : string[];
}

// Only the fields this module reads from "docker inspect"
/* eslint-disable @typescript-eslint/no-explicit-any */
type Inspect = any;

async function docker(args : string[]) : Promise<string> {
    const res = await childProcessAsync.spawn("docker", args, { encoding: "utf-8",
        maxBuffer: 64 * 1024 * 1024 });
    return String(res.stdout ?? "");
}

async function inspect(kind : "container" | "image", ref : string) : Promise<Inspect> {
    return JSON.parse(await docker([ kind, "inspect", ref ]))[0];
}

/**
 * A Dockge stack name derived from a container name.
 * @param name Container name
 * @returns Stack name
 */
function toStackName(name : string) : string {
    const n = name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[^a-z0-9]+/, "").replace(/-+$/, "");
    return n || "container";
}

/**
 * Containers started with "docker run" (not by compose, swarm or Dockge's own import), which can be
 * turned into a Dockge stack.
 * @param server Server
 * @returns Candidates
 */
export async function listContainerCandidates(server : DockgeServer) : Promise<ContainerCandidate[]> {
    const lines = (await docker([ "ps", "-a", "--no-trunc", "--format", "{{json .}}" ])).split("\n").filter(Boolean);
    const hostname = process.env.HOSTNAME || "";
    const candidates : ContainerCandidate[] = [];
    for (const line of lines) {
        const c = JSON.parse(line) as { ID : string, Names : string, Image : string, State : string, Status : string, Labels : string };
        const labels = c.Labels || "";
        if (labels.includes("com.docker.compose.project=") || labels.includes("com.docker.swarm.") || labels.includes("com.docker.stack.namespace=")) {
            continue;
        }
        const name = c.Names.split(",")[0];
        if (name.endsWith(PRE_DOCKGE_SUFFIX)) {
            continue;
        }
        const stackName = toStackName(name);
        const candidate : ContainerCandidate = {
            id: c.ID,
            name,
            image: c.Image,
            state: c.State,
            status: c.Status,
            stackName,
            importable: true,
        };
        if (hostname && c.ID.startsWith(hostname)) {
            // Dockge itself (a bare "docker run" install): never offered
            continue;
        } else if (await fileExists(path.join(server.stacksDir, stackName))) {
            candidate.reason = `A stack named ${stackName} already exists; you can pick another name when importing.`;
        }
        candidates.push(candidate);
    }
    return candidates.sort((a, b) => Number(b.importable) - Number(a.importable) || a.name.localeCompare(b.name));
}

const same = (a : unknown, b : unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Bytes as a compose size ("256m"), exact units only.
 * @param bytes Bytes
 * @returns Size
 */
function size(bytes : number) : string | number {
    for (const [ unit, factor ] of [[ "g", 1024 ** 3 ], [ "m", 1024 ** 2 ], [ "k", 1024 ]] as [ string, number ][]) {
        if (bytes % factor === 0) {
            return `${bytes / factor}${unit}`;
        }
    }
    return bytes;
}

/**
 * Nanoseconds as a compose duration ("1m30s").
 * @param ns Nanoseconds
 * @returns Duration
 */
function duration(ns : number) : string {
    let s = Math.round(ns / 1e9);
    const h = Math.floor(s / 3600);
    s -= h * 3600;
    const m = Math.floor(s / 60);
    s -= m * 60;
    return `${h ? h + "h" : ""}${m ? m + "m" : ""}${s || (!h && !m) ? s + "s" : ""}`;
}

/**
 * Write a compose file that recreates a "docker run" container: only settings that differ from its
 * image's defaults are written, existing volumes are reused as external volumes (so their data is
 * kept), and anything that can't be expressed is reported in `notes`.
 * @param server Server
 * @param ref Container id or name
 * @returns Compose text, suggested stack name and notes
 */
export async function generateCompose(server : DockgeServer, ref : string) : Promise<GeneratedCompose> {
    const c = await inspect("container", ref);
    if (c.Config?.Labels?.["com.docker.compose.project"]) {
        throw new ValidationError("This container belongs to a compose project; import the project instead.");
    }
    let image : Inspect = {};
    try {
        image = await inspect("image", c.Image);
    } catch {
        // Image removed since: nothing to subtract, everything set on the container is written
    }
    const cfg = c.Config ?? {};
    const img = image.Config ?? {};
    const host = c.HostConfig ?? {};
    const notes : string[] = [];
    const name = String(c.Name ?? "").replace(/^\//, "");
    const svc : Record<string, unknown> = {};
    const topVolumes : Record<string, unknown> = {};
    const topNetworks : Record<string, unknown> = {};

    svc.image = cfg.Image;
    svc.container_name = name;

    // Restart policy
    const restart = host.RestartPolicy?.Name;
    if (restart === "on-failure" && host.RestartPolicy.MaximumRetryCount) {
        svc.restart = `on-failure:${host.RestartPolicy.MaximumRetryCount}`;
    } else if (restart && restart !== "no") {
        svc.restart = restart;
    }

    // Process
    if (!same(cfg.Entrypoint, img.Entrypoint)) {
        svc.entrypoint = cfg.Entrypoint ?? [];
    }
    if (!same(cfg.Cmd, img.Cmd) || svc.entrypoint !== undefined) {
        if (cfg.Cmd) {
            svc.command = cfg.Cmd;
        }
    }
    if (cfg.WorkingDir && cfg.WorkingDir !== img.WorkingDir) {
        svc.working_dir = cfg.WorkingDir;
    }
    if (cfg.User && cfg.User !== img.User) {
        svc.user = cfg.User;
    }
    const imageEnv = new Set<string>(img.Env ?? []);
    const env = (cfg.Env ?? []).filter((e : string) => !imageEnv.has(e));
    if (env.length) {
        svc.environment = env;
    }
    const labels = Object.fromEntries(Object.entries(cfg.Labels ?? {}).filter(([ k, v ]) => img.Labels?.[k] !== v));
    if (Object.keys(labels).length) {
        svc.labels = labels;
    }
    if (cfg.Hostname && !c.Id.startsWith(cfg.Hostname) && !host.NetworkMode?.startsWith("container:") && host.NetworkMode !== "host") {
        svc.hostname = cfg.Hostname;
    }
    if (cfg.Domainname) {
        svc.domainname = cfg.Domainname;
    }
    if (cfg.Tty) {
        svc.tty = true;
    }
    if (cfg.OpenStdin) {
        svc.stdin_open = true;
    }
    if (cfg.StopSignal && cfg.StopSignal !== img.StopSignal) {
        svc.stop_signal = cfg.StopSignal;
    }
    if (cfg.Healthcheck && !same(cfg.Healthcheck, img.Healthcheck)) {
        const hc = cfg.Healthcheck;
        if (hc.Test?.[0] === "NONE") {
            svc.healthcheck = { disable: true };
        } else {
            const out : Record<string, unknown> = { test: hc.Test };
            for (const [ key, field ] of [[ "interval", "Interval" ], [ "timeout", "Timeout" ], [ "start_period", "StartPeriod" ], [ "start_interval", "StartInterval" ]]) {
                if (hc[field]) {
                    out[key] = duration(hc[field]);
                }
            }
            if (hc.Retries) {
                out.retries = hc.Retries;
            }
            svc.healthcheck = out;
        }
    }

    // Ports
    const ports : string[] = [];
    for (const [ containerPort, bindings ] of Object.entries(host.PortBindings ?? {}) as [ string, { HostIp : string, HostPort : string }[] ][]) {
        const [ port, proto ] = containerPort.split("/");
        for (const b of bindings ?? []) {
            const hostIp = b.HostIp && b.HostIp !== "0.0.0.0" && b.HostIp !== "::" ? `${b.HostIp.includes(":") ? `[${b.HostIp}]` : b.HostIp}:` : "";
            const hostPort = b.HostPort ? `${b.HostPort}:` : "";
            ports.push(`${hostIp}${hostPort}${port}${proto && proto !== "tcp" ? "/" + proto : ""}`);
        }
    }
    if (ports.length) {
        svc.ports = [ ...new Set(ports) ];
    }
    if (host.PublishAllPorts) {
        notes.push("It was started with -P (publish all ports on random host ports); compose has no equivalent, so add the ports you need.");
    }

    // Volumes: every mount the container has, anonymous ones kept by name so their data carries over
    const volumes : string[] = [];
    for (const m of c.Mounts ?? []) {
        const mode = m.RW === false ? ":ro" : "";
        if (m.Type === "bind") {
            volumes.push(`${m.Source}:${m.Destination}${mode}`);
        } else if (m.Type === "volume") {
            volumes.push(`${m.Name}:${m.Destination}${mode}`);
            topVolumes[m.Name] = { external: true };
            if (/^[0-9a-f]{64}$/.test(m.Name)) {
                notes.push(`${m.Destination} is an anonymous volume; it's kept by its id (${m.Name.slice(0, 12)}…) so its data carries over. You can rename it later.`);
            }
        } else if (m.Type === "tmpfs") {
            // Listed under HostConfig.Tmpfs / Mounts below
        } else {
            notes.push(`Mount of type ${m.Type} at ${m.Destination} isn't carried over.`);
        }
    }
    if (volumes.length) {
        svc.volumes = volumes;
    }
    const tmpfs = Object.entries(host.Tmpfs ?? {}).map(([ p, opts ]) => (opts ? `${p}:${opts}` : p));
    for (const m of host.Mounts ?? []) {
        if (m.Type === "tmpfs") {
            tmpfs.push(m.Target);
        }
    }
    if (tmpfs.length) {
        svc.tmpfs = tmpfs;
    }

    // Networking
    const mode = host.NetworkMode ?? "default";
    const networks = Object.keys(c.NetworkSettings?.Networks ?? {});
    if (mode === "host" || mode === "none" || mode.startsWith("container:")) {
        svc.network_mode = mode;
        if (mode.startsWith("container:")) {
            notes.push(`It shares another container's network (${mode}); that container must exist when this stack starts.`);
        }
    } else {
        const custom = networks.filter((n) => n !== "bridge");
        if (custom.length) {
            svc.networks = custom;
            for (const n of custom) {
                topNetworks[n] = { external: true };
            }
        } else {
            notes.push("It used Docker's default bridge network; as a stack it gets its own network. Ports published to the host work the same, but other containers can no longer reach it by IP on the default bridge.");
        }
    }
    if (host.Dns?.length) {
        svc.dns = host.Dns;
    }
    if (host.DnsSearch?.length) {
        svc.dns_search = host.DnsSearch;
    }
    if (host.DnsOptions?.length) {
        svc.dns_opt = host.DnsOptions;
    }
    if (host.ExtraHosts?.length) {
        svc.extra_hosts = host.ExtraHosts;
    }
    if (host.Links?.length) {
        notes.push("It uses legacy --link, which isn't carried over; put the containers on a shared network instead.");
    }

    // Privileges and devices
    if (host.Privileged) {
        svc.privileged = true;
    }
    if (host.CapAdd?.length) {
        svc.cap_add = host.CapAdd;
    }
    if (host.CapDrop?.length) {
        svc.cap_drop = host.CapDrop;
    }
    if (host.SecurityOpt?.length) {
        svc.security_opt = host.SecurityOpt;
    }
    if (host.Devices?.length) {
        svc.devices = host.Devices.map((d : Inspect) => `${d.PathOnHost}:${d.PathInContainer}${d.CgroupPermissions && d.CgroupPermissions !== "rwm" ? ":" + d.CgroupPermissions : ""}`);
    }
    if (host.DeviceRequests?.length) {
        svc.deploy = { resources: { reservations: { devices: host.DeviceRequests.map((r : Inspect) => ({
            ...(r.Driver ? { driver: r.Driver } : {}),
            ...(r.Count ? { count: r.Count === -1 ? "all" : r.Count } : {}),
            ...(r.DeviceIDs?.length ? { device_ids: r.DeviceIDs } : {}),
            capabilities: (r.Capabilities ?? []).flat().length ? (r.Capabilities ?? []).flat() : [ "gpu" ],
        })) } } };
    }
    if (host.GroupAdd?.length) {
        svc.group_add = host.GroupAdd;
    }
    if (host.Init) {
        svc.init = true;
    }
    if (host.ReadonlyRootfs) {
        svc.read_only = true;
    }
    if (host.PidMode) {
        svc.pid = host.PidMode;
    }
    if (host.IpcMode && host.IpcMode !== "private" && host.IpcMode !== "shareable") {
        svc.ipc = host.IpcMode;
    }
    if (host.Runtime && host.Runtime !== "runc") {
        svc.runtime = host.Runtime;
    }
    if (host.Sysctls && Object.keys(host.Sysctls).length) {
        svc.sysctls = host.Sysctls;
    }
    if (host.Ulimits?.length) {
        svc.ulimits = Object.fromEntries(host.Ulimits.map((u : Inspect) => [ u.Name, u.Soft === u.Hard ? u.Soft : { soft: u.Soft,
            hard: u.Hard } ]));
    }

    // Resources
    if (host.Memory) {
        svc.mem_limit = size(host.Memory);
    }
    if (host.MemoryReservation) {
        svc.mem_reservation = size(host.MemoryReservation);
    }
    if (host.NanoCpus) {
        svc.cpus = host.NanoCpus / 1e9;
    }
    if (host.CpusetCpus) {
        svc.cpuset = host.CpusetCpus;
    }
    if (host.ShmSize && host.ShmSize !== 64 * 1024 * 1024) {
        svc.shm_size = size(host.ShmSize);
    }
    if (host.PidsLimit) {
        svc.pids_limit = host.PidsLimit;
    }

    // Logging
    if (host.LogConfig?.Type && (host.LogConfig.Type !== "json-file" || Object.keys(host.LogConfig.Config ?? {}).length)) {
        svc.logging = { driver: host.LogConfig.Type,
            ...(Object.keys(host.LogConfig.Config ?? {}).length ? { options: host.LogConfig.Config } : {}) };
    }

    if (host.AutoRemove) {
        notes.push("It was started with --rm; a stack's container is kept when it stops.");
    }

    const stackName = toStackName(name);
    const compose : Record<string, unknown> = { services: { [stackName]: svc } };
    if (Object.keys(topVolumes).length) {
        compose.volumes = topVolumes;
    }
    if (Object.keys(topNetworks).length) {
        compose.networks = topNetworks;
    }
    const doc = new Document(compose);
    // Quote port mappings, as compose's docs recommend ("22:22" style values are ambiguous in YAML 1.1)
    const portsNode = doc.getIn([ "services", stackName, "ports" ], true);
    if (isSeq(portsNode)) {
        for (const item of portsNode.items) {
            if (isScalar(item)) {
                item.type = Scalar.QUOTE_DOUBLE;
            }
        }
    }
    doc.commentBefore = ` Generated by Dockge from "docker run" container ${name} (${String(c.Id).slice(0, 12)})`;
    return {
        stackName,
        composeYAML: doc.toString({ lineWidth: 0 }),
        notes,
    };
}

function backupRoot(server : DockgeServer) : string {
    return path.join(server.config.dataDir, "import-backups");
}

/**
 * Put the original container back as it was: its name, its restart policy, and running if it was.
 * @param record Import record
 * @returns void
 */
async function restoreOriginal(record : ImportRecord) : Promise<void> {
    const original = record.container!;
    await docker([ "rename", original.id, original.name ]).catch(() => undefined);
    await docker([ "update", "--restart", original.restart, original.id ]).catch(() => undefined);
    if (original.wasRunning) {
        await docker([ "start", original.id ]);
    }
}

/**
 * Replace a "docker run" container with a Dockge stack running the (reviewed) compose file.
 * The original is stopped, renamed to <name>-pre-dockge and kept with restart "no" until the user
 * keeps the import; any failure puts it back exactly as it was.
 * @param server Server
 * @param socket Socket, for the deploy terminal
 * @param ref Container id or name
 * @param stackName Dockge stack name
 * @param composeYAML Compose file to deploy (as generated, possibly edited)
 * @returns Result for the UI
 */
export async function importContainer(server : DockgeServer, socket : DockgeSocket, ref : string, stackName : string, composeYAML : string) : Promise<ImportResult> {
    if (!VALID_NAME.test(stackName)) {
        throw new ValidationError("Stack name: lowercase letters, digits, - and _ only");
    }
    const targetDir = path.join(server.stacksDir, stackName);
    if (await fileExists(targetDir)) {
        throw new ValidationError(`A stack named ${stackName} already exists.`);
    }
    const c = await inspect("container", ref);
    if (c.Config?.Labels?.["com.docker.compose.project"]) {
        throw new ValidationError("This container belongs to a compose project; import the project instead.");
    }
    if (process.env.HOSTNAME && String(c.Id).startsWith(process.env.HOSTNAME)) {
        throw new ValidationError("This is Dockge itself.");
    }
    const name = String(c.Name).replace(/^\//, "");

    // Nothing changes unless the file is valid as it will be deployed
    await fsAsync.mkdir(targetDir, { recursive: true });
    await fsAsync.writeFile(path.join(targetDir, "compose.yaml"), composeYAML);
    const validation = await validateCompose(server, stackName, composeYAML, "", "");
    if (!validation.valid) {
        await fsAsync.rm(targetDir, { recursive: true,
            force: true });
        throw new ValidationError(`The compose file isn't valid, so nothing was changed:\n${validation.message}`);
    }

    const id = `${stackName}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    const backupDir = path.join(backupRoot(server), id);
    await fsAsync.mkdir(backupDir, { recursive: true });
    await fsAsync.writeFile(path.join(backupDir, "container.inspect.json"), JSON.stringify(c, null, 4));
    await fsAsync.writeFile(path.join(backupDir, "compose.yaml"), composeYAML);
    const record : ImportRecord = {
        id,
        name: stackName,
        importedAt: new Date().toISOString(),
        workingDir: "",
        configFiles: [],
        targetDir,
        redeployed: true,
        notes: [],
        container: {
            id: c.Id,
            name,
            renamedTo: name + PRE_DOCKGE_SUFFIX,
            image: c.Config?.Image,
            restart: c.HostConfig?.RestartPolicy?.Name === "on-failure" && c.HostConfig.RestartPolicy.MaximumRetryCount
                ? `on-failure:${c.HostConfig.RestartPolicy.MaximumRetryCount}`
                : c.HostConfig?.RestartPolicy?.Name || "no",
            wasRunning: Boolean(c.State?.Running),
        },
    };
    await fsAsync.writeFile(path.join(backupDir, "import.json"), JSON.stringify(record, null, 4));

    // Step the original aside: stopped, renamed (frees its name and ports), and never auto-restarted
    try {
        await docker([ "update", "--restart", "no", c.Id ]);
        if (record.container!.wasRunning) {
            await docker([ "stop", c.Id ]);
        }
        await docker([ "rename", c.Id, record.container!.renamedTo ]);
    } catch (e) {
        await restoreOriginal(record).catch(() => undefined);
        await fsAsync.rm(targetDir, { recursive: true,
            force: true });
        await fsAsync.rm(backupDir, { recursive: true,
            force: true });
        throw new Error(`Couldn't stop the original container, so nothing was changed: ${e instanceof Error ? e.message : e}`);
    }

    const stack = await Stack.getStack(server, stackName);
    try {
        await stack.deploy(socket);
    } catch (e) {
        // Remove what the failed deploy created, then put the original back
        await stack.delete(socket).catch(() => fsAsync.rm(targetDir, { recursive: true,
            force: true }));
        await fsAsync.rm(targetDir, { recursive: true,
            force: true });
        await restoreOriginal(record).catch((err) => log.error("container-import", `Restoring ${name} failed: ${err}`));
        await fsAsync.rm(backupDir, { recursive: true,
            force: true });
        server.sendStackList();
        throw new Error(`Deploying the new stack failed, so ${name} was put back as it was: ${e instanceof Error ? e.message : e}`);
    }

    server.sendStackList();
    return {
        name: stackName,
        ok: true,
        msg: `Imported: ${name} now runs as stack ${stackName}. The original is kept (stopped) as ${record.container!.renamedTo} until you choose Keep.`,
        notes: [],
    };
}

/**
 * Undo a container import: remove the new stack (its containers; volumes are kept) and bring the
 * original container back as it was.
 * @param server Server
 * @param socket Socket
 * @param record Import record
 * @returns Message
 */
export async function rollbackContainerImport(server : DockgeServer, socket : DockgeSocket, record : ImportRecord) : Promise<string> {
    if (await fileExists(record.targetDir)) {
        const stack = await Stack.getStack(server, record.name);
        await stack.delete(socket);
    }
    await restoreOriginal(record);
    server.sendStackList();
    return `Removed stack ${record.name} and put ${record.container!.name} back${record.container!.wasRunning ? " (running)" : ""}.`;
}

/**
 * Keep a container import: remove the stopped original (its volumes stay; the stack uses them).
 * @param record Import record
 * @returns void
 */
export async function finalizeContainerImport(record : ImportRecord) : Promise<void> {
    await docker([ "rm", record.container!.id ]).catch((e) => {
        // Already removed by hand is fine
        if (!String(e?.stderr ?? e).includes("No such container")) {
            throw e;
        }
    });
}
