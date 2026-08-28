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
                const msg = e instanceof Error ? e.message : "Failed to add agent";
                res.status(500).json({ ok: false, error: msg });
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
                    if (!url || agent.endpoint === "") continue;

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
                for (const [name, stack] of stackList) {
                    await stack.updateData();
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

        // POST /api/stacks/:name/start
        router.post("/api/stacks/:name/start", validateStackName, async (req: Request, res: Response) => {
            try {
                const endpoint = await resolveEndpoint((req.query.endpoint as string) || "");

                if (!validateEndpoint(endpoint)) {
                    res.status(400).json({ ok: false, error: "Invalid endpoint format" });
                    return;
                }

                if (endpoint && endpoint !== "") {
                    const result = await emitToAgent(server, endpoint, "startStack", req.params.name);
                    if (result.ok) {
                        res.json({ ok: true, message: `Stack '${req.params.name}' started on ${endpoint}`, endpoint });
                    } else {
                        res.status(500).json({ ok: false, error: result.msg || "Start failed on agent" });
                    }
                    return;
                }

                const stack = await Stack.getStack(server, req.params.name, false);

                await childProcessAsync.spawn("docker", [...stack.composeArgs, "up", "-d", "--remove-orphans"], {
                    cwd: stack.path,
                    encoding: "utf-8",
                });

                res.json({
                    ok: true,
                    message: `Stack '${req.params.name}' started`,
                    endpoint: "",
                });
            } catch (e) {
                if (e instanceof ValidationError) {
                    res.status(404).json({ ok: false, error: "Stack not found" });
                } else {
                    log.error("api", `POST /api/stacks/${req.params.name}/start error: ${e}`);
                    res.status(500).json({ ok: false, error: "Failed to start stack" });
                }
            }
        });

        // POST /api/stacks/:name/stop
        router.post("/api/stacks/:name/stop", validateStackName, async (req: Request, res: Response) => {
            try {
                const endpoint = await resolveEndpoint((req.query.endpoint as string) || "");

                if (!validateEndpoint(endpoint)) {
                    res.status(400).json({ ok: false, error: "Invalid endpoint format" });
                    return;
                }

                if (endpoint && endpoint !== "") {
                    const result = await emitToAgent(server, endpoint, "stopStack", req.params.name);
                    if (result.ok) {
                        res.json({ ok: true, message: `Stack '${req.params.name}' stopped on ${endpoint}`, endpoint });
                    } else {
                        res.status(500).json({ ok: false, error: result.msg || "Stop failed on agent" });
                    }
                    return;
                }

                const stack = await Stack.getStack(server, req.params.name, false);

                if (await stack.isSelfStack()) {
                    res.status(400).json({ ok: false, error: "Cannot stop the stack that contains Dockge itself" });
                    return;
                }

                await childProcessAsync.spawn("docker", [...stack.composeArgs, "stop"], {
                    cwd: stack.path,
                    encoding: "utf-8",
                });

                res.json({
                    ok: true,
                    message: `Stack '${req.params.name}' stopped`,
                    endpoint: "",
                });
            } catch (e) {
                if (e instanceof ValidationError) {
                    res.status(404).json({ ok: false, error: "Stack not found" });
                } else {
                    log.error("api", `POST /api/stacks/${req.params.name}/stop error: ${e}`);
                    res.status(500).json({ ok: false, error: "Failed to stop stack" });
                }
            }
        });

        // POST /api/stacks/:name/restart
        router.post("/api/stacks/:name/restart", validateStackName, async (req: Request, res: Response) => {
            try {
                const endpoint = await resolveEndpoint((req.query.endpoint as string) || "");

                if (!validateEndpoint(endpoint)) {
                    res.status(400).json({ ok: false, error: "Invalid endpoint format" });
                    return;
                }

                if (endpoint && endpoint !== "") {
                    const result = await emitToAgent(server, endpoint, "restartStack", req.params.name);
                    if (result.ok) {
                        res.json({ ok: true, message: `Stack '${req.params.name}' restarted on ${endpoint}`, endpoint });
                    } else {
                        res.status(500).json({ ok: false, error: result.msg || "Restart failed on agent" });
                    }
                    return;
                }

                const stack = await Stack.getStack(server, req.params.name, false);

                await childProcessAsync.spawn("docker", [...stack.composeArgs, "restart"], {
                    cwd: stack.path,
                    encoding: "utf-8",
                });

                res.json({
                    ok: true,
                    message: `Stack '${req.params.name}' restarted`,
                    endpoint: "",
                });
            } catch (e) {
                if (e instanceof ValidationError) {
                    res.status(404).json({ ok: false, error: "Stack not found" });
                } else {
                    log.error("api", `POST /api/stacks/${req.params.name}/restart error: ${e}`);
                    res.status(500).json({ ok: false, error: "Failed to restart stack" });
                }
            }
        });

        // POST /api/stacks/:name/down — stop and remove containers (inactive)
        router.post("/api/stacks/:name/down", validateStackName, async (req: Request, res: Response) => {
            try {
                const endpoint = await resolveEndpoint((req.query.endpoint as string) || "");

                if (!validateEndpoint(endpoint)) {
                    res.status(400).json({ ok: false, error: "Invalid endpoint format" });
                    return;
                }

                if (endpoint && endpoint !== "") {
                    const result = await emitToAgent(server, endpoint, "downStack", req.params.name);
                    if (result.ok) {
                        res.json({ ok: true, message: `Stack '${req.params.name}' downed on ${endpoint}`, endpoint });
                    } else {
                        res.status(500).json({ ok: false, error: result.msg || "Down failed on agent" });
                    }
                    return;
                }

                const stack = await Stack.getStack(server, req.params.name, false);

                if (await stack.isSelfStack()) {
                    res.status(400).json({ ok: false, error: "Cannot down the stack that contains Dockge itself" });
                    return;
                }

                await childProcessAsync.spawn("docker", [...stack.composeArgs, "down"], {
                    cwd: stack.path,
                    encoding: "utf-8",
                });

                res.json({
                    ok: true,
                    message: `Stack '${req.params.name}' downed`,
                    endpoint: "",
                });
            } catch (e) {
                if (e instanceof ValidationError) {
                    res.status(404).json({ ok: false, error: "Stack not found" });
                } else {
                    log.error("api", `POST /api/stacks/${req.params.name}/down error: ${e}`);
                    res.status(500).json({ ok: false, error: "Failed to down stack" });
                }
            }
        });

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
                if (req.query.limit) options.limit = parseInt(req.query.limit as string, 10);
                if (req.query.offset) options.offset = parseInt(req.query.offset as string, 10);
                if (req.query.stack) options.stackName = req.query.stack as string;
                if (req.query.service) options.service = req.query.service as string;

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
