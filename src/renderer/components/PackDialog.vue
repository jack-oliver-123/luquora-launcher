<script setup lang="ts">
import { ref, watch } from 'vue'
import { NAlert, NButton, NCheckbox, NCheckboxGroup, NFormItem, NInput, NModal, NTag } from 'naive-ui'
import type { PackPreview } from '../../shared/content'
import { api, launcher, perform } from '../state'
const props = defineProps<{ preview: PackPreview | null; updating?: boolean }>()
const emit = defineEmits<{ close: []; installed: [] }>()
const name = ref('')
const optional = ref<string[]>([])
watch(() => props.preview, value => { name.value = value?.name.slice(0, 80) ?? ''; optional.value = [] })
async function install() {
  if (!props.preview) return
  const id = props.preview.id; const selected = [...optional.value]; const instanceName = name.value
  emit('close')
  const success = await perform('install-pack', async () => { if (props.updating) await api.applyPackUpdate(id, selected); else await api.installPack(id, instanceName, selected); return true })
  if (success) { launcher.notice = props.updating ? '整合包已更新，存档与用户修改已保留。' : '整合包已安装，可在实例中启动。'; emit('installed') }
}
</script>
<template>
  <NModal :show="!!preview" preset="card" :title="updating ? '确认整合包更新' : '安装整合包'" class="content-modal" @update:show="emit('close')">
    <template v-if="preview">
      <div class="pack-summary"><h2>{{ preview.name }}</h2><p>{{ preview.version }}</p><div class="inline-actions"><NTag :bordered="false">Minecraft {{ preview.gameVersion }}</NTag><NTag :bordered="false">{{ preview.loader ? `${preview.loader.kind} ${preview.loader.version}` : '原版' }}</NTag></div></div>
      <NFormItem v-if="!updating" label="实例名称"><NInput v-model:value="name" :maxlength="80" placeholder="为整合包实例命名" /></NFormItem>
      <p class="modal-intro">包含 {{ preview.required }} 个必要文件，自动准备游戏、加载器与 Java。</p>
      <template v-if="preview.optional.length"><h3>可选客户端内容</h3><NCheckboxGroup v-model:value="optional"><div class="optional-files"><NCheckbox v-for="path in preview.optional" :key="path" :value="path">{{ path }}</NCheckbox></div></NCheckboxGroup></template>
      <NAlert :type="updating ? 'warning' : 'info'" :bordered="false">{{ updating ? '更新前会备份变更文件。用户配置与新版本冲突时会停止更新，存档和截图不会被覆盖。' : '整合包会创建独立实例。服务端专用文件不会安装；资源许可由原作者保留。' }}</NAlert>
      <details v-if="preview.changes?.length" class="change-details"><summary>查看必要文件变更（{{ preview.changes.length }}）</summary><ul><li v-for="path in preview.changes" :key="path">{{ path }}</li></ul><p class="modal-intro">可选文件按上方勾选结果另行加入。执行前会重新检查用户修改与文件冲突。</p></details>
      <div class="modal-actions"><NButton @click="emit('close')">取消</NButton><NButton type="primary" :disabled="!updating && !name.trim()" @click="install">{{ updating ? '备份并更新' : '创建并安装' }}</NButton></div>
    </template>
  </NModal>
</template>
