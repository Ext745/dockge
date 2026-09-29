import childProcessAsync from "promisify-child-process";
import { promises as fsAsync } from "fs";
import http from "http";
import https from "https";
import path from "path";
import { parseDocument } from "yaml";
import { DockgeServer } from "./dockge-server";
import { DockgeSocket, fileExists, ValidationError } from "./util-server";
import { Stack } from "./stack";
import { validateCompose } from "./compose-validate";
import { ImportRecord, ImportResult, rewriteForMove } from "./stack-import";
import { detectIndent } from "../common/yaml-indent";
import { log } from "./log";

const VALID_NAME = /^[a-z0-9][a-z0-9_-]*$/;
const HELPER_IMAGE = "busybox:stable";

// Portainer's stack types and statuses (portainer/api)
const TYPE_SWARM = 1;
const TYPE_COMPOSE = 2;
const STATUS_ACTIVE = 1;

export interface PortainerConnection {
    url : string;
    apiKey : string;
    // Accept a self-signed certificate (Portainer's default on :9443)
    insecure : boolean;
}

export interface PortainerCandidate {
    id : number;
    name : string;
    environment : string;
    status : "running" | "stopped" | "deploying";
    variables : number;
    git : boolean;
    importable : boolean;
    reason? : string;
}

interface PortainerStack {
    Id : number;
    Name : string;
    Type : number;
    EndpointId : number;
    Status : number;
    ProjectPath : string;
    Env : { name : string, value : string }[] | null;
    GitConfig : unknown;
}

/**
 * Call the Portainer API with an access token (Portainer → My account → Access tokens).
 * @param conn Connection
 * @param apiPath Path under the Portainer URL, e.g. "/api/stacks"
 * @returns Parsed JSON
 */
async function portainer(conn : PortainerConnection, apiPath : string) : Promise<unknown> {
    let base : URL;
    try {
        base = new URL(conn.url);
    } catch {
        throw new ValidationError("Portainer URL isn't a valid URL (e.g. https://portainer.lan:9443)");
    }
    if (base.protocol !== "http:" && base.protocol !== "https:") {
        throw new ValidationError("Portainer URL must start with http:// or https://");
    }
    const target = new URL(base.pathname.replace(/\/$/, "") + apiPath, base);
    const lib = target.protocol === "https:" ? https : http;
    return new Promise((resolve, reject) => {
        const req = lib.request(target, {
            method: "GET",
            headers: { "X-API-Key": conn.apiKey,
                "Accept": "application/json" },
            timeout: 15000,
            ...(target.protocol === "https:" ? { rejectUnauthorized: !conn.insecure } : {}),
        }, (res) => {
            let body = "";
            res.setEncoding("utf-8");
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () => {
                if (res.statusCode === 401 || res.statusCode === 403) {
                    reject(new ValidationError("Portainer refused the access token (check it, and that it belongs to an admin)"));
                } else if (!res.statusCode || res.statusCode >= 400) {
                    reject(new ValidationError(`Portainer answered ${res.statusCode} for ${apiPath}`));
                } else {
                    try {
                        resolve(JSON.parse(body));
                    } catch {
                        reject(new ValidationError("That URL didn't answer like Portainer does - check the address and port"));
                    }
                }
            });
        });
        req.on("timeout", () => req.destroy(new Error("timed out")));
        req.on("error", (e) => {
            const msg = (e as NodeJS.ErrnoException).code === "DEPTH_ZERO_SELF_SIGNED_CERT" || /self.signed|certificate/i.test(e.message)
                ? "Portainer's certificate isn't trusted - tick \"Accept a self-signed certificate\" if that's expected"
                : `Couldn't reach Portainer: ${e.message}`;
            reject(new ValidationError(msg));
        });
        req.end();
    });
}

async function projectRunsHere(name : string) : Promise<boolean> {
    const res = await childProcessAsync.spawn("docker", [ "ps", "-aq", "--filter", `label=com.docker.compose.project=${name}` ], { encoding: "utf-8" });
    return String(res.stdout || "").trim() !== "";
}

/**
 * Portainer's stacks, and whether each can be imported into this Dockge agent.
 * @param server Server
 * @param conn Portainer connection
 * @returns Candidates
 */
export async function listPortainerStacks(server : DockgeServer, conn : PortainerConnection) : Promise<PortainerCandidate[]> {
    const endpoints = await portainer(conn, "/api/endpoints") as { Id : number, Name : string }[];
    const stacks = await portainer(conn, "/api/stacks") as PortainerStack[];
    const envName = (id : number) => endpoints.find((e) => e.Id === id)?.Name ?? `environment ${id}`;

    const candidates : PortainerCandidate[] = [];
    for (const s of stacks) {
        const runsHere = await projectRunsHere(s.Name);
        const c : PortainerCandidate = {
            id: s.Id,
            name: s.Name,
            environment: envName(s.EndpointId),
            status: s.Status === STATUS_ACTIVE ? "running" : s.Status === 2 ? "stopped" : "deploying",
            variables: (s.Env ?? []).length,
            git: Boolean(s.GitConfig),
            importable: true,
        };
        const no = (reason : string) => candidates.push({ ...c,
            importable: false,
            reason });
        if (s.Type === TYPE_SWARM) {
            no("Swarm stacks can't be run by Dockge.");
        } else if (s.Type !== TYPE_COMPOSE) {
            no("Only Docker Compose stacks can be imported.");
        } else if (!VALID_NAME.test(s.Name)) {
            no(`"${s.Name}" isn't a valid Dockge stack name.`);
        } else if (await fileExists(path.join(server.stacksDir, s.Name))) {
            no("A stack with this name already exists in Dockge.");
        } else if (c.status === "deploying") {
            no("Portainer is still deploying or updating it; try again in a moment.");
        } else if (c.status === "running" && !runsHere) {
            no(`It runs on Portainer environment "${c.environment}", not on this Docker host. Import it from the Dockge agent on that host.`);
        } else {
            if (c.status === "stopped") {
                c.reason = "Stopped in Portainer, so Docker can't confirm it belongs to this host; check the environment before importing.";
            }
            candidates.push(c);
        }
    }
    return candidates.sort((a, b) => Number(b.importable) - Number(a.importable) || a.name.localeCompare(b.name));
}

/**
 * .env text for Portainer's stack variables (which Portainer only ever passes on the command line).
 * @param env Portainer Env
 * @returns .env content
 */
function toDotEnv(env : { name : string, value : string }[]) : string {
    return env.map(({ name, value }) => {
        const needsQuotes = /[\s#"'$\\]/.test(value) || value === "";
        return `${name}=${needsQuotes ? JSON.stringify(value) : value}`;
    }).join("\n") + (env.length ? "\n" : "");
}

/**
 * Read a file from Portainer's own data folder (where it keeps stack files and env_files), through a
 * helper container mounting whatever backs Portainer's /data.
 * @param stackPath Portainer's ProjectPath, e.g. /data/compose/12
 * @param rel Path relative to it
 * @returns Content, or null if Portainer's data can't be found
 */
async function readPortainerFile(stackPath : string, rel : string) : Promise<string | null> {
    // Match by image name ("ancestor=" filters only match the :latest tag), any registry/tag
    const ids = String((await childProcessAsync.spawn("docker", [ "ps", "-a", "--format", "{{.ID}} {{.Image}}" ], { encoding: "utf-8" })).stdout || "")
        .split("\n").filter((l) => /(^|\/)portainer\/portainer-(ce|ee)(:|@|$)/.test(l.split(" ")[1] ?? ""))
        .map((l) => l.split(" ")[0]);
    for (const id of ids) {
        const mounts = JSON.parse(String((await childProcessAsync.spawn("docker", [ "inspect", id, "--format", "{{json .Mounts}}" ], { encoding: "utf-8" })).stdout || "[]"));
        const data = mounts.find((m : { Destination : string }) => m.Destination === "/data");
        if (!data) {
            continue;
        }
        const source = data.Type === "volume" ? data.Name : data.Source;
        const inData = path.posix.join(stackPath.replace(/^\/data/, ""), rel);
        try {
            const res = await childProcessAsync.spawn("docker", [
                "run", "--rm", "--pull", "missing", "--network", "none", "-v", `${source}:/pd:ro`,
                HELPER_IMAGE, "cat", path.posix.join("/pd", inData),
            ], { encoding: "utf-8" });
            return String(res.stdout ?? "");
        } catch {
            return null;
        }
    }
    return null;
}

/**
 * Import one Portainer stack: its compose file (as Portainer serves it), its variables as .env, and
 * the same path handling as a normal import, using Portainer's project folder - which is also where
 * Docker actually bind-mounted relative paths from, so data stays exactly where it is.
 * @param server Server
 * @param socket Socket, for the deploy terminal
 * @param conn Portainer connection
 * @param id Portainer stack id
 * @param redeploy Recreate the containers from Dockge right away
 * @returns Result for the UI
 */
export async function importPortainerStack(server : DockgeServer, socket : DockgeSocket, conn : PortainerConnection, id : number, redeploy : boolean) : Promise<ImportResult> {
    const candidate = (await listPortainerStacks(server, conn)).find((c) => c.id === id);
    if (!candidate) {
        throw new ValidationError(`Portainer stack ${id} no longer exists`);
    }
    if (!candidate.importable) {
        throw new ValidationError(candidate.reason ?? "Can't import this stack");
    }
    const stack = await portainer(conn, `/api/stacks/${id}`) as PortainerStack;
    const { StackFileContent: composeText } = await portainer(conn, `/api/stacks/${id}/file`) as { StackFileContent : string };
    const name = stack.Name;
    const envText = toDotEnv(stack.Env ?? []);

    const doc = parseDocument(composeText);
    if (doc.errors.length > 0) {
        throw new ValidationError(`Portainer's compose file isn't valid YAML: ${doc.errors[0].message}`);
    }
    const rewrite = rewriteForMove(doc, stack.ProjectPath);
    const notes = rewrite.notes.map((n) => n.replace("(data stays where it is)", "(where Portainer's deploy put it; data stays where it is)"));
    if ((stack.Env ?? []).length) {
        notes.push(`${stack.Env!.length} Portainer stack variable(s) written to .env`);
    }
    if (stack.GitConfig) {
        notes.push("Deployed from Git in Portainer; Dockge keeps the current file, and Git auto-update no longer applies.");
    }
    const envCopies : [ string, string ][] = [];
    for (const rel of rewrite.copy) {
        const content = await readPortainerFile(stack.ProjectPath, rel);
        if (content === null) {
            throw new ValidationError(`Couldn't read ${rel} from Portainer's data (is the Portainer container on this host?)`);
        }
        envCopies.push([ rel, content ]);
    }
    notes.push("Portainer still lists this stack: remove it there only by deleting Portainer's record, not with Portainer's \"Delete\"/\"Stop\" on the stack, which would stop these containers.");

    const targetDir = path.join(server.stacksDir, name);
    const recordId = `${name}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    const backupDir = path.join(server.config.dataDir, "import-backups", recordId);
    await fsAsync.mkdir(path.join(backupDir, "original"), { recursive: true });
    await fsAsync.writeFile(path.join(backupDir, "original", "docker-compose.yml"), composeText);
    await fsAsync.writeFile(path.join(backupDir, "original", ".env"), envText);
    await fsAsync.writeFile(path.join(backupDir, "portainer-stack.json"), JSON.stringify({ ...stack,
        Env: stack.Env }, null, 4));
    const record : ImportRecord = {
        id: recordId,
        name,
        importedAt: new Date().toISOString(),
        workingDir: stack.ProjectPath,
        configFiles: [],
        targetDir,
        redeployed: false,
        notes,
        portainer: {
            url: conn.url,
            stackId: id,
            environment: candidate.environment,
        },
    };
    const saveRecord = () => fsAsync.writeFile(path.join(backupDir, "import.json"), JSON.stringify(record, null, 4));
    await saveRecord();

    const composeOut = doc.toString({ indent: detectIndent(composeText),
        lineWidth: 0,
        flowCollectionPadding: false });
    try {
        await fsAsync.mkdir(targetDir, { recursive: true });
        await fsAsync.writeFile(path.join(targetDir, "compose.yaml"), composeOut);
        await fsAsync.writeFile(path.join(targetDir, ".env"), envText);
        for (const [ rel, content ] of envCopies) {
            await fsAsync.mkdir(path.dirname(path.join(targetDir, rel)), { recursive: true });
            await fsAsync.writeFile(path.join(targetDir, rel), content);
        }
        const validation = await validateCompose(server, name, composeOut, envText, "");
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
        try {
            await (await Stack.getStack(server, name)).deploy(socket, true);
            record.redeployed = true;
            await saveRecord();
        } catch (e) {
            await fsAsync.rm(targetDir, { recursive: true,
                force: true });
            await fsAsync.rm(backupDir, { recursive: true,
                force: true });
            log.warn("portainer-import", `Redeploy of ${name} failed: ${e}`);
            throw new Error(`Imported, but redeploying from Dockge failed, so the import was undone: ${e instanceof Error ? e.message : e}`);
        }
    }

    server.sendStackList();
    return {
        name,
        ok: true,
        msg: record.redeployed ? "Imported from Portainer and redeployed from Dockge" : "Imported from Portainer",
        notes,
    };
}
