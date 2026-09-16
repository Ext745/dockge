<template>
    <div class="container-fluid">
        <button
            v-if="$root.isMobile"
            class="btn btn-normal w-100 mb-2 d-flex justify-content-between align-items-center"
            @click="showMobileStackList = !showMobileStackList"
        >
            <span><font-awesome-icon icon="server" class="me-2" />{{ $t("stackList") }}</span>
            <font-awesome-icon :icon="showMobileStackList ? 'chevron-up' : 'chevron-down'" />
        </button>

        <div class="row">
            <div v-if="!$root.isMobile || showMobileStackList" class="col-12 col-md-4 col-xl-3">
                <div>
                    <router-link to="/compose" class="btn btn-primary mb-3"><font-awesome-icon icon="plus" /> {{ $t("compose") }}</router-link>
                </div>
                <StackList :scrollbar="true" />
            </div>

            <div ref="container" class="col-12 col-md-8 col-xl-9 mb-3">
                <!-- Add :key to disable vue router re-use the same component -->
                <router-view :key="$route.fullPath" :calculatedHeight="height" />
            </div>
        </div>
    </div>
</template>

<script>

import StackList from "../components/StackList.vue";

export default {
    components: {
        StackList,
    },
    data() {
        return {
            height: 0,
            showMobileStackList: false,
        };
    },
    mounted() {
        this.height = this.$refs.container.offsetHeight;
    },
};
</script>

<style lang="scss" scoped>
.container-fluid {
    width: 98%;
}
</style>
