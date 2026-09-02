<template>
    <div class="shadow-box mb-3" :style="boxStyle">
        <div class="list-header">
            <div class="header-top">
                <!-- TODO -->
                <button
                    v-if="false" class="btn btn-outline-normal ms-2" :class="{ 'active': selectMode }" type="button"
                    @click="selectMode = !selectMode"
                >
                    {{ $t("Select") }}
                </button>

                <div class="placeholder"></div>
                <div class="search-wrapper">
                    <a v-if="searchText == ''" class="search-icon">
                        <font-awesome-icon icon="search" />
                    </a>
                    <a v-if="searchText != ''" class="search-icon" style="cursor: pointer" @click="clearSearchText">
                        <font-awesome-icon icon="times" />
                    </a>
                    <form>
                        <input v-model="searchText" class="form-control search-input" autocomplete="off" />
                    </form>
                </div>
                <div class="drift-check-wrapper">
                    <router-link to="/" class="btn btn-normal">
                        <font-awesome-icon icon="code-compare" class="me-1" />
                        {{ $t("driftCheck") }}
                    </router-link>

                    <!-- Category filter dropdown -->
                    <BDropdown variant="link" end auto-close="outside" menu-class="filter-dropdown" toggle-class="filter-icon-container" no-caret>
                        <template #button-content>
                            <font-awesome-icon class="filter-icon" :class="{ 'filter-icon-active': stackFilter.isFilterSelected() }" icon="filter" />
                        </template>

                        <BDropdownItemButton :disabled="!stackFilter.isFilterSelected()" button-class="filter-dropdown-clear" @click="stackFilter.clear()">
                            <font-awesome-icon class="ms-1 me-2" icon="times" />{{ $t("clearFilter") }}
                        </BDropdownItemButton>

                        <BDropdownDivider></BDropdownDivider>

                        <template v-for="category in stackFilter.categories" :key="category.label">
                            <BDropdownGroup v-if="category.hasOptions()" :header="$tc(category.label, 2)">
                                <li v-for="(value, key) in category.options" :key="value" class="filter-option">
                                    <div class="form-check">
                                        <input
                                            :id="`stack-filter-${category.label}-${value}`"
                                            class="form-check-input"
                                            type="checkbox"
                                            :checked="category.selected.has(value)"
                                            @change="category.toggleSelected(value)"
                                        />
                                        <label class="form-check-label" :for="`stack-filter-${category.label}-${value}`">{{ $t(key) }}</label>
                                    </div>
                                </li>
                            </BDropdownGroup>
                        </template>
                    </BDropdown>
                </div>
            </div>

            <!-- TODO: Selection Controls -->
            <div v-if="selectMode && false" class="selection-controls px-2 pt-2">
                <input v-model="selectAll" class="form-check-input select-input" type="checkbox" />

                <button class="btn-outline-normal" @click="pauseDialog">
                    <font-awesome-icon icon="pause" size="sm" /> {{
                        $t("Pause") }}
                </button>
                <button class="btn-outline-normal" @click="resumeSelected">
                    <font-awesome-icon icon="play" size="sm" />
                    {{ $t("Resume") }}
                </button>

                <span v-if="selectedStackCount > 0">
                    {{ $t("selectedStackCount", [selectedStackCount]) }}
                </span>
            </div>
        </div>
        <div ref="stackList" class="stack-list" :class="{ scrollbar: scrollbar }" :style="stackListStyle">
            <div v-if="agentStackList[0] && agentStackList[0].stacks.length === 0" class="text-center mt-3">
                <router-link to="/compose">{{ $t("addFirstStackMsg") }}</router-link>
            </div>
            <div v-for="(agent, agentIndex) in agentStackList" :key="agentIndex" class="stack-list-inner">
                <div
                    v-if="$root.agentCount > 1" class="p-2 agent-select"
                    @click="closedAgents.set(agent.endpoint, !closedAgents.get(agent.endpoint))"
                >
                    <span class="me-1">
                        <font-awesome-icon v-show="closedAgents.get(agent.endpoint)" icon="chevron-circle-right" />
                        <font-awesome-icon v-show="!closedAgents.get(agent.endpoint)" icon="chevron-circle-down" />
                    </span>
                    <span v-if="agent.endpoint === 'current'">{{ $t("currentEndpoint") }}</span>
                    <span v-else>{{ agent.endpoint }}</span>
                </div>
                <StackListItem
                    v-for="(item, index) in agent.stacks"
                    v-show="$root.agentCount === 1 || !closedAgents.get(agent.endpoint)" :key="index" :stack="item" :isSelectMode="selectMode"
                    :isSelected="isSelected" :select="select" :deselect="deselect"
                />
            </div>
        </div>
    </div>

    <Confirm ref="confirmPause" :yes-text="$t('Yes')" :no-text="$t('No')" @yes="pauseSelected">
        {{ $t("pauseStackMsg") }}
    </Confirm>
</template>

<script>
import Confirm from "../components/Confirm.vue";
import StackListItem from "../components/StackListItem.vue";
import { CREATED_FILE, CREATED_STACK, EXITED, RUNNING, StackStatusInfo, UNKNOWN } from "../../../common/util-common";

export default {
    components: {
        Confirm,
        StackListItem,
    },
    props: {
        /** Should the scrollbar be shown */
        scrollbar: {
            type: Boolean,
        },
    },
    data() {
        return {
            searchText: "",
            selectMode: false,
            selectAll: false,
            disableSelectAllWatcher: false,
            selectedStacks: {},
            windowTop: 0,
            closedAgents: new Map(),
        };
    },
    computed: {
        /**
         * Improve the sticky appearance of the list by increasing its
         * height as user scrolls down.
         * Not used on mobile.
         * @returns {object} Style for stack list
         */
        boxStyle() {
            if (window.innerWidth > 550) {
                return {
                    height: `calc(100vh - 160px + ${this.windowTop}px)`,
                };
            } else {
                return {
                    height: "calc(100vh - 160px)",
                };
            }

        },

        stackFilter() {
            return this.$root.stackFilter;
        },

        /**
         * Returns a sorted list of stacks based on the applied filters and search text.
         * @returns {Array} The sorted list of stacks.
         */
        agentStackList() {
            let result = Object.values(this.$root.completeStackList);

            result = result.filter(stack => {
                // filter by search text
                // finds stack name, tag name or tag value
                let searchTextMatch = true;
                if (this.searchText !== "") {
                    const loweredSearchText = this.searchText.toLowerCase();
                    searchTextMatch =
                        stack.name.toLowerCase().includes(loweredSearchText)
                        || stack.tags.find(tag => tag.name.toLowerCase().includes(loweredSearchText)
                            || tag.value?.toLowerCase().includes(loweredSearchText));
                }

                // filter by agent
                let agentMatch = true;
                if (this.stackFilter.agents.isFilterSelected()) {
                    agentMatch = this.stackFilter.agents.selected.has(stack.endpoint);
                }

                // filter by status
                let statusMatch = true;
                if (this.stackFilter.status.isFilterSelected()) {
                    statusMatch = this.stackFilter.status.selected.has(StackStatusInfo.get(stack.status).label);
                }

                return searchTextMatch && agentMatch && statusMatch;
            });

            result.sort((m1, m2) => {

                // sort by managed by dockge
                if (m1.isManagedByDockge && !m2.isManagedByDockge) {
                    return -1;
                } else if (!m1.isManagedByDockge && m2.isManagedByDockge) {
                    return 1;
                }

                // sort by status
                if (m1.status !== m2.status) {
                    if (m2.status === RUNNING) {
                        return 1;
                    } else if (m1.status === RUNNING) {
                        return -1;
                    } else if (m2.status === EXITED) {
                        return 1;
                    } else if (m1.status === EXITED) {
                        return -1;
                    } else if (m2.status === CREATED_STACK) {
                        return 1;
                    } else if (m1.status === CREATED_STACK) {
                        return -1;
                    } else if (m2.status === CREATED_FILE) {
                        return 1;
                    } else if (m1.status === CREATED_FILE) {
                        return -1;
                    } else if (m2.status === UNKNOWN) {
                        return 1;
                    } else if (m1.status === UNKNOWN) {
                        return -1;
                    }
                }
                return m1.name.localeCompare(m2.name);
            });

            // Group stacks by endpoint, sorting them so the local endpoint is first
            // and the rest are sorted alphabetically
            result = [
                ...result.reduce((acc, stack) => {
                    const endpoint = stack.endpoint || "current";
                    if (!acc.has(endpoint)) {
                        acc.set(endpoint, []);
                    }
                    acc.get(endpoint).push(stack);
                    return acc;
                }, new Map()).entries()
            ].map(([ endpoint, stacks ]) => ({
                endpoint,
                stacks
            })).sort((a, b) => {
                if (a.endpoint === "current" && b.endpoint !== "current") {
                    return -1;
                } else if (a.endpoint !== "current" && b.endpoint === "current") {
                    return 1;
                }
                return a.endpoint.localeCompare(b.endpoint);
            });

            return result;
        },

        isDarkTheme() {
            return document.body.classList.contains("dark");
        },

        stackListStyle() {
            //let listHeaderHeight = 107;
            let listHeaderHeight = 60;

            if (this.selectMode) {
                listHeaderHeight += 42;
            }

            return {
                "height": `calc(100% - ${listHeaderHeight}px)`
            };
        },

        selectedStackCount() {
            return Object.keys(this.selectedStacks).length;
        },
    },
    watch: {
        searchText() {
            for (let stack of this.agentStackList) {
                if (!this.selectedStacks[stack.id]) {
                    if (this.selectAll) {
                        this.disableSelectAllWatcher = true;
                        this.selectAll = false;
                    }
                    break;
                }
            }
        },
        selectAll() {
            if (!this.disableSelectAllWatcher) {
                this.selectedStacks = {};

                if (this.selectAll) {
                    this.agentStackList.forEach((item) => {
                        this.selectedStacks[item.id] = true;
                    });
                }
            } else {
                this.disableSelectAllWatcher = false;
            }
        },
        selectMode() {
            if (!this.selectMode) {
                this.selectAll = false;
                this.selectedStacks = {};
            }
        },
    },
    mounted() {
        window.addEventListener("scroll", this.onScroll);
    },
    beforeUnmount() {
        window.removeEventListener("scroll", this.onScroll);
    },
    methods: {
        /**
         * Handle user scroll
         * @returns {void}
         */
        onScroll() {
            if (window.top.scrollY <= 133) {
                this.windowTop = window.top.scrollY;
            } else {
                this.windowTop = 133;
            }
        },

        /**
         * Clear the search bar
         * @returns {void}
         */
        clearSearchText() {
            this.searchText = "";
        },
        /**
         * Deselect a stack
         * @param {number} id ID of stack
         * @returns {void}
         */
        deselect(id) {
            delete this.selectedStacks[id];
        },
        /**
         * Select a stack
         * @param {number} id ID of stack
         * @returns {void}
         */
        select(id) {
            this.selectedStacks[id] = true;
        },
        /**
         * Determine if stack is selected
         * @param {number} id ID of stack
         * @returns {bool} Is the stack selected?
         */
        isSelected(id) {
            return id in this.selectedStacks;
        },
        /**
         * Disable select mode and reset selection
         * @returns {void}
         */
        cancelSelectMode() {
            this.selectMode = false;
            this.selectedStacks = {};
        },
        /**
         * Show dialog to confirm pause
         * @returns {void}
         */
        pauseDialog() {
            this.$refs.confirmPause.show();
        },
        /**
         * Pause each selected stack
         * @returns {void}
         */
        pauseSelected() {
            Object.keys(this.selectedStacks)
                .filter(id => this.$root.stackList[id].active)
                .forEach(id => this.$root.getSocket().emit("pauseStack", id, () => { }));

            this.cancelSelectMode();
        },
        /**
         * Resume each selected stack
         * @returns {void}
         */
        resumeSelected() {
            Object.keys(this.selectedStacks)
                .filter(id => !this.$root.stackList[id].active)
                .forEach(id => this.$root.getSocket().emit("resumeStack", id, () => { }));

            this.cancelSelectMode();
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../styles/vars.scss";

.shadow-box {
    height: calc(100vh - 150px);
    position: sticky;
    top: 10px;
}

.small-padding {
    padding-left: 5px !important;
    padding-right: 5px !important;
}

.list-header {
    border-bottom: 1px solid #dee2e6;
    border-radius: 10px 10px 0 0;
    margin: -10px;
    margin-bottom: 10px;
    padding: 10px;

    .dark & {
        background-color: $dark-header-bg;
        border-bottom: 0;
    }
}

.header-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.drift-check-wrapper {
    display: flex;
    align-items: center;
}

:deep(.filter-icon-container) {
    text-decoration: none;
    padding-right: 0;
}

.filter-icon {
    padding: 10px;
    color: $dark-font-color3 !important;
    cursor: pointer;
    border: 1px solid transparent;
}

.filter-icon-active {
    // darthrater78 has no $info variable (hamphh's has one via Bootstrap's SCSS source,
    // which isn't imported here) - reuse the project's existing accent color instead.
    color: $primary !important;
    border: 1px solid $primary;
    border-radius: 5px;
}

:deep(.filter-dropdown) {
    background-color: $dark-bg;
    border-color: $dark-font-color3;
    color: $dark-font-color;

    .dropdown-header {
        color: $dark-font-color;
        font-weight: bolder;
    }

    .form-check-input {
        border-color: $dark-font-color3;
    }
}

:deep(.filter-dropdown-clear) {
    color: $dark-font-color;

    &:disabled {
        color: $dark-font-color3;
    }

    &:hover {
        background-color: $dark-header-active-bg;
        color: $dark-font-color;
    }
}

.filter-option {
    padding: 0.25rem 1rem;
    list-style: none;
}

@media (max-width: 770px) {
    .list-header {
        margin: -20px;
        margin-bottom: 10px;
        padding: 5px;
    }
}

.search-wrapper {
    display: flex;
    align-items: center;
}

.search-icon {
    padding: 10px;
    color: #c0c0c0;

    // Clear filter button (X)
    svg[data-icon="times"] {
        cursor: pointer;
        transition: all ease-in-out 0.1s;

        &:hover {
            opacity: 0.5;
        }
    }
}

.search-input {
    max-width: 10em;
}

.stack-item {
    width: 100%;
}

.tags {
    margin-top: 4px;
    padding-left: 67px;
    display: flex;
    flex-wrap: wrap;
    gap: 0;
}

.bottom-style {
    padding-left: 67px;
    margin-top: 5px;
}

.selection-controls {
    margin-top: 5px;
    display: flex;
    align-items: center;
    gap: 10px;
}

.agent-select {
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    color: $dark-font-color3;
    padding-left: 10px;
    padding-right: 10px;
    display: flex;
    align-items: center;
    user-select: none;
}
</style>
