<template>
    <transition name="slide-fade" appear>
        <div :class="{ 'mobile-stack-page': $root.isMobile, 'has-action-bar': showActionBar }">
            <!-- Mobile: back / title / more-actions bar, then section tabs -->
            <template v-if="$root.isMobile">
                <div class="m-topbar">
                    <button type="button" class="m-icon-btn" :aria-label="$t('back')" @click="$router.push('/')">
                        <font-awesome-icon icon="arrow-left" />
                    </button>
                    <div class="m-title">
                        <div class="m-name">{{ isAdd ? $t("compose") : stack.name }}</div>
                        <div v-if="!isAdd" class="m-sub">
                            <Uptime :stack="globalStack" :pill="true" />
                            <span v-if="$root.agentCount > 1 && endpoint !== ''" class="agent-name">{{ endpointDisplay }}</span>
                        </div>
                    </div>
                    <BDropdown v-if="!isAdd && stack.isManagedByDockge && !isEditMode" variant="link" no-caret end toggle-class="m-icon-btn" :aria-label="$t('moreActions')">
                        <template #button-content>
                            <font-awesome-icon icon="ellipsis-vertical" />
                        </template>
                        <BDropdownItem :disabled="processing" @click="updateStack">
                            <font-awesome-icon icon="cloud-arrow-down" fixed-width class="me-2" />{{ $t("updateStack") }}
                        </BDropdownItem>
                        <BDropdownItem v-if="active" :disabled="versionScanLoading" @click="scanVersionSync(); mobileTab = 'overview'">
                            <font-awesome-icon icon="code-compare" fixed-width class="me-2" />{{ $t("driftCheck") }}
                        </BDropdownItem>
                        <BDropdownItem :disabled="processing" @click="downStack">
                            <font-awesome-icon icon="stop" fixed-width class="me-2" />{{ $t("downStack") }}
                        </BDropdownItem>
                        <BDropdownDivider />
                        <BDropdownItem variant="danger" :disabled="processing" @click="showDeleteDialog = true">
                            <font-awesome-icon icon="trash" fixed-width class="me-2" />{{ $t("deleteStack") }}
                        </BDropdownItem>
                    </BDropdown>
                </div>

                <div v-if="stack.isManagedByDockge" class="m-tabs" role="tablist">
                    <button
                        v-for="tab in mobileTabs" :key="tab.key" type="button" role="tab"
                        :aria-selected="mobileTab === tab.key" :class="{ selected: mobileTab === tab.key }"
                        @click="mobileTab = tab.key"
                    >
                        <font-awesome-icon :icon="tab.icon" class="me-1" />{{ tab.label }}
                        <span v-if="tab.key === 'logs' && processing && !isAdd" class="busy-dot" aria-hidden="true"></span>
                    </button>
                </div>
            </template>

            <h1 v-if="isAdd && !$root.isMobile" class="mb-3">{{ $t("compose") }}</h1>
            <h1 v-else-if="!$root.isMobile" class="mb-3">
                <Uptime :stack="globalStack" :pill="true" /> {{ stack.name }}
                <span v-if="$root.agentCount > 1 && endpoint !== ''" class="agent-name">
                    ({{ endpointDisplay }})
                </span>
            </h1>

            <div v-if="stack.isManagedByDockge && !$root.isMobile" class="stack-actions mb-3">
                <div class="btn-group" role="group">
                    <button v-if="isEditMode" class="btn btn-primary" :disabled="processing" @click="deployStack">
                        <font-awesome-icon icon="rocket" class="me-1" />
                        {{ $t("deployStack") }}
                    </button>

                    <button v-if="isEditMode" class="btn btn-normal" :disabled="processing" @click="saveStack">
                        <font-awesome-icon icon="save" class="me-1" />
                        {{ $t("saveStackDraft") }}
                    </button>

                    <button v-if="!isEditMode" class="btn btn-secondary" :disabled="processing" @click="enableEditMode">
                        <font-awesome-icon icon="pen" class="me-1" />
                        {{ $t("editStack") }}
                    </button>

                    <button v-if="!isEditMode && !active" class="btn btn-primary" :disabled="processing" @click="startStack">
                        <font-awesome-icon icon="play" class="me-1" />
                        {{ $t("startStack") }}
                    </button>

                    <button v-if="!isEditMode && active" class="btn btn-normal " :disabled="processing" @click="restartStack">
                        <font-awesome-icon icon="rotate" class="me-1" />
                        {{ $t("restartStack") }}
                    </button>

                    <button v-if="!isEditMode" class="btn btn-normal" :disabled="processing" @click="updateStack">
                        <font-awesome-icon icon="cloud-arrow-down" class="me-1" />
                        {{ $t("updateStack") }}
                    </button>

                    <button v-if="!isEditMode && active" class="btn btn-normal" :disabled="processing" @click="stopStack">
                        <font-awesome-icon icon="stop" class="me-1" />
                        {{ $t("stopStack") }}
                    </button>

                    <BDropdown right text="" variant="normal">
                        <BDropdownItem @click="downStack">
                            <font-awesome-icon icon="stop" class="me-1" />
                            {{ $t("downStack") }}
                        </BDropdownItem>
                        <BDropdownItem v-if="!isEditMode && transferTargets.length > 0" :disabled="processing || transferring" @click="openTransferDialog">
                            <font-awesome-icon icon="right-left" class="me-1" />
                            {{ $t("transferStack") }}
                        </BDropdownItem>
                        <BDropdownItem v-if="!isEditMode" variant="danger" :disabled="processing" @click="showDeleteDialog = !showDeleteDialog">
                            <font-awesome-icon icon="trash" class="me-1" />
                            {{ $t("deleteStack") }}
                        </BDropdownItem>
                    </BDropdown>
                </div>

                <button v-if="isEditMode && !isAdd" class="btn btn-normal" :disabled="processing" @click="discardStack">{{ $t("discardStack") }}</button>

                <button v-if="!isEditMode && !isAdd && active" class="btn btn-normal" :disabled="versionScanLoading" @click="scanVersionSync">
                    <font-awesome-icon icon="code-compare" class="me-1" />
                    {{ $t("driftCheck") }}
                </button>
            </div>

            <!-- Mobile: which agent this stack lives on -->
            <div v-if="$root.isMobile && $root.agentCount > 1 && !isAdd" v-show="show('overview')" class="stack-agent mb-2">
                <font-awesome-icon icon="server" class="me-2" />{{ $tc("dockgeAgent", 1) }}: <strong>{{ endpoint ? endpointDisplay : $t("currentEndpoint") }}</strong>
            </div>

            <!-- URLs -->
            <div v-if="urls.length > 0" v-show="show('overview')" class="mb-3 stack-urls">
                <a v-for="(urlItem, index) in urls" :key="index" target="_blank" :href="urlItem.url">
                    <span class="badge bg-secondary me-2">{{ urlItem.display }}</span>
                </a>
            </div>

            <!-- Version Sync Mismatches -->
            <transition name="slide-fade" appear>
                <div v-if="showVersionSync" v-show="show('overview')" class="mb-3 shadow-box big-padding version-sync">
                    <div class="d-flex align-items-center mb-2">
                        <h5 class="mb-0 me-auto">
                            <font-awesome-icon icon="code-compare" class="me-1" />
                            {{ $t("driftCheck") }}
                        </h5>
                        <button class="btn btn-sm btn-normal" @click="showVersionSync = false">
                            <font-awesome-icon icon="times" />
                        </button>
                    </div>
                    <div v-if="versionScanLoading" class="text-muted">
                        {{ $t("scanning") }}...
                    </div>
                    <div v-else-if="versionMismatches.length === 0" class="text-muted">
                        {{ $t("noVersionMismatches") }}
                    </div>
                    <div v-else>
                        <div class="mb-2 text-muted small">{{ $t("versionMismatchesFound", [ versionMismatches.length ]) }}</div>
                        <table class="table table-sm mb-2">
                            <thead>
                                <tr>
                                    <th>{{ $t("service") }}</th>
                                    <th>{{ $t("composeImage") }}</th>
                                    <th>{{ $t("runningImage") }}</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="m in versionMismatches" :key="m.service">
                                    <td>{{ m.service }}</td>
                                    <td><code class="text-danger">{{ m.composeImage }}</code></td>
                                    <td><code class="text-success">{{ m.runningImage }}</code></td>
                                    <td>
                                        <button class="btn btn-sm btn-primary" :disabled="versionSyncLoading" @click="syncVersion(m)">
                                            <font-awesome-icon icon="arrows-rotate" class="me-1" />
                                            {{ $t("sync") }}
                                        </button>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                        <button v-if="versionMismatches.length > 1" class="btn btn-primary btn-sm" :disabled="versionSyncLoading" @click="syncAllVersions">
                            <font-awesome-icon icon="arrows-rotate" class="me-1" />
                            {{ $t("syncAll") }}
                        </button>
                    </div>
                </div>
            </transition>

            <!-- Progress Terminal -->
            <ProgressTerminal v-show="show('logs')" ref="progressTerminal" :name="terminalName" :endpoint="endpoint" />

            <div v-if="stack.isManagedByDockge" class="row">
                <div class="col-lg-6" :class="{ 'order-last': $root.isMobile && mobileTab === 'compose' }">
                    <!-- General -->
                    <div v-if="isAdd" v-show="show('overview')">
                        <h4 class="mb-3">{{ $t("general") }}</h4>
                        <div class="shadow-box big-padding mb-3">
                            <!-- Stack Name -->
                            <div>
                                <label for="name" class="form-label">{{ $t("stackName") }}</label>
                                <input id="name" v-model="stack.name" type="text" class="form-control" required @blur="stackNameToLowercase">
                                <div class="form-text">{{ $t("Lowercase only") }}</div>
                            </div>

                            <!-- Endpoint -->
                            <div class="mt-3">
                                <label for="name" class="form-label">{{ $t("dockgeAgent") }}</label>
                                <select v-model="stack.endpoint" class="form-select">
                                    <option v-for="(agent, agentEndpoint) in $root.agentList" :key="agentEndpoint" :value="agentEndpoint" :disabled="$root.agentStatusList[agentEndpoint] != 'online'">
                                        ({{ $root.agentStatusList[agentEndpoint] }}) {{ (agent.name !== '') ? agent.name : agent.url || $t("Current") }}
                                    </option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <!-- Containers -->
                    <div v-show="show('overview')">
                        <h4 class="mb-3">{{ $tc("container", 2) }}</h4>

                        <div v-if="isEditMode" class="input-group mb-3">
                            <input
                                v-model="newContainerName"
                                :placeholder="$t(`New Container Name...`)"
                                class="form-control"
                                @keyup.enter="addContainer"
                            />
                            <button class="btn btn-primary" @click="addContainer">
                                {{ $t("addContainer") }}
                            </button>
                        </div>

                        <div ref="containerList">
                            <Container
                                v-for="(service, name) in jsonConfig.services"
                                :key="name"
                                :name="name"
                                :is-edit-mode="isEditMode"
                                :first="name === Object.keys(jsonConfig.services)[0]"
                                :serviceStatus="serviceStatusList[name]"
                                :dockerStats="dockerStats"
                                @start-service="startService"
                                @stop-service="stopService"
                                @restart-service="restartService"
                            />
                        </div>

                        <button v-if="false && isEditMode && jsonConfig.services && Object.keys(jsonConfig.services).length > 0" class="btn btn-normal mb-3" @click="addContainer">{{ $t("addContainer") }}</button>
                    </div>

                    <!-- General -->
                    <div v-if="isEditMode" v-show="show('compose')">
                        <h4 class="mb-3">{{ $t("extra") }}</h4>
                        <div class="shadow-box big-padding mb-3">
                            <!-- URLs -->
                            <div class="mb-4">
                                <label class="form-label">
                                    {{ $tc("url", 2) }}
                                </label>
                                <ArrayInput name="urls" :display-name="$t('url')" placeholder="https://" object-type="x-dockge" />
                            </div>
                        </div>
                    </div>

                    <!-- Combined Terminal Output -->
                    <div v-show="$root.isMobile ? show('logs') && !isAdd : !isEditMode">
                        <div class="d-flex justify-content-between align-items-center mb-3">
                            <h4 v-if="!$root.isMobile" class="mb-0">{{ $t("terminal") }}</h4>
                            <button class="btn btn-normal btn-sm ms-auto" @click="$refs.combinedTerminal.$refs.terminal.downloadLog()">
                                <font-awesome-icon icon="download" class="me-1" />
                                {{ $t("downloadLog") }}
                            </button>
                        </div>
                        <TerminalPanel
                            ref="combinedTerminal"
                            storage-key="dockge-stack-terminal-height"
                            :default-height="315"
                            :fill-height="$root.isMobile ? mobileTerminalHeight : null"
                            :name="combinedTerminalName"
                            :endpoint="endpoint"
                            :rows="combinedTerminalRows"
                            :cols="combinedTerminalCols"
                        />
                    </div>
                </div>
                <div v-show="show('compose')" class="col-lg-6">
                    <!-- Override YAML editor (only show if file exists) -->
                    <div v-if="stack.composeOverrideYAML && stack.composeOverrideYAML.trim() !== ''">
                        <h4 class="mb-3">{{ stack.composeOverrideFileName || 'compose.override.yaml' }}</h4>
                        <div class="shadow-box mb-3 editor-box" :class="{'edit-mode' : isEditMode}">
                            <button v-if="isEditMode" v-b-modal.compose-override-editor-modal class="expand-button">
                                <font-awesome-icon icon="expand" />
                            </button>
                            <code-mirror
                                ref="overrideEditor"
                                v-model="stack.composeOverrideYAML"
                                :extensions="extensions"
                                minimal
                                wrap="true"
                                dark="true"
                                tab="true"
                                :disabled="!isEditMode"
                                :hasFocus="editorFocus"
                                @change="yamlCodeChange"
                            />
                        </div>
                        <div v-if="isEditMode" class="mb-3">
                            {{ yamlError }}
                        </div>

                        <!-- Override modal fullscreen editor (CodeMirror) -->
                        <BModal
                            id="compose-override-editor-modal" :title="stack.composeOverrideFileName || 'compose.override.yaml'"
                            scrollable size="fullscreen" hide-footer
                        >
                            <div class="shadow-box mb-3 editor-box" :class="{'edit-mode' : isEditMode}">
                                <code-mirror
                                    ref="editorModal"
                                    v-model="stack.composeOverrideYAML"
                                    :extensions="extensions"
                                    minimal
                                    wrap="true"
                                    dark="true"
                                    tab="true"
                                    :disabled="!isEditMode"
                                    :hasFocus="editorFocus"
                                    @change="yamlCodeChange"
                                />
                            </div>
                            <div v-if="isEditMode" class="mb-3">
                                {{ yamlError }}
                            </div>
                        </BModal>
                    </div>

                    <div class="d-flex flex-wrap align-items-center gap-2 mb-3">
                        <h4 class="mb-0 me-auto">{{ stack.composeFileName }}</h4>
                        <template v-if="isEditMode">
                            <div class="form-check mb-0">
                                <input id="formatOnSave" v-model="formatOnSave" class="form-check-input" type="checkbox">
                                <label class="form-check-label" for="formatOnSave">{{ $t("formatOnSave") }}</label>
                            </div>
                            <button type="button" class="btn btn-normal btn-sm" :title="$t('formatYAMLHint')" @click="formatCompose(false)">
                                <font-awesome-icon icon="wand-magic-sparkles" class="me-1" />
                                {{ $t("formatYAML") }}
                            </button>
                        </template>
                    </div>

                    <!-- YAML editor -->
                    <div class="shadow-box mb-3 editor-box" :class="{'edit-mode' : isEditMode}">
                        <button v-if="isEditMode" v-b-modal.compose-editor-modal class="expand-button">
                            <font-awesome-icon icon="expand" />
                        </button>
                        <code-mirror
                            ref="editor"
                            v-model="stack.composeYAML"
                            :extensions="extensions"
                            minimal
                            wrap="true"
                            dark="true"
                            tab="true"
                            :disabled="!isEditMode"
                            :hasFocus="editorFocus"
                            @change="yamlCodeChange"
                        />
                    </div>
                    <div v-if="isEditMode" class="mb-3">
                        {{ yamlError }}
                    </div>

                    <!-- Primary compose.yaml fullscreen editor (CodeMirror) -->
                    <BModal
                        id="compose-editor-modal" :title="stack.composeFileName"
                        scrollable size="fullscreen" hide-footer
                    >
                        <div class="shadow-box mb-3 editor-box" :class="{'edit-mode' : isEditMode}">
                            <code-mirror
                                ref="composeEditorModal"
                                v-model="stack.composeYAML"
                                :extensions="extensions"
                                minimal
                                wrap="true"
                                dark="true"
                                tab="true"
                                :disabled="!isEditMode"
                                :hasFocus="editorFocus"
                                @change="yamlCodeChange"
                            />
                        </div>
                        <div v-if="isEditMode" class="mb-3">
                            {{ yamlError }}
                        </div>
                    </BModal>

                    <!-- ENV editor -->
                    <div v-if="isEditMode">
                        <h4 class="mb-3">.env</h4>
                        <div class="shadow-box mb-3 editor-box" :class="{'edit-mode' : isEditMode}">
                            <code-mirror
                                ref="editor"
                                v-model="stack.composeENV"
                                :extensions="extensionsEnv"
                                minimal
                                wrap="true"
                                dark="true"
                                tab="true"
                                :disabled="!isEditMode"
                                :hasFocus="editorFocus"
                                @change="yamlCodeChange"
                            />
                        </div>
                    </div>

                    <div v-if="isEditMode">
                        <!-- Volumes -->
                        <div v-if="false">
                            <h4 class="mb-3">{{ $tc("volume", 2) }}</h4>
                            <div class="shadow-box big-padding mb-3">
                            </div>
                        </div>

                        <!-- Networks -->
                        <h4 class="mb-3">{{ $tc("network", 2) }}</h4>
                        <div class="shadow-box big-padding mb-3">
                            <NetworkInput />
                        </div>
                    </div>

                    <!-- <div class="shadow-box big-padding mb-3">
                        <div class="mb-3">
                            <label for="name" class="form-label"> Search Templates</label>
                            <input id="name" v-model="name" type="text" class="form-control" placeholder="Search..." required>
                        </div>

                        <prism-editor v-if="false" v-model="yamlConfig" class="yaml-editor" :highlight="highlighter" line-numbers @input="yamlCodeChange"></prism-editor>
                    </div>-->
                </div>
            </div>

            <div v-if="!stack.isManagedByDockge && !processing" class="unmanaged-msg">
                {{ $t("stackNotManagedByDockgeMsg") }}
            </div>

            <!-- Mobile: primary actions within thumb reach -->
            <nav v-if="showActionBar" class="m-action-bar">
                <template v-if="isEditMode">
                    <button type="button" class="m-action primary" :disabled="processing" @click="deployStack">
                        <font-awesome-icon icon="rocket" /><span>{{ $t("deployStack") }}</span>
                    </button>
                    <button type="button" class="m-action" :disabled="processing" @click="saveStack">
                        <font-awesome-icon icon="save" /><span>{{ $t("saveStackDraft") }}</span>
                    </button>
                    <button v-if="!isAdd" type="button" class="m-action" :disabled="processing" @click="discardStack">
                        <font-awesome-icon icon="undo" /><span>{{ $t("discardStack") }}</span>
                    </button>
                </template>
                <template v-else>
                    <button v-if="!active" type="button" class="m-action primary" :disabled="processing" @click="startStack">
                        <font-awesome-icon icon="play" /><span>{{ $t("startStack") }}</span>
                    </button>
                    <button v-if="active" type="button" class="m-action" :disabled="processing" @click="restartStack">
                        <font-awesome-icon icon="rotate" /><span>{{ $t("restartStack") }}</span>
                    </button>
                    <button v-if="active" type="button" class="m-action" :disabled="processing" @click="stopStack">
                        <font-awesome-icon icon="stop" /><span>{{ $t("stopStack") }}</span>
                    </button>
                    <button type="button" class="m-action" :disabled="processing" @click="updateStack">
                        <font-awesome-icon icon="cloud-arrow-down" /><span>{{ $t("updateStack") }}</span>
                    </button>
                    <button type="button" class="m-action" :disabled="processing" @click="enableEditMode">
                        <font-awesome-icon icon="pen" /><span>{{ $t("editStack") }}</span>
                    </button>
                </template>
            </nav>

            <!-- Port conflict check before Save / Deploy -->
            <BModal v-model="showPortConflictDialog" :title="$t('portInUseTitle')" :cancelTitle="$t('cancel')" :okTitle="$t(pendingPortAction === 'deploy' ? 'deployAnyway' : 'saveAnyway')" okVariant="warning" @ok="runPendingPortAction">
                <p>{{ $t("portInUseIntro") }}</p>
                <ul class="ps-3">
                    <li v-for="c in portConflictList" :key="c.port">
                        <strong>{{ c.port }}</strong>:
                        <template v-for="(user, i) in c.users" :key="user.name">
                            {{ user.name }} ({{ $t(user.kind === "container" ? "portUserContainer" : user.running ? "portUserRunning" : "portUserStopped") }})<span v-if="i < c.users.length - 1">, </span>
                        </template>
                    </li>
                </ul>
                <p class="mb-0 small">{{ $t("portInUseHint") }}</p>
            </BModal>

            <BModal v-model="showComposeInvalidDialog" :title="$t('composeInvalidTitle')" :cancelTitle="$t('cancel')" :okTitle="$t(pendingValidateAction === 'save' ? 'saveAnyway' : 'close')" :okOnly="pendingValidateAction !== 'save'" okVariant="warning" @ok="continueAfterInvalid">
                <p>{{ $t(pendingValidateAction === "save" ? "composeInvalidSaveIntro" : "composeInvalidDeployIntro") }}</p>
                <pre class="compose-invalid-message mb-0">{{ composeInvalidMessage }}</pre>
            </BModal>

            <!-- Delete Dialog -->
            <BModal v-model="showDeleteDialog" :cancelTitle="$t('cancel')" :okTitle="$t('deleteStack')" okVariant="danger" @ok="deleteDialog">
                {{ $t("deleteStackMsg") }}
            </BModal>

            <!-- Transfer Dialog -->
            <BModal v-model="showTransferDialog" :cancelTitle="$t('cancel')" :okTitle="$t('transferStack')" okVariant="primary" :okDisabled="!transferTarget || transferring || (namedVolumesInUse.length > 0 && !transferAckDataLoss)" @ok.prevent="confirmTransfer">
                <p>{{ $t("transferStackMsg") }}</p>

                <div v-if="namedVolumesInUse.length > 0" class="alert alert-warning shadow-box">
                    <p class="mb-2">
                        <font-awesome-icon icon="exclamation-circle" class="me-1" />
                        {{ $t("transferVolumeWarning", [ namedVolumesInUse.join(", ") ]) }}
                    </p>
                    <div class="form-check">
                        <input id="transferAckDataLoss" v-model="transferAckDataLoss" type="checkbox" class="form-check-input">
                        <label class="form-check-label" for="transferAckDataLoss">{{ $t("transferVolumeAck") }}</label>
                    </div>
                </div>

                <label class="form-label">{{ $t("targetNode") }}</label>
                <select v-model="transferTarget" class="form-select">
                    <option value="" disabled>{{ $t("selectNode") }}</option>
                    <option v-for="targetEndpoint in transferTargets" :key="targetEndpoint" :value="targetEndpoint">
                        {{ $root.endpointDisplayFunction(targetEndpoint) }}
                    </option>
                </select>

                <div v-if="transferring" class="mt-3 text-muted">
                    <font-awesome-icon icon="spinner" spin class="me-1" />
                    {{ transferStatus }}
                </div>
            </BModal>
        </div>
    </transition>
</template>

<script>
import CodeMirror from "vue-codemirror6";
import { yaml } from "@codemirror/lang-yaml";
import { python } from "@codemirror/lang-python";
import { dracula as editorTheme } from "thememirror";
import { lineNumbers, EditorView } from "@codemirror/view";
import { parseDocument, Document } from "yaml";

import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
import {
    COMBINED_TERMINAL_COLS,
    COMBINED_TERMINAL_ROWS,
    copyYAMLComments, envsubstYAML,
    getCombinedTerminalName,
    getComposeTerminalName,
    RUNNING
} from "../../../common/util-common";
import { BModal, BDropdown, BDropdownItem, BDropdownDivider } from "bootstrap-vue-next";
import NetworkInput from "../components/NetworkInput.vue";
import ProgressTerminal from "../components/ProgressTerminal.vue";
import { formatComposeYAML } from "../util-yaml-format";
import { applyJSONChanges, detectIndent, toPlainJSON } from "../util-yaml-sync";
import dotenv from "dotenv";
import { ref } from "vue";

const template = `
services:
  nginx:
    image: nginx:latest
    restart: unless-stopped
    ports:
      - "8080:80"
`;
const envDefault = "# VARIABLE=value #comment";

let yamlErrorTimeout = null;

const FORMAT_ON_SAVE_KEY = "dockge-format-on-save";

/**
 * "Format on save" is a per-browser preference, off by default.
 * @returns {boolean} Whether it is on
 */
function loadFormatOnSave() {
    try {
        return localStorage.getItem(FORMAT_ON_SAVE_KEY) === "1";
    } catch (e) {
        return false;
    }
}

let serviceStatusTimeout = null;
let dockerStatsTimeout = null;

export default {
    components: {
        NetworkInput,
        FontAwesomeIcon,
        CodeMirror,
        BModal,
        ProgressTerminal,
        BDropdown,
        BDropdownItem,
        BDropdownDivider,
    },
    beforeRouteUpdate(to, from, next) {
        this.exitConfirm(next);
    },
    beforeRouteLeave(to, from, next) {
        this.exitConfirm(next);
    },
    setup() {
        const editorFocus = ref(false);

        const focusEffectHandler = (state, focusing) => {
            editorFocus.value = focusing;
            return null;
        };

        const extensions = [
            editorTheme,
            yaml(),
            lineNumbers(),
            EditorView.focusChangeEffect.of(focusEffectHandler)
        ];

        const extensionsEnv = [
            editorTheme,
            python(),
            lineNumbers(),
            EditorView.focusChangeEffect.of(focusEffectHandler)
        ];

        return { extensions,
            extensionsEnv,
            editorFocus };
    },
    yamlDoc: null,  // For keeping the yaml comments
    jsonSnapshot: undefined,  // jsonConfig as last parsed/synced, to diff form edits against (not reactive)
    data() {
        return {
            jsonConfig: {},
            envsubstJSONConfig: {},
            yamlError: "",
            // Set when jsonConfig was just parsed from the text, so the jsonConfig watcher doesn't write it back
            jsonConfigFromYAML: false,
            formatOnSave: loadFormatOnSave(),
            showComposeInvalidDialog: false,
            composeInvalidMessage: "",
            pendingValidateAction: null,
            processing: true,
            showPortConflictDialog: false,
            portConflictList: [],
            pendingPortAction: null,
            showProgressTerminal: false,
            combinedTerminalRows: COMBINED_TERMINAL_ROWS,
            combinedTerminalCols: COMBINED_TERMINAL_COLS,
            stack: {
                composeOverrideYAML: "",
            },
            serviceStatusList: {},
            dockerStats: {},
            isEditMode: false,
            submitted: false,
            showDeleteDialog: false,
            showTransferDialog: false,
            transferTarget: "",
            transferring: false,
            transferStatus: "",
            transferAckDataLoss: false,
            newContainerName: "",
            stopServiceStatusTimeout: false,
            stopDockerStatsTimeout: false,
            versionMismatches: [],
            versionScanLoading: false,
            versionSyncLoading: false,
            showVersionSync: false,
            // Mobile only: which section is on screen
            mobileTab: [ "overview", "compose", "logs" ].includes(this.$route.query.tab) ? this.$route.query.tab : "overview",
        };
    },
    computed: {
        mobileTabs() {
            const tabs = [
                { key: "overview", icon: "cubes", label: this.$t("overview") },
                { key: "compose", icon: "file-code", label: this.$t("compose") },
            ];
            if (!this.isAdd || this.showProgressTerminal) {
                tabs.push({ key: "logs", icon: "terminal", label: this.$t("logs") });
            }
            return tabs;
        },

        showActionBar() {
            return this.$root.isMobile && this.stack.isManagedByDockge;
        },

        // Logs tab: the terminal fills what the top bar, tabs and action bar leave, minus the progress terminal
        mobileTerminalHeight() {
            const chrome = "var(--m-chrome-height) - 34px";
            return this.showProgressTerminal ? `calc(100dvh - ${chrome} - 216px)` : `calc(100dvh - ${chrome})`;
        },

        endpointDisplay() {
            return this.$root.endpointDisplayFunction(this.endpoint);
        },

        /**
         * Other connected (online) nodes this stack can be transferred to.
         * Excludes the node the stack currently lives on.
         * @returns {string[]} List of target endpoints
         */
        transferTargets() {
            return Object.keys(this.$root.agentList)
                .filter(endpoint => endpoint !== this.endpoint && this.$root.agentStatusList[endpoint] === "online");
        },

        /**
         * Named Docker volumes referenced by this stack's compose file
         * (top-level `volumes:` declarations, plus any named-volume-style
         * mounts on individual services). Transfer only zips the stack's
         * own folder, so data in these volumes is NOT moved - it's left
         * behind on the source node while the target starts with fresh,
         * empty volumes of the same name.
         * @returns {string[]} Named volume names in use, deduplicated
         */
        namedVolumesInUse() {
            const names = new Set();

            if (this.jsonConfig.volumes && typeof this.jsonConfig.volumes === "object") {
                for (const name of Object.keys(this.jsonConfig.volumes)) {
                    names.add(name);
                }
            }

            const services = this.jsonConfig.services;
            if (services && typeof services === "object") {
                for (const service of Object.values(services)) {
                    if (!service || !Array.isArray(service.volumes)) {
                        continue;
                    }
                    for (const mount of service.volumes) {
                        if (typeof mount === "string") {
                            const source = mount.split(":")[0];
                            // A bind mount source is a relative (./, ../) or
                            // absolute (/, ~) host path. Anything else is a
                            // named volume reference.
                            if (source && !/^(\.|\/|~)/.test(source)) {
                                names.add(source);
                            }
                        } else if (mount && typeof mount === "object" && mount.type === "volume" && mount.source) {
                            names.add(mount.source);
                        }
                    }
                }
            }

            return Array.from(names);
        },

        urls() {
            if (!this.envsubstJSONConfig["x-dockge"] || !this.envsubstJSONConfig["x-dockge"].urls || !Array.isArray(this.envsubstJSONConfig["x-dockge"].urls)) {
                return [];
            }

            let urls = [];
            const allowedProtocols = [ "http:", "https:" ];
            for (const url of this.envsubstJSONConfig["x-dockge"].urls) {
                let display;
                try {
                    let obj = new URL(url);
                    if (!allowedProtocols.includes(obj.protocol)) {
                        continue;
                    }
                    let pathname = obj.pathname;
                    if (pathname === "/") {
                        pathname = "";
                    }
                    display = obj.host + pathname + obj.search;
                } catch (e) {
                    continue;
                }

                urls.push({
                    display,
                    url,
                });
            }
            return urls;
        },

        isAdd() {
            return this.$route.path === "/compose" && !this.submitted;
        },

        /**
         * Get the stack from the global stack list, because it may contain more real-time data like status
         * @return {*}
         */
        globalStack() {
            return this.$root.completeStackList[this.stack.name + "_" + this.endpoint];
        },

        status() {
            return this.globalStack?.status;
        },

        active() {
            return this.status === RUNNING;
        },

        terminalName() {
            if (!this.stack.name) {
                return "";
            }
            return getComposeTerminalName(this.endpoint, this.stack.name);
        },

        combinedTerminalName() {
            if (!this.stack.name) {
                return "";
            }
            return getCombinedTerminalName(this.endpoint, this.stack.name);
        },

        networks() {
            return this.jsonConfig.networks;
        },

        endpoint() {
            return this.stack.endpoint || this.$route.params.endpoint || "";
        },

        url() {
            if (this.stack.endpoint) {
                return `/compose/${this.stack.name}/${this.stack.endpoint}`;
            } else {
                return `/compose/${this.stack.name}`;
            }
        },
    },
    watch: {
        "stack.composeYAML": {
            handler() {
                if (this.editorFocus) {
                    console.debug("yaml code changed");
                    this.yamlCodeChange();
                }
            },
            deep: true,
        },

        "stack.composeENV": {
            handler() {
                if (this.editorFocus) {
                    console.debug("env code changed");
                    this.yamlCodeChange();
                }
            },
            deep: true,
        },

        "stack.composeOverrideYAML": {
            handler() {
                if (this.editorFocus) {
                    console.debug("override yaml code changed");
                    this.yamlCodeChange();
                }
            },
            deep: true,
        },

        formatOnSave(value) {
            try {
                localStorage.setItem(FORMAT_ON_SAVE_KEY, value ? "1" : "0");
            } catch (e) {
                // localStorage may be unavailable (private browsing, disabled storage, etc.)
            }
        },

        jsonConfig: {
            handler() {
                // Parsed from the text: writing it back would only lose formatting, quotes and "key:" nulls
                if (this.jsonConfigFromYAML) {
                    this.jsonConfigFromYAML = false;
                    return;
                }
                if (!this.editorFocus) {
                    console.debug("jsonConfig changed");
                    const after = toPlainJSON(this.jsonConfig);

                    if (this.yamlDoc && this.yamlDoc.errors.length === 0 && this.yamlDoc.contents && this.jsonSnapshot !== undefined) {
                        // Edit made through a form: patch only what changed into the parsed document, so the
                        // rest of the file keeps its quotes, inline lists, "key:" nulls, comments and indentation
                        applyJSONChanges(this.yamlDoc, this.jsonSnapshot, after);
                        this.stack.composeYAML = this.yamlDoc.toString({
                            indent: detectIndent(this.stack.composeYAML),
                            lineWidth: 0,
                            flowCollectionPadding: false,
                        });
                    } else {
                        // Nothing parsed to patch (empty or new file): build it from the data
                        let doc = new Document(this.jsonConfig);
                        if (this.yamlDoc) {
                            copyYAMLComments(doc, this.yamlDoc);
                        }
                        this.stack.composeYAML = doc.toString();
                        this.yamlDoc = doc;
                    }
                    this.jsonSnapshot = after;
                }
            },
            deep: true,
        },

        $route(to, from) {

        }
    },
    mounted() {
        if (this.isAdd) {
            this.processing = false;
            this.isEditMode = true;

            let composeYAML;
            let composeENV;

            if (this.$root.composeTemplate) {
                composeYAML = this.$root.composeTemplate;
                this.$root.composeTemplate = "";
            } else {
                composeYAML = template;
            }
            if (this.$root.envTemplate) {
                composeENV = this.$root.envTemplate;
                this.$root.envTemplate = "";
            } else {
                composeENV = envDefault;
            }

            // Default Values
            this.stack = {
                name: "",
                composeYAML,
                composeENV,
                isManagedByDockge: true,
                endpoint: "",
            };

            this.yamlCodeChange();

        } else {
            this.stack.name = this.$route.params.stackName;
            this.loadStack();
        }

        this.requestServiceStatus();
        this.requestDockerStats();
    },
    unmounted() {

    },
    methods: {
        /**
         * Whether a section is visible. Desktop shows everything; mobile shows the selected tab.
         * @param {string} tab Section's tab
         * @returns {boolean} Visible
         */
        show(tab) {
            return !this.$root.isMobile || this.mobileTab === tab;
        },

        // On mobile, jump to the logs so the user sees the action's output
        showLogs() {
            if (this.$root.isMobile) {
                this.mobileTab = "logs";
            }
        },

        startServiceStatusTimeout() {
            clearTimeout(serviceStatusTimeout);
            serviceStatusTimeout = setTimeout(async () => {
                this.requestServiceStatus();
            }, 5000);
        },

        startDockerStatsTimeout() {
            clearTimeout(dockerStatsTimeout);
            dockerStatsTimeout = setTimeout(async () => {
                this.requestDockerStats();
            }, 5000);
        },

        requestServiceStatus() {
            // Do not request if it is add mode
            if (this.isAdd) {
                return;
            }

            this.$root.emitAgent(this.endpoint, "serviceStatusList", this.stack.name, (res) => {
                if (res.ok) {
                    this.serviceStatusList = res.serviceStatusList;
                }
                if (!this.stopServiceStatusTimeout) {
                    this.startServiceStatusTimeout();
                }
            });
        },

        requestDockerStats() {
            this.$root.emitAgent(this.endpoint, "dockerStats", (res) => {
                if (res.ok) {
                    this.dockerStats = res.dockerStats;
                }
                if (!this.stopDockerStatsTimeout) {
                    this.startDockerStatsTimeout();
                }
            });
        },

        exitConfirm(next) {
            if (this.isEditMode) {
                if (confirm(this.$t("confirmLeaveStack"))) {
                    this.exitAction();
                    next();
                } else {
                    next(false);
                }
            } else {
                this.exitAction();
                next();
            }
        },

        exitAction() {
            console.log("exitAction");
            this.stopServiceStatusTimeout = true;
            this.stopDockerStatsTimeout = true;
            clearTimeout(serviceStatusTimeout);
            clearTimeout(dockerStatsTimeout);

            // Leave Combined Terminal
            console.debug("leaveCombinedTerminal", this.endpoint, this.stack.name);
            this.$root.emitAgent(this.endpoint, "leaveCombinedTerminal", this.stack.name, () => {});
        },

        // Show the progress terminal immediately and bind it for a compose action that
        // streams live docker/docker-compose output (deploy/start/stop/down/restart).
        startComposeAction() {
            this.processing = true;
            this.submitted = true;
            this.showProgressTerminal = true;
            this.$refs.progressTerminal?.show();
            this.showLogs();
        },

        // Auto-collapses the progress terminal 10s after the action finishes (see
        // ProgressTerminal.vue), matching hamphh/dockge 1.2's behavior.
        stopComposeAction() {
            this.processing = false;
            this.$refs.progressTerminal?.hideWithTimeout();
        },

        loadStack() {
            this.processing = true;
            this.$root.emitAgent(this.endpoint, "getStack", this.stack.name, (res) => {
                if (res.ok) {
                    this.stack = res.stack;
                    this.yamlCodeChange();
                    this.processing = false;
                } else {
                    this.$root.toastRes(res);
                }
            });
        },

        /**
         * Ask the agent which host ports of the edited stack are already used by another stack (running or not) or
         * by a running container, and confirm before going on. An agent without this check (older version) or an
         * error never blocks the save.
         * @param {"save" | "deploy"} action What to run once cleared
         * @returns {void}
         */
        checkPortsThen(action) {
            this.processing = true;
            let settled = false;
            const settle = (conflicts) => {
                if (settled) {
                    return;
                }
                settled = true;
                this.processing = false;
                if (conflicts.length > 0) {
                    this.portConflictList = conflicts;
                    this.pendingPortAction = action;
                    this.showPortConflictDialog = true;
                } else {
                    this.runPortAction(action);
                }
            };
            const timeout = setTimeout(() => settle([]), 5000);
            this.$root.emitAgent(this.stack.endpoint, "checkPortConflicts", this.stack.name || "", this.stack.composeYAML, this.stack.composeENV, this.stack.composeOverrideYAML || "", (res) => {
                clearTimeout(timeout);
                settle(res?.ok && Array.isArray(res.conflicts) ? res.conflicts : []);
            });
        },

        runPortAction(action) {
            if (action === "deploy") {
                this.doDeployStack();
            } else {
                this.doSaveStack();
            }
        },

        runPendingPortAction() {
            const action = this.pendingPortAction;
            this.pendingPortAction = null;
            this.runPortAction(action);
        },

        deployStack() {
            this.prepareThen("deploy");
        },

        saveStack() {
            this.prepareThen("save");
        },

        /**
         * Before Save/Deploy: format (if "Format on save" is on), then check the file is valid compose,
         * then check its ports.
         * @param {"save" | "deploy"} action What to run once cleared
         * @returns {void}
         */
        prepareThen(action) {
            if (this.formatOnSave) {
                this.formatCompose(true);
            }
            this.validateThen(action);
        },

        /**
         * Tidy compose.yaml (and the override) without changing their meaning. See formatComposeYAML().
         * @param {boolean} quiet Don't toast (Format on save); a file that can't be parsed is then left for validateThen() to report
         * @returns {void}
         */
        formatCompose(quiet) {
            let changed = false;
            for (const key of [ "composeYAML", "composeOverrideYAML" ]) {
                const text = this.stack[key];
                if (!text) {
                    continue;
                }
                const result = formatComposeYAML(text);
                if (!result.ok) {
                    if (!quiet) {
                        this.$root.toastError(result.error);
                    }
                    return;
                }
                if (result.changed) {
                    this.stack[key] = result.text;
                    changed = true;
                }
            }
            if (changed) {
                this.yamlCodeChange();
            }
            if (!quiet) {
                this.$root.toastSuccess(this.$t(changed ? "formatDone" : "formatNoChange"));
            }
        },

        /**
         * Ask the agent whether the edited files are a valid compose project ("docker compose config"),
         * the way Deploy will read them. An invalid file blocks Deploy (it would fail anyway) and asks
         * before Save. An agent without this check (older version) or an error never blocks.
         * @param {"save" | "deploy"} action What to run once cleared
         * @returns {void}
         */
        validateThen(action) {
            this.processing = true;
            let settled = false;
            const settle = (res) => {
                if (settled) {
                    return;
                }
                settled = true;
                this.processing = false;
                if (res?.ok && res.valid === false) {
                    this.composeInvalidMessage = res.message;
                    this.pendingValidateAction = action;
                    this.showComposeInvalidDialog = true;
                } else {
                    this.checkPortsThen(action);
                }
            };
            const timeout = setTimeout(() => settle(null), 10000);
            this.$root.emitAgent(this.stack.endpoint, "validateCompose", this.stack.name || "", this.stack.composeYAML, this.stack.composeENV, this.stack.composeOverrideYAML || "", (res) => {
                clearTimeout(timeout);
                settle(res);
            });
        },

        continueAfterInvalid() {
            const action = this.pendingValidateAction;
            this.pendingValidateAction = null;
            if (action === "save") {
                this.checkPortsThen("save");
            }
        },

        doDeployStack() {
            if (!this.jsonConfig.services) {
                this.$root.toastError("No services found in compose.yaml");
                return;
            }

            // Check if services is object
            if (typeof this.jsonConfig.services !== "object") {
                this.$root.toastError("Services must be an object");
                return;
            }

            let serviceNameList = Object.keys(this.jsonConfig.services);

            // Set the stack name if empty, use the first container name
            if (!this.stack.name && serviceNameList.length > 0) {
                let serviceName = serviceNameList[0];
                let service = this.jsonConfig.services[serviceName];

                if (service && service.container_name) {
                    this.stack.name = service.container_name;
                } else {
                    this.stack.name = serviceName;
                }
            }

            // isAdd flips to false as soon as startComposeAction() marks this submitted,
            // so capture it now - the server still needs to know this was a new stack.
            const isAdd = this.isAdd;

            this.startComposeAction();

            this.$root.emitAgent(this.stack.endpoint, "deployStack", this.stack.name, this.stack.composeYAML, this.stack.composeENV, this.stack.composeOverrideYAML || "", isAdd, (res) => {
                this.stopComposeAction();
                this.$root.toastRes(res);

                if (res.ok) {
                    this.isEditMode = false;
                    this.$router.push(this.$root.isMobile ? { path: this.url, query: { tab: "logs" } } : this.url);
                }
            });
        },

        doSaveStack() {
            this.processing = true;

            this.$root.emitAgent(this.stack.endpoint, "saveStack", this.stack.name, this.stack.composeYAML, this.stack.composeENV, this.stack.composeOverrideYAML || "", this.isAdd, (res) => {
                this.processing = false;
                this.$root.toastRes(res);

                if (res.ok) {
                    this.isEditMode = false;
                    this.$router.push(this.url);
                }
            });
        },

        startStack() {
            this.startComposeAction();

            this.$root.emitAgent(this.endpoint, "startStack", this.stack.name, (res) => {
                this.stopComposeAction();
                this.$root.toastRes(res);
            });
        },

        stopStack() {
            this.startComposeAction();

            this.$root.emitAgent(this.endpoint, "stopStack", this.stack.name, (res) => {
                this.stopComposeAction();
                this.$root.toastRes(res);
            });
        },

        downStack() {
            this.startComposeAction();

            this.$root.emitAgent(this.endpoint, "downStack", this.stack.name, (res) => {
                this.stopComposeAction();
                this.$root.toastRes(res);
            });
        },

        restartStack() {
            this.startComposeAction();

            this.$root.emitAgent(this.endpoint, "restartStack", this.stack.name, (res) => {
                this.stopComposeAction();
                this.$root.toastRes(res);
            });
        },

        updateStack() {
            this.processing = true;
            this.showLogs();

            this.$root.emitAgent(this.endpoint, "updateStack", this.stack.name, (res) => {
                this.processing = false;
                this.$root.toastRes(res);
            });
        },

        deleteDialog() {
            this.$root.emitAgent(this.endpoint, "deleteStack", this.stack.name, (res) => {
                this.$root.toastRes(res);
                if (res.ok) {
                    this.$router.push("/");
                }
            });
        },

        openTransferDialog() {
            this.transferTarget = this.transferTargets[0] || "";
            this.transferStatus = "";
            this.transferAckDataLoss = false;
            this.showTransferDialog = true;
        },

        /**
         * Move this stack to another node. The export -> import+deploy ->
         * delete-source sequence runs entirely on the backend (a single
         * "transferStack" call) rather than being chained here step-by-step,
         * so the transfer still finishes even if this browser tab closes or
         * loses connection partway through.
         * @returns {void}
         */
        confirmTransfer() {
            const target = this.transferTarget;
            const stackName = this.stack.name;
            const source = this.endpoint;

            if (!target) {
                return;
            }

            this.transferring = true;
            this.transferStatus = this.$t("transferInProgress");

            this.$root.getSocket().emit("transferStack", stackName, source, target, (res) => {
                this.transferring = false;
                this.showTransferDialog = false;

                if (!res.ok) {
                    this.$root.toastRes(res);
                    return;
                }

                if (res.sourceRemoveFailed) {
                    this.$root.toastError(this.$t("transferSourceRemoveFailed"));
                } else {
                    this.$root.toastSuccess(this.$t("transferDone"));
                }

                // Navigate to the stack on its new node.
                this.submitted = true;
                const newUrl = target ? `/compose/${stackName}/${target}` : `/compose/${stackName}`;
                this.$router.push(newUrl);
            });
        },

        discardStack() {
            this.loadStack();
            this.isEditMode = false;
            this.mobileTab = "overview";
        },

        yamlToJSON(yaml) {
            let doc = parseDocument(yaml);
            if (doc.errors.length > 0) {
                throw doc.errors[0];
            }

            const config = doc.toJS() ?? {};

            // Check data types
            // "services" must be an object
            if (!config.services) {
                config.services = {};
            }

            if (Array.isArray(config.services) || typeof config.services !== "object") {
                throw new Error("Services must be an object");
            }

            return {
                config,
                doc,
            };
        },

        yamlCodeChange() {
            try {
                let { config, doc } = this.yamlToJSON(this.stack.composeYAML);

                this.yamlDoc = doc;
                this.jsonSnapshot = toPlainJSON(config);
                this.jsonConfigFromYAML = true;
                this.jsonConfig = config;

                let env = dotenv.parse(this.stack.composeENV);
                let envYAML = envsubstYAML(this.stack.composeYAML, env);
                this.envsubstJSONConfig = this.yamlToJSON(envYAML).config;

                clearTimeout(yamlErrorTimeout);
                this.yamlError = "";
            } catch (e) {
                clearTimeout(yamlErrorTimeout);

                if (this.yamlError) {
                    this.yamlError = e.message;

                } else {
                    yamlErrorTimeout = setTimeout(() => {
                        this.yamlError = e.message;
                    }, 3000);
                }
            }
        },

        enableEditMode() {
            this.isEditMode = true;
            this.mobileTab = "compose";
        },

        checkYAML() {

        },

        addContainer() {
            this.checkYAML();

            if (this.jsonConfig.services[this.newContainerName]) {
                this.$root.toastError("Container name already exists");
                return;
            }

            if (!this.newContainerName) {
                this.$root.toastError("Container name cannot be empty");
                return;
            }

            this.jsonConfig.services[this.newContainerName] = {
                restart: "unless-stopped",
            };
            this.newContainerName = "";
            let element = this.$refs.containerList.lastElementChild;
            element.scrollIntoView({
                block: "start",
                behavior: "smooth"
            });
        },

        stackNameToLowercase() {
            this.stack.name = this.stack?.name?.toLowerCase();
        },

        scanVersionSync() {
            this.versionScanLoading = true;
            this.showVersionSync = true;
            this.versionMismatches = [];

            this.$root.emitAgent(this.endpoint, "scanVersionSync", this.stack.name, (res) => {
                this.versionScanLoading = false;
                if (res.ok) {
                    this.versionMismatches = res.data.mismatches;
                } else {
                    this.$root.toastRes(res);
                }
            });
        },

        syncVersion(mismatch) {
            this.versionSyncLoading = true;

            this.$root.emitAgent(this.endpoint, "syncVersion", mismatch.stackName, mismatch.service, mismatch.runningImage, (res) => {
                this.versionSyncLoading = false;
                this.$root.toastRes(res);
                if (res.ok) {
                    this.versionMismatches = this.versionMismatches.filter(m => m.service !== mismatch.service);
                    this.loadStack();
                }
            });
        },

        syncAllVersions() {
            this.versionSyncLoading = true;

            this.$root.emitAgent(this.endpoint, "syncAllVersions", this.stack.name, (res) => {
                this.versionSyncLoading = false;
                this.$root.toastRes(res);
                if (res.ok) {
                    this.versionMismatches = [];
                    this.loadStack();
                }
            });
        },

        startService(serviceName) {
            this.processing = true;

            this.$root.emitAgent(this.endpoint, "startService", this.stack.name, serviceName, (res) => {
                this.processing = false;
                this.$root.toastRes(res);

                if (res.ok) {
                    this.requestServiceStatus(); // Refresh service status
                }
            });
        },

        stopService(serviceName) {
            this.processing = true;

            this.$root.emitAgent(this.endpoint, "stopService", this.stack.name, serviceName, (res) => {
                this.processing = false;
                this.$root.toastRes(res);

                if (res.ok) {
                    this.requestServiceStatus(); // Refresh service status
                }
            });
        },

        restartService(serviceName) {
            this.processing = true;

            this.$root.emitAgent(this.endpoint, "restartService", this.stack.name, serviceName, (res) => {
                this.processing = false;
                this.$root.toastRes(res);

                if (res.ok) {
                    this.requestServiceStatus(); // Refresh service status
                }
            });
        },
    }
};
</script>

<style scoped lang="scss">
.compose-invalid-message {
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 40vh;
    overflow: auto;
    font-size: 0.85rem;
    padding: 10px;
    border-radius: 10px;
    background-color: rgba(0, 0, 0, 0.2);
}

@import "../styles/vars.scss";

.terminal {
    height: 200px;
}

.stack-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;

    @media (max-width: 768px) {
        // Full-width rows of evenly sized buttons instead of a ragged wrap
        .btn-group {
            width: 100%;

            > .btn {
                flex: 1 1 0;
                padding-left: 6px;
                padding-right: 6px;
                white-space: nowrap;
            }
        }

        > .btn {
            flex: 1 1 0;
            white-space: nowrap;
        }
    }
}

.editor-box {
    font-family: 'JetBrains Mono', monospace;
    font-size: 14px;
}

.agent-name {
    font-size: 13px;
    color: $dark-font-color3;
}

// ---------- Mobile ----------
$m-topbar: 56px;
$m-tabs: 46px;
$m-actionbar: 64px;

.mobile-stack-page {
    // Everything that is not the terminal on the logs tab (bars + gaps)
    --m-chrome-height: calc(#{$m-topbar} + #{$m-tabs} + 24px + env(safe-area-inset-top));

    &.has-action-bar {
        --m-chrome-height: calc(#{$m-topbar} + #{$m-tabs} + #{$m-actionbar} + 24px + env(safe-area-inset-top) + env(safe-area-inset-bottom));
        padding-bottom: calc(#{$m-actionbar} + 12px + env(safe-area-inset-bottom));
    }

    h4 {
        font-size: 1.1rem;
    }

    .m-topbar {
        position: sticky;
        top: 0;
        z-index: 1001;
        display: flex;
        align-items: center;
        gap: 4px;
        height: calc(#{$m-topbar} + env(safe-area-inset-top));
        margin: 0 -12px;
        padding: env(safe-area-inset-top) 4px 0;
        background-color: var(--bar-bg);
        backdrop-filter: saturate(180%) blur(12px);
        -webkit-backdrop-filter: saturate(180%) blur(12px);
    }

    .m-title {
        flex: 1 1 auto;
        min-width: 0;
        line-height: 1.2;

        .m-name {
            font-size: 17px;
            font-weight: 700;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .m-sub {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-top: 2px;

            .badge {
                min-width: 0;
                font-size: 11px;
                padding: 2px 8px;
            }
        }
    }

    :deep(.m-icon-btn), .m-icon-btn {
        width: 44px;
        height: 44px;
        padding: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: none;
        border-radius: 12px;
        background: transparent;
        color: inherit;
        font-size: 20px;
        text-decoration: none;
    }

    .m-tabs {
        position: sticky;
        top: calc(#{$m-topbar} + env(safe-area-inset-top));
        z-index: 1000;
        display: flex;
        margin: 0 -12px 12px;
        padding: 0 8px;
        height: $m-tabs;
        background-color: var(--bar-bg);
        backdrop-filter: saturate(180%) blur(12px);
        -webkit-backdrop-filter: saturate(180%) blur(12px);
        border-bottom: 1px solid var(--card-border);

        button {
            position: relative;
            flex: 1 1 0;
            border: none;
            background: transparent;
            color: inherit;
            opacity: 0.65;
            font-size: 15px;
            border-bottom: 3px solid transparent;

            &.selected {
                opacity: 1;
                font-weight: 600;
                color: $primary;
                border-bottom-color: $primary;
            }
        }

        .busy-dot {
            display: inline-block;
            width: 7px;
            height: 7px;
            margin-left: 6px;
            border-radius: 50%;
            background-color: $warning;
            vertical-align: middle;
            animation: busy-pulse 1s infinite alternate;
        }
    }

    .m-action-bar {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 1000;
        display: flex;
        gap: 6px;
        height: calc(#{$m-actionbar} + env(safe-area-inset-bottom));
        padding: 6px 8px env(safe-area-inset-bottom);
        background-color: var(--bar-bg);
        backdrop-filter: saturate(180%) blur(12px);
        -webkit-backdrop-filter: saturate(180%) blur(12px);
        border-top: 1px solid var(--card-border);
    }

    .m-action {
        flex: 1 1 0;
        min-width: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 3px;
        border: none;
        border-radius: 12px;
        background: transparent;
        color: inherit;
        font-size: 12px;

        svg {
            font-size: 19px;
        }

        span {
            max-width: 100%;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        &.primary {
            background: $primary-gradient;
            color: $dark-font-color2;
            font-weight: 600;
        }

        &:active:not(:disabled) {
            filter: brightness(0.9);
        }

        &:disabled {
            opacity: 0.45;
        }
    }

    .stack-urls .badge {
        font-size: 13px;
        padding: 6px 10px;
        margin-bottom: 6px;
    }

    .version-sync {
        overflow-x: auto;
    }

    .stack-agent {
        font-size: 14px;
        opacity: 0.85;
    }

    .unmanaged-msg {
        padding: 16px 4px;
    }
}

@keyframes busy-pulse {
    from { opacity: 0.3; }
    to { opacity: 1; }
}
</style>
