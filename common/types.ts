export type StatsData = {
    cpuPerc: string,
    memUsage: string,
    memPerc: string,
    netIO: string,
    blockIO: string
}

export type ServiceData = {
    name: string,
    containerName: string,
    image: string,
    state: string,
    status: string,
    health: string,
    recreateNecessary: boolean,
    imageUpdateAvailable: boolean,
    remoteImageDigest: string,
}

export type SimpleStackData = {
    name: string,
    status: number,
    started: boolean,
    recreateNecessary: boolean,
    imageUpdatesAvailable: boolean,
    tags: string[],
    isManagedByDockge: boolean,
    composeFileName: string,
    endpoint: string,
    autoUpdate?: boolean
}

export type StackData = SimpleStackData & {
    composeYAML: string,
    composeENV: string,
    primaryHostname: string,
    services: Record<string, ServiceData>
}

export type AgentData = {
    url: string,
    username: string,
    password: string,
    endpoint: string,
    name: string
}

export enum DockerArtefactAction {
    Prune = "prune",
    PruneAll = "pruneAll",
    Remove = "remove",
    Pull = "pull"
}

export type DockerArtefactInfo = {
    name: string,
    actions: DockerArtefactAction[]
}

export const DockerArtefactInfos: Record<string, DockerArtefactInfo> = {
    Container: {
        name: "container",
        actions: [ DockerArtefactAction.Prune, DockerArtefactAction.Remove ]
    },
    Image: {
        name: "image",
        actions: [ DockerArtefactAction.Prune, DockerArtefactAction.PruneAll, DockerArtefactAction.Pull, DockerArtefactAction.Remove ]
    },
    Network: {
        name: "network",
        actions: [ DockerArtefactAction.Prune, DockerArtefactAction.Remove ]
    },
    Volume: {
        name: "volume",
        actions: [ DockerArtefactAction.Prune, DockerArtefactAction.PruneAll, DockerArtefactAction.Remove ]
    }
};

export type DockerArtefactItem = {
    id: string,
    actionIds: Record<string, string>,
    values: Record<string, string | [string, string] | [string, number]>,
    dangling: boolean,
    danglingLabel: string,
    excludedActions: DockerArtefactAction[]
}

export type DockerArtefactData = {
    info: DockerArtefactInfo,
    data: DockerArtefactItem[]
}

export type VersionMismatchData = {
    stackName: string,
    service: string,
    composeImage: string,
    runningImage: string,
    composePath: string,
}

export type VersionScanResultData = {
    mismatches: VersionMismatchData[],
    matched: { stackName: string; service: string; image: string }[],
    unmatchedServices: { stackName: string; service: string; composeImage: string }[],
}

export type VersionSyncHistoryEntryData = {
    id: number,
    stackName: string,
    endpoint: string,
    service: string,
    oldImage: string,
    newImage: string,
    composePath: string,
    isRevert: boolean,
    createdAt: string,
}
