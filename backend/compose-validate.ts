import childProcessAsync from "promisify-child-process";
import { promises as fsAsync } from "fs";
import os from "os";
import path from "path";
import { DockgeServer } from "./dockge-server";
import { fileExists } from "./util-server";
import { log } from "./log";

export interface ComposeValidation {
    valid : boolean;
    // What docker compose printed, with the temp folder's paths replaced by the stack's own file names
    message : string;
}

/**
 * Ask "docker compose config" whether the edited (unsaved) files are a valid compose project, the way
 * Deploy will read them: the stack's folder is the project directory, so relative paths (env_file,
 * bind mounts, build contexts) resolve as they will on deploy, and global.env / .env are applied in
 * the same order as Stack.getComposeOptions().
 * @param server Server
 * @param name Stack name; may be empty or not yet exist for a new stack
 * @param composeYAML Edited compose.yaml
 * @param composeENV Edited .env
 * @param composeOverrideYAML Edited compose.override.yaml, "" if none
 * @returns Whether it is valid, and compose's message if not
 */
export async function validateCompose(server : DockgeServer, name : string, composeYAML : string, composeENV : string, composeOverrideYAML : string) : Promise<ComposeValidation> {
    const tempDir = await fsAsync.mkdtemp(path.join(os.tmpdir(), "dockge-validate-"));
    try {
        const composeFile = path.join(tempDir, "compose.yaml");
        await fsAsync.writeFile(composeFile, composeYAML);

        const args = [ "compose" ];

        const globalEnv = path.join(server.stacksDir, "global.env");
        const hasGlobalEnv = await fileExists(globalEnv);
        if (hasGlobalEnv) {
            args.push("--env-file", globalEnv);
        }
        // Always the edited .env (even empty): after saving, that is exactly the stack's .env, and an
        // explicit --env-file stops compose from reading the old one from the project folder
        const envFile = path.join(tempDir, ".env");
        await fsAsync.writeFile(envFile, composeENV);
        args.push("--env-file", envFile);

        args.push("-f", composeFile);
        if (composeOverrideYAML.trim() !== "") {
            const overrideFile = path.join(tempDir, "compose.override.yaml");
            await fsAsync.writeFile(overrideFile, composeOverrideYAML);
            args.push("-f", overrideFile);
        }

        // Resolve relative paths against the real stack folder when there is one
        let projectDir = tempDir;
        if (/^[a-z0-9][a-z0-9_-]*$/.test(name) && await fileExists(path.join(server.stacksDir, name))) {
            projectDir = path.join(server.stacksDir, name);
        }
        args.push("--project-directory", projectDir, "config", "--quiet");

        try {
            await childProcessAsync.spawn("docker", args, {
                cwd: tempDir,
                encoding: "utf-8",
            });
            return {
                valid: true,
                message: "",
            };
        } catch (e) {
            const stderr = String((e as { stderr? : unknown }).stderr ?? (e as Error).message ?? e);
            return {
                valid: false,
                message: stderr.split(tempDir + path.sep).join("").trim(),
            };
        }
    } catch (e) {
        // Never block a save because the check itself could not run
        log.warn("compose-validate", `Validation could not run: ${e}`);
        return {
            valid: true,
            message: "",
        };
    } finally {
        await fsAsync.rm(tempDir, {
            recursive: true,
            force: true,
        });
    }
}
