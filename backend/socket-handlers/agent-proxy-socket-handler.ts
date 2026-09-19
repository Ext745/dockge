import { SocketHandler } from "../socket-handler.js";
import { DockgeServer } from "../dockge-server";
import { log } from "../log";
import { callbackError, callbackResult, checkLogin, DockgeSocket, ValidationError } from "../util-server";
import { AgentSocket } from "../../common/agent-socket";
import { ALL_ENDPOINTS, LooseObject } from "../../common/util-common";
import { io, Socket as AgentSocketClient } from "socket.io-client";
import { Agent } from "../models/agent";
import { decryptCredential } from "../services/agent-crypto";

/**
 * Open a short-lived, dedicated connection to a registered agent and log in.
 * Deliberately independent of the initiating browser socket's own
 * `instanceManager` connections, which dockge-server.ts's "disconnect"
 * handler tears down the instant that browser socket disconnects - a
 * multi-step operation (see "transferStack" below) needs its agent
 * connections to survive that, since it must finish even if the browser tab
 * that started it closes partway through.
 */
function connectToAgent(url : string, username : string, password : string) : Promise<AgentSocketClient> {
    return new Promise((resolve, reject) => {
        const endpoint = new URL(url).host;
        const client = io(url, {
            extraHeaders: { endpoint },
        });

        client.on("connect", () => {
            client.emit("login", { username, password }, (res : LooseObject) => {
                if (res.ok) {
                    resolve(client);
                } else {
                    client.disconnect();
                    reject(new Error(res.msg || `Login to ${endpoint} failed`));
                }
            });
        });

        client.on("connect_error", (err : Error) => {
            client.disconnect();
            reject(err);
        });
    });
}

/**
 * Call an agent-scoped event and resolve/reject based on its `{ ok }`
 * response.
 * @param agentSocket This connection's local agent event dispatch table,
 * used when `endpoint` is empty (the operation runs on this instance)
 * @param client A connected, logged-in agent client from connectToAgent(),
 * used when `endpoint` is a remote agent
 * @param endpoint Target endpoint ("" for local/direct)
 * @param eventName Agent-scoped event to call (e.g. "exportStack")
 * @param args Event-specific arguments (excluding the callback)
 * @returns The event's `{ ok, ... }` response
 */
function callEndpoint(agentSocket : AgentSocket, client : AgentSocketClient | null, endpoint : string, eventName : string, ...args : unknown[]) : Promise<LooseObject> {
    return new Promise((resolve, reject) => {
        const ack = (res : LooseObject) => {
            if (res && res.ok === false) {
                reject(new Error(res.msg || `${eventName} failed`));
            } else {
                resolve(res);
            }
        };

        if (!client) {
            agentSocket.call(eventName, ...args, ack);
        } else {
            client.emit("agent", endpoint, eventName, ...args, ack);
        }
    });
}

export class AgentProxySocketHandler extends SocketHandler {

    create2(socket : DockgeSocket, server : DockgeServer, agentSocket : AgentSocket) {
        // Agent - proxying requests if needed
        socket.on("agent", async (endpoint : unknown, eventName : unknown, ...args : unknown[]) => {
            try {
                checkLogin(socket);

                // Check Type
                if (typeof(endpoint) !== "string") {
                    throw new Error("Endpoint must be a string: " + endpoint);
                }
                if (typeof(eventName) !== "string") {
                    throw new Error("Event name must be a string");
                }

                if (endpoint === ALL_ENDPOINTS) {      // Send to all endpoints
                    log.debug("agent", "Sending to all endpoints: " + eventName);
                    socket.instanceManager.emitToAllEndpoints(eventName, ...args);

                } else if (!endpoint || endpoint === socket.endpoint) {      // Direct connection or matching endpoint
                    log.debug("agent", "Matched endpoint: " + eventName);
                    agentSocket.call(eventName, ...args);

                } else {
                    log.debug("agent", "Proxying request to " + endpoint + " for " + eventName);
                    await socket.instanceManager.emitToEndpoint(endpoint, eventName, ...args);
                }
            } catch (e) {
                if (e instanceof Error) {
                    log.warn("agent", e.message);
                }
            }
        });

        // Move a stack from one node to another. Runs the whole
        // export -> import+deploy -> delete-source sequence here on the
        // backend (rather than the browser chaining three separate "agent"
        // calls itself) so the transfer finishes even if the browser tab
        // that started it disconnects partway through - previously, doing
        // so between steps could leave the stack permanently deployed on
        // both nodes with no error ever shown.
        socket.on("transferStack", async (stackName : unknown, sourceEndpoint : unknown, targetEndpoint : unknown, callback) => {
            let sourceClient : AgentSocketClient | null = null;
            let targetClient : AgentSocketClient | null = null;

            try {
                checkLogin(socket);

                if (typeof stackName !== "string") {
                    throw new ValidationError("Stack name must be a string");
                }
                if (typeof sourceEndpoint !== "string") {
                    throw new ValidationError("Source endpoint must be a string");
                }
                if (typeof targetEndpoint !== "string") {
                    throw new ValidationError("Target endpoint must be a string");
                }
                if (sourceEndpoint === targetEndpoint) {
                    throw new ValidationError("Source and target node must be different.");
                }

                log.info("agent", `Transferring stack "${stackName}" from "${sourceEndpoint || "(current)"}" to "${targetEndpoint || "(current)"}"`);

                // Open dedicated connections for any remote endpoint involved
                // (a local/direct endpoint uses agentSocket instead and needs
                // no connection at all). These belong to this transfer only,
                // not to the initiating browser's session.
                const agentList = await Agent.getAgentList();
                if (sourceEndpoint) {
                    const agent = agentList[sourceEndpoint];
                    if (!agent) {
                        throw new ValidationError(`Unknown source agent endpoint: ${sourceEndpoint}`);
                    }
                    sourceClient = await connectToAgent(agent.url, agent.username, decryptCredential(agent.password));
                }
                if (targetEndpoint) {
                    const agent = agentList[targetEndpoint];
                    if (!agent) {
                        throw new ValidationError(`Unknown target agent endpoint: ${targetEndpoint}`);
                    }
                    targetClient = await connectToAgent(agent.url, agent.username, decryptCredential(agent.password));
                }

                const exportRes = await callEndpoint(agentSocket, sourceClient, sourceEndpoint, "exportStack", stackName);
                await callEndpoint(agentSocket, targetClient, targetEndpoint, "importStack", stackName, exportRes.contentBase64, true);

                try {
                    await callEndpoint(agentSocket, sourceClient, sourceEndpoint, "deleteStack", stackName);
                } catch (deleteError) {
                    log.warn("agent", `Transfer of "${stackName}" deployed on target but failed to remove the source: ${deleteError instanceof Error ? deleteError.message : deleteError}`);
                    callbackResult({
                        ok: true,
                        sourceRemoveFailed: true,
                        msg: "Deployed on target, but failed to remove the source stack. Please remove it manually.",
                    }, callback);
                    return;
                }

                callbackResult({
                    ok: true,
                    msg: "Stack transferred successfully.",
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            } finally {
                sourceClient?.disconnect();
                targetClient?.disconnect();
            }
        });
    }

    create(socket : DockgeSocket, server : DockgeServer) {
        throw new Error("Method not implemented. Please use create2 instead.");
    }
}
