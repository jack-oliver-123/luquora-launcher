<script setup lang="ts">
import { NAlert, NButton, NModal, NTag } from 'naive-ui'
import type { ResourcePlan } from '../../shared/content'
import { api, launcher, perform } from '../state'
const props = defineProps<{ plan: ResourcePlan | null }>()
const emit = defineEmits<{ close: []; installed: [] }>()
async function install() {
  if (!props.plan) return
  const id = props.plan.id
  emit('close')
  const result = await perform('install-resource', async () => { await api.applyResource(id); return true })
  if (result) { launcher.notice = '资源与必要依赖已安装。'; emit('installed') }
}
</script>
<template>
  <NModal :show="!!plan" preset="card" title="确认资源安装" class="content-modal" @update:show="emit('close')">
    <template v-if="plan">
      <p class="modal-intro">安装 {{ plan.title }}，并处理以下必要依赖。替换前会备份原文件。</p>
      <div class="plan-list"><div v-for="item in plan.files" :key="item.version.id" class="plan-item"><div><strong>{{ item.project.title }}</strong><p>{{ item.version.version_number }} · {{ item.path }}</p></div><NTag size="small" :bordered="false">{{ item.replaces ? '替换' : '新增' }}</NTag></div></div>
      <NAlert type="info" :bordered="false">版本兼容信息来自资源作者，不保证所有模组之间都能兼容。已有模组的禁用状态会保留。</NAlert>
      <div class="modal-actions"><NButton @click="emit('close')">取消</NButton><NButton type="primary" @click="install">安装 {{ plan.files.length }} 个资源</NButton></div>
    </template>
  </NModal>
</template>
