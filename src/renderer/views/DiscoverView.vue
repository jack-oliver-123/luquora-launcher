<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { NAlert, NButton, NEmpty, NFormItem, NIcon, NInput, NModal, NPagination, NSelect, NSpin, NSwitch, NTabPane, NTabs, NTag } from 'naive-ui'
import { CubeOutline, SearchOutline, DownloadOutline } from '@vicons/ionicons5'
import type { ContentKind, ContentProject, ContentVersion, LoaderKind, PackPreview, ResourcePlan, SearchResult } from '../../shared/content'
import { api, launcher, perform } from '../state'
import PackDialog from '../components/PackDialog.vue'
import ResourcePlanDialog from '../components/ResourcePlanDialog.vue'

const query = ref('')
const kind = ref<ContentKind>('mod')
const gameVersion = ref('')
const loader = ref<LoaderKind | null>(null)
const page = ref(1)
const result = ref<SearchResult | null>(null)
const loading = ref(false)
const failure = ref('')
const project = ref<ContentProject | null>(null)
const projectLoading = ref(false)
const detailOpen = ref(false)
const versions = ref<ContentVersion[]>([])
const selectedVersion = ref<string | null>(null)
const target = ref<string | null>(launcher.snapshot?.config.selectedInstanceId ?? null)
const showTesting = ref(false)
const plan = ref<ResourcePlan | null>(null)
const pack = ref<PackPreview | null>(null)
const instanceOptions = computed(() => (launcher.snapshot?.config.instances ?? []).map(instance => ({ label: `${instance.name} · ${instance.versionId}${instance.loader ? ` · ${instance.loader.kind}` : ' · 原版'}`, value: instance.id })))
const filteredVersions = computed(() => versions.value.filter(version => showTesting.value || version.version_type === 'release'))
const versionOptions = computed(() => filteredVersions.value.map(version => ({ label: `${version.name} (${version.version_number})${version.version_type === 'release' ? '' : ` · ${version.version_type}`}`, value: version.id })))
const loaderOptions = ['fabric', 'forge', 'neoforge', 'quilt'].map(value => ({ label: value === 'neoforge' ? 'NeoForge' : value[0].toUpperCase() + value.slice(1), value }))
let requestId = 0
let detailId = 0
let timer: ReturnType<typeof setTimeout> | undefined
async function search() {
  const current = ++requestId; loading.value = true; failure.value = ''
  try {
    const data = await api.searchContent({ query: query.value, kind: kind.value, gameVersion: gameVersion.value.trim() || undefined, loader: loader.value ?? undefined, offset: (page.value - 1) * 20 })
    if (current === requestId) result.value = data
  } catch (error) { if (current === requestId) { failure.value = error instanceof Error ? error.message : '资源加载失败。'; result.value = null } }
  finally { if (current === requestId) loading.value = false }
}
watch([query, kind, gameVersion, loader], () => { page.value = 1; requestId++; clearTimeout(timer); timer = setTimeout(search, 350) })
watch(page, () => { clearTimeout(timer); void search() })
async function loadDetails(id: string) {
  detailOpen.value = true; projectLoading.value = true; project.value = null; versions.value = []; selectedVersion.value = null
  const current = ++detailId
  await perform(`resource-details-${current}`, async () => {
    const info = await api.getContentProject(id)
    const list = await api.listContentVersions(id, info.project_type === 'modpack' ? null : target.value)
    if (current !== detailId) return
    project.value = info; versions.value = list
    selectedVersion.value = list.find(version => version.version_type === 'release')?.id ?? null
  })
  if (current === detailId) projectLoading.value = false
}
watch(target, () => { if (project.value) void loadDetails(project.value.id) })
watch(showTesting, () => { if (!filteredVersions.value.some(version => version.id === selectedVersion.value)) selectedVersion.value = filteredVersions.value[0]?.id ?? null })
async function preview() {
  if (!selectedVersion.value || !project.value) return
  if (project.value.project_type === 'modpack') {
    const preview = await perform('pack-preview', () => api.previewPack(selectedVersion.value))
    if (preview) { pack.value = preview; detailOpen.value = false }
  } else if (target.value) {
    const preview = await perform('resource-preview', () => api.previewResource(target.value!, selectedVersion.value!))
    if (preview) { plan.value = preview; detailOpen.value = false }
  }
}
async function importPack() {
  const preview = await perform('pack-preview', () => api.previewPack(null))
  if (preview) pack.value = preview
}
onMounted(search)
onUnmounted(() => { requestId++; detailId++; clearTimeout(timer) })
</script>

<template>
  <section>
    <header class="page-header"><div><h1>资源中心</h1><p>找到新的玩法，装进自己的世界。</p></div><NButton :loading="launcher.busy.has('pack-preview')" @click="importPack"><template #icon><NIcon :component="DownloadOutline" /></template>导入整合包</NButton></header>
    <NTabs v-model:value="kind" type="line" class="resource-tabs" aria-label="资源类型"><NTabPane name="mod" tab="模组" /><NTabPane name="modpack" tab="整合包" /><NTabPane name="resourcepack" tab="资源包" /><NTabPane name="shader" tab="光影" /></NTabs>
    <form class="resource-search" @submit.prevent="search"><NInput v-model:value="query" placeholder="搜索 Modrinth 资源" clearable aria-label="搜索资源"><template #prefix><NIcon :component="SearchOutline" /></template></NInput><NInput v-model:value="gameVersion" placeholder="游戏版本，例如 1.20.1" clearable aria-label="筛选游戏版本" /><NSelect v-model:value="loader" :options="loaderOptions" placeholder="所有加载器" clearable aria-label="筛选加载器" /><NButton attr-type="submit" :loading="loading">搜索</NButton></form>
    <NAlert v-if="kind === 'shader'" type="info" :bordered="false" class="spaced-alert">光影需要实例已有兼容的渲染模组，例如 Iris 或 Oculus。下载光影不会自动安装渲染环境。</NAlert>
    <div class="resource-meta"><span>来源 Modrinth</span><span v-if="result">{{ result.total_hits.toLocaleString() }} 个结果</span></div>
    <NAlert v-if="failure" type="error" class="spaced-alert">{{ failure }}<div class="inline-actions"><NButton size="small" @click="search">重新加载</NButton></div></NAlert>
    <div v-if="loading && !result" class="content-loading"><NSpin /><p>正在寻找资源…</p></div>
    <NEmpty v-else-if="!failure && !result?.hits.length" description="没有找到匹配资源，试试其他关键词或减少筛选条件。" class="content-loading" />
    <div v-else class="resource-results" :aria-busy="loading"><button v-for="item in result?.hits" :key="item.project_id" class="resource-result surface" @click="loadDetails(item.project_id)"><div class="resource-symbol"><NIcon :component="CubeOutline" :size="28" /></div><div class="resource-copy"><h3>{{ item.title }}</h3><p>{{ item.description }}</p><small>{{ item.author }} · {{ item.downloads.toLocaleString() }} 次下载</small></div><span class="resource-open">查看</span></button></div>
    <NPagination v-if="result && result.total_hits > 20" v-model:page="page" :page-size="20" :item-count="Math.min(result.total_hits, 10000)" :page-slot="5" class="resource-pagination" />
    <p class="page-note">资源由原作者提供。安装前会检查游戏版本、加载器与必要依赖。</p>
    <NModal v-model:show="detailOpen" preset="card" :title="project?.title ?? '加载资源详情'" class="resource-detail-modal">
      <div v-if="projectLoading" class="content-loading"><NSpin /></div>
      <template v-else-if="project">
        <p class="modal-intro">{{ project.description }}</p><div class="inline-actions"><NTag :bordered="false">{{ project.license?.name ?? '以项目页面为准' }}</NTag><NButton text @click="perform('project-link', () => api.openContentProject(project!.id))">在 Modrinth 查看</NButton></div>
        <div class="resource-body">{{ project.body || '作者未提供详细介绍。' }}</div>
        <NFormItem v-if="project.project_type !== 'modpack'" label="目标实例"><NSelect v-model:value="target" :options="instanceOptions" placeholder="先创建一个兼容实例" /></NFormItem>
        <NFormItem label="资源版本"><NSelect v-model:value="selectedVersion" :options="versionOptions" placeholder="没有兼容的正式版本" filterable /></NFormItem>
        <div class="setting-row"><span>显示测试版</span><NSwitch v-model:value="showTesting" aria-label="显示测试版" /></div>
        <NAlert v-if="project.project_type === 'mod' && !launcher.snapshot?.config.instances.find(instance => instance.id === target)?.loader" type="warning" :bordered="false">模组需要加载器实例。请先创建 Fabric、Forge、NeoForge 或 Quilt 实例。</NAlert>
        <div class="modal-actions"><NButton @click="detailOpen = false">关闭</NButton><NButton type="primary" :loading="launcher.busy.has('resource-preview') || launcher.busy.has('pack-preview')" :disabled="!selectedVersion || project.project_type !== 'modpack' && !target" @click="preview">{{ project.project_type === 'modpack' ? '预览整合包' : '预览安装与依赖' }}</NButton></div>
      </template>
      <NEmpty v-else description="详情加载失败，请关闭后重试。" />
    </NModal>
    <ResourcePlanDialog :plan="plan" @close="plan = null" />
    <PackDialog :preview="pack" @close="pack = null" />
  </section>
</template>
