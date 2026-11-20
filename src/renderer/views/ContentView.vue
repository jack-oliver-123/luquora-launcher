<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NAlert, NButton, NEmpty, NInput, NSelect, NSpin, NSwitch, NTabPane, NTabs, NTag } from 'naive-ui'
import type { ContentKind, ContentListing, PackPreview, ResourcePlan } from '../../shared/content'
import { api, launcher, perform } from '../state'
import PackDialog from '../components/PackDialog.vue'
import ResourcePlanDialog from '../components/ResourcePlanDialog.vue'

const emit = defineEmits<{ discover: [] }>()
const target = ref<string | null>(launcher.snapshot?.config.selectedInstanceId ?? launcher.snapshot?.config.instances[0]?.id ?? null)
const kind = ref<Exclude<ContentKind, 'modpack'>>('mod')
const listing = ref<ContentListing | null>(null)
const loading = ref(false)
const updates = ref<Awaited<ReturnType<typeof api.checkContentUpdates>>>([])
const packVersions = ref<{ label: string; value: string }[]>([])
const packVersion = ref<string | null>(null)
const pack = ref<PackPreview | null>(null)
const plan = ref<ResourcePlan | null>(null)
const filter = ref('')
const options = computed(() => launcher.snapshot?.config.instances.map(instance => ({ label: `${instance.name} · ${instance.versionId}`, value: instance.id })) ?? [])
const files = computed(() => listing.value?.files.filter(file => file.kind === kind.value && `${file.name} ${file.path}`.toLowerCase().includes(filter.value.toLowerCase())) ?? [])
const busy = computed(() => !!launcher.snapshot?.installation || launcher.snapshot?.contentTasks?.some(task => ['queued', 'running'].includes(task.phase)) || ['checking', 'starting', 'running'].includes(launcher.snapshot?.game.phase ?? ''))
let request = 0
async function load() {
  const id = target.value; const current = ++request
  if (!id) { listing.value = null; return }
  loading.value = true
  await perform(`content-list-${current}`, async () => { const value = await api.listInstanceContent(id); if (current === request) listing.value = value })
  if (current === request) loading.value = false
}
watch(target, () => { listing.value = null; updates.value = []; packVersions.value = []; packVersion.value = null; void load() }, { immediate: true })
async function modify(operation: (id: string) => Promise<void>) {
  const id = target.value
  if (!id) return
  await perform('content-edit', () => operation(id)); await load()
}
async function checkUpdates() {
  const id = target.value
  if (!id) return
  await perform('content-updates', async () => {
    const result = await api.checkContentUpdates(id)
    const versions = listing.value?.pack?.projectId ? await api.listContentVersions(listing.value.pack.projectId, null) : []
    if (id !== target.value) return
    updates.value = result
    packVersions.value = versions.filter(version => version.version_type === 'release' && version.id !== listing.value?.pack?.versionId).map(version => ({ label: version.name, value: version.id }))
    packVersion.value = packVersions.value[0]?.value ?? null
    launcher.notice = result.length || packVersions.value.length ? '已找到兼容更新，请预览后安装。' : '当前没有可用的正式版更新。本地未知来源文件需手动检查。'
  })
}
async function previewUpdate(versionId: string) {
  if (!target.value) return
  const value = await perform('resource-preview', () => api.previewResource(target.value!, versionId))
  if (value) plan.value = value
}
async function previewPack(online: boolean) {
  if (!target.value) return
  const value = await perform('pack-preview', () => api.previewPackUpdate(target.value!, online ? packVersion.value : null))
  if (value) pack.value = value
}
</script>

<template>
  <section>
    <header class="page-header"><div><h1>实例内容</h1><p>管理模组、资源包与光影，让每个世界各有不同。</p></div><NButton @click="emit('discover')">浏览资源中心</NButton></header>
    <div class="content-toolbar"><NSelect v-model:value="target" :options="options" placeholder="先创建实例" aria-label="内容管理目标实例" /><NButton :loading="loading" :disabled="!target" @click="load">刷新</NButton><NButton :disabled="!target || busy" :loading="launcher.busy.has('content-updates')" @click="checkUpdates">检查更新</NButton></div>
    <NEmpty v-if="!target" description="创建实例后，在这里管理内容。" class="content-loading" />
    <template v-else>
      <NAlert v-if="busy" type="info" :bordered="false" class="spaced-alert">游戏或写入任务进行中，结束后可修改实例内容。</NAlert>
      <div v-if="listing?.pack" class="pack-summary surface"><h2>{{ listing.pack.name }}</h2><p>整合包 {{ listing.pack.version }}</p><div class="inline-actions"><NSelect v-if="packVersions.length" v-model:value="packVersion" :options="packVersions" aria-label="整合包更新版本" style="min-width: 200px; flex: 1" /><NButton v-if="packVersions.length" :disabled="busy || !packVersion" @click="previewPack(true)">预览在线更新</NButton><NButton :disabled="busy" :loading="launcher.busy.has('pack-preview')" @click="previewPack(false)">从文件更新整合包</NButton></div></div>
      <NTabs v-model:value="kind" type="line"><NTabPane name="mod" tab="模组" /><NTabPane name="resourcepack" tab="资源包" /><NTabPane name="shader" tab="光影" /></NTabs>
      <div class="content-toolbar"><NInput v-model:value="filter" placeholder="筛选已安装内容" clearable aria-label="筛选已安装内容" /><NButton :disabled="busy" :loading="launcher.busy.has('content-edit')" @click="modify(id => api.importContent(id, kind))">导入本地文件</NButton></div>
      <div v-if="loading && !listing" class="content-loading"><NSpin /></div><NEmpty v-else-if="!files.length" description="这里还没有匹配的内容。可以从资源中心安装，或导入本地文件。" class="content-loading" />
      <div v-else class="surface content-list"><div v-for="file in files" :key="file.path" class="content-row"><div class="resource-copy"><strong>{{ file.name }}</strong><p>{{ file.versionName ?? '本地文件，兼容性未验证' }}<span v-if="file.disabled"> · 已禁用</span><span v-if="file.modified"> · 文件已修改</span></p><small>{{ file.path }}</small></div><NTag v-if="file.projectId" size="small" :bordered="false">Modrinth</NTag><NSwitch v-if="file.kind === 'mod'" :value="!file.disabled" :disabled="busy || launcher.busy.has('content-edit')" :aria-label="`启用 ${file.name}`" @update:value="modify(id => api.toggleContent(id, file.path))" /><NButton v-if="file.projectId" size="small" @click="perform('project-link', () => api.openContentProject(file.projectId!))">来源</NButton><NButton v-if="updates.find(item => item.projectId === file.projectId)" size="small" :disabled="busy" @click="previewUpdate(updates.find(item => item.projectId === file.projectId)!.versionId)">预览更新</NButton><NButton size="small" :disabled="busy" @click="modify(id => api.removeContent(id, file.path))">移除</NButton></div></div>
      <div class="content-backups"><div><strong>变更备份</strong><p>{{ listing?.canRestore ? '可恢复最近一次资源变更或整合包更新。' : '还没有可恢复的变更。' }}<span v-if="listing?.backupsBytes !== undefined"> 占用 {{ (listing.backupsBytes / 1048576).toFixed(1) }} MiB</span></p></div><NButton :disabled="busy || !listing?.canRestore" @click="modify(id => api.restoreContent(id))">恢复最近变更</NButton><NButton :disabled="busy || !listing?.backupsBytes" @click="modify(id => api.clearContentBackups(id))">清理备份</NButton></div>
      <p class="page-note">启用和禁用不会删除模组。资源包与光影需在游戏内手动选择，移除的文件进入回收站。</p>
    </template>
    <ResourcePlanDialog :plan="plan" @close="plan = null" @installed="load" /><PackDialog :preview="pack" updating @close="pack = null" @installed="load" />
  </section>
</template>
