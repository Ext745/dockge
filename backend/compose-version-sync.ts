import { log } from "./log";
import childProcessAsync from "promisify-child-process";
import yaml from "yaml";
import fs from "fs";
import path from "path";
import { acceptedComposeFileNames } from "../common/util-common";

export interface ImageRef {
    repository: string;
    tag: string;
}

export interface VersionMismatch {
    stackName: string;
    service: string;
    composeImage: string;
    runningImage: string;
    composePath: string;
}

export interface VersionScanResult {
    mismatches: VersionMismatch[];
    matched: { stackName: string; service: string; image: string }[];
    unmatchedServices: { stackName: string; service: string; composeImage: string }[];
}

interface RunningContainerInfo {
    project: string;
    service: string;
    imageTags: string[];
    configImage: string;
}

export function parseImageRef(image: string): ImageRef {
    if (!image) {
        return {
            repository: "",
            tag: "",
        };
    }

    const atIndex = image.indexOf("@");
    if (atIndex > 0) {
        return {
            repository: image.substring(0, atIndex),
            tag: image.substring(atIndex),
        };
    }

    const lastColon = image.lastIndexOf(":");
    if (lastColon > 0 && !image.substring(lastColon).includes("/")) {
        return {
            repository: image.substring(0, lastColon),
            tag: image.substring(lastColon + 1),
        };
    }

    return {
        repository: image,
        tag: "latest",
    };
}

export function normalizeImageName(name: string): string {
    let normalized = name;
    if (normalized.startsWith("docker.io/")) {
        normalized = normalized.substring("docker.io/".length);
    }
    if (normalized.startsWith("library/")) {
        normalized = normalized.substring("library/".length);
    }
    return normalized;
}

function imageRefsMatch(composeImage: string, runningImage: string): boolean {
    const composeRef = parseImageRef(composeImage);
    const runningRef = parseImageRef(runningImage);

    const composeRepo = normalizeImageName(composeRef.repository);
    const runningRepo = normalizeImageName(runningRef.repository);

    return composeRepo === runningRepo && composeRef.tag === runningRef.tag;
}

/**
 * Run `docker <args>` and parse its JSON array output; [] on failure or no output.
 * @param args Docker CLI arguments ending in the object IDs
 * @returns Parsed array
 */
async function dockerInspectJSON(args: string[]): Promise<Record<string, unknown>[]> {
    try {
        const res = await childProcessAsync.spawn("docker", args, { encoding: "utf-8" });
        if (!res.stdout) {
            return [];
        }
        const data = JSON.parse(res.stdout.toString());
        return Array.isArray(data) ? data : [];
    } catch (e) {
        log.debug("compose-version-sync", `docker ${args[0]} failed: ${e}`);
        return [];
    }
}

/**
 * Every running compose container, keyed by "project::service", with its configured image and the
 * tags of the image it runs. Three docker calls in total (ps, one batched container inspect, one
 * batched image inspect), however many containers there are.
 * @returns Running containers
 */
async function getRunningContainers(): Promise<Map<string, RunningContainerInfo>> {
    const containers = new Map<string, RunningContainerInfo>();

    const res = await childProcessAsync.spawn("docker", [
        "ps", "--format", "{{json .}}", "--no-trunc"
    ], { encoding: "utf-8" });

    if (!res.stdout) {
        return containers;
    }

    const lines = res.stdout.toString().trim().split("\n").filter(Boolean);
    const composeContainers: { id: string, project: string, service: string, image: string }[] = [];

    for (const line of lines) {
        const info = JSON.parse(line);
        const labels = info.Labels || "";

        const labelMap = new Map<string, string>();
        for (const part of labels.split(",")) {
            const eqIdx = part.indexOf("=");
            if (eqIdx > 0) {
                labelMap.set(part.substring(0, eqIdx), part.substring(eqIdx + 1));
            }
        }

        const project = labelMap.get("com.docker.compose.project");
        const service = labelMap.get("com.docker.compose.service");

        if (!project || !service) {
            continue;
        }
        composeContainers.push({ id: info.ID, project, service, image: info.Image || "" });
    }

    if (composeContainers.length === 0) {
        return containers;
    }

    // Container ID -> { configured image, image ID }
    const inspected = new Map<string, { configImage: string, imageId: string }>();
    for (const c of await dockerInspectJSON([ "inspect", "--format", "json", ...composeContainers.map(c => c.id) ])) {
        const config = c.Config as { Image?: string } | undefined;
        inspected.set(String(c.Id), { configImage: config?.Image || "", imageId: String(c.Image || "") });
    }

    // Image ID -> repo tags
    const imageIds = [ ...new Set([ ...inspected.values() ].map(i => i.imageId).filter(Boolean)) ];
    const imageTagsById = new Map<string, string[]>();
    if (imageIds.length > 0) {
        for (const img of await dockerInspectJSON([ "image", "inspect", "--format", "json", ...imageIds ])) {
            imageTagsById.set(String(img.Id), (img.RepoTags as string[]) || []);
        }
    }

    for (const c of composeContainers) {
        const details = inspected.get(c.id);
        containers.set(`${c.project}::${c.service}`, {
            project: c.project,
            service: c.service,
            imageTags: details ? imageTagsById.get(details.imageId) ?? [] : [],
            configImage: details?.configImage || c.image,
        });
    }

    return containers;
}

function getComposeServices(composePath: string): Map<string, string> {
    const services = new Map<string, string>();
    try {
        const content = fs.readFileSync(composePath, "utf-8");
        const doc = yaml.parse(content);
        if (doc?.services) {
            for (const [ name, svc ] of Object.entries(doc.services)) {
                const service = svc as Record<string, unknown>;
                if (service.image && typeof service.image === "string") {
                    services.set(name, service.image);
                }
            }
        }
    } catch (e) {
        log.warn("compose-version-sync", `Failed to parse compose file ${composePath}: ${e}`);
    }
    return services;
}

function findComposeFile(stackDir: string): string | null {
    for (const filename of acceptedComposeFileNames) {
        const filePath = path.join(stackDir, filename);
        if (fs.existsSync(filePath)) {
            return filePath;
        }
    }
    return null;
}

function findBestRunningTag(imageTags: string[], composeImage: string): string {
    if (imageTags.length === 0) {
        return "";
    }

    const composeRef = parseImageRef(composeImage);
    const composeRepo = normalizeImageName(composeRef.repository);

    for (const tag of imageTags) {
        const tagRef = parseImageRef(tag);
        if (normalizeImageName(tagRef.repository) === composeRepo) {
            return tag;
        }
    }

    return imageTags[0];
}

/**
 * @param stacksDir Stacks directory
 * @param stackName Stack to scan
 * @param runningContainers Pass when scanning many stacks, so docker is queried once rather than per stack
 * @returns Mismatches, matches and services with no running container
 */
export async function scanStack(stacksDir: string, stackName: string, runningContainers?: Map<string, RunningContainerInfo>): Promise<VersionScanResult> {
    const result: VersionScanResult = {
        mismatches: [],
        matched: [],
        unmatchedServices: [],
    };

    const stackDir = path.join(stacksDir, stackName);
    const resolvedStackDir = path.resolve(stackDir);
    const resolvedStacksDir = path.resolve(stacksDir);
    if (!resolvedStackDir.startsWith(resolvedStacksDir + path.sep) && resolvedStackDir !== resolvedStacksDir) {
        log.warn("compose-version-sync", `Stack directory ${stackDir} is outside stacks directory`);
        return result;
    }

    const composePath = findComposeFile(stackDir);
    if (!composePath) {
        return result;
    }

    const composeServices = getComposeServices(composePath);
    runningContainers ??= await getRunningContainers();

    for (const [ serviceName, composeImage ] of composeServices) {
        const key = `${stackName}::${serviceName}`;
        const container = runningContainers.get(key);

        if (!container) {
            result.unmatchedServices.push({
                stackName,
                service: serviceName,
                composeImage,
            });
            continue;
        }

        const bestTag = findBestRunningTag(container.imageTags, composeImage);
        const runningImage = bestTag || container.configImage;

        if (imageRefsMatch(composeImage, runningImage)) {
            result.matched.push({
                stackName,
                service: serviceName,
                image: composeImage,
            });
        } else {
            result.mismatches.push({
                stackName,
                service: serviceName,
                composeImage,
                runningImage,
                composePath,
            });
        }
    }

    return result;
}

export async function scanAllStacks(stacksDir: string): Promise<VersionScanResult> {
    const combined: VersionScanResult = {
        mismatches: [],
        matched: [],
        unmatchedServices: [],
    };

    if (!fs.existsSync(stacksDir)) {
        return combined;
    }

    const entries = fs.readdirSync(stacksDir);
    const runningContainers = await getRunningContainers();
    for (const entry of entries) {
        const entryPath = path.join(stacksDir, entry);
        try {
            const stat = fs.statSync(entryPath);
            if (!stat.isDirectory()) {
                continue;
            }
        } catch {
            continue;
        }

        const result = await scanStack(stacksDir, entry, runningContainers);
        combined.mismatches.push(...result.mismatches);
        combined.matched.push(...result.matched);
        combined.unmatchedServices.push(...result.unmatchedServices);
    }

    return combined;
}

export function syncComposeFile(composePath: string, serviceName: string, newImage: string, stacksDir: string): { oldImage: string; success: boolean } {
    const resolvedPath = path.resolve(composePath);
    const resolvedStacksDir = path.resolve(stacksDir);
    if (!resolvedPath.startsWith(resolvedStacksDir + path.sep)) {
        throw new Error("Compose file path is outside stacks directory");
    }

    const content = fs.readFileSync(composePath, "utf-8");
    const doc = yaml.parseDocument(content);

    const servicesNode = doc.get("services");
    if (!servicesNode || typeof servicesNode !== "object") {
        throw new Error("No services found in compose file");
    }

    const serviceNode = (servicesNode as yaml.YAMLMap).get(serviceName);
    if (!serviceNode || typeof serviceNode !== "object") {
        throw new Error(`Service '${serviceName}' not found in compose file`);
    }

    const oldImage = (serviceNode as yaml.YAMLMap).get("image") as string;
    if (!oldImage) {
        throw new Error(`Service '${serviceName}' has no image field`);
    }

    (serviceNode as yaml.YAMLMap).set("image", newImage);

    fs.writeFileSync(composePath, doc.toString(), "utf-8");

    return {
        oldImage,
        success: true,
    };
}
