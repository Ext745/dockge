import { DockgeServer } from "../dockge-server";
import { Router } from "../router";
import express, { Express, Request, Response, NextFunction, Router as ExpressRouter } from "express";
import { Stack } from "../stack";
import { log } from "../log";
import { ValidationError } from "../util-server";
import { UNKNOWN, CREATED_FILE, CREATED_STACK, RUNNING, EXITED, RUNNING_AND_EXITED, UNHEALTHY } from "../../common/util-common";
import { Agent } from "../models/agent";
import childProcessAsync from "promisify-child-process";
import crypto from "crypto";
import { VersionSyncHistoryService } from "../version-sync-history-service";
import { scanStack, scanAllStacks, syncComposeFile } from "../compose-version-sync";
import { Settings } from "../settings";
import { encryptCredential } from "../services/agent-crypto";

const STATUS_NAMES: Record<number, string> = {
    [UNKNOWN]: "unknown",
    [CREATED_FILE]: "created_file",
    [CREATED_STACK]: "created_stack",
    [RUNNING]: "running",
    [EXITED]: "exited",
    [RUNNING_AND_EXITED]: "running_and_exited",
    [UNHEALTHY]: "unhealthy",
};

const VALID_STACK_NAME = /^[a-z0-9_-]+$/;

type StackAction = {
    path: string;
    label: string;
    pastTense: string;
    agentEvent: string;
    // Each entry is one `docker compose` invocation: [command, ...args], run in order
    composeCommands: string[][];
    // Refuse on the local host if Dockge itself runs in this stack (it would take itself down)
    refuseSelfStack: boolean;
};

const STACK_ACTIONS: StackAction[] = [
    { path: "start", label: "Start", pastTense: "started", agentEvent: "startStack", composeCommands: [[ "up", "-d", "--remove-orphans" ]], refuseSelfStack: false },
    { path: "stop", label: "Stop", pastTense: "stopped", agentEvent: "stopStack", composeCommands: [[ "stop" ]], refuseSelfStack: true },
    { path: "restart", label: "Restart", pastTense: "restarted", agentEvent: "restartStack", composeCommands: [[ "restart" ]], refuseSelfStack: false },
    // Pull images and recreate
    { path: "update", label: "Update", pastTense: "updated", agentEvent: "updateStack", composeCommands: [[ "pull" ], [ "up", "-d", "--remove-orphans" ]], refuseSelfStack: false },
    // Stop and remove containers (inactive)
    { path: "down", label: "Down", pastTense: "downed", agentEvent: "downStack", composeCommands: [[ "down" ]], refuseSelfStack: true },
];

async function apiKeyAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
    const settingsKey = await Settings.get("apiKey") as string | null;
    const apiKey = settingsKey || process.env.DOCKGE_API_KEY;

    if (!apiKey) {
        res.status(503).json({ error: "API key not configured. Generate one in Settings or set DOCKGE_API_KEY environment variable." });
        return;
    }

    const provided = req.headers["x-api-key"];
    if (typeof provided !== "string") {
        res.status(401).json({ error: "Invalid or missing API key" });
        return;
    }

    const providedHash = crypto.createHash("sha256").update(provided).digest();
    const expectedHash = crypto.createHash("sha256").update(apiKey).digest();
    if (!crypto.timingSafeEqual(providedHash, expectedHash)) {
        res.status(401).json({ error: "Invalid or missing API key" });
        return;
    }

    next();
}

function validateStackName(req: Request, res: Response, next: NextFunction): void {
    const name = req.params.name;
    if (!name || !VALID_STACK_NAME.test(name)) {
        res.status(400).json({ ok: false, error: "Invalid stack name" });
        return;
    }
    next();
}

function validateEndpoint(endpoint: string | undefined): boolean {
    if (!endpoint || endpoint === "") {
        return true;
    }
    return /^[a-zA-Z0-9._: -]+$/.test(endpoint);
}

async function resolveEndpoint(endpoint: string | undefined): Promise<string> {
    if (!endpoint || endpoint === "") {
        return "";
    }
    if (/^\d/.test(endpoint) || endpoint.includes(":")) {
        return endpoint;
    }
    const agentList = await Agent.getAgentList();
    for (const url in agentList) {
        const agent = agentList[url];
        const name = agent.name || "";
        if (name.toLowerCase() === endpoint.toLowerCase()) {
            return agent.endpoint;
        }
    }
    return endpoint;
}

/**
 * Parse a query value as an integer and clamp it, so a bad or huge value can't reach the SQL LIMIT/OFFSET.
 * @param value Raw query value
 * @param min Lowest allowed value, also used when the value isn't a number
 * @param max Highest allowed value
 * @returns The bounded integer
 */
function parseBoundedInt(value: unknown, min: number, max: number): number {
    const n = parseInt(String(value), 10);
    if (Number.isNaN(n)) {
        return min;
    }
    return Math.min(max, Math.max(min, n));
}

const STACK_STATUS_CONCURRENCY = 4;

/**
 * Run an async task over items with at most `limit` tasks in flight.
 * @param items Items to process
 * @param limit Maximum number of concurrent tasks
 * @param task Async task for one item
 * @returns Resolves once every task has settled; rejects with the first failure
 */
async function forEachWithConcurrency<T>(items: T[], limit: number, task: (item: T) => Promise<unknown>): Promise<void> {
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            await task(items[next++]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

function agentSupports(server: DockgeServer, endpoint: string): boolean {
    return server.serverAgentManager.supportsFeature(endpoint, "1.6.0");
}

function emitToAgent(server: DockgeServer, endpoint: string, eventName: string, ...args: unknown[]): Promise<Record<string, unknown>>;
function emitToAgent(server: DockgeServer, endpoint: string, eventName: string, timeoutMs: number, ...args: unknown[]): Promise<Record<string, unknown>>;
function emitToAgent(server: DockgeServer, endpoint: string, eventName: string, ...args: unknown[]): Promise<Record<string, unknown>> {
    let timeoutMs = 30000;
    if (typeof args[0] === "number") {
        timeoutMs = args.shift() as number;
    }
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error(`Timeout waiting for response from agent ${endpoint}`));
        }, timeoutMs);

        server.serverAgentManager.emitToEndpoint(endpoint, eventName, ...args, (result: Record<string, unknown>) => {
            clearTimeout(timeout);
            resolve(result);
        }).catch((e: Error) => {
            clearTimeout(timeout);
            reject(e);
        });
    });
}

export class ApiRouter extends Router {
    create(app: Express, server: DockgeServer): ExpressRouter {
        const router = express.Router();

        router.use(express.json());

        router.get("/api/health", (_req: Request, res: Response) => {
            res.json({ status: "ok", version: server.packageJSON.version });
        });

        router.use("/api", apiKeyAuth);

        // GET /api/agents
        router.get("/api/agents", async (_req: Request, res: Response) => {
            try {
                const agentList = await Agent.getAgentList();
                const agents: { endpoint: string; name: string; url: string; version: string | null }[] = [];

                let hasMaster = false;

                for (const url in agentList) {
                    const agent = agentList[url];
                    if (url === "" || agent.endpoint === "") {
                        hasMaster = true;
                        agents.push({
                            endpoint: "",
                            name: agent.name || "master",
                            url: "",
                            version: server.packageJSON.version ?? null,
                        });
                    } else {
                        agents.push({
                            endpoint: agent.endpoint,
                            name: agent.name || agent.endpoint,
                            url: agent.url,
                            version: server.serverAgentManager.getVersion(agent.endpoint) ?? null,
                        });
                    }
                }

                if (!hasMaster) {
                    agents.unshift({
                        endpoint: "",
                        name: "master",
                        url: "",
                        version: server.packageJSON.version ?? null,
                    });
                }

                res.json({ ok: true, agents });
            } catch (e) {
                log.error("api", "GET /api/agents error: " + e);
                res.status(500).json({ ok: false, error: "Failed to list agents" });
            }
        });

        // POST /api/agents
        router.post("/api/agents", async (req: Request, res: Response) => {
            try {
                const { url, username, password, name } = req.body;
                if (!url || typeof url !== "string") {
                    res.status(400).json({ ok: false, error: "url is required" });
                    return;
                }
                let parsedUrl: URL;
                try {
                    parsedUrl = new URL(url);
                } catch {
                    res.status(400).json({ ok: false, error: "url must be a valid http(s) URL" });
                    return;
                }
                if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
                    res.status(400).json({ ok: false, error: "url must be a valid http(s) URL" });
                    return;
                }
                if ((username !== undefined && typeof username !== "string") || (password !== undefined && typeof password !== "string") || (name !== undefined && typeof name !== "string")) {
                    res.status(400).json({ ok: false, error: "username, password and name must be strings" });
                    return;
                }

                server.serverAgentManager.connect(url, username || "", password || "");

                const { R } = await import("redbean-node");
                let bean = R.dispense("agent") as Agent;
                bean.url = url;
                bean.username = username || "";
                bean.password = encryptCredential(password || "");
                bean.name = name || "";
                await R.store(bean);

                res.json({ ok: true, message: "Agent added successfully" });
            } catch (e) {
                log.error("api", "POST /api/agents error: " + e);
                res.status(500).json({ ok: false, error: "Failed to add agent" });
            }
        });

        // GET /api/agents/status
        router.get("/api/agents/status", async (_req: Request, res: Response) => {
            try {
                const agentList = await Agent.getAgentList();
                const agents: { endpoint: string; name: string; url: string; connected: boolean; version: string | null }[] = [];

                agents.push({ endpoint: "", name: "master", url: "", connected: true, version: server.packageJSON.version ?? null });

                for (const url in agentList) {
                    const agent = agentList[url];
                    if (!url || agent.endpoint === "") {
                        continue;
                    }

                    agents.push({
                        endpoint: agent.endpoint,
                        name: agent.name || agent.endpoint,
                        url: agent.url,
                        connected: server.serverAgentManager.isConnected(agent.endpoint),
                        version: server.serverAgentManager.getVersion(agent.endpoint) ?? null,
                    });
                }

                res.json({ ok: true, agents });
            } catch (e) {
                log.error("api", "GET /api/agents/status error: " + e);
                res.status(500).json({ ok: false, error: "Failed to check agent status" });
            }
        });

        // GET /api/stacks
        router.get("/api/stacks", async (_req: Request, res: Response) => {
            try {
                type ServiceInfo = { name: string; containerName: string; image: string; state: string; status: string; health: string };
                type StackInfo = { name: string; status: string; statusCode: number; isManagedByDockge: boolean; endpoint: string; services: Record<string, ServiceInfo> };
                const stacks: StackInfo[] = [];

                const stackList = await Stack.getStackList(server, true);
                // Each updateData() spawns `docker compose ps`; run a few at a time rather than one by one
                await forEachWithConcurrency([ ...stackList.values() ], STACK_STATUS_CONCURRENCY, (stack) => stack.updateData());
                for (const [name, stack] of stackList) {
                    stacks.push({
                        name,
                        status: STATUS_NAMES[stack.status] || "unknown",
                        statusCode: stack.status,
                        isManagedByDockge: stack.isManagedByDockge,
                        endpoint: "",
                        services: Object.fromEntries(stack.services),
                    });
                }

                const agentList = await Agent.getAgentList();
                const unsupportedAgents: string[] = [];
                for (const url in agentList) {
                    const agent = agentList[url];
                    if (!url || agent.endpoint === "") {
                        continue;
                    }
                    if (!agentSupports(server, agent.endpoint)) {
                        unsupportedAgents.push(agent.endpoint);
                        continue;
                    }
                    try {
                        const result = await emitToAgent(server, agent.endpoint, "getStackList");
                        if (result.ok && result.stackList) {
                            const agentStacks = result.stackList as Record<string, { name: string; status: number; isManagedByDockge: boolean; endpoint: string; services?: Record<string, ServiceInfo> }>;
                            for (const name in agentStacks) {
                                const s = agentStacks[name];
                                stacks.push({
                                    name: s.name || name,
                                    status: STATUS_NAMES[s.status] || "unknown",
                                    statusCode: s.status,
                                    isManagedByDockge: s.isManagedByDockge,
                                    endpoint: agent.endpoint,
                                    services: s.services ?? {},
                                });
                            }
                        }
                    } catch (e) {
                        log.warn("api", `Failed to get stacks from agent ${agent.endpoint}: ${e}`);
                    }
                }

                const response: Record<string, unknown> = { ok: true, stacks };
                if (unsupportedAgents.length > 0) {
                    response.unsupportedAgents = unsupportedAgents;
                    response.notice = "Some agents are running a version older than 1.6.0 and do not support API stack listing. Upgrade them to include their stacks.";
                }
                res.json(response);
            } catch (e) {
                log.error("api", "GET /api/stacks error: " + e);
                res.status(500).json({ ok: false, error: "Failed to list stacks" });
            }
        });

        // GET /api/stacks/:name/status
        router.get("/api/stacks/:name/status", validateStackName, async (req: Request, res: Response) => {
            try {
                const endpoint = await resolveEndpoint((req.query.endpoint as string) || "");

                if (!validateEndpoint(endpoint)) {
                    res.status(400).json({ ok: false, error: "Invalid endpoint format" });
                    return;
                }

                if (endpoint && endpoint !== "") {
                    const result = await emitToAgent(server, endpoint, "getStack", req.params.name);
                    if (result.ok && result.stack) {
                        const data = result.stack as Record<string, unknown>;
                        res.json({
                            ok: true,
                            stack: {
                                name: data.name,
                                status: STATUS_NAMES[data.status as number] || "unknown",
                                statusCode: data.status,
                                started: data.started,
                                isManagedByDockge: data.isManagedByDockge,
                                recreateNecessary: data.recreateNecessary,
                                services: data.services,
                                endpoint,
                            },
                        });
                    } else {
                        res.status(404).json({ ok: false, error: result.msg || "Stack not found on agent" });
                    }
                    return;
                }

                const stack = await Stack.getStack(server, req.params.name, false);
                await stack.updateData();

                res.json({
                    ok: true,
                    stack: {
                        name: stack.name,
                        status: STATUS_NAMES[stack.status] || "unknown",
                        statusCode: stack.status,
                        started: stack.isStarted,
                        isManagedByDockge: stack.isManagedByDockge,
                        services: Object.fromEntries(stack.services),
                        endpoint: "",
                    },
                });
            } catch (e) {
                if (e instanceof ValidationError) {
                    res.status(404).json({ ok: false, error: "Stack not found" });
                } else {
                    log.error("api", `GET /api/stacks/${req.params.name}/status error: ${e}`);
                    res.status(500).json({ ok: false, error: "Failed to get stack status" });
                }
            }
        });

        // POST /api/stacks/:name/{start,stop,restart,update,down}
        for (const action of STACK_ACTIONS) {
            router.post(`/api/stacks/:name/${action.path}`, validateStackName, async (req: Request, res: Response) => {
                const name = req.params.name;
                try {
                    const endpoint = await resolveEndpoint((req.query.endpoint as string) || "");

                    if (!validateEndpoint(endpoint)) {
                        res.status(400).json({ ok: false, error: "Invalid endpoint format" });
                        return;
                    }

                    if (endpoint && endpoint !== "") {
                        const result = await emitToAgent(server, endpoint, action.agentEvent, name);
                        if (result.ok) {
                            res.json({ ok: true, message: `Stack '${name}' ${action.pastTense} on ${endpoint}`, endpoint });
                        } else {
                            res.status(500).json({ ok: false, error: result.msg || `${action.label} failed on agent` });
                        }
                        return;
                    }

                    const stack = await Stack.getStack(server, name, false);

                    if (action.refuseSelfStack && await stack.isSelfStack()) {
                        res.status(400).json({ ok: false, error: `Cannot ${action.path} the stack that contains Dockge itself` });
                        return;
                    }

                    for (const args of action.composeCommands) {
                        await childProcessAsync.spawn("docker", stack.getComposeOptions(args[0], ...args.slice(1)), {
                            cwd: stack.path,
                            encoding: "utf-8",
                        });
                    }

                    res.json({ ok: true, message: `Stack '${name}' ${action.pastTense}`, endpoint: "" });
                } catch (e) {
                    if (e instanceof ValidationError) {
                        res.status(404).json({ ok: false, error: "Stack not found" });
                    } else {
                        log.error("api", `POST /api/stacks/${name}/${action.path} error: ${e}`);
                        res.status(500).json({ ok: false, error: `Failed to ${action.path} stack` });
                    }
                }
            });
        }

        // POST /api/system/prune
        router.post("/api/system/prune", async (req: Request, res: Response) => {
            try {
                const endpoint = await resolveEndpoint((req.query.endpoint as string) || "");

                if (!validateEndpoint(endpoint)) {
                    res.status(400).json({ ok: false, error: "Invalid endpoint format" });
                    return;
                }

                if (endpoint && endpoint !== "") {
                    const result = await emitToAgent(server, endpoint, "dockerSystemPrune", true, false);
                    if (result.ok) {
                        res.json({ ok: true, output: result.msg || "", endpoint });
                    } else {
                        res.status(500).json({ ok: false, error: result.msg || "Prune failed on agent" });
                    }
                    return;
                }

                const result = await childProcessAsync.spawn("docker", ["system", "prune", "-a", "-f"], {
                    encoding: "utf-8",
                });

                res.json({
                    ok: true,
                    output: result?.stdout?.toString() || "",
                    endpoint: "",
                });
            } catch (e) {
                log.error("api", "POST /api/system/prune error: " + e);
                res.status(500).json({ ok: false, error: "Failed to prune system" });
            }
        });

        // GET /api/version-sync/scan — scan for version mismatches
        router.get("/api/version-sync/scan", async (req: Request, res: Response) => {
            try {
                const stackName = req.query.stack as string | undefined;
                let result;
                if (stackName && VALID_STACK_NAME.test(stackName)) {
                    result = await scanStack(server.stacksDir, stackName);
                } else {
                    result = await scanAllStacks(server.stacksDir);
                }
                res.json({ ok: true, ...result });
            } catch (e) {
                log.error("api", "GET /api/version-sync/scan error: " + e);
                res.status(500).json({ ok: false, error: "Failed to scan for version mismatches" });
            }
        });

        // POST /api/version-sync/sync — sync a specific service
        router.post("/api/version-sync/sync", async (req: Request, res: Response) => {
            try {
                const { stackName, service, newImage } = req.body;
                if (typeof stackName !== "string" || typeof service !== "string" || typeof newImage !== "string") {
                    res.status(400).json({ ok: false, error: "stackName, service, and newImage are required strings" });
                    return;
                }
                if (!VALID_STACK_NAME.test(stackName)) {
                    res.status(400).json({ ok: false, error: "Invalid stack name" });
                    return;
                }

                const scanResult = await scanStack(server.stacksDir, stackName);
                const mismatch = scanResult.mismatches.find(m => m.service === service);
                if (!mismatch) {
                    res.status(404).json({ ok: false, error: "No mismatch found for this service" });
                    return;
                }

                const { oldImage } = syncComposeFile(mismatch.composePath, service, newImage, server.stacksDir);
                await VersionSyncHistoryService.recordSync(stackName, "", service, oldImage, newImage, mismatch.composePath, false);

                res.json({ ok: true, stackName, service, oldImage, newImage });
            } catch (e) {
                log.error("api", "POST /api/version-sync/sync error: " + e);
                res.status(500).json({ ok: false, error: "Failed to sync version" });
            }
        });

        // POST /api/version-sync/sync-all — sync all mismatches
        router.post("/api/version-sync/sync-all", async (req: Request, res: Response) => {
            try {
                const stackName = req.query.stack as string | undefined;
                let scanResult;
                if (stackName && VALID_STACK_NAME.test(stackName)) {
                    scanResult = await scanStack(server.stacksDir, stackName);
                } else {
                    scanResult = await scanAllStacks(server.stacksDir);
                }

                const synced: { stackName: string; service: string; oldImage: string; newImage: string }[] = [];
                for (const mismatch of scanResult.mismatches) {
                    const { oldImage } = syncComposeFile(mismatch.composePath, mismatch.service, mismatch.runningImage, server.stacksDir);
                    await VersionSyncHistoryService.recordSync(mismatch.stackName, "", mismatch.service, oldImage, mismatch.runningImage, mismatch.composePath, false);
                    synced.push({ stackName: mismatch.stackName, service: mismatch.service, oldImage, newImage: mismatch.runningImage });
                }

                res.json({ ok: true, synced, count: synced.length });
            } catch (e) {
                log.error("api", "POST /api/version-sync/sync-all error: " + e);
                res.status(500).json({ ok: false, error: "Failed to sync all versions" });
            }
        });

        // GET /api/version-sync/history
        router.get("/api/version-sync/history", async (req: Request, res: Response) => {
            try {
                const options: Record<string, unknown> = {};
                if (req.query.limit) {
                    options.limit = parseBoundedInt(req.query.limit, 1, 500);
                }
                if (req.query.offset) {
                    options.offset = parseBoundedInt(req.query.offset, 0, Number.MAX_SAFE_INTEGER);
                }
                if (req.query.stack) {
                    options.stackName = req.query.stack as string;
                }
                if (req.query.service) {
                    options.service = req.query.service as string;
                }

                const result = await VersionSyncHistoryService.getHistory(options);
                res.json({ ok: true, ...result });
            } catch (e) {
                log.error("api", "GET /api/version-sync/history error: " + e);
                res.status(500).json({ ok: false, error: "Failed to get version sync history" });
            }
        });

        // POST /api/version-sync/revert
        router.post("/api/version-sync/revert", async (req: Request, res: Response) => {
            try {
                const { stackName, service } = req.body;
                if (typeof stackName !== "string" || typeof service !== "string") {
                    res.status(400).json({ ok: false, error: "stackName and service are required strings" });
                    return;
                }

                const revertable = await VersionSyncHistoryService.getRevertableEntries(stackName, service);
                if (revertable.length === 0) {
                    res.status(404).json({ ok: false, error: "No revertable sync found" });
                    return;
                }

                const entry = revertable[0];
                syncComposeFile(entry.composePath, entry.service, entry.oldImage, server.stacksDir);
                await VersionSyncHistoryService.recordSync(entry.stackName, "", entry.service, entry.newImage, entry.oldImage, entry.composePath, true);

                res.json({ ok: true, stackName, service, revertedTo: entry.oldImage });
            } catch (e) {
                log.error("api", "POST /api/version-sync/revert error: " + e);
                res.status(500).json({ ok: false, error: "Failed to revert version sync" });
            }
        });

        return router;
    }
}
