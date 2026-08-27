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
import { StackSettingsService } from "../stack-settings-service";
import { UpdateHistoryService } from "../update-history-service";
import { Settings } from "../settings";
import { Cron } from "croner";

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
                bean.password = password || "";
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
                type ServiceInfo = { name: string; containerName: string; image: string; state: string; status: string; health: string; imageUpdateAvailable: boolean };
                type StackInfo = { name: string; status: string; statusCode: number; isManagedByDockge: boolean; endpoint: string; autoUpdate: boolean; imageUpdatesAvailable: boolean; services: Record<string, ServiceInfo> };
                const stacks: StackInfo[] = [];

                const stackList = await Stack.getStackList(server, true);
                for (const [name, stack] of stackList) {
                    stacks.push({
                        name,
                        status: STATUS_NAMES[stack.status] || "unknown",
                        statusCode: stack.status,
                        isManagedByDockge: stack.isManagedByDockge,
                        endpoint: "",
                        autoUpdate: Stack.autoUpdateCache.get(Stack.autoUpdateCacheKey(name, "")) ?? false,
                        imageUpdatesAvailable: stack.imageUpdatesAvailable,
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
                            const agentStacks = result.stackList as Record<string, { name: string; status: number; isManagedByDockge: boolean; endpoint: string; imageUpdatesAvailable?: boolean; services?: Record<string, ServiceInfo> }>;
                            for (const name in agentStacks) {
                                const s = agentStacks[name];
                                stacks.push({
                                    name: s.name || name,
                                    status: STATUS_NAMES[s.status] || "unknown",
                                    statusCode: s.status,
                                    isManagedByDockge: s.isManagedByDockge,
                                    endpoint: agent.endpoint,
                                    autoUpdate: Stack.autoUpdateCache.get(Stack.autoUpdateCacheKey(name, agent.endpoint)) ?? false,
                                    imageUpdatesAvailable: s.imageUpdatesAvailable ?? false,
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
                                imageUpdatesAvailable: data.imageUpdatesAvailable,
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
                        imageUpdatesAvailable: stack.imageUpdatesAvailable,
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

        // POST /api/stacks/:name/update
        router.post("/api/stacks/:name/update", validateStackName, async (req: Request, res: Response) => {
            try {
                const endpoint = await resolveEndpoint((req.query.endpoint as string) || "");

                if (!validateEndpoint(endpoint)) {
                    res.status(400).json({ ok: false, error: "Invalid endpoint format" });
                    return;
                }

                const pruneAfterUpdate = await Settings.get("defaultPruneAfterUpdate")
                    ?? await Settings.get("schedulerPruneAfterUpdate") ?? true;
                const pruneAllAfterUpdate = await Settings.get("defaultPruneAllAfterUpdate")
                    ?? await Settings.get("schedulerPruneAllAfterUpdate") ?? true;

                const startedAt = new Date().toISOString();
                const startTime = Date.now();

                if (endpoint && endpoint !== "") {
                    try {
                        let result: Record<string, unknown>;
                        if (agentSupports(server, endpoint)) {
                            result = await emitToAgent(server, endpoint, "updateStack", 300000, req.params.name, pruneAfterUpdate, pruneAllAfterUpdate);
                        } else {
                            result = await emitToAgent(server, endpoint, "updateStack", 300000, req.params.name);
                        }
                        const durationMs = Date.now() - startTime;
                        const success = !!result.ok;
                        await UpdateHistoryService.recordUpdate(req.params.name, endpoint, "api", success, null, success ? null : (result.msg as string) || null, startedAt, new Date().toISOString(), durationMs);
                        if (success) {
                            res.json({ ok: true, message: `Stack '${req.params.name}' updated on ${endpoint}`, endpoint });
                        } else {
                            res.status(500).json({ ok: false, error: result.msg || "Update failed on agent" });
                        }
                    } catch (e) {
                        const durationMs = Date.now() - startTime;
                        const errorMsg = e instanceof Error ? e.message : String(e);
                        await UpdateHistoryService.recordUpdate(req.params.name, endpoint, "api", false, null, errorMsg, startedAt, new Date().toISOString(), durationMs);
                        throw e;
                    }
                    return;
                }

                const stack = await Stack.getStack(server, req.params.name, false);
                await stack.updateData();

                if (await stack.isSelfStack()) {
                    await stack.selfUpdate(pruneAfterUpdate as boolean, pruneAllAfterUpdate as boolean);
                    const durationMs = Date.now() - startTime;
                    await UpdateHistoryService.recordUpdate(req.params.name, "", "api", true, null, null, startedAt, new Date().toISOString(), durationMs);
                    res.json({
                        ok: true,
                        message: `Stack '${req.params.name}' self-update initiated — Dockge will restart shortly`,
                        endpoint: "",
                    });
                    return;
                }

                const pullResult = await childProcessAsync.spawn("docker", [...stack.composeArgs, "pull"], {
                    cwd: stack.path,
                    encoding: "utf-8",
                });

                let upResult;
                if (stack.isStarted) {
                    upResult = await childProcessAsync.spawn("docker", [...stack.composeArgs, "up", "-d", "--remove-orphans"], {
                        cwd: stack.path,
                        encoding: "utf-8",
                    });
                }

                if (pruneAfterUpdate) {
                    const pruneArgs = ["image", "prune", "-f"];
                    if (pruneAllAfterUpdate) {
                        pruneArgs.push("-a");
                    }
                    await childProcessAsync.spawn("docker", pruneArgs, { encoding: "utf-8" });
                }

                await stack.updateData();
                await stack.updateImageInfos();

                const durationMs = Date.now() - startTime;
                await UpdateHistoryService.recordUpdate(req.params.name, "", "api", true, null, null, startedAt, new Date().toISOString(), durationMs);

                res.json({
                    ok: true,
                    message: `Stack '${req.params.name}' updated`,
                    pullOutput: pullResult?.stdout?.toString() || "",
                    upOutput: upResult?.stdout?.toString() || "",
                    endpoint: "",
                });
            } catch (e) {
                if (e instanceof ValidationError) {
                    res.status(404).json({ ok: false, error: "Stack not found" });
                } else {
                    log.error("api", `POST /api/stacks/${req.params.name}/update error: ${e}`);
                    res.status(500).json({ ok: false, error: "Failed to update stack" });
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

        // POST /api/stacks/:name/check-updates
        router.post("/api/stacks/:name/check-updates", validateStackName, async (req: Request, res: Response) => {
            try {
                const endpoint = await resolveEndpoint((req.query.endpoint as string) || "");
                if (!validateEndpoint(endpoint)) {
                    res.status(400).json({ ok: false, error: "Invalid endpoint format" });
                    return;
                }

                if (endpoint && endpoint !== "") {
                    if (!agentSupports(server, endpoint)) {
                        res.json({ ok: true, imageUpdatesAvailable: false, endpoint, notice: "Agent is running a version older than 1.6.0 and does not support image update checks" });
                        return;
                    }
                    try {
                        const result = await emitToAgent(server, endpoint, "checkStackUpdates", req.params.name);
                        res.json({ ok: true, imageUpdatesAvailable: result.imageUpdatesAvailable ?? false, endpoint });
                    } catch (e) {
                        log.error("api", `POST /api/stacks/${req.params.name}/check-updates proxy error: ${e}`);
                        res.status(502).json({ ok: false, error: "Failed to communicate with agent" });
                    }
                    return;
                }

                const stack = await Stack.getStack(server, req.params.name, false);
                await stack.updateData();
                await stack.updateImageInfos();

                res.json({
                    ok: true,
                    imageUpdatesAvailable: stack.imageUpdatesAvailable,
                    endpoint: "",
                });
            } catch (e) {
                if (e instanceof ValidationError) {
                    res.status(404).json({ ok: false, error: "Stack not found" });
                } else {
                    log.error("api", `POST /api/stacks/${req.params.name}/check-updates error: ${e}`);
                    res.status(500).json({ ok: false, error: "Failed to check for updates" });
                }
            }
        });

        // GET /api/stacks/:name/auto-update
        router.get("/api/stacks/:name/auto-update", validateStackName, async (req: Request, res: Response) => {
            try {
                const endpoint = await resolveEndpoint((req.query.endpoint as string) || "");
                if (!validateEndpoint(endpoint)) {
                    res.status(400).json({ ok: false, error: "Invalid endpoint format" });
                    return;
                }
                const enabled = await StackSettingsService.getAutoUpdate(req.params.name, endpoint);
                res.json({ ok: true, autoUpdate: enabled });
            } catch (e) {
                log.error("api", `GET /api/stacks/${req.params.name}/auto-update error: ${e}`);
                res.status(500).json({ ok: false, error: "Failed to get auto-update status" });
            }
        });

        // PUT /api/stacks/:name/auto-update
        router.put("/api/stacks/:name/auto-update", validateStackName, async (req: Request, res: Response) => {
            try {
                const endpoint = await resolveEndpoint((req.query.endpoint as string) || "");
                if (!validateEndpoint(endpoint)) {
                    res.status(400).json({ ok: false, error: "Invalid endpoint format" });
                    return;
                }
                const { enabled } = req.body;
                if (typeof enabled !== "boolean") {
                    res.status(400).json({ ok: false, error: "enabled must be a boolean" });
                    return;
                }
                await StackSettingsService.setAutoUpdate(req.params.name, endpoint, enabled);
                Stack.autoUpdateCache.set(Stack.autoUpdateCacheKey(req.params.name, endpoint), enabled);
                res.json({ ok: true });
            } catch (e) {
                log.error("api", `PUT /api/stacks/${req.params.name}/auto-update error: ${e}`);
                res.status(500).json({ ok: false, error: "Failed to set auto-update status" });
            }
        });

        // POST /api/update-all
        router.post("/api/update-all", async (req: Request, res: Response) => {
            try {
                const rawEndpointFilter = req.query.endpoint as string | undefined;
                if (rawEndpointFilter !== undefined && !validateEndpoint(rawEndpointFilter)) {
                    res.status(400).json({ ok: false, error: "Invalid endpoint format" });
                    return;
                }

                const pruneAfterUpdate = await Settings.get("defaultPruneAfterUpdate")
                    ?? await Settings.get("schedulerPruneAfterUpdate") ?? true;
                const pruneAllAfterUpdate = await Settings.get("defaultPruneAllAfterUpdate")
                    ?? await Settings.get("schedulerPruneAllAfterUpdate") ?? true;

                const results: { name: string; endpoint: string; success: boolean; error?: string }[] = [];

                const updateLocalStacks = async () => {
                    const stackList = await Stack.getStackList(server, true);
                    for (const [name, stack] of stackList) {
                        if (!stack.isManagedByDockge) continue;
                        if (!stack.isStarted) {
                            results.push({ name, endpoint: "", success: true, error: "skipped (not running)" });
                            continue;
                        }
                        const startedAt = new Date().toISOString();
                        const startTime = Date.now();
                        try {
                            if (await stack.isSelfStack()) {
                                await stack.selfUpdate(pruneAfterUpdate as boolean, pruneAllAfterUpdate as boolean);
                                const durationMs = Date.now() - startTime;
                                await UpdateHistoryService.recordUpdate(name, "", "api", true, null, null, startedAt, new Date().toISOString(), durationMs);
                                results.push({ name, endpoint: "", success: true, error: "self-update initiated" });
                                continue;
                            }

                            await childProcessAsync.spawn("docker", [...stack.composeArgs, "pull"], { cwd: stack.path, encoding: "utf-8" });
                            await stack.updateData();
                            if (stack.isStarted) {
                                await childProcessAsync.spawn("docker", [...stack.composeArgs, "up", "-d", "--remove-orphans"], { cwd: stack.path, encoding: "utf-8" });
                            }
                            if (pruneAfterUpdate) {
                                const pruneArgs = ["image", "prune", "-f"];
                                if (pruneAllAfterUpdate) {
                                    pruneArgs.push("-a");
                                }
                                await childProcessAsync.spawn("docker", pruneArgs, { encoding: "utf-8" });
                            }
                            await stack.updateImageInfos();
                            const durationMs = Date.now() - startTime;
                            await UpdateHistoryService.recordUpdate(name, "", "api", true, null, null, startedAt, new Date().toISOString(), durationMs);
                            results.push({ name, endpoint: "", success: true });
                        } catch (e) {
                            const durationMs = Date.now() - startTime;
                            const errorMsg = e instanceof Error ? e.message : String(e);
                            await UpdateHistoryService.recordUpdate(name, "", "api", false, null, errorMsg, startedAt, new Date().toISOString(), durationMs);
                            results.push({ name, endpoint: "", success: false, error: errorMsg });
                        }
                    }
                };

                const updateAgentStacks = async (ep: string) => {
                    const supported = agentSupports(server, ep);
                    if (!supported) {
                        log.info("api", `Agent ${ep} is pre-1.6.0, using auto-update settings to determine stacks`);
                        const autoUpdateStacks = await StackSettingsService.getAllAutoUpdateStacks();
                        const agentStacks = autoUpdateStacks.filter(s => s.endpoint === ep);
                        if (agentStacks.length === 0) {
                            results.push({ name: "(all)", endpoint: ep, success: false, error: "Agent is pre-1.6.0 and has no auto-update stacks configured" });
                            return;
                        }
                        for (const { stackName } of agentStacks) {
                            const startedAt = new Date().toISOString();
                            const startTime = Date.now();
                            try {
                                const updateResult = await emitToAgent(server, ep, "updateStack", 300000, stackName);
                                const durationMs = Date.now() - startTime;
                                const success = !!updateResult.ok;
                                await UpdateHistoryService.recordUpdate(stackName, ep, "api", success, null, success ? null : (updateResult.msg as string) || null, startedAt, new Date().toISOString(), durationMs);
                                results.push({ name: stackName, endpoint: ep, success });
                            } catch (e) {
                                const durationMs = Date.now() - startTime;
                                const errorMsg = e instanceof Error ? e.message : String(e);
                                await UpdateHistoryService.recordUpdate(stackName, ep, "api", false, null, errorMsg, startedAt, new Date().toISOString(), durationMs);
                                results.push({ name: stackName, endpoint: ep, success: false, error: errorMsg });
                            }
                        }
                        return;
                    }

                    try {
                        const listResult = await emitToAgent(server, ep, "getStackList");
                        if (!listResult.ok || !listResult.stackList) return;
                        const agentStacks = listResult.stackList as Record<string, { name: string; isManagedByDockge: boolean }>;
                        for (const name in agentStacks) {
                            if (!agentStacks[name].isManagedByDockge) continue;
                            const startedAt = new Date().toISOString();
                            const startTime = Date.now();
                            try {
                                const updateResult = await emitToAgent(server, ep, "updateStack", 300000, name, pruneAfterUpdate, pruneAllAfterUpdate);
                                const durationMs = Date.now() - startTime;
                                const success = !!updateResult.ok;
                                await UpdateHistoryService.recordUpdate(name, ep, "api", success, null, success ? null : (updateResult.msg as string) || null, startedAt, new Date().toISOString(), durationMs);
                                results.push({ name, endpoint: ep, success });
                            } catch (e) {
                                const durationMs = Date.now() - startTime;
                                const errorMsg = e instanceof Error ? e.message : String(e);
                                await UpdateHistoryService.recordUpdate(name, ep, "api", false, null, errorMsg, startedAt, new Date().toISOString(), durationMs);
                                results.push({ name, endpoint: ep, success: false, error: errorMsg });
                            }
                        }
                    } catch (e) {
                        log.warn("api", `Failed to update stacks on agent ${ep}: ${e}`);
                        results.push({ name: "(all)", endpoint: ep, success: false, error: e instanceof Error ? e.message : String(e) });
                    }
                };

                const endpointFilter = rawEndpointFilter !== undefined ? await resolveEndpoint(rawEndpointFilter) : undefined;
                if (endpointFilter !== undefined) {
                    if (!endpointFilter || endpointFilter === "") {
                        await updateLocalStacks();
                    } else {
                        await updateAgentStacks(endpointFilter);
                    }
                } else {
                    await updateLocalStacks();
                    const agentList = await Agent.getAgentList();
                    for (const url in agentList) {
                        const agent = agentList[url];
                        if (!url || agent.endpoint === "") continue;
                        await updateAgentStacks(agent.endpoint);
                    }
                }

                res.json({ ok: true, results });
            } catch (e) {
                log.error("api", "POST /api/update-all error: " + e);
                res.status(500).json({ ok: false, error: "Failed to update stacks" });
            }
        });

        // GET /api/update-history
        router.get("/api/update-history", async (req: Request, res: Response) => {
            try {
                const options: Record<string, unknown> = {};
                if (req.query.limit) options.limit = parseInt(req.query.limit as string, 10);
                if (req.query.offset) options.offset = parseInt(req.query.offset as string, 10);
                if (req.query.stack) options.stackName = req.query.stack as string;
                if (req.query.endpoint !== undefined) options.endpoint = await resolveEndpoint(req.query.endpoint as string);
                if (req.query.trigger) options.triggerType = req.query.trigger as string;
                if (req.query.success !== undefined) options.success = req.query.success === "true";

                const result = await UpdateHistoryService.getHistory(options);
                res.json({ ok: true, ...result });
            } catch (e) {
                log.error("api", "GET /api/update-history error: " + e);
                res.status(500).json({ ok: false, error: "Failed to get update history" });
            }
        });

        // GET /api/scheduler
        router.get("/api/scheduler", async (_req: Request, res: Response) => {
            try {
                res.json({
                    ok: true,
                    enabled: await Settings.get("schedulerEnabled") ?? false,
                    cronExpression: await Settings.get("schedulerCron") ?? "0 3 * * *",
                    pruneAfterUpdate: await Settings.get("defaultPruneAfterUpdate")
                        ?? await Settings.get("schedulerPruneAfterUpdate") ?? true,
                    pruneAllAfterUpdate: await Settings.get("defaultPruneAllAfterUpdate")
                        ?? await Settings.get("schedulerPruneAllAfterUpdate") ?? true,
                    nextAutoUpdate: server.autoUpdateScheduler?.getNextRunTime() ?? null,
                });
            } catch (e) {
                log.error("api", "GET /api/scheduler error: " + e);
                res.status(500).json({ ok: false, error: "Failed to get scheduler settings" });
            }
        });

        // PUT /api/scheduler
        router.put("/api/scheduler", async (req: Request, res: Response) => {
            try {
                const { enabled, cronExpression, pruneAfterUpdate, pruneAllAfterUpdate } = req.body;
                if (typeof enabled === "boolean") await Settings.set("schedulerEnabled", enabled, "boolean");
                if (typeof cronExpression === "string") {
                    try {
                        new Cron(cronExpression, { legacyMode: false });
                    } catch {
                        res.status(400).json({ ok: false, error: "Invalid cron expression" });
                        return;
                    }
                    await Settings.set("schedulerCron", cronExpression, "string");
                }
                if (typeof pruneAfterUpdate === "boolean") await Settings.set("defaultPruneAfterUpdate", pruneAfterUpdate, "boolean");
                if (typeof pruneAllAfterUpdate === "boolean") await Settings.set("defaultPruneAllAfterUpdate", pruneAllAfterUpdate, "boolean");
                server.restartScheduler?.();
                res.json({ ok: true });
            } catch (e) {
                log.error("api", "PUT /api/scheduler error: " + e);
                res.status(500).json({ ok: false, error: "Failed to update scheduler settings" });
            }
        });

        // POST /api/scheduler/trigger
        router.post("/api/scheduler/trigger", async (_req: Request, res: Response) => {
            try {
                const stacks = await StackSettingsService.getAllAutoUpdateStacks();
                const pruneAfterUpdate = await Settings.get("defaultPruneAfterUpdate")
                    ?? await Settings.get("schedulerPruneAfterUpdate") ?? true;
                const pruneAllAfterUpdate = await Settings.get("defaultPruneAllAfterUpdate")
                    ?? await Settings.get("schedulerPruneAllAfterUpdate") ?? true;

                const results: { stackName: string; endpoint: string; success: boolean; error?: string }[] = [];

                for (const { stackName, endpoint } of stacks) {
                    const startedAt = new Date().toISOString();
                    const startTime = Date.now();
                    try {
                        if (endpoint !== "") {
                            let updateResult;
                            if (agentSupports(server, endpoint)) {
                                updateResult = await emitToAgent(server, endpoint, "updateStack", 300000, stackName, pruneAfterUpdate, pruneAllAfterUpdate);
                            } else {
                                log.info("api", `Agent ${endpoint} is pre-1.6.0, using legacy updateStack for ${stackName}`);
                                updateResult = await emitToAgent(server, endpoint, "updateStack", 300000, stackName);
                            }
                            const durationMs = Date.now() - startTime;
                            const success = !!updateResult.ok;
                            await UpdateHistoryService.recordUpdate(stackName, endpoint, "api-trigger", success, null, success ? null : (updateResult.msg as string) || null, startedAt, new Date().toISOString(), durationMs);
                            results.push({ stackName, endpoint, success });
                        } else {
                            const stack = await Stack.getStack(server, stackName, false);

                            if (await stack.isSelfStack()) {
                                await stack.selfUpdate(pruneAfterUpdate as boolean, pruneAllAfterUpdate as boolean);
                                const durationMs = Date.now() - startTime;
                                await UpdateHistoryService.recordUpdate(stackName, endpoint, "api-trigger", true, null, null, startedAt, new Date().toISOString(), durationMs);
                                results.push({ stackName, endpoint, success: true });
                                continue;
                            }

                            await childProcessAsync.spawn("docker", [...stack.composeArgs, "pull"], { cwd: stack.path, encoding: "utf-8" });
                            await stack.updateData();
                            if (stack.isStarted) {
                                await childProcessAsync.spawn("docker", [...stack.composeArgs, "up", "-d", "--remove-orphans"], { cwd: stack.path, encoding: "utf-8" });
                            }
                            if (pruneAfterUpdate) {
                                const pruneArgs = ["image", "prune", "-f"];
                                if (pruneAllAfterUpdate) pruneArgs.push("-a");
                                await childProcessAsync.spawn("docker", pruneArgs, { encoding: "utf-8" });
                            }
                            const durationMs = Date.now() - startTime;
                            await UpdateHistoryService.recordUpdate(stackName, endpoint, "api-trigger", true, null, null, startedAt, new Date().toISOString(), durationMs);
                            results.push({ stackName, endpoint, success: true });
                        }
                    } catch (e) {
                        const durationMs = Date.now() - startTime;
                        const errorMsg = e instanceof Error ? e.message : String(e);
                        await UpdateHistoryService.recordUpdate(stackName, endpoint, "api-trigger", false, null, errorMsg, startedAt, new Date().toISOString(), durationMs);
                        results.push({ stackName, endpoint, success: false, error: errorMsg });
                    }
                }

                res.json({ ok: true, results });
            } catch (e) {
                log.error("api", "POST /api/scheduler/trigger error: " + e);
                res.status(500).json({ ok: false, error: "Failed to trigger auto-update" });
            }
        });

        return router;
    }
}
