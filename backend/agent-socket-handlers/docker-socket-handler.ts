import { AgentSocketHandler } from "../agent-socket-handler";
import { DockgeServer } from "../dockge-server";
import { callbackError, callbackResult, checkLogin, DockgeSocket, fileExists, ValidationError } from "../util-server";
import { Stack } from "../stack";
import { AgentSocket } from "../../common/agent-socket";
import { scanStack, scanAllStacks, syncComposeFile } from "../compose-version-sync";
import { VersionSyncHistoryService } from "../version-sync-history-service";
import { promises as fsAsync } from "fs";
import path from "path";
import AdmZip from "adm-zip";

export class DockerSocketHandler extends AgentSocketHandler {
    create(socket : DockgeSocket, server : DockgeServer, agentSocket : AgentSocket) {
        // Do not call super.create()

        agentSocket.on("deployStack", async (name : unknown, composeYAML : unknown, composeENV : unknown, composeOverrideYAML : unknown, isAdd : unknown, callback) => {
            try {
                checkLogin(socket);
                const stack = await this.saveStack(server, name, composeYAML, composeENV, composeOverrideYAML, isAdd);
                await stack.deploy(socket);
                server.sendStackList();
                callbackResult({
                    ok: true,
                    msg: "Deployed",
                    msgi18n: true,
                }, callback);
                stack.joinCombinedTerminal(socket);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        agentSocket.on("saveStack", async (name : unknown, composeYAML : unknown, composeENV : unknown, composeOverrideYAML : unknown, isAdd : unknown, callback) => {
            try {
                checkLogin(socket);
                await this.saveStack(server, name, composeYAML, composeENV, composeOverrideYAML, isAdd);
                callbackResult({
                    ok: true,
                    msg: "Saved",
                    msgi18n: true,
                }, callback);
                server.sendStackList();
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // Export a Dockge-managed stack folder as a zip (base64) so it can be
        // transferred to another node.
        agentSocket.on("exportStack", async (stackName : unknown, callback) => {
            try {
                checkLogin(socket);
                if (typeof(stackName) !== "string") {
                    throw new ValidationError("Stack name must be a string");
                }

                const stack = await Stack.getStack(server, stackName);
                if (!stack.isManagedByDockge) {
                    throw new ValidationError("Only Dockge-managed stacks can be transferred.");
                }

                const zip = new AdmZip();
                zip.addLocalFolder(stack.fullPath);

                callbackResult({
                    ok: true,
                    stackName: stack.name,
                    contentBase64: zip.toBuffer().toString("base64"),
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // Import a stack zip (base64) onto this node, optionally deploying it.
        // Used as the receiving end of a node-to-node transfer.
        agentSocket.on("importStack", async (stackName : unknown, contentBase64 : unknown, deploy : unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof(stackName) !== "string" || typeof(contentBase64) !== "string") {
                    throw new ValidationError("Invalid import request");
                }
                if (!/^[a-z0-9][a-z0-9_-]*$/.test(stackName)) {
                    throw new ValidationError("Invalid stack name");
                }

                const targetDir = path.join(server.stacksDir, stackName);
                if (await fileExists(targetDir)) {
                    throw new ValidationError("A stack with this name already exists on the target node.");
                }

                const zip = new AdmZip(Buffer.from(contentBase64, "base64"));
                const root = path.resolve(targetDir);
                await fsAsync.mkdir(root, { recursive: true });

                // Extract each entry manually with zip-slip protection so a
                // malicious archive cannot write outside the stack folder.
                for (const entry of zip.getEntries()) {
                    const entryPath = path.resolve(root, entry.entryName);
                    if (entryPath !== root && !entryPath.startsWith(root + path.sep)) {
                        throw new ValidationError(`Unsafe path in archive: ${entry.entryName}`);
                    }

                    if (entry.isDirectory) {
                        await fsAsync.mkdir(entryPath, { recursive: true });
                    } else {
                        await fsAsync.mkdir(path.dirname(entryPath), { recursive: true });
                        await fsAsync.writeFile(entryPath, entry.getData());
                    }
                }

                server.sendStackList();

                if (Boolean(deploy)) {
                    try {
                        const stack = await Stack.getStack(server, stackName);
                        await stack.deploy(socket);
                        server.sendStackList();
                        stack.joinCombinedTerminal(socket);
                    } catch (deployError) {
                        // Deploy failed after extraction: remove the orphaned
                        // stack folder so the target node isn't left with an
                        // undeployed stack blocking a retry of this import.
                        await fsAsync.rm(root, {
                            recursive: true,
                            force: true,
                        });
                        server.sendStackList();
                        throw deployError;
                    }
                }

                callbackResult({
                    ok: true,
                    msg: "Stack imported.",
                    stackName,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        agentSocket.on("deleteStack", async (name : unknown, callback) => {
            try {
                checkLogin(socket);
                if (typeof(name) !== "string") {
                    throw new ValidationError("Name must be a string");
                }
                const stack = await Stack.getStack(server, name);

                try {
                    await stack.delete(socket);
                } catch (e) {
                    server.sendStackList();
                    throw e;
                }

                server.sendStackList();
                callbackResult({
                    ok: true,
                    msg: "Deleted",
                    msgi18n: true,
                }, callback);

            } catch (e) {
                callbackError(e, callback);
            }
        });

        agentSocket.on("getStack", async (stackName : unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof(stackName) !== "string") {
                    throw new ValidationError("Stack name must be a string");
                }

                const stack = await Stack.getStack(server, stackName);

                if (stack.isManagedByDockge) {
                    stack.joinCombinedTerminal(socket);
                }

                callbackResult({
                    ok: true,
                    stack: await stack.toJSON(socket.endpoint),
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // requestStackList
        agentSocket.on("requestStackList", async (callback) => {
            try {
                checkLogin(socket);
                server.sendStackList();
                callbackResult({
                    ok: true,
                    msg: "Updated",
                    msgi18n: true,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // startStack
        agentSocket.on("startStack", async (stackName : unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof(stackName) !== "string") {
                    throw new ValidationError("Stack name must be a string");
                }

                const stack = await Stack.getStack(server, stackName);
                await stack.start(socket);
                callbackResult({
                    ok: true,
                    msg: "Started",
                    msgi18n: true,
                }, callback);
                server.sendStackList();

                stack.joinCombinedTerminal(socket);

            } catch (e) {
                callbackError(e, callback);
            }
        });

        // stopStack
        agentSocket.on("stopStack", async (stackName : unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof(stackName) !== "string") {
                    throw new ValidationError("Stack name must be a string");
                }

                const stack = await Stack.getStack(server, stackName);
                await stack.stop(socket);
                callbackResult({
                    ok: true,
                    msg: "Stopped",
                    msgi18n: true,
                }, callback);
                server.sendStackList();

                stack.leaveCombinedTerminal(socket);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // restartStack
        agentSocket.on("restartStack", async (stackName : unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof(stackName) !== "string") {
                    throw new ValidationError("Stack name must be a string");
                }

                const stack = await Stack.getStack(server, stackName);
                await stack.restart(socket);
                callbackResult({
                    ok: true,
                    msg: "Restarted",
                    msgi18n: true,
                }, callback);
                server.sendStackList();
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // updateStack
        agentSocket.on("updateStack", async (stackName : unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof(stackName) !== "string") {
                    throw new ValidationError("Stack name must be a string");
                }

                const stack = await Stack.getStack(server, stackName);
                await stack.update(socket);
                callbackResult({
                    ok: true,
                    msg: "Updated",
                    msgi18n: true,
                }, callback);
                server.sendStackList();
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // down stack
        agentSocket.on("downStack", async (stackName : unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof(stackName) !== "string") {
                    throw new ValidationError("Stack name must be a string");
                }

                const stack = await Stack.getStack(server, stackName);
                await stack.down(socket);
                callbackResult({
                    ok: true,
                    msg: "Downed",
                    msgi18n: true,
                }, callback);
                server.sendStackList();
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // Services status
        agentSocket.on("serviceStatusList", async (stackName : unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof(stackName) !== "string") {
                    throw new ValidationError("Stack name must be a string");
                }

                const stack = await Stack.getStack(server, stackName, true);
                const serviceStatusList = Object.fromEntries(await stack.getServiceStatusList());
                callbackResult({
                    ok: true,
                    serviceStatusList,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // Docker stats
        agentSocket.on("dockerStats", async (callback) => {
            try {
                checkLogin(socket);

                const dockerStats = Object.fromEntries(await server.getDockerStats());
                callbackResult({
                    ok: true,
                    dockerStats,
                }, callback);
                server.sendStackList();
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // Start a service
        agentSocket.on("startService", async (stackName: unknown, serviceName: unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof (stackName) !== "string" || typeof (serviceName) !== "string") {
                    throw new ValidationError("Stack name and service name must be strings");
                }

                const stack = await Stack.getStack(server, stackName);
                await stack.startService(socket, serviceName);
                stack.joinCombinedTerminal(socket); // Ensure the combined terminal is joined
                callbackResult({
                    ok: true,
                    msg: "Service " + serviceName + " started"
                }, callback);
                server.sendStackList();
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // Stop a service
        agentSocket.on("stopService", async (stackName: unknown, serviceName: unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof (stackName) !== "string" || typeof (serviceName) !== "string") {
                    throw new ValidationError("Stack name and service name must be strings");
                }

                const stack = await Stack.getStack(server, stackName);
                await stack.stopService(socket, serviceName);
                callbackResult({
                    ok: true,
                    msg: "Service " + serviceName + " stopped"
                }, callback);
                server.sendStackList();
            } catch (e) {
                callbackError(e, callback);
            }
        });

        agentSocket.on("restartService", async (stackName: unknown, serviceName: unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof stackName !== "string" || typeof serviceName !== "string") {
                    throw new Error("Invalid stackName or serviceName");
                }

                const stack = await Stack.getStack(server, stackName, true);
                await stack.restartService(socket, serviceName);
                callbackResult({
                    ok: true,
                    msg: "Service " + serviceName + " restarted"
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        agentSocket.on("scanVersionSync", async (stackName: unknown, callback) => {
            try {
                checkLogin(socket);

                let result;
                if (typeof stackName === "string" && stackName !== "") {
                    result = await scanStack(server.stacksDir, stackName);
                } else {
                    result = await scanAllStacks(server.stacksDir);
                }

                callbackResult({
                    ok: true,
                    data: result,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        agentSocket.on("syncVersion", async (stackName: unknown, serviceName: unknown, newImage: unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof stackName !== "string") {
                    throw new ValidationError("Stack name must be a string");
                }
                if (typeof serviceName !== "string") {
                    throw new ValidationError("Service name must be a string");
                }
                if (typeof newImage !== "string") {
                    throw new ValidationError("New image must be a string");
                }

                const scanResult = await scanStack(server.stacksDir, stackName);
                const mismatch = scanResult.mismatches.find(m => m.service === serviceName);

                if (!mismatch) {
                    throw new ValidationError("No mismatch found for this service");
                }

                const { oldImage } = syncComposeFile(mismatch.composePath, serviceName, newImage, server.stacksDir);

                await VersionSyncHistoryService.recordSync(
                    stackName, socket.endpoint, serviceName, oldImage, newImage, mismatch.composePath, false
                );

                callbackResult({
                    ok: true,
                    msg: "versionSynced",
                    msgi18n: true,
                    data: {
                        stackName,
                        service: serviceName,
                        oldImage,
                        newImage,
                    },
                }, callback);

                server.sendStackList();
            } catch (e) {
                callbackError(e, callback);
            }
        });

        agentSocket.on("syncAllVersions", async (stackName: unknown, callback) => {
            try {
                checkLogin(socket);

                let scanResult;
                if (typeof stackName === "string" && stackName !== "") {
                    scanResult = await scanStack(server.stacksDir, stackName);
                } else {
                    scanResult = await scanAllStacks(server.stacksDir);
                }

                const synced: { stackName: string; service: string; oldImage: string; newImage: string }[] = [];

                for (const mismatch of scanResult.mismatches) {
                    const { oldImage } = syncComposeFile(
                        mismatch.composePath, mismatch.service, mismatch.runningImage, server.stacksDir
                    );

                    await VersionSyncHistoryService.recordSync(
                        mismatch.stackName, socket.endpoint, mismatch.service,
                        oldImage, mismatch.runningImage, mismatch.composePath, false
                    );

                    synced.push({
                        stackName: mismatch.stackName,
                        service: mismatch.service,
                        oldImage,
                        newImage: mismatch.runningImage,
                    });
                }

                callbackResult({
                    ok: true,
                    msg: "allVersionsSynced",
                    msgi18n: true,
                    data: {
                        synced,
                        count: synced.length,
                    },
                }, callback);

                server.sendStackList();
            } catch (e) {
                callbackError(e, callback);
            }
        });

        agentSocket.on("revertVersionSync", async (stackName: unknown, serviceName: unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof stackName !== "string") {
                    throw new ValidationError("Stack name must be a string");
                }
                if (typeof serviceName !== "string") {
                    throw new ValidationError("Service name must be a string");
                }

                const revertable = await VersionSyncHistoryService.getRevertableEntries(stackName, serviceName);

                if (revertable.length === 0) {
                    throw new ValidationError("No revertable sync found for this service");
                }

                const entry = revertable[0];
                syncComposeFile(entry.composePath, entry.service, entry.oldImage, server.stacksDir);

                await VersionSyncHistoryService.recordSync(
                    entry.stackName, socket.endpoint, entry.service,
                    entry.newImage, entry.oldImage, entry.composePath, true
                );

                callbackResult({
                    ok: true,
                    msg: "versionReverted",
                    msgi18n: true,
                    data: {
                        stackName,
                        service: serviceName,
                        revertedTo: entry.oldImage,
                    },
                }, callback);

                server.sendStackList();
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // getExternalNetworkList
        agentSocket.on("getDockerNetworkList", async (callback) => {
            try {
                checkLogin(socket);
                const dockerNetworkList = await server.getDockerNetworkList();
                callbackResult({
                    ok: true,
                    dockerNetworkList,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });
    }

    async saveStack(server : DockgeServer, name : unknown, composeYAML : unknown, composeENV : unknown, composeOverrideYAML : unknown, isAdd : unknown) : Promise<Stack> {
        // Check types
        if (typeof(name) !== "string") {
            throw new ValidationError("Name must be a string");
        }
        if (typeof(composeYAML) !== "string") {
            throw new ValidationError("Compose YAML must be a string");
        }
        if (typeof(composeENV) !== "string") {
            throw new ValidationError("Compose ENV must be a string");
        }
        if (typeof(composeOverrideYAML) !== "string") {
            throw new ValidationError("Compose Override YAML must be a string");
        }
        if (typeof(isAdd) !== "boolean") {
            throw new ValidationError("isAdd must be a boolean");
        }

        const stack = new Stack(server, name, composeYAML, composeENV, composeOverrideYAML, false);
        await stack.save(isAdd);
        return stack;
    }

}

