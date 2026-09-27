<template>
    <div class="shadow-box terminal-box">
        <div v-pre ref="terminal" class="main-terminal"></div>
        <button
            class="copy-all-btn"
            type="button"
            :title="$t('copyAllToClipboard')"
            @click="copyAllToClipboard"
        >
            <font-awesome-icon icon="copy" />
        </button>
    </div>
</template>

<script>
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
import { TERMINAL_COLS, TERMINAL_ROWS } from "../../../common/util-common";

export default {
    /**
     * @type {Terminal}
     */
    terminal: null,
    components: {
        FontAwesomeIcon,
    },
    props: {
        name: {
            type: String,
            required: true,
        },

        endpoint: {
            type: String,
            required: true,
        },

        // Require if mode is interactive
        stackName: {
            type: String,
            default: "",
        },

        // Require if mode is interactive
        serviceName: {
            type: String,
            default: "",
        },

        // Require if mode is interactive
        shell: {
            type: String,
            default: "bash",
        },

        rows: {
            type: Number,
            default: TERMINAL_ROWS,
        },

        cols: {
            type: Number,
            default: TERMINAL_COLS,
        },

        // Mode
        // displayOnly: Only display terminal output
        // mainTerminal: Free input and output for the Dockge host console (raw keystrokes to the shell)
        // interactive: Free input and output (creates a container exec terminal)
        // progress: Display output for an existing server-side operation,
        //           but still forward keystrokes so the user can answer
        //           interactive prompts (e.g. "[y/N]") or press Ctrl+C.
        mode: {
            type: String,
            default: "displayOnly",
        }
    },
    emits: [ "has-data" ],
    data() {
        return {
            first: true,
        };
    },
    created() {

    },
    mounted() {
        let cursorBlink = true;

        if (this.mode === "displayOnly") {
            cursorBlink = false;
        }

        this.terminal = new Terminal({
            fontSize: 14,
            fontFamily: "'JetBrains Mono', monospace",
            cursorBlink,
            cols: this.cols,
            rows: this.rows,
        });

        if (this.mode === "mainTerminal" || this.mode === "interactive" || this.mode === "progress") {
            this.interactiveTerminalConfig();
        }

        //this.terminal.loadAddon(new WebLinksAddon());

        // Bind to a div
        this.terminal.open(this.$refs.terminal);
        this.terminal.focus();

        // Add right-click context menu handler for paste
        this.$refs.terminal.addEventListener("contextmenu", this.handleContextMenu);

        // Add selection handler for copy to clipboard
        this.terminal.onSelectionChange(() => {
            this.handleSelection();
        });

        // Notify parent component when data is received
        this.terminal.onCursorMove(() => {
            console.debug("onData triggered");
            if (this.first) {
                this.$emit("has-data");
                this.first = false;
            }
        });

        this.bind();

        // Create a new Terminal
        if (this.mode === "mainTerminal") {
            this.$root.emitAgent(this.endpoint, "mainTerminal", this.name, (res) => {
                if (!res.ok) {
                    this.$root.toastRes(res);
                    return;
                }
                this.resyncSize();
            });
        } else if (this.mode === "interactive") {
            console.debug("Create Interactive terminal:", this.name);
            this.$root.emitAgent(this.endpoint, "interactiveTerminal", this.stackName, this.serviceName, this.shell, (res) => {
                if (!res.ok) {
                    this.$root.toastRes(res);
                    return;
                }
                this.resyncSize();
            });
        }
        // Fit the terminal width to the div container size after terminal is created.
        this.updateTerminalSize();
        this.remeasureAfterFontLoad();
    },

    unmounted() {
        this.isUnmounted = true;
        this.resizeObserver?.disconnect();
        if (this.fitRaf) {
            cancelAnimationFrame(this.fitRaf);
        }
        this.$root.unbindTerminal(this.name);
        this.terminal.dispose();
        this.$refs.terminal?.removeEventListener("contextmenu", this.handleContextMenu);
    },

    methods: {
        bind(endpoint, name) {
            // Workaround: normally this.name should be set, but it is not sometimes, so we use the parameter, but eventually this.name and name must be the same name
            if (name) {
                this.$root.unbindTerminal(name);
                this.$root.bindTerminal(endpoint, name, this.terminal);
                console.debug("Terminal bound via parameter: " + name);
            } else if (this.name) {
                this.$root.unbindTerminal(this.name);
                this.$root.bindTerminal(this.endpoint, this.name, this.terminal);
                console.debug("Terminal bound: " + this.name);
            } else {
                console.debug("Terminal name not set");
            }
        },

        clearTerminal() {
            this.terminal.clear();
        },

        interactiveTerminalConfig() {
            this.terminal.onKey(e => {
                // Handle Ctrl+V for paste
                if (e.key === "\u0016" || (e.domEvent?.ctrlKey && e.key.toLowerCase() === "v")) {
                    this.handlePaste();
                    return;
                }

                this.$root.emitAgent(this.endpoint, "terminalInput", this.name, e.key, (res) => {
                    // In "progress" mode the server-side terminal disappears once
                    // the operation finishes, so ignore "terminal not found"
                    // errors that happen when the user keeps typing afterwards.
                    if (!res.ok && this.mode !== "progress") {
                        this.$root.toastRes(res);
                    }
                });
            });
        },

        /**
         * Fit the terminal to its container and keep it fitted.
         *
         * On first call, loads the fit addon and starts a ResizeObserver on the container, so any
         * size change (window resize, drag handle, expand toggle, layout reflow) refits xterm.
         * @returns {void}
         */
        updateTerminalSize() {
            if (!this.terminalFitAddOn) {
                this.terminalFitAddOn = new FitAddon();
                this.terminal.loadAddon(this.terminalFitAddOn);
                this.resizeObserver = new ResizeObserver(() => this.scheduleFit());
                this.resizeObserver.observe(this.$refs.terminal);
            }
            this.fitAndSync();
        },

        /**
         * xterm measures its cell size when it opens, which is usually before the web font has loaded, and
         * does not measure again on its own. The font then renders taller than the measured cells, so the
         * grid overflows its box and the newest lines are hidden below the bottom edge. Once the font is in,
         * re-apply it (xterm only re-measures when the option changes) and refit.
         * @returns {void}
         */
        remeasureAfterFontLoad() {
            if (!document.fonts) {
                return;
            }
            document.fonts.load(`${this.terminal.options.fontSize}px 'JetBrains Mono'`).then(() => {
                if (this.isUnmounted) {
                    return;
                }
                const fontFamily = this.terminal.options.fontFamily;
                this.terminal.options.fontFamily = "monospace";
                this.terminal.options.fontFamily = fontFamily;
                this.scheduleFit();
            }).catch(() => {
                // Font unavailable: xterm keeps the fallback font it already measured
            });
        },

        /**
         * Coalesce bursts of resize notifications into one fit per animation frame.
         * @returns {void}
         */
        scheduleFit() {
            if (this.fitRaf) {
                return;
            }
            this.fitRaf = requestAnimationFrame(() => {
                this.fitRaf = null;
                this.fitAndSync();
            });
        },

        /**
         * Re-send the current size, e.g. once the server has created the pty and can accept it.
         * @returns {void}
         */
        resyncSize() {
            this.syncedRows = undefined;
            this.syncedCols = undefined;
            this.fitAndSync();
        },

        /**
         * Fit xterm to the container and, if the grid size changed, tell the server so the pty matches.
         * @returns {void}
         */
        fitAndSync() {
            // A hidden container (v-show, collapsed panel) has no size to fit to
            if (!this.$refs.terminal?.offsetParent) {
                return;
            }
            this.terminalFitAddOn.fit();
            const { rows, cols } = this.terminal;
            if (rows === this.syncedRows && cols === this.syncedCols) {
                return;
            }
            this.syncedRows = rows;
            this.syncedCols = cols;
            this.$root.emitAgent(this.endpoint, "terminalResize", this.name, rows, cols);
        },

        /**
         * Handle clipboard paste operation
         */
        async handlePaste() {
            try {
                const text = await navigator.clipboard.readText();
                if (text) {
                    this.pasteText(text);
                }
            } catch (error) {
                console.error("Failed to read from clipboard:", error);
            }
        },

        /**
         * Paste text into the terminal based on current mode
         */
        pasteText(text) {
            if (this.mode === "mainTerminal" || this.mode === "interactive") {
                // Send directly to the server-side shell
                this.$root.emitAgent(this.endpoint, "terminalInput", this.name, text, (res) => {
                    if (!res.ok) {
                        this.$root.toastRes(res);
                    }
                });
            }
        },

        /**
         * Handle right-click context menu for paste operation
         */
        handleContextMenu(event) {
            // Prevent default context menu
            event.preventDefault();

            // Only handle paste for modes that support input
            if (this.mode === "mainTerminal" || this.mode === "interactive") {
                this.handlePaste();
            }
        },

        /**
         * Handle text selection in terminal - copy to clipboard
         */
        handleSelection() {
            const selectedText = this.terminal.getSelection();
            if (selectedText && selectedText.length > 0) {
                this.copyToClipboard(selectedText);
            }
        },

        /**
         * Copy text to clipboard. navigator.clipboard only exists in a
         * secure context (HTTPS or localhost) - a Dockge instance reached
         * over plain HTTP on a LAN IP (the common self-hosted case) has no
         * Clipboard API at all, so fall back to the legacy
         * document.execCommand("copy") trick, which still works over HTTP.
         * @param {string} text Text to copy
         * @returns {Promise<boolean>} Whether the copy succeeded
         */
        async copyToClipboard(text) {
            if (navigator.clipboard?.writeText) {
                try {
                    await navigator.clipboard.writeText(text);
                    console.debug("Text copied to clipboard:", text);
                    return true;
                } catch (error) {
                    console.error("navigator.clipboard.writeText failed, falling back:", error);
                }
            }

            if (this.legacyCopyToClipboard(text)) {
                return true;
            }

            console.error("Failed to copy to clipboard: no working method available (requires HTTPS or localhost for the modern Clipboard API)");
            this.$root.toastError(this.$t("clipboardCopyFailed"));
            return false;
        },

        /**
         * Copy the terminal's full scrollback to the clipboard (the
         * bottom-right "copy all" button), with a success toast - unlike
         * copyToClipboard()'s other caller (select-to-copy), an explicit
         * button click should give visible confirmation.
         */
        async copyAllToClipboard() {
            const ok = await this.copyToClipboard(this.getPlainTextContent());
            if (ok) {
                this.$root.toastSuccess(this.$t("copiedToClipboard"));
            }
        },

        /**
         * Fallback copy method for non-secure contexts. Returns true on
         * success.
         * @param {string} text Text to copy
         * @returns {boolean} Whether the copy succeeded
         */
        legacyCopyToClipboard(text) {
            const textarea = document.createElement("textarea");
            textarea.value = text;
            // Keep it out of the visible layout/flow without display:none,
            // which some browsers refuse to select() text from.
            textarea.style.position = "fixed";
            textarea.style.top = "0";
            textarea.style.left = "0";
            textarea.style.opacity = "0";
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();

            let success = false;
            try {
                success = document.execCommand("copy");
            } catch (error) {
                console.error("document.execCommand('copy') failed:", error);
            }

            document.body.removeChild(textarea);
            return success;
        },

        /**
         * Read the terminal's full scrollback (not just what's currently
         * visible in the viewport) as plain text. Rows that are just the
         * soft-wrapped continuation of a long line (line.isWrapped) are
         * re-joined so wrapping at the terminal's column width doesn't
         * fragment the original output into extra lines.
         * @returns {string} Terminal content, one line per logical line
         */
        getPlainTextContent() {
            const buffer = this.terminal.buffer.active;
            const lines = [];
            for (let i = 0; i < buffer.length; i++) {
                const line = buffer.getLine(i);
                if (!line) {
                    continue;
                }
                const text = line.translateToString(true);
                if (line.isWrapped && lines.length > 0) {
                    lines[lines.length - 1] += text;
                } else {
                    lines.push(text);
                }
            }
            return lines.join("\n");
        },

        /**
         * Save the terminal's full output as a local .log file.
         */
        downloadLog() {
            const content = this.getPlainTextContent();
            const blob = new Blob([ content ], { type: "text/plain" });
            const url = URL.createObjectURL(blob);
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
            const a = document.createElement("a");
            a.href = url;
            a.download = `${this.name || "terminal"}-${timestamp}.log`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        },
    }
};
</script>

<style scoped lang="scss">
.terminal-box {
    position: relative;
}

.main-terminal {
    height: 100%;
}

.copy-all-btn {
    position: absolute;
    right: 8px;
    bottom: 8px;
    z-index: 5;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    border-radius: 4px;
    background-color: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.45);
    transition: background-color 0.15s ease, color 0.15s ease;

    &:hover,
    &:focus-visible {
        background-color: rgba(255, 255, 255, 0.18);
        color: #fff;
    }
}
</style>

<style lang="scss">
.terminal {
    background-color: black !important;
    height: 100%;
}
</style>
