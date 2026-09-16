import { defineComponent } from "vue";

const STORAGE_KEY = "dockge-terminal-height";
const MIN_HEIGHT = 200;
const MAX_HEIGHT = 1200;
const DEFAULT_HEIGHT = 410;
const KEYBOARD_STEP = 20;

/**
 * Adds a draggable resize handle to a page that embeds a <Terminal ref="resizableTerminal">.
 * The chosen height is remembered per-browser via localStorage.
 */
export default defineComponent({
    data() {
        return {
            terminalHeight: DEFAULT_HEIGHT,
            resizing: false,
        };
    },

    created() {
        try {
            const saved = parseInt(localStorage.getItem(STORAGE_KEY) ?? "", 10);
            if (!Number.isNaN(saved) && saved >= MIN_HEIGHT && saved <= MAX_HEIGHT) {
                this.terminalHeight = saved;
            }
        } catch (e) {
            // localStorage may be unavailable (private browsing, disabled storage, etc.)
        }
    },

    beforeUnmount() {
        this.stopResize();
    },

    methods: {
        /**
         * Begin a drag/touch resize of the terminal panel.
         * @param {MouseEvent | TouchEvent} event Pointer-down event on the resize handle
         * @returns {void}
         */
        startResize(event: MouseEvent | TouchEvent) {
            event.preventDefault();
            this.resizing = true;
            this.resizeStartY = "touches" in event ? event.touches[0].clientY : event.clientY;
            this.resizeStartHeight = this.terminalHeight;

            window.addEventListener("mousemove", this.onResize);
            window.addEventListener("mouseup", this.stopResize);
            window.addEventListener("touchmove", this.onResize, { passive: false });
            window.addEventListener("touchend", this.stopResize);
        },

        /**
         * Track pointer movement while dragging the resize handle.
         * @param {MouseEvent | TouchEvent} event Pointer-move event
         * @returns {void}
         */
        onResize(event: MouseEvent | TouchEvent) {
            if (!this.resizing) {
                return;
            }
            event.preventDefault();

            const clientY = "touches" in event ? event.touches[0].clientY : event.clientY;
            const delta = clientY - this.resizeStartY;
            this.terminalHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, this.resizeStartHeight + delta));

            if (!this.resizeRaf) {
                this.resizeRaf = requestAnimationFrame(() => {
                    this.resizeRaf = null;
                    this.fitTerminal();
                });
            }
        },

        /**
         * End the drag/touch resize and persist the chosen height.
         * @returns {void}
         */
        stopResize() {
            if (!this.resizing) {
                return;
            }
            this.resizing = false;

            window.removeEventListener("mousemove", this.onResize);
            window.removeEventListener("mouseup", this.stopResize);
            window.removeEventListener("touchmove", this.onResize);
            window.removeEventListener("touchend", this.stopResize);

            if (this.resizeRaf) {
                cancelAnimationFrame(this.resizeRaf);
                this.resizeRaf = null;
            }

            try {
                localStorage.setItem(STORAGE_KEY, String(this.terminalHeight));
            } catch (e) {
                // localStorage may be unavailable (private browsing, disabled storage, etc.)
            }
        },

        /**
         * Allow resizing the terminal via the keyboard when the handle is focused.
         * @param {KeyboardEvent} event Keydown event on the resize handle
         * @returns {void}
         */
        onHandleKeydown(event: KeyboardEvent) {
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
                return;
            }
            event.preventDefault();
            const direction = event.key === "ArrowUp" ? -1 : 1;
            this.terminalHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, this.terminalHeight + direction * KEYBOARD_STEP));
            this.fitTerminal();
            try {
                localStorage.setItem(STORAGE_KEY, String(this.terminalHeight));
            } catch (e) {
                // localStorage may be unavailable (private browsing, disabled storage, etc.)
            }
        },

        /**
         * Ask the embedded Terminal component to fit xterm to its (now resized) container.
         * @returns {void}
         */
        fitTerminal() {
            const terminalRef = this.$refs.resizableTerminal as { updateTerminalSize?: () => void } | undefined;
            terminalRef?.updateTerminalSize?.();
        },
    },
});
