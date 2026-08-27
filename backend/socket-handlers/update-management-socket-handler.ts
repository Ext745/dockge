import { SocketHandler } from "../socket-handler";
import { DockgeServer } from "../dockge-server";
import { callbackError, checkLogin, DockgeSocket, ValidationError } from "../util-server";
import { VersionSyncHistoryService } from "../version-sync-history-service";
import crypto from "crypto";
import { Settings } from "../settings";

export class UpdateManagementSocketHandler extends SocketHandler {
    create(socket: DockgeSocket, server: DockgeServer) {

        socket.on("getVersionSyncHistory", async (options: unknown, callback) => {
            try {
                checkLogin(socket);

                const opts = (typeof options === "object" && options !== null) ? options as Record<string, unknown> : {};
                const result = await VersionSyncHistoryService.getHistory({
                    limit: typeof opts.limit === "number" ? opts.limit : undefined,
                    offset: typeof opts.offset === "number" ? opts.offset : undefined,
                    stackName: typeof opts.stackName === "string" ? opts.stackName : undefined,
                    service: typeof opts.service === "string" ? opts.service : undefined,
                    endpoint: typeof opts.endpoint === "string" ? opts.endpoint : undefined,
                });

                callback({
                    ok: true,
                    data: result,
                });
            } catch (e) {
                callbackError(e, callback);
            }
        });

        socket.on("generateApiKey", async (callback) => {
            try {
                checkLogin(socket);

                const apiKey = crypto.randomBytes(32).toString("hex");
                await Settings.set("apiKey", apiKey, "string");

                callback({
                    ok: true,
                    apiKey,
                });
            } catch (e) {
                callbackError(e, callback);
            }
        });

        socket.on("getApiKey", async (callback) => {
            try {
                checkLogin(socket);

                const apiKey = await Settings.get("apiKey");

                callback({
                    ok: true,
                    apiKey: apiKey || null,
                });
            } catch (e) {
                callbackError(e, callback);
            }
        });

        socket.on("setApiKey", async (apiKey: unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof apiKey !== "string" || apiKey.length < 16) {
                    throw new ValidationError("API key must be a string of at least 16 characters");
                }

                await Settings.set("apiKey", apiKey, "string");

                callback({
                    ok: true,
                    msg: "Saved",
                    msgi18n: true,
                });
            } catch (e) {
                callbackError(e, callback);
            }
        });
    }
}
