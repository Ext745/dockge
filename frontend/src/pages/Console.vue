<template>
    <transition name="slide-fade" appear>
        <div v-if="!processing">
            <h1 class="mb-3">{{ $t("console") }}</h1>

            <div v-if="enableConsole">
                <div class="terminal-wrapper" :style="{ height: terminalHeight + 'px' }">
                    <Terminal ref="resizableTerminal" class="terminal" :rows="20" mode="mainTerminal" name="console" :endpoint="endpoint"></Terminal>
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

            <div v-else class="alert alert-warning shadow-box" role="alert">
                <h4 class="alert-heading">{{ $t("Console is not enabled") }}</h4>
                <i18n-t keypath="ConsoleNotEnabledMSG1" tag="p">
                    <template #docker><code>{{ $t('dockerCode') }}</code></template>
                    <template #rm><code>{{ $t('rmCode') }}</code></template>
                </i18n-t>

                <i18n-t keypath="ConsoleNotEnabledMSG2" tag="p">
                    <template #rmRf>
                        <code>{{ $t('rmRfCode') }}</code>
                    </template>
                </i18n-t>

                <i18n-t keypath="ConsoleNotEnabledMSG3" tag="p">
                    <template #envVar>
                        <code>{{ $t('envVarCode') }}</code>
                    </template>
                </i18n-t>
            </div>
        </div>
    </transition>
</template>

<script>
import resizableTerminal from "../mixins/resizableTerminal";

export default {
    components: {
    },
    mixins: [ resizableTerminal ],
    data() {
        return {
            processing: true,
            enableConsole: false,
        };
    },
    computed: {
        endpoint() {
            return this.$route.params.endpoint || "";
        },
    },
    mounted() {
        this.$root.emitAgent(this.endpoint, "checkMainTerminal", (res) => {
            this.enableConsole = res.ok;
            this.processing = false;
        });
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
