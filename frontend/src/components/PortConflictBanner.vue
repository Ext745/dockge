<template>
    <div v-if="conflicts.length > 0" class="port-conflict-banner" role="alert">
        <div class="banner-head">
            <font-awesome-icon icon="exclamation-circle" class="me-1" />
            <strong>{{ $tc("portConflictsFound", conflicts.length, [ conflicts.length ]) }}</strong>
        </div>
        <ul class="conflict-list">
            <li v-for="c in conflicts" :key="c.endpoint + ':' + c.port">
                <span class="port">{{ c.port }}</span>
                <span class="users">
                    <template v-for="(name, i) in c.stacks" :key="name">
                        <router-link :to="stackUrl({ name, endpoint: c.endpoint === 'current' ? '' : c.endpoint })">{{ name }}</router-link><span v-if="i < c.stacks.length - 1">, </span>
                    </template>
                    <span v-if="showEndpoint" class="endpoint">({{ endpointLabel(c.endpoint) }})</span>
                </span>
            </li>
        </ul>
    </div>
</template>

<script>
import { portConflicts, stackUrl } from "../util-stacks";

/**
 * Lists every host port that more than one running stack publishes, and which stacks they are.
 */
export default {
    computed: {
        conflicts() {
            return portConflicts(Object.values(this.$root.completeStackList));
        },
        showEndpoint() {
            return this.$root.agentCount > 1;
        },
    },
    methods: {
        stackUrl,
        endpointLabel(endpoint) {
            return endpoint === "current" ? this.$t("currentEndpoint") : this.$root.endpointDisplayFunction(endpoint);
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../styles/vars.scss";

.port-conflict-banner {
    border: 1px solid rgba($danger, 0.45);
    background-color: rgba($danger, 0.1);
    color: $danger;
    border-radius: 10px;
    padding: 6px 10px;
    font-size: 13px;
    line-height: 1.35;
}

.banner-head {
    font-size: 13px;
}

.conflict-list {
    list-style: none;
    margin: 2px 0 0;
    padding: 0;

    li {
        display: flex;
        align-items: baseline;
        gap: 6px;
    }

    .port {
        flex: 0 0 auto;
        font-weight: 700;
        font-variant-numeric: tabular-nums;

        &::after {
            content: ":";
        }
    }

    .users {
        min-width: 0;
        overflow-wrap: anywhere;
    }

    a {
        color: inherit;
        text-decoration: underline;
        text-underline-offset: 2px;
    }

    .endpoint {
        margin-left: 4px;
        opacity: 0.7;
    }
}
</style>
