<template>
    <transition name="slide-fade" appear>
        <div :class="{ 'mobile-terminal-page': $root.isMobile }">
            <div v-if="$root.isMobile" class="m-topbar">
                <router-link :to="stackLink" class="m-icon-btn" :aria-label="$t('back')">
                    <font-awesome-icon icon="arrow-left" />
                </router-link>
                <div class="m-title">
                    <div class="m-name">{{ serviceName }}</div>
                    <div class="m-sub">{{ stackName }} · {{ shell }}</div>
                </div>
                <router-link v-if="shell !== 'sh'" :to="sh" class="btn btn-normal btn-sm me-2">{{ $t("Switch to sh") }}</router-link>
            </div>

            <template v-else>
                <h1 class="mb-3">{{ $t("terminal") }} - {{ serviceName }} ({{ stackName }})</h1>

                <div class="mb-3">
                    <router-link :to="sh" class="btn btn-normal me-2">{{ $t("Switch to sh") }}</router-link>
                </div>
            </template>

            <TerminalPanel
                storage-key="dockge-terminal-height" :rows="20"
                :fill-height="$root.isMobile ? 'calc(100dvh - 56px - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 48px)' : null" mode="interactive" :name="terminalName" :stack-name="stackName" :service-name="serviceName" :shell="shell" :endpoint="endpoint"
            />
        </div>
    </transition>
</template>

<script>
import { getContainerExecTerminalName } from "../../../common/util-common";

export default {
    components: {
    },
    data() {
        return {

        };
    },
    computed: {
        stackName() {
            return this.$route.params.stackName;
        },
        endpoint() {
            return this.$route.params.endpoint || "";
        },
        shell() {
            return this.$route.params.type;
        },
        serviceName() {
            return this.$route.params.serviceName;
        },
        terminalName() {
            return getContainerExecTerminalName(this.endpoint, this.stackName, this.serviceName, 0);
        },
        stackLink() {
            return this.endpoint ? `/compose/${this.stackName}/${this.endpoint}` : `/compose/${this.stackName}`;
        },
        sh() {
            let endpoint = this.$route.params.endpoint;

            let data = {
                name: "containerTerminal",
                params: {
                    stackName: this.stackName,
                    serviceName: this.serviceName,
                    type: "sh",
                },
            };

            if (endpoint) {
                data.name = "containerTerminalEndpoint";
                data.params.endpoint = endpoint;
            }

            return data;
        },
    },
    mounted() {

    },
    methods: {

    }
};
</script>

<style scoped lang="scss">
.mobile-terminal-page {
    .m-topbar {
        position: sticky;
        top: 0;
        z-index: 1001;
        display: flex;
        align-items: center;
        gap: 4px;
        height: calc(56px + env(safe-area-inset-top));
        margin: 0 -12px 8px;
        padding: env(safe-area-inset-top) 4px 0;
        background-color: var(--bar-bg);
        border-bottom: 1px solid var(--card-border);
    }

    .m-icon-btn {
        width: 44px;
        height: 44px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: inherit;
        font-size: 20px;
    }

    .m-title {
        flex: 1 1 auto;
        min-width: 0;
        line-height: 1.2;

        .m-name {
            font-size: 17px;
            font-weight: 700;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .m-sub {
            font-size: 12px;
            opacity: 0.7;
        }
    }
}
</style>
