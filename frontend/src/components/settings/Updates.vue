<template>
    <div>
        <!-- API Key -->
        <h4 class="my-4">{{ $t("apiKey") }}</h4>
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
            apiKey: "",
            showApiKey: false,
        };
    },

    methods: {
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
