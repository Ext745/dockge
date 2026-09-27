<template>
    <router-link :to="url" :class="{ 'dim' : !stack.isManagedByDockge }" class="item">
        <Uptime :stack="stack" :fixed-width="true" class="me-2" />
        <div class="title-and-ports">
            <span class="title" :class="{ 'port-conflict': hasPortConflict }">{{ stackName }}</span>
            <span v-if="orderedPorts.length > 0" ref="ports" class="ports">
                <span ref="portLabel" class="port-label" :class="{ 'port-conflict': hasPortConflict }">Configured Ports:</span>
                <span v-for="port in displayPorts" :key="port" ref="portBadges" class="badge port-badge" :class="{ 'port-conflict-badge': conflictingPorts.has(port) }">{{ port }}</span>
                <span v-if="hiddenPorts.length > 0" class="badge port-badge port-overflow" :class="{ 'port-conflict-badge': hiddenConflict }" :title="hiddenPorts.join(', ')">+{{ hiddenPorts.length }}</span>
            </span>
            <span v-else-if="isRunning" class="ports">
                <span class="badge host-badge">HOST</span>
            </span>
        </div>
    </router-link>
</template>

<script>
import Uptime from "./Uptime.vue";
import { RUNNING } from "../../../common/util-common";
import { splitPorts, stackPorts, stackUrl } from "../util-stacks";

// Gap between badges (matches .ports gap) and room kept for the "+N" badge
const PORT_GAP = 3;
const OVERFLOW_BADGE_WIDTH = 28;

export default {
    components: {
        Uptime
    },
    props: {
        /** Stack this represents */
        stack: {
            type: Object,
            default: null,
        },
        /** If the user is in select mode */
        isSelectMode: {
            type: Boolean,
            default: false,
        },
        /** How many ancestors are above this stack */
        depth: {
            type: Number,
            default: 0,
        },
        /** Callback to determine if stack is selected */
        isSelected: {
            type: Function,
            default: () => {}
        },
        /** Callback fired when stack is selected */
        select: {
            type: Function,
            default: () => {}
        },
        /** Callback fired when stack is deselected */
        deselect: {
            type: Function,
            default: () => {}
        },
        /** Set of port numbers that conflict across stacks */
        conflictingPorts: {
            type: Set,
            default: () => new Set(),
        },
    },
    data() {
        return {
            isCollapsed: true,
            // How many port badges fit; null = not measured yet (render all to measure)
            fitCount: null,
        };
    },
    computed: {
        endpointDisplay() {
            return this.$root.endpointDisplayFunction(this.stack.endpoint);
        },
        url() {
            return stackUrl(this.stack);
        },
        depthMargin() {
            return {
                marginLeft: `${31 * this.depth}px`,
            };
        },
        stackName() {
            return this.stack.name;
        },
        portList() {
            return stackPorts(this.stack);
        },
        // Conflicting ports sort first, so a conflict is never hidden behind "+N"
        orderedPorts() {
            return splitPorts(this.portList, this.conflictingPorts, Infinity).visible;
        },
        // As many as fit on one line at the current pane width (all of them until measured)
        displayPorts() {
            return this.orderedPorts.slice(0, this.fitCount ?? this.orderedPorts.length);
        },
        hiddenPorts() {
            return this.orderedPorts.slice(this.displayPorts.length);
        },
        hiddenConflict() {
            return this.hiddenPorts.some(port => this.conflictingPorts.has(port));
        },
        isRunning() {
            return this.stack?.status === RUNNING;
        },
        hasPortConflict() {
            return this.portList.some(port => this.conflictingPorts.has(port));
        }
    },
    watch: {
        // A different set or order of badges needs measuring again
        orderedPorts(to, from) {
            if (to.join() !== from.join()) {
                this.measurePorts();
            }
        },
        isSelectMode() {
            // TODO: Resize the heartbeat bar, but too slow
            // this.$refs.heartbeatBar.resize();
        }
    },
    mounted() {
        this.badgeWidths = [];
        this.labelWidth = 0;
        this.resizeObserver = new ResizeObserver(() => this.fitPorts());
        this.resizeObserver.observe(this.$el);
        this.measurePorts();
    },
    beforeUnmount() {
        this.resizeObserver?.disconnect();
    },
    methods: {
        /**
         * Render every badge once, record their widths, then fit them to the available width.
         * Widths are cached, so resizing the pane only re-runs fitPorts().
         * @returns {void}
         */
        measurePorts() {
            this.fitCount = null;
            this.$nextTick(() => {
                const badges = this.$refs.portBadges ?? [];
                this.badgeWidths = badges.map(el => el.offsetWidth);
                this.labelWidth = this.$refs.portLabel?.offsetWidth ?? 0;
                this.fitPorts();
            });
        },

        /**
         * Show as many badges as fit on one line, keeping room for "+N" when some are hidden.
         * @returns {void}
         */
        fitPorts() {
            const container = this.$refs.ports;
            const total = this.badgeWidths.length;
            if (!container || total === 0) {
                return;
            }
            const available = container.clientWidth - this.labelWidth - PORT_GAP;
            let used = 0;
            let count = 0;
            for (let i = 0; i < total; i++) {
                const next = used + this.badgeWidths[i] + PORT_GAP;
                const reserve = i < total - 1 ? OVERFLOW_BADGE_WIDTH + PORT_GAP : 0;
                if (next + reserve > available) {
                    break;
                }
                used = next;
                count++;
            }
            this.fitCount = count;
        },

        /**
         * Changes the collapsed value of the current stack and saves
         * it to local storage
         * @returns {void}
         */
        changeCollapsed() {
            this.isCollapsed = !this.isCollapsed;

            // Save collapsed value into local storage
            let storage = window.localStorage.getItem("stackCollapsed");
            let storageObject = {};
            if (storage !== null) {
                storageObject = JSON.parse(storage);
            }
            storageObject[`stack_${this.stack.id}`] = this.isCollapsed;

            window.localStorage.setItem("stackCollapsed", JSON.stringify(storageObject));
        },

        /**
         * Toggle selection of stack
         * @returns {void}
         */
        toggleSelection() {
            if (this.isSelected(this.stack.id)) {
                this.deselect(this.stack.id);
            } else {
                this.select(this.stack.id);
            }
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../styles/vars.scss";

.small-padding {
    padding-left: 5px !important;
    padding-right: 5px !important;
}

.collapse-padding {
    padding-left: 8px !important;
    padding-right: 2px !important;
}

.item {
    text-decoration: none;
    display: flex;
    align-items: center;
    min-height: 52px;
    border-radius: 10px;
    transition: all ease-in-out 0.15s;
    width: 100%;
    padding: 5px 8px;
    &.disabled {
        opacity: 0.3;
    }
    &:hover {
        background-color: $highlight-white;
    }
    &.active {
        background-color: #cdf8f4;
    }
    .title-and-ports {
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        min-width: 0;

        .title {
            margin-top: -4px;
            font-size: 0.95rem;
            font-weight: 600;
        }

        .ports {
            display: flex;
            flex-wrap: nowrap;
            overflow: hidden;
            gap: 3px;
            margin-top: 2px;
        }
    }
    .endpoint {
        font-size: 12px;
        color: $dark-font-color3;
    }
}

.port-label {
    flex: 0 0 auto;
    white-space: nowrap;
    font-size: 0.7rem;
    font-weight: 600;
    color: $primary;
    align-self: center;
}

.port-badge {
    flex: 0 0 auto;
    font-size: 0.7rem;
    font-weight: 500;
    padding: 2px 6px;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    background-color: rgba(116, 194, 255, 0.15);
    color: $primary;
}

.port-overflow {
    opacity: 0.7;
}

.port-conflict {
    color: $danger !important;
}

.port-conflict-badge {
    background-color: rgba($danger, 0.15) !important;
    color: $danger !important;
}

.host-badge {
    font-size: 0.7rem;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 4px;
    background-color: rgba($warning, 0.15);
    color: $warning;
}

.collapsed {
    transform: rotate(-90deg);
}

.animated {
    transition: all 0.2s $easing-in;
}

.select-input-wrapper {
    float: left;
    margin-top: 15px;
    margin-left: 3px;
    margin-right: 10px;
    padding-left: 4px;
    position: relative;
    z-index: 15;
}

.dim {
    opacity: 0.5;
}

</style>
