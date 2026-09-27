<template>
    <div class="terminal-panel" :class="{ expanded }">
        <div class="terminal-wrapper" :style="wrapperStyle">
            <Terminal ref="terminal" class="terminal" v-bind="$attrs" />
        </div>
        <div class="terminal-toolbar">
            <div
                v-if="!expanded && !fillHeight"
                class="terminal-resize-handle"
                role="separator"
                aria-orientation="horizontal"
                :aria-label="$t('resizeTerminal')"
                :aria-valuenow="height"
                :aria-valuemin="MIN_HEIGHT"
                :aria-valuemax="maxHeight()"
                tabindex="0"
                @mousedown="startResize"
                @touchstart="startResize"
                @keydown="onHandleKeydown"
            >
                <div class="resize-grip"></div>
            </div>
            <button
                type="button"
                class="expand-toggle"
                :title="expanded ? $t('collapseTerminal') : $t('expandTerminal')"
                :aria-label="expanded ? $t('collapseTerminal') : $t('expandTerminal')"
                :aria-pressed="expanded"
                @click="toggleExpanded"
            >
                <font-awesome-icon :icon="expanded ? 'compress' : 'expand'" />
            </button>
        </div>
    </div>
</template>

<script>
import Terminal from "./Terminal.vue";

const MIN_HEIGHT = 150;
const KEYBOARD_STEP = 20;

/**
 * A <Terminal> in a panel the user can resize (drag the handle, or arrow keys on it) and expand to fill
 * the viewport (button, Esc to leave). Each page passes its own storageKey so its height is remembered
 * separately, per browser. All other attributes are passed through to <Terminal>.
 */
export default {
    components: {
        Terminal,
    },
    inheritAttrs: false,
    props: {
        storageKey: {
            type: String,
            required: true,
        },
        defaultHeight: {
            type: Number,
            default: 410,
        },
        /** A CSS height to fill instead of the user-resizable one (mobile). Disables the drag handle. */
        fillHeight: {
            type: String,
            default: null,
        },
    },
    data() {
        return {
            MIN_HEIGHT,
            height: this.defaultHeight,
            expanded: false,
            resizing: false,
        };
    },

    computed: {
        wrapperStyle() {
            if (this.expanded) {
                return null;
            }
            return { height: this.fillHeight ?? `${this.height}px` };
        },
    },

    created() {
        try {
            const saved = parseInt(localStorage.getItem(this.storageKey) ?? "", 10);
            if (!Number.isNaN(saved)) {
                this.height = this.clampHeight(saved);
            }
        } catch (e) {
            // localStorage may be unavailable (private browsing, disabled storage, etc.)
        }
    },

    beforeUnmount() {
        this.stopResize();
        this.setExpanded(false);
    },

    methods: {
        /**
         * The tallest the panel may be dragged: the viewport, less room for the handle.
         * @returns {number} Maximum height in pixels
         */
        maxHeight() {
            return Math.max(MIN_HEIGHT, window.innerHeight - 40);
        },

        /**
         * @param {number} value Requested height in pixels
         * @returns {number} The height clamped to the allowed range
         */
        clampHeight(value) {
            return Math.min(this.maxHeight(), Math.max(MIN_HEIGHT, value));
        },

        saveHeight() {
            try {
                localStorage.setItem(this.storageKey, String(this.height));
            } catch (e) {
                // localStorage may be unavailable (private browsing, disabled storage, etc.)
            }
        },

        /**
         * Begin a drag/touch resize of the panel.
         * @param {MouseEvent | TouchEvent} event Pointer-down event on the resize handle
         * @returns {void}
         */
        startResize(event) {
            event.preventDefault();
            this.resizing = true;
            this.resizeStartY = "touches" in event ? event.touches[0].clientY : event.clientY;
            this.resizeStartHeight = this.height;

            window.addEventListener("mousemove", this.onResize);
            window.addEventListener("mouseup", this.stopResize);
            window.addEventListener("touchmove", this.onResize, { passive: false });
            window.addEventListener("touchend", this.stopResize);
            window.addEventListener("touchcancel", this.stopResize);
        },

        /**
         * @param {MouseEvent | TouchEvent} event Pointer-move event while dragging
         * @returns {void}
         */
        onResize(event) {
            if (!this.resizing) {
                return;
            }
            event.preventDefault();
            const clientY = "touches" in event ? event.touches[0].clientY : event.clientY;
            this.height = this.clampHeight(this.resizeStartHeight + clientY - this.resizeStartY);
        },

        stopResize() {
            if (!this.resizing) {
                return;
            }
            this.resizing = false;

            window.removeEventListener("mousemove", this.onResize);
            window.removeEventListener("mouseup", this.stopResize);
            window.removeEventListener("touchmove", this.onResize);
            window.removeEventListener("touchend", this.stopResize);
            window.removeEventListener("touchcancel", this.stopResize);

            this.saveHeight();
        },

        /**
         * @param {KeyboardEvent} event Keydown on the focused resize handle
         * @returns {void}
         */
        onHandleKeydown(event) {
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
                return;
            }
            event.preventDefault();
            const direction = event.key === "ArrowUp" ? -1 : 1;
            this.height = this.clampHeight(this.height + direction * KEYBOARD_STEP);
            this.saveHeight();
        },

        toggleExpanded() {
            this.setExpanded(!this.expanded);
        },

        /**
         * Expand the panel to fill the viewport, or restore it. While expanded, the page behind it
         * does not scroll and Esc restores it.
         * @param {boolean} value Whether the panel should be expanded
         * @returns {void}
         */
        setExpanded(value) {
            if (value === this.expanded) {
                return;
            }
            this.expanded = value;
            document.body.classList.toggle("terminal-expanded", value);
            if (value) {
                document.addEventListener("keydown", this.onDocumentKeydown);
            } else {
                document.removeEventListener("keydown", this.onDocumentKeydown);
            }
        },

        /**
         * @param {KeyboardEvent} event Keydown anywhere while expanded
         * @returns {void}
         */
        onDocumentKeydown(event) {
            if (event.key === "Escape") {
                this.setExpanded(false);
            }
        },
    },
};
</script>

<style scoped lang="scss">
@import "../styles/vars.scss";

.terminal-wrapper {
    min-height: 150px;
}

.terminal {
    height: 100%;
}

.terminal-toolbar {
    display: flex;
    align-items: center;
    min-height: 28px;
}

.expand-toggle {
    flex: 0 0 auto;
    margin-left: auto;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 6px;
    color: rgba(128, 128, 128, 0.9);
    background-color: transparent;
    transition: color 0.15s, background-color 0.15s;

    &:hover,
    &:focus-visible {
        color: $primary;
        background-color: rgba(128, 128, 128, 0.15);
    }

    &:focus-visible {
        outline: 2px solid $primary;
    }
}

.expanded {
    position: fixed;
    inset: 0;
    // Above the mobile bottom nav (1000) and the header, below modals and toasts
    z-index: 1040;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: calc(12px + env(safe-area-inset-top)) 12px calc(8px + env(safe-area-inset-bottom));
    background-color: $dark-bg;

    .terminal-wrapper {
        flex: 1 1 auto;
        min-height: 0;
    }
}

.terminal-resize-handle {
    flex: 1 1 auto;
    // Keep the grip centred under the terminal despite the button on the right
    margin-left: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: ns-resize;
    touch-action: none;
    user-select: none;

    &:focus-visible {
        outline: 2px solid $primary;
        outline-offset: 2px;
        border-radius: 4px;
    }

    .resize-grip {
        width: 48px;
        height: 5px;
        border-radius: 3px;
        background-color: rgba(128, 128, 128, 0.4);
    }

    &:hover .resize-grip,
    &:focus .resize-grip {
        background-color: rgba(128, 128, 128, 0.7);
    }
}
</style>

<style lang="scss">
body.terminal-expanded {
    overflow: hidden;
}
</style>
