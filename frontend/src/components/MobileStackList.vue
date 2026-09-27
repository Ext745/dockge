<template>
    <div class="mobile-stack-list">
        <!-- Search + filters stay pinned under the header while the list scrolls -->
        <div class="list-toolbar">
            <div class="search-row">
                <div class="search-box">
                    <font-awesome-icon icon="search" class="search-glyph" />
                    <input
                        v-model="searchText"
                        type="search"
                        class="form-control"
                        :placeholder="$t('searchStacks')"
                        :aria-label="$t('searchStacks')"
                        autocomplete="off"
                        autocapitalize="off"
                        spellcheck="false"
                        enterkeyhint="search"
                        @keyup.enter="$event.target.blur()"
                    />
                    <button v-if="searchText" type="button" class="clear-search" :aria-label="$t('clearSearch')" @click="searchText = ''">
                        <font-awesome-icon icon="times-circle" />
                    </button>
                </div>
                <router-link to="/overview#drift-check" class="drift-btn" :aria-label="$t('driftCheck')" :title="$t('driftCheck')">
                    <font-awesome-icon icon="code-compare" />
                </router-link>
            </div>

            <div class="filter-chips" role="tablist">
                <button
                    v-for="chip in chips"
                    :key="chip.key"
                    type="button"
                    role="tab"
                    class="chip"
                    :class="[ `chip-${chip.key}`, { selected: filter === chip.key } ]"
                    :aria-selected="filter === chip.key"
                    @click="filter = chip.key"
                >
                    {{ chip.label }} <span class="chip-count">{{ chip.count }}</span>
                </button>
            </div>
        </div>

        <PortConflictBanner class="mb-2" />

        <div v-if="stacks.length === 0" class="empty-state">
            <template v-if="allStacks.length === 0">
                <router-link to="/compose">{{ $t("addFirstStackMsg") }}</router-link>
            </template>
            <template v-else>
                {{ $t("noStacksMatch") }}
            </template>
        </div>

        <!-- One agent: a flat list. Several: a collapsible section per agent, collapsed until opened (or searched) -->
        <section v-for="group in groups" :key="group.endpoint" class="agent-group">
            <button
                v-if="grouped"
                type="button"
                class="agent-header"
                :aria-expanded="isOpen(group.endpoint)"
                @click="toggle(group.endpoint)"
            >
                <font-awesome-icon :icon="isOpen(group.endpoint) ? 'chevron-down' : 'chevron-right'" fixed-width class="me-2" />
                <span class="agent-name">{{ endpointLabel(group.endpoint) }}</span>
                <span v-if="$root.agentStatusList[group.endpoint === 'current' ? '' : group.endpoint] && $root.agentStatusList[group.endpoint === 'current' ? '' : group.endpoint] !== 'online'" class="agent-offline">
                    {{ $root.agentStatusList[group.endpoint === 'current' ? '' : group.endpoint] }}
                </span>
                <span class="agent-counts">
                    <span v-if="group.running > 0" class="running">{{ group.running }}</span>
                    <span>{{ group.stacks.length }}</span>
                </span>
            </button>

            <ul v-show="!grouped || isOpen(group.endpoint)" class="stack-cards">
                <li v-for="stack in group.stacks" :key="stack.name + '_' + stack.endpoint">
                    <router-link :to="stackUrl(stack)" class="stack-card" :class="[ `status-${statusColor(stack.status)}`, { unmanaged: !stack.isManagedByDockge } ]">
                        <span class="status-dot" aria-hidden="true"></span>
                        <span class="card-body">
                            <span class="card-title">
                                <span class="name" :class="{ 'port-conflict': portInfo(stack).hasConflict }">{{ stack.name }}</span>
                            </span>
                            <span class="card-meta">
                                <span class="status-label">{{ $t(statusNameShort(stack.status)) }}</span>
                                <span v-if="!stack.isManagedByDockge" class="meta-item">{{ $t("notManaged") }}</span>
                                <template v-for="port in portInfo(stack).visible" :key="port">
                                    <span class="port" :class="{ conflict: portInfo(stack).conflicts.has(port) }">{{ port }}</span>
                                </template>
                                <span v-if="portInfo(stack).hidden.length > 0" class="port more" :class="{ conflict: portInfo(stack).hiddenConflict }">+{{ portInfo(stack).hidden.length }}</span>
                            </span>
                        </span>
                        <font-awesome-icon icon="chevron-right" class="chevron" />
                    </router-link>
                </li>
            </ul>
        </section>

        <router-link to="/compose" class="fab" :aria-label="$t('compose')">
            <font-awesome-icon icon="plus" />
        </router-link>
    </div>
</template>

<script>
import { CREATED_FILE, CREATED_STACK, EXITED, RUNNING, statusColor, statusNameShort } from "../../../common/util-common";
import PortConflictBanner from "./PortConflictBanner.vue";
import { compareStacks, conflictingPortsByEndpoint, splitPorts, stackPorts, stackUrl } from "../util-stacks";

const MAX_VISIBLE_PORTS = 3;

// Kept across navigation so going back to the list lands where you left it
const remembered = {
    searchText: "",
    filter: "all",
    scrollY: 0,
    openAgents: new Set(),
};

const FILTERS = {
    all: () => true,
    running: (s) => s.status === RUNNING,
    exited: (s) => s.status === EXITED,
    inactive: (s) => s.status === CREATED_FILE || s.status === CREATED_STACK,
};

/**
 * Mobile home: find a stack fast. Search and status filters on top, one tappable card per stack.
 */
export default {
    components: {
        PortConflictBanner,
    },
    data() {
        return {
            searchText: remembered.searchText,
            filter: remembered.filter,
            openAgents: new Set(remembered.openAgents),
        };
    },

    computed: {
        allStacks() {
            return Object.values(this.$root.completeStackList);
        },

        conflictMap() {
            return conflictingPortsByEndpoint(this.allStacks);
        },

        // Port split and conflict flags per stack, computed once per change rather than per render call
        portInfoByStack() {
            const info = new Map();
            for (const stack of this.allStacks) {
                const conflicts = this.conflictMap[stack.endpoint || "current"] ?? new Set();
                const ports = stackPorts(stack);
                const { visible, hidden } = splitPorts(ports, conflicts, MAX_VISIBLE_PORTS);
                info.set(stack, {
                    conflicts,
                    visible,
                    hidden,
                    hiddenConflict: hidden.some(port => conflicts.has(port)),
                    hasConflict: stack.status === RUNNING && ports.some(port => conflicts.has(port)),
                });
            }
            return info;
        },

        searchedStacks() {
            const q = this.searchText.trim().toLowerCase();
            if (!q) {
                return this.allStacks;
            }
            return this.allStacks.filter(stack =>
                stack.name.toLowerCase().includes(q)
                || (stack.endpoint || "").toLowerCase().includes(q)
                || stackPorts(stack).some(port => port.startsWith(q))
            );
        },

        stacks() {
            return this.searchedStacks
                .filter(stack => this.matchesFilter(stack, this.filter))
                .sort(compareStacks);
        },

        grouped() {
            return this.$root.agentCount > 1;
        },

        // Stacks per agent, the local one first, then by name
        groups() {
            const byEndpoint = new Map();
            for (const stack of this.stacks) {
                const endpoint = stack.endpoint || "current";
                if (!byEndpoint.has(endpoint)) {
                    byEndpoint.set(endpoint, []);
                }
                byEndpoint.get(endpoint).push(stack);
            }
            return [ ...byEndpoint.entries() ]
                .map(([ endpoint, stacks ]) => ({
                    endpoint,
                    stacks,
                    running: stacks.filter(s => s.status === RUNNING).length,
                }))
                .sort((a, b) => {
                    if (a.endpoint === "current" || b.endpoint === "current") {
                        return a.endpoint === "current" ? -1 : 1;
                    }
                    return a.endpoint.localeCompare(b.endpoint);
                });
        },

        chips() {
            const count = (key) => this.searchedStacks.filter(stack => this.matchesFilter(stack, key)).length;
            const chips = [
                { key: "all", label: this.$t("all") },
                { key: "running", label: this.$t("active") },
                { key: "exited", label: this.$t("exited") },
                { key: "inactive", label: this.$t("inactive") },
                { key: "conflicts", label: this.$t("portConflicts") },
            ].map(chip => ({ ...chip, count: count(chip.key) }));

            // Only offer the conflicts chip when there is something to show (or it is the active filter)
            return chips.filter(chip => chip.key !== "conflicts" || chip.count > 0 || this.filter === "conflicts");
        },
    },

    watch: {
        searchText(value) {
            remembered.searchText = value;
        },
        filter(value) {
            remembered.filter = value;
        },
        openAgents(value) {
            remembered.openAgents = value;
        },
    },

    mounted() {
        this.$nextTick(() => window.scrollTo(0, remembered.scrollY));
    },

    beforeUnmount() {
        remembered.scrollY = window.scrollY;
    },

    methods: {
        statusColor,
        statusNameShort,
        stackUrl,

        portInfo(stack) {
            return this.portInfoByStack.get(stack);
        },

        matchesFilter(stack, key) {
            if (key === "conflicts") {
                return this.portInfo(stack).hasConflict;
            }
            return (FILTERS[key] ?? FILTERS.all)(stack);
        },

        endpointLabel(endpoint) {
            return endpoint && endpoint !== "current" ? this.$root.endpointDisplayFunction(endpoint) : this.$t("currentEndpoint");
        },

        // A search or a filter other than "all" opens every section, so matches are never hidden
        isOpen(endpoint) {
            return this.searchText.trim() !== "" || this.filter !== "all" || this.openAgents.has(endpoint);
        },

        toggle(endpoint) {
            const open = new Set(this.openAgents);
            if (this.isOpen(endpoint) && open.has(endpoint)) {
                open.delete(endpoint);
            } else {
                open.add(endpoint);
            }
            this.openAgents = open;
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../styles/vars.scss";

.mobile-stack-list {
    padding-bottom: calc(88px + env(safe-area-inset-bottom));
}

.list-toolbar {
    position: sticky;
    top: var(--mobile-header-height, 56px);
    z-index: 10;
    margin: 0 -12px;
    padding: 8px 12px 6px;
    background-color: var(--page-bg);
}

.search-row {
    display: flex;
    gap: 8px;

    .search-box {
        flex: 1 1 auto;
        min-width: 0;
    }
}

.drift-btn {
    flex: 0 0 auto;
    width: 46px;
    height: 46px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 12px;
    border: 1px solid var(--card-border);
    background-color: var(--card-bg);
    color: inherit;
    font-size: 18px;
}

.search-box {
    position: relative;

    .search-glyph {
        position: absolute;
        left: 14px;
        top: 50%;
        transform: translateY(-50%);
        color: #9aa0a6;
        pointer-events: none;
    }

    input {
        height: 46px;
        padding-left: 40px;
        padding-right: 44px;
        border-radius: 12px;
        font-size: 16px; // 16px stops iOS zooming into the field
    }

    // Our own clear button replaces the native one
    input::-webkit-search-cancel-button {
        -webkit-appearance: none;
    }

    .clear-search {
        position: absolute;
        right: 4px;
        top: 50%;
        transform: translateY(-50%);
        width: 40px;
        height: 40px;
        border: none;
        background: transparent;
        color: #9aa0a6;
    }
}

.filter-chips {
    display: flex;
    gap: 8px;
    margin-top: 10px;
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;

    &::-webkit-scrollbar {
        display: none;
    }
}

.chip {
    flex: 0 0 auto;
    height: 34px;
    padding: 0 14px;
    border-radius: 17px;
    border: 1px solid rgba(128, 128, 128, 0.3);
    background: transparent;
    color: inherit;
    font-size: 14px;
    text-transform: capitalize;
    white-space: nowrap;

    .chip-count {
        margin-left: 4px;
        opacity: 0.6;
        font-variant-numeric: tabular-nums;
    }

    &.selected {
        background-color: $primary;
        border-color: $primary;
        color: $dark-font-color2;
        font-weight: 600;

        .chip-count {
            opacity: 0.8;
        }
    }

    &.chip-conflicts:not(.selected) {
        border-color: rgba($danger, 0.6);
        color: $danger;
    }
}

.empty-state {
    padding: 40px 16px;
    text-align: center;
    opacity: 0.7;
}

.agent-group + .agent-group {
    margin-top: 8px;
}

.agent-header {
    display: flex;
    align-items: center;
    width: 100%;
    min-height: 48px;
    padding: 0 12px;
    margin-bottom: 8px;
    border: 1px solid var(--card-border);
    border-radius: 12px;
    background-color: var(--card-bg);
    color: inherit;
    font-weight: 600;
    text-align: left;

    .agent-name {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .agent-offline {
        margin-right: 8px;
        font-size: 12px;
        color: $danger;
    }

    .agent-counts {
        display: flex;
        gap: 6px;
        font-size: 13px;
        font-variant-numeric: tabular-nums;

        span {
            padding: 1px 8px;
            border-radius: 10px;
            background-color: rgba(128, 128, 128, 0.15);
        }

        .running {
            color: $primary;
            background-color: rgba($primary, 0.15);
        }
    }
}

.stack-cards {
    list-style: none;
    margin: 4px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.stack-card {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 64px;
    padding: 10px 12px 10px 14px;
    border-radius: 12px;
    background-color: var(--card-bg);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
    color: inherit;
    text-decoration: none;
    -webkit-tap-highlight-color: transparent;

    &:active {
        transform: scale(0.99);
        filter: brightness(0.96);
    }

    &.unmanaged {
        opacity: 0.6;
    }

    .status-dot {
        flex: 0 0 auto;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background-color: #6c757d;
    }

    &.status-primary .status-dot {
        background-color: $primary;
        box-shadow: 0 0 0 4px rgba($primary, 0.2);
    }

    &.status-danger .status-dot {
        background-color: $danger;
    }

    &.status-dark .status-dot {
        background-color: transparent;
        border: 2px solid #6c757d;
    }

    .card-body {
        flex: 1 1 auto;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .card-title .name {
        display: block;
        font-size: 16px;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .card-meta {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px 8px;
        font-size: 12px;
        opacity: 0.85;
    }

    .status-label {
        text-transform: capitalize;
        font-weight: 600;
    }

    &.status-primary .status-label {
        color: $primary;
    }

    &.status-danger .status-label {
        color: $danger;
    }

    .meta-item {
        opacity: 0.8;
    }

    .port {
        padding: 1px 6px;
        border-radius: 4px;
        background-color: rgba(128, 128, 128, 0.15);
        font-variant-numeric: tabular-nums;

        &.conflict {
            background-color: rgba($danger, 0.18);
            color: $danger;
            font-weight: 600;
        }
    }

    .chevron {
        flex: 0 0 auto;
        opacity: 0.35;
    }
}

.port-conflict {
    color: $danger;
}

.fab {
    position: fixed;
    right: 18px;
    bottom: calc(18px + env(safe-area-inset-bottom));
    z-index: 900;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 22px;
    color: $dark-font-color2;
    background: $primary-gradient;
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.25);
    text-decoration: none;
}
</style>
