import { AgentSocketHandler } from "../agent-socket-handler";
import { AgentSocket } from "../../common/agent-socket";
import { DockgeServer } from "../dockge-server";
import { callbackError, callbackResult, checkLogin, DockgeSocket, ValidationError } from "../util-server";
import { finalizeImport, importStack, ImportResult, listImportCandidates, listImports, rollbackImport } from "../stack-import";
import { generateCompose, importContainer, listContainerCandidates } from "../container-import";

const optionalDir = (dir : unknown) : string | undefined => {
    if (dir === undefined || dir === null || dir === "") {
        return undefined;
    }
    if (typeof(dir) !== "string") {
        throw new ValidationError("Folder must be a string");
    }
    return dir.trim();
};

export class ImportSocketHandler extends AgentSocketHandler {
    create(socket : DockgeSocket, server : DockgeServer, agentSocket : AgentSocket) {

        agentSocket.on("getImportCandidates", async (scanDir : unknown, callback) => {
            try {
                checkLogin(socket);
                callbackResult({
                    ok: true,
                    candidates: await listImportCandidates(server, optionalDir(scanDir)),
                    containers: await listContainerCandidates(server),
                    imports: await listImports(server),
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // Imports one stack at a time, so one failure doesn't stop (or undo) the others
        agentSocket.on("importStacks", async (names : unknown, scanDir : unknown, redeploy : unknown, callback) => {
            try {
                checkLogin(socket);
                if (!Array.isArray(names) || !names.every((n) => typeof n === "string")) {
                    throw new ValidationError("names must be a list of stack names");
                }
                const results : ImportResult[] = [];
                for (const name of names as string[]) {
                    try {
                        results.push(await importStack(server, socket, name, optionalDir(scanDir), Boolean(redeploy)));
                    } catch (e) {
                        results.push({
                            name,
                            ok: false,
                            msg: e instanceof Error ? e.message : String(e),
                            notes: [],
                        });
                    }
                }
                callbackResult({
                    ok: true,
                    results,
                    imports: await listImports(server),
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // Compose file that would recreate a "docker run" container, for the user to review
        agentSocket.on("generateContainerCompose", async (ref : unknown, callback) => {
            try {
                checkLogin(socket);
                if (typeof(ref) !== "string") {
                    throw new ValidationError("container must be a string");
                }
                callbackResult({
                    ok: true,
                    ...await generateCompose(server, ref),
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        agentSocket.on("importContainer", async (ref : unknown, stackName : unknown, composeYAML : unknown, callback) => {
            try {
                checkLogin(socket);
                if (typeof(ref) !== "string" || typeof(stackName) !== "string" || typeof(composeYAML) !== "string") {
                    throw new ValidationError("Invalid arguments");
                }
                let result : ImportResult;
                try {
                    result = await importContainer(server, socket, ref, stackName.trim(), composeYAML);
                } catch (e) {
                    result = {
                        name: stackName,
                        ok: false,
                        msg: e instanceof Error ? e.message : String(e),
                        notes: [],
                    };
                }
                callbackResult({
                    ok: true,
                    results: [ result ],
                    imports: await listImports(server),
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        agentSocket.on("rollbackImport", async (id : unknown, callback) => {
            try {
                checkLogin(socket);
                if (typeof(id) !== "string") {
                    throw new ValidationError("id must be a string");
                }
                callbackResult({
                    ok: true,
                    msg: await rollbackImport(server, socket, id),
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        agentSocket.on("finalizeImport", async (id : unknown, callback) => {
            try {
                checkLogin(socket);
                if (typeof(id) !== "string") {
                    throw new ValidationError("id must be a string");
                }
                await finalizeImport(server, id);
                callbackResult({
                    ok: true,
                    msg: "Import kept; its rollback record was removed.",
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });
    }
}
