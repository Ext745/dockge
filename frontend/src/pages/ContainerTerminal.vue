<template>
    <transition name="slide-fade" appear>
        <div>
            <h1 class="mb-3">{{ $t("terminal") }} - {{ serviceName }} ({{ stackName }})</h1>

            <div class="mb-3">
                <router-link :to="sh" class="btn btn-normal me-2">{{ $t("Switch to sh") }}</router-link>
            </div>

            <div class="terminal-wrapper" :style="{ height: terminalHeight + 'px' }">
                <Terminal ref="resizableTerminal" class="terminal" :rows="20" mode="interactive" :name="terminalName" :stack-name="stackName" :service-name="serviceName" :shell="shell" :endpoint="endpoint"></Terminal>
            </div>
            <div
                class="terminal-resize-handle"
                role="separator"
                aria-orientation="horizontal"
                :aria-label="$t('resizeTerminal')"
                tabindex="0"
                @mousedown="startResize"
                @touchstart="startResize"
                @keydown="onHandleKeydown"
            >
                <div class="resize-grip"></div>
            </div>
        </div>
    </transition>
</template>

<script>
import { getContainerExecTerminalName } from "../../../common/util-common";
import resizableTerminal from "../mixins/resizableTerminal";

export default {
    components: {
    },
    mixins: [ resizableTerminal ],
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
.terminal-wrapper {
    min-height: 200px;
}

.terminal {
    height: 100%;
}

.terminal-resize-handle {
    height: 14px;
    margin-top: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: ns-resize;
    touch-action: none;
    user-select: none;

    &:focus-visible {
        outline: 2px solid var(--bs-primary, #5cdd8b);
        outline-offset: 2px;
        border-radius: 4px;
    }

    .resize-grip {
        width: 40px;
        height: 4px;
        border-radius: 2px;
        background-color: rgba(128, 128, 128, 0.4);
    }

    &:hover .resize-grip,
    &:focus .resize-grip {
        background-color: rgba(128, 128, 128, 0.7);
    }
}
</style>
