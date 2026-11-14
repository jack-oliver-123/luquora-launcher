<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NDropdown, NIcon, NProgress, NSelect, NTag } from 'naive-ui'
import { AddOutline, CubeOutline, EllipsisHorizontal, FolderOpenOutline, PersonOutline, PlayOutline, SettingsOutline } from '@vicons/ionicons5'
import type { Instance } from '../../shared/contracts'
import { api, launcher, perform } from '../state'
import InstanceEditor from '../components/InstanceEditor.vue'

const emit = defineEmits<{ accounts: []; logs: [] }>()
const showEditor = ref(false)
const editing = ref<Instance | null>(null)
const snapshot = computed(() => launcher.snapshot!)
const account = computed(() => snapshot.value.accounts.find(item => item.id === snapshot.value.config.selectedAccountId))
const selected = computed(() => snapshot.value.config.instances.find(item => item.id === snapshot.value.config.selectedInstanceId) ?? snapshot.value.config.instances[0])
const gameActive = computed(() => ['checking', 'starting', 'running'].includes(snapshot.value.game.phase))
const stages = { metadata: '获取版本信息', java: '准备 Java 运行时', files: '下载与校验游戏文件', verify: '完成校验', complete: '安装完成' }
const progress = computed(() => { const task = snapshot.value.installation; return task?.total ? Math.min(100, Math.round(task.completed / task.total * 100)) : undefined })
const menu = [{ label: '实例设置', key: 'edit' }, { label: '打开实例目录', key: 'folder' }, { label: '查看日志', key: 'logs' }, { type: 'divider', key: 'divider' }, { label: '移入回收站', key: 'delete' }]
function editor(instance: Instance | null) { editing.value = instance; showEditor.value = true }
function busy(instance: Instance) { return snapshot.value.installation?.instanceId === instance.id || gameActive.value && snapshot.value.game.instanceId === instance.id }
function menuSelect(key: string, instance: Instance) {
  if (key === 'edit') editor(instance)
  else if (key === 'folder') void perform('folder', () => api.openInstanceFolder(instance.id))
  else if (key === 'logs') emit('logs')
  else if (key === 'delete') void perform('delete', () => api.removeInstance(instance.id))
}
function launch(instance: Instance) { void perform('launch', () => api.launchInstance(instance.id)) }
function install(instance: Instance) { void perform('install', () => api.installInstance(instance.id)) }
function bytes(value: number) { return `${(value / 1048576).toFixed(1)} MiB` }
</script>

<template>
  <section>
    <header class="page-header"><div><h1>我的实例</h1><p>每一个世界，都有自己的空间。</p></div><NButton type="primary" size="large" @click="editor(null)"><template #icon><NIcon :component="AddOutline" /></template>创建实例</NButton></header>
    <div class="account-strip">
      <div class="round-icon"><NIcon :component="PersonOutline" :size="23" /></div><strong>当前账号</strong><span class="account-separator"></span>
      <NSelect v-if="snapshot.accounts.length" :value="account?.id ?? null" :options="snapshot.accounts.map(item => ({ label: item.name + (item.kind === 'local' ? ' · 本地角色' : item.status === 'reauth-required' ? ' · 需要验证' : ' · 微软账号'), value: item.id }))" placeholder="选择账号或角色" :bordered="false" style="max-width: 250px" @update:value="value => perform('account', () => api.selectAccount(value))" />
      <span v-else class="muted">尚未添加角色</span><NButton text class="strip-action" @click="emit('accounts')">{{ snapshot.accounts.length ? '管理账号' : '添加角色' }}</NButton>
    </div>
    <div v-if="!snapshot.config.instances.length" class="empty-world">
      <NIcon :component="CubeOutline" :size="92" class="empty-cube" /><h2>创建你的第一个世界</h2><p>安装原版 Minecraft，让每个世界拥有独立的存档与设置。</p>
      <NButton type="primary" size="large" @click="editor(null)">创建实例</NButton><div class="empty-footnote">从选择版本开始，Java 与游戏文件由 LQL 自动准备。</div>
    </div>
    <template v-else>
      <div v-if="selected" class="instance-focus surface">
        <div class="instance-cover"><NIcon :component="CubeOutline" :size="60" /></div>
        <div class="focus-copy"><div class="eyebrow">MINECRAFT JAVA EDITION</div><h2>{{ selected.name }}</h2><p>{{ selected.versionId }}<span class="dot-separator">·</span>{{ selected.installation === 'ready' ? '已安装' : '等待安装' }}<span v-if="gameActive && snapshot.game.instanceId === selected.id" class="dot-separator">· {{ snapshot.game.phase === 'running' ? '游戏运行中' : '正在启动' }}</span></p></div>
        <div class="focus-actions">
          <template v-if="gameActive && snapshot.game.instanceId === selected.id"><NButton type="primary" :loading="launcher.busy.has('stop')" @click="perform('stop', () => api.stopGame(false))">结束游戏</NButton><NButton text @click="perform('stop', () => api.stopGame(true))">强制结束</NButton></template>
          <NButton v-else-if="selected.installation === 'ready'" type="primary" size="large" :disabled="gameActive || !!snapshot.installation || !account" :loading="launcher.busy.has('launch')" @click="launch(selected)"><template #icon><NIcon :component="PlayOutline" /></template>启动游戏</NButton>
          <NButton v-else type="primary" size="large" :disabled="!!snapshot.installation || gameActive" :loading="snapshot.installation?.instanceId === selected.id" @click="install(selected)">安装游戏</NButton>
          <span v-if="!account && !gameActive" class="action-hint">启动前需添加本地角色或微软账号</span>
        </div>
      </div>
      <div v-if="snapshot.installation" class="task-panel surface" aria-live="polite"><div class="task-heading"><div><strong>{{ stages[snapshot.installation.stage] }}</strong><p>{{ snapshot.config.instances.find(item => item.id === snapshot.installation?.instanceId)?.name }}</p></div><NButton size="small" :loading="launcher.busy.has('cancel-install')" @click="perform('cancel-install', () => api.cancelInstall())">取消安装</NButton></div><NProgress type="line" :percentage="progress ?? 0" :processing="true" :show-indicator="progress !== undefined" :height="5" color="#54545a" /><p class="progress-caption">{{ snapshot.installation.total === null ? '正在准备，请稍候…' : snapshot.installation.unit === 'bytes' ? `${bytes(snapshot.installation.completed)} / ${bytes(snapshot.installation.total)}` : `${snapshot.installation.completed} / ${snapshot.installation.total} 个文件` }}</p></div>
      <div class="section-heading"><h3>全部实例 <span>{{ snapshot.config.instances.length }}</span></h3><span class="muted">独立存档，共享游戏资源</span></div>
      <div class="instance-list surface">
        <div v-for="instance in snapshot.config.instances" :key="instance.id" class="instance-row" :class="{ selected: selected?.id === instance.id }">
          <NButton quaternary class="instance-select" @click="perform('select', () => api.selectInstance(instance.id))"><template #icon><NIcon :component="CubeOutline" :size="26" /></template><span class="instance-label"><strong>{{ instance.name }}</strong><small>Minecraft {{ instance.versionId }}</small></span></NButton>
          <NTag :bordered="false" size="small" round>{{ busy(instance) ? '任务进行中' : instance.installation === 'ready' ? '已就绪' : '未安装' }}</NTag>
          <NButton quaternary circle aria-label="打开实例目录" @click="perform('folder', () => api.openInstanceFolder(instance.id))"><template #icon><NIcon :component="FolderOpenOutline" /></template></NButton>
          <NDropdown :options="menu.map(item => ({ ...item, disabled: ['edit', 'delete'].includes(item.key) && busy(instance) }))" trigger="click" @select="key => menuSelect(key, instance)"><NButton quaternary circle :aria-label="`${instance.name} 更多操作`"><template #icon><NIcon :component="EllipsisHorizontal" /></template></NButton></NDropdown>
          <NButton v-if="instance.installation === 'ready'" size="small" :disabled="!!snapshot.installation || gameActive" @click="install(instance)">安装 / 修复</NButton>
        </div>
      </div>
      <p class="page-note"><NIcon :component="SettingsOutline" /> 每个实例可单独设置内存、窗口与 Java。在更多操作中打开实例设置。</p>
    </template>
    <InstanceEditor v-model:show="showEditor" :instance="editing" />
  </section>
</template>
