<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NAlert, NButton, NForm, NFormItem, NInput, NModal, NSelect, NSwitch } from 'naive-ui'
import type { Instance, LaunchSettings, VersionSummary } from '../../shared/contracts'
import { api, launcher, perform } from '../state'
import SettingsFields from './SettingsFields.vue'

const props = defineProps<{ show: boolean; instance: Instance | null }>()
const emit = defineEmits<{ 'update:show': [value: boolean] }>()
const name = ref('')
const versionId = ref<string | null>(null)
const versions = ref<VersionSummary[]>([])
const loading = ref(false)
const versionError = ref('')
const inherit = ref(true)
const settings = ref<LaunchSettings>({ memoryMiB: 2048, width: 1280, height: 720, fullscreen: false, javaPath: null })
const options = computed(() => versions.value.map(version => ({ label: version.id, value: version.id })))
async function loadVersions() {
  loading.value = true; versionError.value = ''
  try { versions.value = await api.listVersions(); if (!versionId.value) versionId.value = versions.value[0]?.id ?? null }
  catch (error) { versionError.value = error instanceof Error ? error.message : '无法加载版本列表。' }
  finally { loading.value = false }
}
watch(() => props.show, show => {
  if (!show || !launcher.snapshot) return
  name.value = props.instance?.name ?? ''
  versionId.value = props.instance?.versionId ?? null
  inherit.value = !props.instance || Object.keys(props.instance.overrides).length === 0
  settings.value = { ...launcher.snapshot.config.defaults, ...props.instance?.overrides }
  if (!props.instance) void loadVersions()
})
async function save() {
  const result = await perform('instance-editor', () => props.instance
    ? api.updateInstance(props.instance.id, { name: name.value, overrides: inherit.value ? {} : { ...settings.value } })
    : api.createInstance(name.value, versionId.value!))
  if (result) emit('update:show', false)
}
async function chooseJava() {
  if (!props.instance) return
  const path = await perform('java', () => api.chooseJavaPath(props.instance!.id))
  if (path) settings.value.javaPath = path
}
</script>

<template>
  <NModal :show="show" preset="card" :title="instance ? '实例设置' : '创建实例'" class="editor-modal" :mask-closable="!launcher.busy.has('instance-editor')" @update:show="emit('update:show', $event)">
    <p class="modal-intro">{{ instance ? '独立保存这个世界的名称与启动偏好。' : '选择一个正式版本，为新的冒险留一处空间。' }}</p>
    <NForm label-placement="top" :disabled="launcher.busy.has('instance-editor')" @submit.prevent="save">
      <NFormItem label="实例名称" required><NInput v-model:value="name" placeholder="例如：我的生存世界" :maxlength="80" show-count autofocus /></NFormItem>
      <NFormItem label="Minecraft 版本" required>
        <NInput v-if="instance" :value="instance.versionId" readonly />
        <NSelect v-else v-model:value="versionId" :options="options" filterable :loading="loading" placeholder="选择正式版本" :disabled="loading" />
      </NFormItem>
      <NAlert v-if="versionError" type="warning" :bordered="false">{{ versionError }}<div class="inline-actions"><NButton size="small" @click="loadVersions">重新加载</NButton></div></NAlert>
      <template v-if="instance">
        <div class="setting-row"><div><strong>使用全局启动设置</strong><p>关闭后，可为此实例单独分配内存和 Java。</p></div><NSwitch v-model:value="inherit" aria-label="使用全局启动设置" /></div>
        <SettingsFields v-if="!inherit" :model="settings" @choose-java="chooseJava" @automatic-java="settings.javaPath = null" />
      </template>
      <div class="modal-actions"><NButton @click="emit('update:show', false)">取消</NButton><NButton type="primary" attr-type="submit" :loading="launcher.busy.has('instance-editor')" :disabled="!name.trim() || !versionId || (!instance && loading)">{{ instance ? '保存设置' : '创建实例' }}</NButton></div>
    </NForm>
  </NModal>
</template>
