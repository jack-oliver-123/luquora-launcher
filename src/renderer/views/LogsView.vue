<script setup lang="ts">
import { computed, watch } from 'vue'
import { NButton, NIcon, NSelect, NSpin } from 'naive-ui'
import { DocumentTextOutline } from '@vicons/ionicons5'
import { api, launcher, perform } from '../state'

const options = computed(() => launcher.snapshot?.logs.map(log => ({ label: `${new Date(log.createdAt).toLocaleString('zh-CN')} · ${launcher.snapshot?.config.instances.find(instance => instance.id === log.instanceId)?.name ?? '已删除实例'} · ${log.versionId}`, value: log.id })) ?? [])
async function read(id: string | null) { launcher.logId = id; launcher.logLines = []; if (id) await perform('read-log', async () => { const lines = await api.readLog(id); if (launcher.logId === id) launcher.logLines = lines }) }
watch(() => launcher.snapshot?.logs[0]?.id, id => { if (id && !launcher.logId) void read(id) }, { immediate: true })
</script>

<template>
  <section>
    <header class="page-header"><div><h1>游戏日志</h1><p>每一次启动，都有迹可循。</p></div><NButton :disabled="!launcher.logId" :loading="launcher.busy.has('export')" @click="perform('export', async () => { const path = await api.exportLog(launcher.logId!); if (path) launcher.notice = '日志已导出。' })">导出日志</NButton></header>
    <div v-if="!options.length" class="quiet-empty surface"><div class="round-icon large"><NIcon :component="DocumentTextOutline" :size="36" /></div><h2>还没有启动记录</h2><p>启动游戏后，在这里查看运行输出和退出信息。</p></div>
    <template v-else><div class="log-toolbar"><NSelect :value="launcher.logId" :options="options" placeholder="选择启动记录" @update:value="read" /><NButton :disabled="!launcher.logId" @click="read(launcher.logId)">刷新</NButton></div><NSpin :show="launcher.busy.has('read-log')"><pre class="log-content" aria-label="游戏日志内容" tabindex="0">{{ launcher.logLines.join('\n') || '暂无日志输出。' }}</pre></NSpin><p class="page-note">显示最近 2000 行，保留最近 10 次启动。已对已知令牌脱敏；导出内容仍可能包含本地路径、聊天或游戏内容。</p></template>
  </section>
</template>
