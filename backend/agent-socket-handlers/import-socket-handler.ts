import { AgentSocketHandler } from "../agent-socket-handler";
import { AgentSocket } from "../../common/agent-socket";
import { DockgeServer } from "../dockge-server";
import { callbackError, callbackResult, checkLogin, DockgeSocket, ValidationError } from "../util-server";
import { finalizeImport, importStack, ImportResult, listImportCandidates, listImports, rollbackImport } from "../stack-import";

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

        agentSocket.on("rollbackImport", async (id : unknown, callback) => {
            try {
                checkLogin(socket);
                if (typeof(id) !== "string") {
                    throw new ValidationError("id must be a string");
                }
                callbackResult({
                    ok: true,
                    msg: await rollbackImport(server, id),
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
