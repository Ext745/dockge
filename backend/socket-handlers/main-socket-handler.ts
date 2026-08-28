// @ts-ignore
import composerize from "composerize";
import { SocketHandler } from "../socket-handler.js";
import { DockgeServer } from "../dockge-server";
import { log } from "../log";
import { R } from "redbean-node";
import { loginRateLimiter, twoFaRateLimiter } from "../rate-limiter";
import { generatePasswordHash, needRehashPassword, shake256, SHAKE256_LENGTH, verifyPassword } from "../password-hash";
import { User } from "../models/user";
import {
    callbackError,
    checkLogin,
    DockgeSocket,
    doubleCheckPassword,
    JWTDecoded,
    ValidationError
} from "../util-server";
import { passwordStrength } from "check-password-strength";
import jwt from "jsonwebtoken";
import { Settings } from "../settings";
import fs, { promises as fsAsync } from "fs";
import path from "path";
import { generateTwoFASecret, verifyTwoFAToken, twoFAVerifyOptions } from "../two-fa";

async function verifyTurnstileToken(token: string, clientIP: string, secretKey: string): Promise<boolean> {
    if (!token) {
        log.warn("auth", "Turnstile token is not provided.");
        return false;
    }

    const url = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
    const result = await fetch(url, {
        body: JSON.stringify({
            secret: secretKey,
            response: token,
            remoteip: clientIP
        }),
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        }
    });
    const outcome = await result.json();
    if (outcome && outcome.success) {
        log.info("auth", "Turnstile token verified successfully.");
        return true;
    }
    log.warn("auth", "Turnstile token verification failed: " + JSON.stringify(outcome["error-codes"]));
    return false;
}

export class MainSocketHandler extends SocketHandler {
    create(socket : DockgeSocket, server : DockgeServer) {

        // ***************************
        // Public Socket API
        // ***************************

        // Setup
        socket.on("setup", async (username, password, callback) => {
            try {
                if (passwordStrength(password).value === "Too weak") {
                    throw new Error("Password is too weak. It should contain alphabetic and numeric characters. It must be at least 6 characters in length.");
                }

                if ((await R.knex("user").count("id as count").first()).count !== 0) {
                    throw new Error("Dockge has been initialized. If you want to run setup again, please delete the database.");
                }

                const user = R.dispense("user");
                user.username = username;
                user.password = generatePasswordHash(password);
                await R.store(user);

                server.needSetup = false;

                callback({
                    ok: true,
                    msg: "successAdded",
                    msgi18n: true,
                });

            } catch (e) {
                if (e instanceof Error) {
                    callback({
                        ok: false,
                        msg: e.message,
                    });
                }
            }
        });

        // New event to fetch the Turnstile site key
        socket.on("getTurnstileSiteKey", async (callback) => {
            try {
                const siteKey = process.env.TURNSTILE_SITE_KEY || "";
                // Checking
                if (typeof callback !== "function") {
                    return;
                }
                if (!siteKey) {
                    log.warn("auth", "Turnstile site key is not configured in the environment.");
                    callback({
                        ok: false,
                        msg: "Turnstile site key is not configured.",
                    });
                    return;
                }

                callback({
                    ok: true,
                    siteKey: siteKey,
                });
            } catch (error) {
                log.error("Error fetching Turnstile site key:", error);
                callback({
                    ok: false,
                    msg: "Failed to fetch Turnstile site key.",
                });
            }
        });

        // Login by token
        socket.on("loginByToken", async (token, callback) => {
            const clientIP = await server.getClientIP(socket);

            log.info("auth", `Login by token. IP=${clientIP}`);

            try {
                const decoded = jwt.verify(token, server.jwtSecret) as JWTDecoded;

                log.info("auth", "Username from JWT: " + decoded.username);

                const user = await R.findOne("user", " username = ? AND active = 1 ", [
                    decoded.username,
                ]) as User;

                if (user) {
                    // Check if the password changed
                    if (decoded.h !== shake256(user.password, SHAKE256_LENGTH)) {
                        throw new Error("The token is invalid due to password change or old token");
                    }

                    log.debug("auth", "afterLogin");
                    await server.afterLogin(socket, user);
                    log.debug("auth", "afterLogin ok");

                    log.info("auth", `Successfully logged in user ${decoded.username}. IP=${clientIP}`);

                    callback({
                        ok: true,
                    });
                } else {

                    log.info("auth", `Inactive or deleted user ${decoded.username}. IP=${clientIP}`);

                    callback({
                        ok: false,
                        msg: "authUserInactiveOrDeleted",
                        msgi18n: true,
                    });
                }
            } catch (error) {
                if (!(error instanceof Error)) {
                    console.error("Unknown error:", error);
                    return;
                }
                log.error("auth", `Invalid token. IP=${clientIP}`);
                if (error.message) {
                    log.error("auth", error.message + ` IP=${clientIP}`);
                }
                callback({
                    ok: false,
                    msg: "authInvalidToken",
                    msgi18n: true,
                });
            }

        });

        // Login
        socket.on("login", async (data, callback) => {
            const clientIP = await server.getClientIP(socket);

            log.info("auth", `Login by username + password. IP=${clientIP}`);

            // Checking
            if (typeof callback !== "function") {
                return;
            }

            if (!data) {
                return;
            }

            const siteKey = process.env.TURNSTILE_SITE_KEY || "";
            const secretKey = process.env.TURNSTILE_SECRET_KEY || "";
            if (siteKey && secretKey) {
                const isCaptchaValid = await verifyTurnstileToken(data.captchaToken, clientIP, secretKey);
                if (!isCaptchaValid) {
                    return callback({
                        ok: false,
                        msg: "Invalid CAPTCHA"
                    });
                }
            }

            // Login Rate Limit
            if (!await loginRateLimiter.pass(callback)) {
                log.info("auth", `Too many failed requests for user ${data.username}. IP=${clientIP}`);
                return;
            }

            const user = await this.login(data.username, data.password);

            if (user) {
                if (user.twofa_status === 0) {
                    server.afterLogin(socket, user);

                    log.info("auth", `Successfully logged in user ${data.username}. IP=${clientIP}`);

                    callback({
                        ok: true,
                        token: User.createJWT(user, server.jwtSecret),
                    });
                }

                if (user.twofa_status === 1 && !data.token) {

                    log.info("auth", `2FA token required for user ${data.username}. IP=${clientIP}`);

                    callback({
                        tokenRequired: true,
                    });
                }

                if (data.token) {
                    const verify = verifyTwoFAToken(data.token, user.twofa_secret);

                    if (user.twofa_last_token !== data.token && verify) {
                        server.afterLogin(socket, user);

                        await R.exec("UPDATE `user` SET twofa_last_token = ? WHERE id = ? ", [
                            data.token,
                            socket.userID,
                        ]);

                        log.info("auth", `Successfully logged in user ${data.username}. IP=${clientIP}`);

                        callback({
                            ok: true,
                            token: User.createJWT(user, server.jwtSecret),
                        });
                    } else {

                        log.warn("auth", `Invalid token provided for user ${data.username}. IP=${clientIP}`);

                        callback({
                            ok: false,
                            msg: "authInvalidToken",
                            msgi18n: true,
                        });
                    }
                }
            } else {

                log.warn("auth", `Incorrect username or password for user ${data.username}. IP=${clientIP}`);

                callback({
                    ok: false,
                    msg: "authIncorrectCreds",
                    msgi18n: true,
                });
            }

        });

        // Change Password
        socket.on("changePassword", async (password, callback) => {
            try {
                checkLogin(socket);

                if (! password.newPassword) {
                    throw new Error("Invalid new password");
                }

                if (passwordStrength(password.newPassword).value === "Too weak") {
                    throw new Error("Password is too weak. It should contain alphabetic and numeric characters. It must be at least 6 characters in length.");
                }

                let user = await doubleCheckPassword(socket, password.currentPassword);
                await user.resetPassword(password.newPassword);

                server.disconnectAllSocketClients(user.id, socket.id);

                callback({
                    ok: true,
                    msg: "Password has been updated successfully.",
                });

            } catch (e) {
                if (e instanceof Error) {
                    callback({
                        ok: false,
                        msg: e.message,
                    });
                }
            }
        });

        socket.on("getSettings", async (callback) => {
            try {
                checkLogin(socket);
                const data = await Settings.getSettings("general");

                if (fs.existsSync(path.join(server.stacksDir, "global.env"))) {
                    data.globalENV = fs.readFileSync(path.join(server.stacksDir, "global.env"), "utf-8");
                } else {
                    data.globalENV = "# VARIABLE=value #comment";
                }

                callback({
                    ok: true,
                    data: data,
                });

            } catch (e) {
                if (e instanceof Error) {
                    callback({
                        ok: false,
                        msg: e.message,
                    });
                }
            }
        });

        socket.on("setSettings", async (data, currentPassword, callback) => {
            try {
                checkLogin(socket);

                // If currently is disabled auth, don't need to check
                // Disabled Auth + Want to Disable Auth => No Check
                // Disabled Auth + Want to Enable Auth => No Check
                // Enabled Auth + Want to Disable Auth => Check!!
                // Enabled Auth + Want to Enable Auth => No Check
                const currentDisabledAuth = await Settings.get("disableAuth");
                if (!currentDisabledAuth && data.disableAuth) {
                    await doubleCheckPassword(socket, currentPassword);
                }
                // Handle global.env
                if (data.globalENV && data.globalENV != "# VARIABLE=value #comment") {
                    await fsAsync.writeFile(path.join(server.stacksDir, "global.env"), data.globalENV);
                } else {
                    await fsAsync.rm(path.join(server.stacksDir, "global.env"), {
                        recursive: true,
                        force: true
                    });
                }
                delete data.globalENV;

                await Settings.setSettings("general", data);

                callback({
                    ok: true,
                    msg: "Saved"
                });

                server.sendInfo(socket);

            } catch (e) {
                if (e instanceof Error) {
                    callback({
                        ok: false,
                        msg: e.message,
                    });
                }
            }
        });

        // Disconnect all other socket clients of the user
        socket.on("disconnectOtherSocketClients", async () => {
            try {
                checkLogin(socket);
                server.disconnectAllSocketClients(socket.userID, socket.id);
            } catch (e) {
                if (e instanceof Error) {
                    log.warn("disconnectOtherSocketClients", e.message);
                }
            }
        });

        // 2FA status
        socket.on("twoFAStatus", async (callback) => {
            try {
                checkLogin(socket);

                const user = await R.findOne("user", " id = ? ", [socket.userID]) as User;

                callback({
                    ok: true,
                    status: user.twofa_status === 1,
                });
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // Prepare 2FA — generate secret and return URI for QR code
        socket.on("prepare2FA", async (currentPassword : unknown, callback) => {
            try {
                checkLogin(socket);
                await doubleCheckPassword(socket, currentPassword as string);

                const user = await R.findOne("user", " id = ? ", [socket.userID]) as User;
                const { secret, uri } = generateTwoFASecret(user.username);

                await R.exec("UPDATE `user` SET twofa_secret = ? WHERE id = ? ", [
                    secret,
                    socket.userID,
                ]);

                callback({
                    ok: true,
                    uri,
                });
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // Save (enable) 2FA
        socket.on("save2FA", async (currentPassword : unknown, callback) => {
            try {
                checkLogin(socket);
                await doubleCheckPassword(socket, currentPassword as string);

                await R.exec("UPDATE `user` SET twofa_status = 1 WHERE id = ? ", [
                    socket.userID,
                ]);

                callback({
                    ok: true,
                    msg: "2FA Enabled",
                    msgi18n: true,
                });
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // Disable 2FA
        socket.on("disable2FA", async (currentPassword : unknown, callback) => {
            try {
                checkLogin(socket);
                await doubleCheckPassword(socket, currentPassword as string);

                await R.exec("UPDATE `user` SET twofa_status = 0, twofa_secret = '', twofa_last_token = '' WHERE id = ? ", [
                    socket.userID,
                ]);

                callback({
                    ok: true,
                    msg: "2FA Disabled",
                    msgi18n: true,
                });
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // Verify a TOTP token (used during 2FA setup to confirm the user's app works)
        socket.on("verifyToken", async (token : unknown, currentPassword : unknown, callback) => {
            try {
                checkLogin(socket);
                await doubleCheckPassword(socket, currentPassword as string);

                if (typeof token !== "string") {
                    throw new ValidationError("Token must be a string");
                }

                if (!await twoFaRateLimiter.pass(callback)) {
                    return;
                }

                const user = await R.findOne("user", " id = ? ", [socket.userID]) as User;
                const valid = verifyTwoFAToken(token, user.twofa_secret);

                callback({
                    ok: true,
                    valid,
                });
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // composerize
        socket.on("composerize", async (dockerRunCommand : unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof(dockerRunCommand) !== "string") {
                    throw new ValidationError("dockerRunCommand must be a string");
                }

                // Option: 'latest' | 'v2x' | 'v3x'
                let composeTemplate = composerize(dockerRunCommand, "", "latest");

                // Remove the first line "name: <your project name>"
                composeTemplate = composeTemplate.split("\n").slice(1).join("\n");

                callback({
                    ok: true,
                    composeTemplate,
                });
            } catch (e) {
                callbackError(e, callback);
            }
        });
    }

    async login(username : string, password : string) : Promise<User | null> {
        if (typeof username !== "string" || typeof password !== "string") {
            return null;
        }

        const user = await R.findOne("user", " username = ? AND active = 1 ", [
            username,
        ]) as User;

        if (user && verifyPassword(password, user.password)) {
            // Upgrade the hash to bcrypt
            if (needRehashPassword(user.password)) {
                await R.exec("UPDATE `user` SET password = ? WHERE id = ? ", [
                    generatePasswordHash(password),
                    user.id,
                ]);
            }
            return user;
        }

        return null;
    }
}
