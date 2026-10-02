<template>
    <div>
        <div class="shadow-box big-padding my-4">
            <div class="form-text mb-3">{{ $t("imageUpdatesHelp") }}</div>

            <div class="form-check form-switch mb-3">
                <input id="imageUpdateCheck" v-model="imageUpdateCheck" class="form-check-input" type="checkbox">
                <label class="form-check-label" for="imageUpdateCheck">{{ $t("imageUpdateCheck") }}</label>
            </div>

            <div class="mb-3">
                <label class="form-label" for="imageUpdateInterval">{{ $t("imageUpdateInterval") }}</label>
                <select id="imageUpdateInterval" v-model.number="imageUpdateInterval" class="form-select interval-select" :disabled="!imageUpdateCheck">
                    <option v-for="hours in intervalOptions" :key="hours" :value="hours">{{ $tc("everyHours", hours, { n: hours }) }}</option>
                </select>
            </div>

            <table class="table table-sm node-table mb-3">
                <thead>
                    <tr>
                        <th>{{ $tc("agent", 1) }}</th>
                        <th>{{ $t("lastChecked") }}</th>
                        <th>{{ $t("result") }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="endpoint in endpoints" :key="endpoint" :data-endpoint="endpoint">
                        <td>{{ $root.endpointDisplayFunction(endpoint) }}</td>
                        <td>{{ lastCheckedText(endpoint) }}</td>
                        <td>{{ nodes[endpoint]?.result ?? "" }}</td>
                    </tr>
                </tbody>
            </table>

            <button class="btn btn-primary me-2" :disabled="busy" @click="saveImageUpdates">
                {{ $t("Save") }}
            </button>
            <button class="btn btn-normal" :disabled="busy || !imageUpdateCheck" @click="checkNow">
                <font-awesome-icon icon="cloud-arrow-down" class="me-1" />
                {{ checking ? $t("checking") : $t("checkNow") }}
            </button>
        </div>
    </div>
</template>

<script lang="ts">
import dayjs from "dayjs";

// An agent running an older Dockge never answers these events
const AGENT_TIMEOUT_MS = 8000;

export default {
    data() {
        return {
            imageUpdateCheck: true,
            imageUpdateInterval: 6,
            intervalOptions: [ 1, 3, 6, 12, 24, 48, 168 ],
            // endpoint -> { lastCheckedAt?, result? }
            nodes: {} as Record<string, { lastCheckedAt?: number, result?: string }>,
            busy: false,
            checking: false,
        };
    },

    computed: {
        // Online nodes, this one first
        endpoints(): string[] {
            const all = new Set([ "", ...Object.keys(this.$root.agentList) ]);
            return [ ...all ].filter(e => this.$root.agentStatusList[e] === "online");
        },
    },

    watch: {
        // Agents connect a moment after the page opens: load each one as it comes online
        endpoints(to: string[], from: string[]) {
            const added = to.filter(e => !from.includes(e));
            if (added.length > 0) {
                this.loadStatus(added);
            }
        },
    },

    mounted() {
        this.loadStatus();
    },

    methods: {
        /**
         * emitAgent with a timeout, for agents that may predate the event
         * @param {string} endpoint Node
         * @param {string} event Event name
         * @param {...unknown} args Arguments
         * @returns {Promise<object>} Response, or { ok: false, timeout: true }
         */
        ask(endpoint: string, event: string, ...args: unknown[]): Promise<Record<string, unknown>> {
            return new Promise((resolve) => {
                const timer = setTimeout(() => resolve({ ok: false,
                    timeout: true }), event === "checkImageUpdates" ? 5 * 60 * 1000 : AGENT_TIMEOUT_MS);
                this.$root.emitAgent(endpoint, event, ...args, (res: Record<string, unknown>) => {
                    clearTimeout(timer);
                    resolve(res);
                });
            });
        },

        setNode(endpoint: string, data: { lastCheckedAt?: number, result?: string }) {
            this.nodes = { ...this.nodes,
                [endpoint]: { ...this.nodes[endpoint],
                    ...data } };
        },

        summaryText(s: Record<string, number>): string {
            return this.$t("imageCheckResult", { images: s.images,
                updates: s.updates,
                skipped: s.skipped });
        },

        lastCheckedText(endpoint: string): string {
            const at = this.nodes[endpoint]?.lastCheckedAt;
            if (at === undefined) {
                return "";
            }
            return at ? dayjs(at).format("YYYY-MM-DD HH:mm") : this.$t("never");
        },

        async loadStatus(endpoints: string[] = this.endpoints) {
            await Promise.all(endpoints.map(async (endpoint) => {
                const res = await this.ask(endpoint, "imageUpdateStatus");
                if (res.ok) {
                    const summary = res.lastSummary as Record<string, number> | null;
                    this.setNode(endpoint, { lastCheckedAt: res.lastCheckedAt as number,
                        result: !res.enabled ? this.$t("imageUpdatesOff") : summary ? this.summaryText(summary) : "" });
                    // The form shows this node's settings
                    if (endpoint === "") {
                        this.imageUpdateCheck = res.enabled as boolean;
                        this.imageUpdateInterval = res.intervalHours as number;
                    }
                } else {
                    this.setNode(endpoint, { result: res.timeout ? this.$t("imageUpdatesUnsupported") : String(res.msg ?? "") });
                }
            }));
        },

        // Applies to every online node: each checks its own stacks
        async saveImageUpdates() {
            this.busy = true;
            const results = await Promise.all(this.endpoints.map(async (endpoint) => {
                const res = await this.ask(endpoint, "setImageUpdateSettings", this.imageUpdateCheck, this.imageUpdateInterval);
                if (!res.ok) {
                    this.setNode(endpoint, { result: res.timeout ? this.$t("imageUpdatesUnsupported") : String(res.msg ?? "") });
                }
                return res;
            }));
            this.busy = false;
            const failed = results.find(r => !r.ok && !r.timeout);
            this.$root.toastRes(failed ?? { ok: true,
                msg: "Saved",
                msgi18n: true });
            await this.loadStatus();
        },

        async checkNow() {
            this.busy = true;
            this.checking = true;
            await Promise.all(this.endpoints.map(async (endpoint) => {
                this.setNode(endpoint, { result: this.$t("checking") });
                const res = await this.ask(endpoint, "checkImageUpdates");
                if (res.ok) {
                    this.setNode(endpoint, {
                        lastCheckedAt: res.checkedAt as number,
                        result: this.summaryText(res as Record<string, number>),
                    });
                } else {
                    this.setNode(endpoint, { result: res.timeout ? this.$t("imageUpdatesUnsupported") : String(res.msg ?? "") });
                }
            }));
            this.busy = false;
            this.checking = false;
        }
    },
};
</script>

<style lang="scss" scoped>
@import "../../styles/vars.scss";

.interval-select {
    max-width: 16rem;
}

.node-table {
    max-width: 40rem;
    // Follow the page's light/dark background instead of Bootstrap's white table
    --bs-table-bg: transparent;
    --bs-table-color: inherit;

    .dark & {
        border-color: $dark-border-color;
    }
}
</style>
