<template>
    <div :class="classes">
        <div v-if="! $root.socketIO.connected && ! $root.socketIO.firstConnect" class="lost-connection">
            <div class="container-fluid">
                {{ $root.socketIO.connectionErrorMsg }}
                <div v-if="$root.socketIO.showReverseProxyGuide">
                    {{ $t("reverseProxyMsg1") }} <a href="https://github.com/louislam/uptime-kuma/wiki/Reverse-Proxy" target="_blank">{{ $t("reverseProxyMsg2") }}</a>
                </div>
            </div>
        </div>

        <!-- Desktop header -->
        <header v-if="! $root.isMobile" class="d-flex flex-wrap justify-content-center py-3 mb-3 border-bottom">
            <router-link to="/" class="d-flex align-items-center mb-3 mb-md-0 me-md-auto text-dark text-decoration-none">
                <object class="bi me-2 ms-4" width="40" height="40" data="/icon.svg" />
                <span class="fs-4 title">Dockge</span>
            </router-link>

            <a v-if="hasNewVersion" target="_blank" rel="noopener noreferrer" href="https://github.com/Ext745/dockge/releases/latest" class="btn btn-warning me-3">
                <font-awesome-icon icon="arrow-alt-circle-up" /> {{ $t("newUpdate") }}
            </a>

            <ul class="nav nav-pills">
                <li v-if="$root.loggedIn" class="nav-item me-2">
                    <router-link to="/" class="nav-link">
                        <font-awesome-icon icon="home" /> {{ $t("home") }}
                    </router-link>
                </li>

                <li v-if="$root.loggedIn" class="nav-item me-2">
                    <router-link to="/console" class="nav-link">
                        <font-awesome-icon icon="terminal" /> {{ $t("console") }}
                    </router-link>
                </li>

                <li v-if="$root.loggedIn" class="nav-item">
                    <div class="dropdown dropdown-profile-pic">
                        <div class="nav-link" data-bs-toggle="dropdown">
                            <div class="profile-pic">{{ $root.usernameFirstChar }}</div>
                            <font-awesome-icon icon="angle-down" />
                        </div>

                        <!-- Header's Dropdown Menu -->
                        <ul class="dropdown-menu">
                            <!-- Username -->
                            <li>
                                <i18n-t v-if="$root.username != null" tag="span" keypath="signedInDisp" class="dropdown-item-text">
                                    <strong>{{ $root.username }}</strong>
                                </i18n-t>
                                <span v-if="$root.username == null" class="dropdown-item-text">{{ $t("signedInDispDisabled") }}</span>
                            </li>

                            <li><hr class="dropdown-divider"></li>

                            <!-- Functions -->

                            <!--<li>
                                <router-link to="/registry" class="dropdown-item" :class="{ active: $route.path.includes('settings') }">
                                    <font-awesome-icon icon="warehouse" /> {{ $t("registry") }}
                                </router-link>
                            </li>-->

                            <li>
                                <button class="dropdown-item" @click="scanFolder">
                                    <font-awesome-icon icon="arrows-rotate" /> {{ $t("scanFolder") }}
                                </button>
                            </li>

                            <li>
                                <router-link to="/settings/general" class="dropdown-item" :class="{ active: $route.path.includes('settings') }">
                                    <font-awesome-icon icon="cog" /> {{ $t("Settings") }}
                                </router-link>
                            </li>

                            <li>
                                <button class="dropdown-item" @click="$root.logout">
                                    <font-awesome-icon icon="sign-out-alt" />
                                    {{ $t("Logout") }}
                                </button>
                            </li>
                        </ul>
                    </div>
                </li>
            </ul>
        </header>

        <!-- Mobile header: hidden on stack pages, which bring their own back/actions bar -->
        <header v-else-if="! mobileStackPage" class="mobile-header">
            <router-link to="/" class="brand">
                <object width="28" height="28" data="/icon.svg" />
                <span class="title">Dockge</span>
            </router-link>

            <div class="header-actions">
                <a v-if="hasNewVersion" target="_blank" rel="noopener noreferrer" href="https://github.com/Ext745/dockge/releases/latest" class="icon-btn text-warning" :aria-label="$t('newUpdate')">
                    <font-awesome-icon icon="arrow-alt-circle-up" />
                </a>
                <button v-if="$root.loggedIn" type="button" class="icon-btn" :aria-label="$t('menu')" :aria-expanded="menuOpen" @click="menuOpen = true">
                    <font-awesome-icon icon="bars" />
                </button>
            </div>
        </header>

        <!-- Mobile menu sheet -->
        <transition name="sheet">
            <div v-if="$root.isMobile && menuOpen" class="menu-backdrop" @click.self="menuOpen = false">
                <nav class="menu-sheet" :aria-label="$t('menu')">
                    <div class="sheet-grip"></div>
                    <div v-if="$root.username" class="sheet-user">
                        <div class="profile-pic">{{ $root.usernameFirstChar }}</div>
                        <span>{{ $root.username }}</span>
                    </div>
                    <router-link to="/" class="sheet-item" @click="menuOpen = false">
                        <font-awesome-icon icon="server" fixed-width /> {{ $t("stackList") }}
                    </router-link>
                    <router-link to="/overview" class="sheet-item" @click="menuOpen = false">
                        <font-awesome-icon icon="home" fixed-width /> {{ $t("overview") }}
                    </router-link>
                    <router-link to="/overview#drift-check" class="sheet-item" @click="menuOpen = false">
                        <font-awesome-icon icon="code-compare" fixed-width /> {{ $t("driftCheck") }}
                    </router-link>
                    <router-link to="/console" class="sheet-item" @click="menuOpen = false">
                        <font-awesome-icon icon="terminal" fixed-width /> {{ $t("console") }}
                    </router-link>
                    <router-link to="/settings/general" class="sheet-item" @click="menuOpen = false">
                        <font-awesome-icon icon="cog" fixed-width /> {{ $t("Settings") }}
                    </router-link>
                    <button type="button" class="sheet-item" @click="scanFolder(); menuOpen = false">
                        <font-awesome-icon icon="arrows-rotate" fixed-width /> {{ $t("scanFolder") }}
                    </button>
                    <button type="button" class="sheet-item" @click="menuOpen = false; $root.logout()">
                        <font-awesome-icon icon="sign-out-alt" fixed-width /> {{ $t("Logout") }}
                    </button>
                </nav>
            </div>
        </transition>

        <main>
            <div v-if="$root.socketIO.connecting" class="container mt-5">
                <h4>{{ $t("connecting...") }}</h4>
            </div>

            <router-view v-if="$root.loggedIn" />
            <Login v-if="! $root.loggedIn && $root.allowLoginDialog" />
        </main>
    </div>
</template>

<script>
import Login from "../components/Login.vue";
import { compareVersions } from "compare-versions";
import { ALL_ENDPOINTS } from "../../../common/util-common";

export default {

    components: {
        Login,
    },

    data() {
        return {
            menuOpen: false,
        };
    },

    computed: {

        // Theme or Mobile
        classes() {
            const classes = {};
            classes[this.$root.theme] = true;
            classes["mobile"] = this.$root.isMobile;
            return classes;
        },

        // Stack pages (and container terminals) on mobile render their own top bar
        mobileStackPage() {
            return this.$root.isMobile && (this.$route.path.startsWith("/compose") || this.$route.path.startsWith("/terminal"));
        },

        hasNewVersion() {
            if (this.$root.info.latestVersion && this.$root.info.version) {
                return compareVersions(this.$root.info.latestVersion, this.$root.info.version) >= 1;
            } else {
                return false;
            }
        },

    },

    watch: {
        $route() {
            this.menuOpen = false;
        },
    },

    mounted() {

    },

    beforeUnmount() {

    },

    methods: {
        scanFolder() {
            this.$root.emitAgent(ALL_ENDPOINTS, "requestStackList", (res) => {
                this.$root.toastRes(res);
            });
        },
    },

};
</script>

<style lang="scss" scoped>
@import "../styles/vars.scss";

.nav-link {
    &.status-page {
        background-color: rgba(255, 255, 255, 0.1);
    }
}

main {
    min-height: calc(100vh - 160px);
}

.mobile main {
    min-height: 0;
}

.mobile-header {
    position: sticky;
    top: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: calc(56px + env(safe-area-inset-top));
    padding: env(safe-area-inset-top) 8px 0 16px;
    background-color: var(--bar-bg);
    backdrop-filter: saturate(180%) blur(12px);
    -webkit-backdrop-filter: saturate(180%) blur(12px);
    border-bottom: 1px solid var(--card-border);

    .brand {
        display: flex;
        align-items: center;
        gap: 8px;
        color: inherit;
        text-decoration: none;
        font-size: 1.15rem;

        // The <object> logo would otherwise swallow taps meant for the home link
        object {
            pointer-events: none;
        }
    }

    .header-actions {
        display: flex;
        align-items: center;
    }
}

.icon-btn {
    width: 44px;
    height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 12px;
    background: transparent;
    color: inherit;
    font-size: 20px;

    &:active {
        background-color: rgba(128, 128, 128, 0.15);
    }
}

.menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1050;
    background-color: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: flex-end;
}

.menu-sheet {
    width: 100%;
    padding: 8px 12px calc(16px + env(safe-area-inset-bottom));
    border-radius: 18px 18px 0 0;
    background-color: var(--card-bg);
    display: flex;
    flex-direction: column;

    .sheet-grip {
        align-self: center;
        width: 40px;
        height: 5px;
        border-radius: 3px;
        margin-bottom: 8px;
        background-color: rgba(128, 128, 128, 0.4);
    }

    .sheet-user {
        .profile-pic {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            color: white;
            background-color: $primary;
            font-weight: bold;
        }

        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 12px 12px;
        font-weight: 600;
        border-bottom: 1px solid var(--card-border);
        margin-bottom: 4px;
    }

    .sheet-item {
        display: flex;
        align-items: center;
        gap: 14px;
        min-height: 52px;
        padding: 0 12px;
        border: none;
        border-radius: 10px;
        background: transparent;
        color: inherit;
        text-align: left;
        text-decoration: none;
        font-size: 16px;

        &.router-link-exact-active {
            color: $primary;
            font-weight: 600;
        }

        &:active {
            background-color: rgba(128, 128, 128, 0.15);
        }
    }
}

.sheet-enter-active, .sheet-leave-active {
    transition: opacity 0.2s;

    .menu-sheet {
        transition: transform 0.2s $easing-out;
    }
}

.sheet-enter-from, .sheet-leave-to {
    opacity: 0;

    .menu-sheet {
        transform: translateY(100%);
    }
}

.title {
    font-weight: bold;
}

.nav {
    margin-right: 25px;
}

.lost-connection {
    padding: 5px;
    background-color: crimson;
    color: white;
    position: fixed;
    width: 100%;
    z-index: 99999;
}

// Profile Pic Button with Dropdown
.dropdown-profile-pic {
    user-select: none;

    .nav-link {
        cursor: pointer;
        display: flex;
        gap: 6px;
        align-items: center;
        background-color: rgba(200, 200, 200, 0.2);
        padding: 0.5rem 0.8rem;

        &:hover {
            background-color: rgba(255, 255, 255, 0.2);
        }
    }

    .dropdown-menu {
        transition: all 0.2s;
        padding-left: 0;
        padding-bottom: 0;
        margin-top: 8px !important;
        border-radius: 16px;
        overflow: hidden;

        .dropdown-divider {
            margin: 0;
            border-top: 1px solid rgba(0, 0, 0, 0.4);
            background-color: transparent;
        }

        .dropdown-item-text {
            font-size: 14px;
            padding-bottom: 0.7rem;
        }

        .dropdown-item {
            padding: 0.7rem 1rem;
        }

        .dark & {
            background-color: $dark-bg;
            color: $dark-font-color;
            border-color: $dark-border-color;

            .dropdown-item {
                color: $dark-font-color;

                &.active {
                    color: $dark-font-color2;
                    background-color: $highlight !important;
                }

                &:hover {
                    background-color: $dark-bg2;
                }
            }
        }
    }

    .profile-pic {
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        background-color: $primary;
        width: 24px;
        height: 24px;
        margin-right: 5px;
        border-radius: 50rem;
        font-weight: bold;
        font-size: 10px;
    }
}

.dark {
    header {
        background-color: $dark-header-bg;
        border-bottom-color: $dark-header-bg !important;

        span {
            color: #f0f6fc;
        }
    }

}
</style>
