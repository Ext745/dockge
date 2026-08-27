<template>
    <div>
        <!-- Update Defaults -->
        <h4 class="my-4">{{ $t("updateDefaults") }}</h4>
        <div class="shadow-box big-padding mb-4">
            <div class="mb-3">
                <BFormCheckbox v-model="updateDefaults.pruneAfterUpdate" switch>
                    <span v-html="$t('pruneAfterUpdate')"></span>
                </BFormCheckbox>
            </div>

            <div class="mb-3" style="margin-left: 2.5rem;">
                <BFormCheckbox v-model="updateDefaults.pruneAllAfterUpdate" switch :disabled="!updateDefaults.pruneAfterUpdate">
                    <span v-html="$t('pruneAllAfterUpdate')"></span>
                </BFormCheckbox>
            </div>

            <button class="btn btn-primary" @click="saveUpdateDefaults">
                {{ $t("Save") }}
            </button>
        </div>

        <!-- Scheduler Settings -->
        <h4 class="mt-5 mb-3">{{ $t("schedulerSettings") }}</h4>
        <div class="shadow-box big-padding mb-4">
            <div class="mb-3">
                <BFormCheckbox v-model="scheduler.enabled" switch @change="saveScheduler">
                    {{ $t("enableAutoUpdateScheduler") }}
                </BFormCheckbox>
            </div>

            <div class="mb-3">
                <label class="form-label">{{ $t("cronExpression") }}</label>
                <input v-model="scheduler.cronExpression" type="text" class="form-control" placeholder="0 3 * * *" :disabled="!scheduler.enabled">
                <div class="form-text">{{ $t("cronHelp") }}</div>
            </div>

            <button class="btn btn-primary" :disabled="!scheduler.enabled" @click="saveScheduler">
                {{ $t("Save") }}
            </button>
        </div>

        <!-- API Key -->
        <h4 class="mt-5 mb-3">{{ $t("apiKey") }}</h4>
        <div class="shadow-box big-padding mb-4">
            <div class="form-text mb-3">{{ $t("apiKeyHelp") }}</div>
            <div class="mb-3">
                <label class="form-label">{{ $t("apiKey") }}</label>
                <div class="input-group">
                    <input v-model="apiKey" :type="showApiKey ? 'text' : 'password'" class="form-control" :placeholder="$t('apiKeyPlaceholder')">
                    <button class="btn btn-outline-secondary" type="button" @click="showApiKey = !showApiKey">
                        <font-awesome-icon :icon="showApiKey ? 'eye-slash' : 'eye'" />
                    </button>
                </div>
            </div>

            <button class="btn btn-primary" @click="saveApiKey">
                {{ $t("Save") }}
            </button>
        </div>
    </div>
</template>

<script lang="ts">
export default {
    data() {
        return {
            updateDefaults: {
                pruneAfterUpdate: true,
                pruneAllAfterUpdate: true,
            },
            scheduler: {
                enabled: false,
                cronExpression: "0 3 * * *",
            },
            apiKey: "",
            showApiKey: false,
        };
    },

    mounted() {
        this.loadUpdateDefaults();
        this.loadSchedulerSettings();
    },

    methods: {
        loadUpdateDefaults() {
            this.$root.getSocket().emit("getUpdateDefaults", (res) => {
                if (res.ok) {
                    this.updateDefaults = res.data;
                }
            });
        },

        saveUpdateDefaults() {
            this.$root.getSocket().emit("setUpdateDefaults", this.updateDefaults, (res) => {
                this.$root.toastRes(res);
            });
        },

        loadSchedulerSettings() {
            this.$root.getSocket().emit("getSchedulerSettings", (res) => {
                if (res.ok) {
                    this.scheduler = res.data;
                }
            });
        },

        saveScheduler() {
            this.$root.getSocket().emit("setSchedulerSettings", this.scheduler, (res) => {
                this.$root.toastRes(res);
            });
        },

        saveApiKey() {
            this.$root.getSocket().emit("setApiKey", this.apiKey, (res) => {
                this.$root.toastRes(res);
                if (res.ok) {
                    this.apiKey = "";
                }
            });
        },
    },
};
</script>
