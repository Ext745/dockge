import { DockgeServer } from "./dockge-server";
import { DockerArtefactAction, DockerArtefactData, DockerArtefactInfos } from "../common/types";
import { getAgentMaintenanceTerminalName } from "../common/util-common";
import { DockgeSocket } from "./util-server";
import { Terminal } from "./terminal";
import { log } from "./log";
import childProcessAsync from "promisify-child-process";
import { describeCleanup, pruneAllBuildCache, removeUnusedImages } from "./image-protection";

export class AgentMaintenance {

    constructor(protected server: DockgeServer) {
    }

    async getContainerData(): Promise<DockerArtefactData> {
        const containerData: DockerArtefactData = {
            info: DockerArtefactInfos.Container,
            data: []
        };

        try {
            const res = await childProcessAsync.spawn("docker", [ "ps", "--all", "--format", "json" ], {
                encoding: "utf-8",
            });

            if (!res.stdout) {
                return containerData;
            }

            const lines = res.stdout?.toString().split("\n");

            for (let line of lines) {
                if (line != "") {
                    const containerInfo = JSON.parse(line);

                    containerData.data.push({
                        id: containerInfo.ID,
                        actionIds: {},
                        values: {
                            Names: containerInfo.Names,
                            Image: containerInfo.Image,
                            Created: containerInfo.CreatedAt,
                            Status: containerInfo.Status
                        },
                        dangling: containerInfo.Status.startsWith("Exited"),
                        danglingLabel: "stopped",
                        excludedActions: []
                    });
                }
            }
        } catch (e) {
            log.error("getContainerData", e);
        }

        return containerData;
    }

    async getImageData(): Promise<DockerArtefactData> {
        const imageData: DockerArtefactData = {
            info: DockerArtefactInfos.Image,
            data: []
        };

        try {
            // "docker image ls" hides dangling images by default (Docker CLI: "-a, --all
            // Show all images (default hides intermediate and dangling images)"). Query them
            // separately and merge, otherwise dangling images never show up here even though
            // "Prune Images" happily removes them.
            const res = await childProcessAsync.spawn("docker", [ "image", "ls", "--format", "json" ], {
                encoding: "utf-8",
            });

            const danglingRes = await childProcessAsync.spawn("docker", [ "image", "ls", "--format", "json", "-f", "dangling=true" ], {
                encoding: "utf-8",
            });

            if (!res.stdout) {
                return imageData;
            }

            const lines = res.stdout?.toString().split("\n");
            if (danglingRes.stdout) {
                lines.push(...danglingRes.stdout.toString().split("\n"));
            }

            for (let line of lines) {
                if (line != "") {
                    const imageInfo = JSON.parse(line);

                    const noneTag = imageInfo.Tag === "<none>";
                    const nameWithTag = imageInfo.Repository + (noneTag ? "" : `:${imageInfo.Tag}`);

                    imageData.data.push({
                        // One row per tag, and several tags can share an image ID (always true on the
                        // containerd image store): identify a tagged row by its name, so selecting it
                        // selects only that row and Delete removes only that tag - deleting by ID hit
                        // every tag of the image, and failed if a running container used another one
                        id: noneTag ? imageInfo.ID : nameWithTag,
                        actionIds: { pull: nameWithTag },
                        values: {
                            Name: nameWithTag,
                            Created: [ imageInfo.CreatedSince, imageInfo.CreatedAt ],
                            Size: [ imageInfo.Size, this.getByteSize(imageInfo.Size) ]
                        },
                        // "Containers" is unreliable for this purpose (it reports "N/A" rather than "0" for
                        // unused images on current Docker CLI versions), so treat untagged images as
                        // dangling unconditionally - that's unambiguous regardless of what Containers says.
                        dangling: noneTag || imageInfo.Containers === "0",
                        danglingLabel: noneTag ? "dangling" : "unused",
                        excludedActions: noneTag ? [ DockerArtefactAction.Pull ] : []
                    });
                }
            }
        } catch (e) {
            log.error("getImageData", e);
        }

        return imageData;
    }

    async getNetworkData(): Promise<DockerArtefactData> {
        const networkData: DockerArtefactData = {
            info: DockerArtefactInfos.Network,
            data: []
        };

        const defaultNetworks = new Set([ "bridge", "host", "none" ]);

        try {
            const res = await childProcessAsync.spawn("docker", [ "network", "ls", "--format", "json" ], {
                encoding: "utf-8",
            });

            if (!res.stdout) {
                return networkData;
            }

            const lines = res.stdout?.toString().split("\n");

            for (let line of lines) {
                if (line != "") {
                    const networkInfo = JSON.parse(line);

                    let inspectData = {
                        Containers: {
                            nodata: true
                        }
                    };

                    if (!defaultNetworks.has(networkInfo.Name)) {
                        const inspectRes = await childProcessAsync.spawn("docker", [ "network", "inspect", "--format", "json", networkInfo.ID ], {
                            encoding: "utf-8",
                        });

                        if (inspectRes.stdout) {
                            inspectData = JSON.parse(inspectRes.stdout.toString())[0];
                        }
                    }

                    networkData.data.push({
                        id: networkInfo.ID,
                        actionIds: {},
                        values: {
                            Name: networkInfo.Name,
                            Created: networkInfo.CreatedAt,
                            Driver: networkInfo.Driver,
                            Scope: networkInfo.Scope
                        },
                        dangling: Object.keys(inspectData.Containers).length === 0,
                        danglingLabel: "dangling",
                        excludedActions: []
                    });
                }
            }
        } catch (e) {
            log.error("getNetworkData", e);
        }

        return networkData;
    }

    async getVolumeData(): Promise<DockerArtefactData> {
        const volumeData: DockerArtefactData = {
            info: DockerArtefactInfos.Volume,
            data: []
        };

        try {
            const danglingRes = await childProcessAsync.spawn("docker", [ "volume", "ls", "--format", "json", "-f", "dangling=true" ], {
                encoding: "utf-8",
            });

            const danglingVolumes = new Set();
            if (danglingRes.stdout) {
                const lines = danglingRes.stdout?.toString().split("\n");
                for (let line of lines) {
                    if (line != "") {
                        const danglingVolume = JSON.parse(line);
                        danglingVolumes.add(danglingVolume.Name);
                    }
                }
            }

            const res = await childProcessAsync.spawn("docker", [ "volume", "ls", "--format", "json" ], {
                encoding: "utf-8",
            });

            if (!res.stdout) {
                return volumeData;
            }

            const lines = res.stdout?.toString().split("\n");

            for (let line of lines) {
                if (line != "") {
                    const volumeInfo = JSON.parse(line);

                    const inspectRes = await childProcessAsync.spawn("docker", [ "volume", "inspect", "--format", "json", volumeInfo.Name ], {
                        encoding: "utf-8",
                    });

                    let inspectData = {
                        CreatedAt: ""
                    };
                    if (inspectRes.stdout) {
                        inspectData = JSON.parse(inspectRes.stdout.toString())[0];
                    }

                    volumeData.data.push({
                        id: volumeInfo.Name,
                        actionIds: {},
                        values: {
                            Name: volumeInfo.Name,
                            Created: inspectData.CreatedAt,
                            Driver: volumeInfo.Driver,
                            Scope: volumeInfo.Scope,
                            Size: [ volumeInfo.Size, this.getByteSize(volumeInfo.Size) ]
                        },
                        dangling: danglingVolumes.has(volumeInfo.Name),
                        danglingLabel: "dangling",
                        excludedActions: []
                    });
                }
            }
        } catch (e) {
            log.error("getVolumeData", e);
        }

        return volumeData;
    }

    async prune(socket: DockgeSocket, artefact: string, all: boolean) {
        const terminalName = getAgentMaintenanceTerminalName(socket.endpoint);

        // "All images" is done by Dockge (see removeUnusedImages) so images a stack uses are kept
        const dockerParams = [ artefact, "prune", "-f" ];
        if (all && artefact !== "image") {
            dockerParams.push("-a");
        }

        let exitCode = await Terminal.exec(this.server, socket, terminalName, "docker", dockerParams, "");

        if (exitCode !== 0) {
            throw new Error("Failed to prune, please check the terminal output for more information.");
        }

        if (all && artefact === "image") {
            await this.removeUnusedImagesWithOutput(socket, terminalName);
        }

        return exitCode;
    }

    /**
     * Remove every image no container uses, except those a Dockge stack's compose file names, and
     * print what happened to the maintenance terminal.
     * @param socket Socket
     * @param terminalName Terminal
     * @returns void
     */
    private async removeUnusedImagesWithOutput(socket: DockgeSocket, terminalName: string, alsoBuildCache = false) {
        const lines = [];
        if (alsoBuildCache) {
            lines.push(await pruneAllBuildCache());
        }
        lines.push(describeCleanup(await removeUnusedImages(this.server)));
        await Terminal.exec(this.server, socket, terminalName, "echo", [ lines.join("\n") ], "");
    }

    async remove(socket: DockgeSocket, artefact: string, ids: string[]) {
        const terminalName = getAgentMaintenanceTerminalName(socket.endpoint);

        const dockerParams = [ artefact, "rm" ];
        for (const id of ids) {
            dockerParams.push(id);
        }

        let exitCode = await Terminal.exec(this.server, socket, terminalName, "docker", dockerParams, "");

        if (exitCode !== 0) {
            throw new Error("Failed to delete, please check the terminal output for more information.");
        }

        return exitCode;
    }

    async pullImages(socket: DockgeSocket, ids: string[]) {
        const terminalName = getAgentMaintenanceTerminalName(socket.endpoint);

        let overallExitCode = 0;
        for (const id of ids) {
            let exitCode = await Terminal.exec(this.server, socket, terminalName, "docker", [ "image", "pull", id ], "");

            if (exitCode !== 0) {
                overallExitCode = exitCode;
            }
        }

        if (overallExitCode !== 0) {
            throw new Error("Failed to update image(s), please check the terminal output for more information.");
        }

        return overallExitCode;
    }

    async systemPrune(socket: DockgeSocket, all: boolean, volumes: boolean) {
        const terminalName = getAgentMaintenanceTerminalName(socket.endpoint);

        // Without -a: images are handled below so the ones Dockge stacks use are kept
        const dockerParams = [ "system", "prune", "-f" ];
        if (volumes) {
            dockerParams.push("--volumes");
        }

        let exitCode = await Terminal.exec(this.server, socket, terminalName, "docker", dockerParams, "");

        if (exitCode !== 0) {
            throw new Error("Failed to prune, please check the terminal output for more information.");
        }

        if (all) {
            // What -a also did: all build cache, not just dangling
            await this.removeUnusedImagesWithOutput(socket, terminalName, true);
        }

        return exitCode;
    }

    private getByteSize(sizeStr: string): number {
        let byteSize = parseFloat(sizeStr);

        if (byteSize) {
            if (sizeStr.endsWith("KB")) {
                byteSize = byteSize * 1024;
            } else if (sizeStr.endsWith("MB")) {
                byteSize = byteSize * 1024 * 1024;
            } else if (sizeStr.endsWith("GB")) {
                byteSize = byteSize * 1024 * 1024 * 1024;
            }
        } else {
            byteSize = 0;
        }

        return byteSize;
    }
}
