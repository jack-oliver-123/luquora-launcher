<script setup lang="ts">
import { computed } from 'vue'
import { NButton, NEmpty, NProgress, NTag } from 'naive-ui'
import { api, launcher, perform } from '../state'
const tasks = computed(() => [...(launcher.snapshot?.contentTasks ?? [])].reverse())
const phases = { queued: '等待中', running: '进行中', complete: '已完成', failed: '失败', cancelled: '已取消' }
const installation = computed(() => launcher.snapshot?.installation)
const stages = { metadata: '读取游戏元数据', java: '准备 Java', files: '下载游戏与资源', loader: '安装加载器', verify: '校验文件', complete: '已完成' }
</script>
<template>
  <section>
    <header class="page-header"><div><h1>下载任务</h1><p>查看安装进度、完成记录与失败原因。</p></div></header>
    <div v-if="installation" class="task-panel surface"><div class="task-heading"><div><strong>{{ stages[installation.stage] }}</strong><p>{{ launcher.snapshot?.config.instances.find(instance => instance.id === installation?.instanceId)?.name ?? '整合包游戏环境' }}</p></div><NButton @click="perform('cancel-install', () => api.cancelInstall())">取消安装</NButton></div><NProgress type="line" :percentage="installation.total ? Math.min(100, Math.round(installation.completed / installation.total * 100)) : 0" :show-indicator="!!installation.total" :processing="true" /></div>
    <NEmpty v-if="!tasks.length && !installation" description="还没有下载任务。到资源中心寻找新的玩法。" class="content-loading" />
    <div class="download-tasks"><article v-for="task in tasks" :key="task.id" class="task-panel surface"><div class="task-heading"><div><strong>{{ task.title }}</strong><p>{{ task.stage }} · {{ new Date(task.startedAt).toLocaleTimeString('zh-CN') }}</p></div><NTag :bordered="false" :type="task.phase === 'failed' ? 'error' : task.phase === 'complete' ? 'success' : 'default'">{{ phases[task.phase] }}</NTag><NButton v-if="['queued', 'running'].includes(task.phase)" size="small" @click="perform(`cancel-${task.id}`, () => api.cancelContentTask(task.id))">取消任务</NButton></div><NProgress v-if="task.phase === 'running'" type="line" :percentage="task.total ? Math.min(100, Math.round(task.completed / task.total * 100)) : 0" :show-indicator="!!task.total" :processing="true" /><p v-if="task.error" class="task-error">{{ task.error }}</p><p v-if="task.phase === 'failed'" class="progress-caption">修复原因后，从资源详情或实例中重新发起操作。已验证的游戏文件会复用。</p></article></div>
    <p class="page-note">任务记录保留在本次会话中。取消会等待文件写入结束，未完成的文件不会标记为可用。</p>
  </section>
</template>
