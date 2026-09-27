<template>
    <!-- Mobile: the stack list is the home screen; every other page gets the full width -->
    <div v-if="$root.isMobile" class="mobile-dashboard">
        <MobileStackList v-if="$route.name === 'DashboardHome'" />
        <router-view v-else :key="$route.fullPath" />
    </div>

    <div v-else class="container-fluid">
        <div class="split" :class="{ resizing }">
            <div class="side-pane" :style="{ width: sideWidth + 'px' }">
                <div>
                    <router-link to="/compose" class="btn btn-primary mb-3"><font-awesome-icon icon="plus" /> {{ $t("compose") }}</router-link>
                </div>
                <StackList :scrollbar="true" />
            </div>

            <div
                class="pane-resizer"
                role="separator"
                aria-orientation="vertical"
                :aria-label="$t('resizeStackList')"
                :aria-valuenow="sideWidth"
                :aria-valuemin="MIN_WIDTH"
                :aria-valuemax="maxWidth()"
                tabindex="0"
                :title="$t('resizeStackList')"
                @mousedown="startResize"
                @dblclick="resetWidth"
                @keydown="onResizerKeydown"
            >
                <div class="resizer-grip"></div>
            </div>

            <div ref="container" class="main-pane mb-3">
                <!-- Add :key to disable vue router re-use the same component -->
                <router-view :key="$route.fullPath" :calculatedHeight="height" />
            </div>
        </div>
    </div>
</template>

<script>

import StackList from "../components/StackList.vue";
import MobileStackList from "../components/MobileStackList.vue";

const STORAGE_KEY = "dockge-stack-list-width";
const MIN_WIDTH = 240;
const DEFAULT_WIDTH = 340;
const KEYBOARD_STEP = 20;
// The main pane keeps at least this much room
const MIN_MAIN_WIDTH = 420;

export default {
    components: {
        StackList,
        MobileStackList,
    },
    data() {
        return {
            MIN_WIDTH,
            height: 0,
            sideWidth: DEFAULT_WIDTH,
            resizing: false,
        };
    },
    created() {
        try {
            const saved = parseInt(localStorage.getItem(STORAGE_KEY) ?? "", 10);
            if (!Number.isNaN(saved)) {
                this.sideWidth = this.clampWidth(saved);
            }
        } catch (e) {
            // localStorage may be unavailable (private browsing, disabled storage, etc.)
        }
    },
    mounted() {
        this.height = this.$refs.container?.offsetHeight ?? 0;
        window.addEventListener("resize", this.onWindowResize);
    },
    beforeUnmount() {
        this.stopResize();
        window.removeEventListener("resize", this.onWindowResize);
    },
    methods: {
        /**
         * @returns {number} Widest the stack list may be, leaving the main pane usable
         */
        maxWidth() {
            return Math.max(MIN_WIDTH, window.innerWidth - MIN_MAIN_WIDTH);
        },

        /**
         * @param {number} value Requested width in pixels
         * @returns {number} Width clamped to the allowed range
         */
        clampWidth(value) {
            return Math.min(this.maxWidth(), Math.max(MIN_WIDTH, value));
        },

        saveWidth() {
            try {
                localStorage.setItem(STORAGE_KEY, String(this.sideWidth));
            } catch (e) {
                // localStorage may be unavailable
            }
        },

        onWindowResize() {
            this.sideWidth = this.clampWidth(this.sideWidth);
        },

        /**
         * @param {MouseEvent} event Mouse-down on the resizer
         * @returns {void}
         */
        startResize(event) {
            event.preventDefault();
            this.resizing = true;
            this.resizeStartX = event.clientX;
            this.resizeStartWidth = this.sideWidth;
            window.addEventListener("mousemove", this.onResize);
            window.addEventListener("mouseup", this.stopResize);
        },

        /**
         * @param {MouseEvent} event Mouse-move while dragging
         * @returns {void}
         */
        onResize(event) {
            this.sideWidth = this.clampWidth(this.resizeStartWidth + event.clientX - this.resizeStartX);
        },

        stopResize() {
            if (!this.resizing) {
                return;
            }
            this.resizing = false;
            window.removeEventListener("mousemove", this.onResize);
            window.removeEventListener("mouseup", this.stopResize);
            this.saveWidth();
        },

        resetWidth() {
            this.sideWidth = this.clampWidth(DEFAULT_WIDTH);
            this.saveWidth();
        },

        /**
         * Arrow keys resize, Home resets.
         * @param {KeyboardEvent} event Keydown on the focused resizer
         * @returns {void}
         */
        onResizerKeydown(event) {
            if (event.key === "Home") {
                event.preventDefault();
                this.resetWidth();
                return;
            }
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
                return;
            }
            event.preventDefault();
            const direction = event.key === "ArrowLeft" ? -1 : 1;
            this.sideWidth = this.clampWidth(this.sideWidth + direction * KEYBOARD_STEP);
            this.saveWidth();
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../styles/vars.scss";

.container-fluid {
    width: 98%;
}

.mobile-dashboard {
    padding: 0 12px;
}

.split {
    display: flex;
    align-items: flex-start;

    // Keep the drag smooth: no text selection or hover effects while resizing
    &.resizing {
        user-select: none;
        cursor: col-resize;

        .side-pane, .main-pane {
            pointer-events: none;
        }
    }
}

.side-pane {
    flex: 0 0 auto;
    min-width: 0;
}

.main-pane {
    flex: 1 1 0;
    min-width: 0;
}

.pane-resizer {
    position: sticky;
    top: 10px;
    flex: 0 0 auto;
    align-self: stretch;
    width: 16px;
    margin: 0 4px;
    max-height: calc(100vh - 20px);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: col-resize;

    .resizer-grip {
        width: 4px;
        height: 48px;
        border-radius: 2px;
        background-color: rgba(128, 128, 128, 0.3);
        transition: background-color 0.15s, height 0.15s;
    }

    &:hover .resizer-grip,
    &:focus-visible .resizer-grip,
    .resizing & .resizer-grip {
        height: 96px;
        background-color: $primary;
    }

    &:focus-visible {
        outline: none;
    }
}
</style>
