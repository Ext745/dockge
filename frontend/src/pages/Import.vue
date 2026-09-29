<template>
    <transition name="slide-fade" appear>
        <div class="import-page">
            <h1 class="mb-2">
                {{ $t("importTitle") }}
                <small v-if="agentLabel" class="agent-label">{{ agentLabel }}</small>
            </h1>
            <p class="intro mb-3">{{ $t("importIntro") }}</p>

            <!-- Folder scan -->
            <div class="shadow-box big-padding mb-3">
                <h5 class="mb-2">{{ $t("importScanTitle") }}</h5>
                <form class="d-flex gap-2" @submit.prevent="load">
                    <input v-model="scanDir" class="form-control" :placeholder="$t('importScanPlaceholder')" :disabled="loading || importing" />
                    <button type="submit" class="btn btn-normal text-nowrap" :disabled="loading || importing">
                        <font-awesome-icon icon="search" class="me-1" />{{ $t("importScan") }}
                    </button>
                </form>
                <div class="form-text">{{ $t("importScanHint") }}</div>
            </div>

            <!-- Candidates -->
            <div class="shadow-box big-padding mb-3">
                <div class="d-flex align-items-center mb-2">
                    <h5 class="mb-0 me-auto">{{ $t("importCandidates") }}</h5>
                    <button type="button" class="btn btn-sm btn-normal" :disabled="loading || importing" :title="$t('importRefresh')" @click="load">
                        <font-awesome-icon icon="arrows-rotate" />
                    </button>
                </div>

                <div v-if="loading" class="subtle py-2">{{ $t("importLoading") }}</div>
                <div v-else-if="candidates.length === 0" class="subtle py-2">{{ $t("importNothing") }}</div>
                <div v-else class="candidate-list">
                    <label
                        v-for="c in candidates" :key="c.name"
                        class="candidate" :class="{ disabled: !c.importable }"
                    >
                        <input v-model="selected" type="checkbox" class="form-check-input mt-1" :value="c.name" :disabled="!c.importable || importing" />
                        <div class="candidate-body">
                            <div class="d-flex flex-wrap align-items-center gap-2">
                                <strong>{{ c.name }}</strong>
                                <span class="badge" :class="c.source === 'running' ? 'bg-primary' : 'bg-secondary'">{{ c.source === "running" ? $t("importSourceDocker") : $t("importSourceFolder") }}</span>
                                <span class="small subtle">{{ c.status }}</span>
                            </div>
                            <div v-for="f in c.configFiles" :key="f" class="small file">{{ f }}</div>
                            <div v-if="!c.importable" class="small reason">{{ c.reason }}</div>
                        </div>
                    </label>
                </div>

                <div class="form-check mt-3">
                    <input id="importRedeploy" v-model="redeploy" class="form-check-input" type="checkbox" :disabled="importing" />
                    <label class="form-check-label" for="importRedeploy">{{ $t("importRedeploy") }}</label>
                </div>
                <div class="form-text mb-3">{{ $t("importRedeployHint") }}</div>

                <p class="small safety mb-3">
                    <font-awesome-icon icon="shield-halved" class="me-1" />{{ $t("importSafety") }}
                </p>

                <button type="button" class="btn btn-primary" :disabled="selected.length === 0 || importing" @click="doImport">
                    <font-awesome-icon :icon="importing ? 'spinner' : 'file-import'" :spin="importing" class="me-1" />
                    {{ $t("importSelected", [ selected.length ]) }}
                </button>
            </div>

            <!-- Single "docker run" containers -->
            <div class="shadow-box big-padding mb-3">
                <h5 class="mb-1">{{ $t("importContainersTitle") }}</h5>
                <div class="form-text mb-2">{{ $t("importContainersHint") }}</div>
                <div v-if="loading" class="subtle py-2">{{ $t("importLoading") }}</div>
                <div v-else-if="containers.length === 0" class="subtle py-2">{{ $t("importNoContainers") }}</div>
                <div v-else class="candidate-list">
                    <div v-for="c in containers" :key="c.id" class="candidate" :class="{ disabled: !c.importable }">
                        <div class="candidate-body me-auto">
                            <div class="d-flex flex-wrap align-items-center gap-2">
                                <strong>{{ c.name }}</strong>
                                <span class="badge" :class="c.state === 'running' ? 'bg-primary' : 'bg-secondary'">{{ c.state }}</span>
                                <span class="small subtle">{{ c.status }}</span>
                            </div>
                            <div class="small file">{{ c.image }}</div>
                            <div v-if="c.reason" class="small reason">{{ c.reason }}</div>
                        </div>
                        <button type="button" class="btn btn-sm btn-normal align-self-center text-nowrap" :disabled="!c.importable || importing || reviewLoading" @click="review(c)">
                            <font-awesome-icon icon="file-import" class="me-1" />{{ $t("importReview") }}
                        </button>
                    </div>
                </div>
            </div>

            <!-- Portainer stacks -->
            <div class="shadow-box big-padding mb-3">
                <h5 class="mb-1">{{ $t("importPortainerTitle") }}</h5>
                <div class="form-text mb-2">{{ $t("importPortainerHint") }}</div>
                <form class="portainer-form mb-2" @submit.prevent="connectPortainer">
                    <input id="portainerUrl" v-model="portainer.url" class="form-control" :placeholder="'https://portainer.lan:9443'" :disabled="portainerLoading || importing" />
                    <input id="portainerKey" v-model="portainer.apiKey" type="password" class="form-control" :placeholder="$t('importPortainerToken')" autocomplete="off" :disabled="portainerLoading || importing" />
                    <button type="submit" class="btn btn-normal text-nowrap" :disabled="portainerLoading || importing || !portainer.url || !portainer.apiKey">
                        <font-awesome-icon :icon="portainerLoading ? 'spinner' : 'plug'" :spin="portainerLoading" class="me-1" />{{ $t("importPortainerConnect") }}
                    </button>
                </form>
                <div class="form-check mb-2">
                    <input id="portainerInsecure" v-model="portainer.insecure" class="form-check-input" type="checkbox" />
                    <label class="form-check-label" for="portainerInsecure">{{ $t("importPortainerInsecure") }}</label>
                </div>

                <template v-if="portainerStacks !== null">
                    <div v-if="portainerStacks.length === 0" class="subtle py-2">{{ $t("importPortainerNone") }}</div>
                    <div v-else class="candidate-list mb-3">
                        <label v-for="p in portainerStacks" :key="p.id" class="candidate" :class="{ disabled: !p.importable }">
                            <input v-model="portainerSelected" type="checkbox" class="form-check-input mt-1" :value="p.id" :disabled="!p.importable || importing" />
                            <div class="candidate-body">
                                <div class="d-flex flex-wrap align-items-center gap-2">
                                    <strong>{{ p.name }}</strong>
                                    <span class="badge bg-secondary">{{ p.environment }}</span>
                                    <span class="badge" :class="p.status === 'running' ? 'bg-primary' : 'bg-secondary'">{{ p.status }}</span>
                                    <span v-if="p.git" class="badge bg-secondary">Git</span>
                                    <span v-if="p.variables" class="small subtle">{{ $t("importPortainerVars", [ p.variables ]) }}</span>
                                </div>
                                <div v-if="p.reason" class="small reason">{{ p.reason }}</div>
                            </div>
                        </label>
                    </div>

                    <template v-if="portainerStacks.length > 0">
                        <div class="form-check">
                            <input id="portainerRedeploy" v-model="portainerRedeploy" class="form-check-input" type="checkbox" :disabled="importing" />
                            <label class="form-check-label" for="portainerRedeploy">{{ $t("importRedeploy") }}</label>
                        </div>
                        <div class="form-text mb-3">{{ $t("importRedeployHint") }}</div>
                        <p class="small reason mb-3">
                            <font-awesome-icon icon="exclamation-triangle" class="me-1" />{{ $t("importPortainerWarning") }}
                        </p>
                        <button type="button" class="btn btn-primary" :disabled="portainerSelected.length === 0 || importing" @click="importPortainer">
                            <font-awesome-icon :icon="importing ? 'spinner' : 'file-import'" :spin="importing" class="me-1" />
                            {{ $t("importSelected", [ portainerSelected.length ]) }}
                        </button>
                    </template>
                </template>
            </div>

            <!-- Results of the last run -->
            <div v-if="results.length > 0" class="shadow-box big-padding mb-3">
                <h5 class="mb-2">{{ $t("importResults") }}</h5>
                <div v-for="r in results" :key="r.name" class="result" :class="r.ok ? 'ok' : 'failed'">
                    <div class="d-flex flex-wrap align-items-center gap-2">
                        <font-awesome-icon :icon="r.ok ? 'check' : 'times'" />
                        <strong>{{ r.name }}</strong>
                        <span class="msg">{{ r.msg }}</span>
                        <router-link v-if="r.ok" :to="stackUrl(r.name)" class="ms-auto small">{{ $t("importOpenStack") }}</router-link>
                    </div>
                    <ul v-if="r.notes.length > 0" class="small mb-0 mt-1">
                        <li v-for="(n, i) in r.notes" :key="i">{{ n }}</li>
                    </ul>
                </div>
            </div>

            <!-- Imports that can still be rolled back -->
            <div v-if="imports.length > 0" class="shadow-box big-padding mb-3">
                <h5 class="mb-1">{{ $t("importRecent") }}</h5>
                <div class="form-text mb-2">{{ $t("importRecentHint") }}</div>
                <div v-for="rec in imports" :key="rec.id" class="record">
                    <div class="me-auto">
                        <router-link :to="stackUrl(rec.name)"><strong>{{ rec.name }}</strong></router-link>
                        <div class="small subtle">
                            <template v-if="rec.portainer">{{ $t("importFromPortainer", [ rec.portainer.environment ]) }}</template>
                            <template v-else-if="rec.container">{{ $t("importFromContainer", [ rec.container.name, rec.container.renamedTo ]) }}</template>
                            <template v-else>{{ $t("importFrom", [ rec.workingDir ]) }}</template>
                            · {{ new Date(rec.importedAt).toLocaleString() }}
                            <span v-if="rec.redeployed && !rec.container"> · {{ $t("importWasRedeployed") }}</span>
                        </div>
                    </div>
                    <button type="button" class="btn btn-sm btn-normal" :disabled="importing" @click="pendingRollback = rec">
                        <font-awesome-icon icon="rotate-left" class="me-1" />{{ $t("importRollback") }}
                    </button>
                    <button type="button" class="btn btn-sm btn-normal" :disabled="importing" @click="finalize(rec)">
                        <font-awesome-icon icon="check" class="me-1" />{{ $t("importKeep") }}
                    </button>
                </div>
            </div>

            <BModal :model-value="pendingRollback !== null" :title="$t('importRollback')" :cancelTitle="$t('cancel')" :okTitle="$t('importRollback')" okVariant="warning" @ok="rollback" @hidden="pendingRollback = null">
                <p class="mb-0">{{ rollbackMessage }}</p>
            </BModal>

            <BModal v-model="showReview" size="xl" :title="reviewContainer ? $t('importReviewTitle', [ reviewContainer.name ]) : ''" :cancelTitle="$t('cancel')" :okTitle="$t('importContainerConfirm')" :okDisabled="!reviewStackName || importing" okVariant="primary" @ok="importReviewed">
                <label class="form-label" for="reviewStackName">{{ $t("stackName") }}</label>
                <input id="reviewStackName" v-model="reviewStackName" class="form-control mb-3" />

                <label class="form-label" for="reviewCompose">compose.yaml</label>
                <textarea id="reviewCompose" v-model="reviewYAML" class="form-control review-yaml mb-3" rows="16" spellcheck="false"></textarea>

                <ul v-if="reviewNotes.length > 0" class="small mb-3">
                    <li v-for="(n, i) in reviewNotes" :key="i">{{ n }}</li>
                </ul>
                <p class="small safety mb-0">
                    <font-awesome-icon icon="shield-halved" class="me-1" />{{ reviewContainer && $t("importContainerSafety", [ reviewContainer.name, reviewContainer.name + "-pre-dockge" ]) }}
                </p>
            </BModal>
        </div>
    </transition>
</template>

<script>
import { BModal } from "bootstrap-vue-next";

export default {
    components: {
        BModal,
    },
    data() {
        return {
            scanDir: "",
            // The folder the current list came from; imports re-check candidates against the same scan
            scannedDir: "",
            candidates: [],
            imports: [],
            selected: [],
            redeploy: false,
            loading: false,
            importing: false,
            results: [],
            pendingRollback: null,
            containers: [],
            showReview: false,
            reviewLoading: false,
            reviewContainer: null,
            reviewStackName: "",
            reviewYAML: "",
            reviewNotes: [],
            // The access token only lives in this page; it's sent with each request and never saved
            portainer: {
                url: "",
                apiKey: "",
                insecure: false,
            },
            portainerLoading: false,
            portainerStacks: null,
            portainerSelected: [],
            portainerRedeploy: false,
        };
    },
    computed: {
        endpoint() {
            return this.$route.params.endpoint || "";
        },
        rollbackMessage() {
            const rec = this.pendingRollback;
            if (!rec) {
                return "";
            }
            if (rec.container) {
                return this.$t("importRollbackContainerMsg", [ rec.name, rec.container.name ]);
            }
            if (rec.portainer) {
                return this.$t(rec.redeployed ? "importRollbackPortainerRedeployedMsg" : "importRollbackPortainerMsg", [ rec.name ]);
            }
            return this.$t(rec.redeployed ? "importRollbackRedeployedMsg" : "importRollbackMsg", [ rec.name, rec.workingDir ]);
        },

        agentLabel() {
            if (!this.endpoint || this.$root.agentCount <= 1) {
                return "";
            }
            const agent = this.$root.agentList?.[this.endpoint];
            return agent?.name || this.endpoint;
        },
    },
    watch: {
        endpoint() {
            this.results = [];
            this.selected = [];
            this.load();
        },
    },
    mounted() {
        this.load();
    },
    methods: {
        stackUrl(name) {
            return this.endpoint ? `/compose/${name}/${this.endpoint}` : `/compose/${name}`;
        },

        load() {
            this.loading = true;
            const dir = this.scanDir.trim();
            this.$root.emitAgent(this.endpoint, "getImportCandidates", dir, (res) => {
                this.loading = false;
                if (!res.ok) {
                    this.$root.toastRes(res);
                    return;
                }
                this.candidates = res.candidates;
                this.containers = res.containers ?? [];
                this.imports = res.imports;
                this.scannedDir = dir;
                this.selected = this.selected.filter((name) => res.candidates.some((c) => c.name === name && c.importable));
            });
        },

        doImport() {
            this.importing = true;
            this.results = [];
            this.$root.emitAgent(this.endpoint, "importStacks", [ ...this.selected ], this.scannedDir, this.redeploy, (res) => {
                this.importing = false;
                if (!res.ok) {
                    this.$root.toastRes(res);
                    return;
                }
                this.results = res.results;
                this.imports = res.imports;
                this.selected = [];
                this.load();
            });
        },

        connectPortainer() {
            this.portainerLoading = true;
            this.$root.emitAgent(this.endpoint, "getPortainerStacks", { ...this.portainer }, (res) => {
                this.portainerLoading = false;
                if (!res.ok) {
                    this.$root.toastRes(res);
                    return;
                }
                this.portainerStacks = res.stacks;
                this.portainerSelected = this.portainerSelected.filter((id) => res.stacks.some((p) => p.id === id && p.importable));
            });
        },

        importPortainer() {
            this.importing = true;
            this.results = [];
            this.$root.emitAgent(this.endpoint, "importPortainerStacks", { ...this.portainer }, [ ...this.portainerSelected ], this.portainerRedeploy, (res) => {
                this.importing = false;
                if (!res.ok) {
                    this.$root.toastRes(res);
                    return;
                }
                this.results = res.results;
                this.imports = res.imports;
                this.portainerSelected = [];
                this.connectPortainer();
                this.load();
            });
        },

        review(container) {
            this.reviewLoading = true;
            this.$root.emitAgent(this.endpoint, "generateContainerCompose", container.id, (res) => {
                this.reviewLoading = false;
                if (!res.ok) {
                    this.$root.toastRes(res);
                    return;
                }
                this.reviewContainer = container;
                this.reviewStackName = res.stackName;
                this.reviewYAML = res.composeYAML;
                this.reviewNotes = res.notes;
                this.showReview = true;
            });
        },

        importReviewed() {
            const container = this.reviewContainer;
            this.importing = true;
            this.results = [];
            this.$root.emitAgent(this.endpoint, "importContainer", container.id, this.reviewStackName.trim(), this.reviewYAML, (res) => {
                this.importing = false;
                if (!res.ok) {
                    this.$root.toastRes(res);
                    return;
                }
                this.results = res.results;
                this.imports = res.imports;
                this.load();
            });
        },

        rollback() {
            const rec = this.pendingRollback;
            this.pendingRollback = null;
            this.$root.emitAgent(this.endpoint, "rollbackImport", rec.id, (res) => {
                this.$root.toastRes(res);
                this.load();
            });
        },

        finalize(rec) {
            this.$root.emitAgent(this.endpoint, "finalizeImport", rec.id, (res) => {
                this.$root.toastRes(res);
                this.load();
            });
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../styles/vars.scss";

.agent-label {
    font-size: 1rem;
    color: $dark-font-color3;
}

.intro,
.safety,
.subtle {
    color: $dark-font-color;
    opacity: 0.75;
}

.candidate-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.candidate {
    display: flex;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid $dark-border-color;
    cursor: pointer;

    &.disabled {
        opacity: 0.6;
        cursor: default;
    }

    .candidate-body {
        min-width: 0;
    }

    .file {
        font-family: "JetBrains Mono", monospace;
        word-break: break-all;
        color: $dark-font-color3;
    }

    .reason {
        color: $warning;
    }
}

.result {
    padding: 8px 0;
    border-bottom: 1px solid $dark-border-color;

    &:last-child {
        border-bottom: 0;
    }

    &.ok svg {
        color: $primary;
    }

    &.failed svg,
    &.failed .msg {
        color: $danger;
    }

    .msg {
        white-space: pre-wrap;
    }
}

.portainer-form {
    display: grid;
    grid-template-columns: 2fr 2fr auto;
    gap: 8px;

    @media (max-width: 770px) {
        grid-template-columns: 1fr;
    }
}

.review-yaml {
    font-family: "JetBrains Mono", monospace;
    font-size: 0.85rem;
}

.record {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 8px 0;
    border-bottom: 1px solid $dark-border-color;

    &:last-child {
        border-bottom: 0;
    }
}
</style>
