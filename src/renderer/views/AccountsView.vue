<script setup lang="ts">
import { computed, ref } from 'vue'
import { NAlert, NButton, NForm, NFormItem, NIcon, NInput, NModal, NPopconfirm, NSpace, NTag } from 'naive-ui'
import { AddOutline, PersonOutline, ShieldCheckmarkOutline } from '@vicons/ionicons5'
import { api, launcher, perform } from '../state'

const showLocal = ref(false)
const name = ref('')
const validName = computed(() => /^[A-Za-z0-9_]{3,16}$/.test(name.value.trim()))
function openLocal() { name.value = ''; launcher.error = null; showLocal.value = true }
async function saveLocal() {
  if (!validName.value) return
  const result = await perform('local-profile', () => api.addLocalProfile(name.value.trim()))
  if (result) { showLocal.value = false; launcher.notice = `已选择本地角色 ${result.name}。` }
}
</script>

<template>
  <section v-if="launcher.snapshot">
    <header class="page-header"><div><h1>账号与角色</h1><p>选一个名字，开启你的世界。</p></div><NSpace justify="end"><NButton size="large" :disabled="!launcher.snapshot.clientConfigured || launcher.snapshot.authPending" :loading="launcher.snapshot.authPending" @click="perform('auth', () => api.addAccount())">微软登录</NButton><NButton type="primary" size="large" @click="openLocal"><template #icon><NIcon :component="AddOutline" /></template>添加本地角色</NButton></NSpace></header>
    <NAlert v-if="!launcher.snapshot.clientConfigured" type="info" :bordered="false" title="微软登录尚未配置" class="spaced-alert">本地角色无需登录即可启动单人游戏。微软登录需配置 LQL 自有应用后使用。</NAlert>
    <NAlert v-if="!launcher.snapshot.persistentAuth" type="warning" :bordered="false" title="会话仅本次有效" class="spaced-alert">Windows 加密存储当前不可用，账号会话不会以明文保存。重启后需要重新授权。</NAlert>
    <div v-if="!launcher.snapshot.accounts.length" class="quiet-empty surface"><div class="round-icon large"><NIcon :component="PersonOutline" :size="36" /></div><h2>让你的世界，认出你。</h2><p>创建本地角色，从一段单人冒险开始。</p><NButton @click="openLocal">添加本地角色</NButton><p class="small muted">需要正版验证的服务器与 Realms 请使用微软账号。</p></div>
    <div v-else class="account-list surface"><div v-for="account in launcher.snapshot.accounts" :key="account.id" class="account-row"><div class="avatar">{{ account.name.slice(0, 1).toUpperCase() }}</div><div class="account-details"><strong>{{ account.name }}</strong><p>{{ account.kind === 'local' ? '本地角色 · 单人游戏 / 离线服务器' : account.status === 'ready' ? '微软账号 · 已验证的 Minecraft 角色' : '微软账号 · 启动前刷新授权' }}</p></div><NTag v-if="launcher.snapshot.config.selectedAccountId === account.id" :bordered="false" round>当前使用</NTag><NButton v-else @click="perform('account', () => api.selectAccount(account.id))">设为当前</NButton><NButton v-if="account.status === 'reauth-required'" :disabled="launcher.snapshot.authPending" @click="perform('auth', () => api.addAccount())">重新授权</NButton><NPopconfirm @positive-click="perform('remove-account', () => api.removeAccount(account.id))"><template #trigger><NButton quaternary :disabled="launcher.snapshot.authPending || launcher.busy.has('remove-account')">移除</NButton></template>{{ account.kind === 'local' ? '移除此本地角色？游戏存档会保留。再次使用完全相同的昵称可恢复原角色 UUID。' : '从 LQL 移除此账号及其本地会话？' }}</NPopconfirm></div></div>
    <div class="privacy-note"><NIcon :component="ShieldCheckmarkOutline" :size="21" /><div><strong>角色留在本地，冒险由你开始。</strong><p>本地角色不验证正版身份，不提供在线皮肤、Realms 或正版服务器认证。微软会话由 Windows 加密保存，LQL 不自动上传日志。</p></div></div>
    <NModal v-model:show="showLocal" preset="card" title="添加本地角色" class="editor-modal" :mask-closable="!launcher.busy.has('local-profile')">
      <p class="modal-intro">无需登录即可开始单人游戏。昵称决定角色 UUID，请保持一致，以便继续使用存档中的角色数据。</p>
      <NForm label-placement="top" :disabled="launcher.busy.has('local-profile')" @submit.prevent="saveLocal">
        <NFormItem label="角色昵称" required :validation-status="name && !validName ? 'error' : undefined" :feedback="name && !validName ? '使用 3–16 位英文字母、数字或下划线。' : '昵称区分大小写，UUID 按 Minecraft 离线规则生成。'"><NInput v-model:value="name" placeholder="例如：Luquora" :maxlength="16" show-count autofocus /></NFormItem>
        <NAlert v-if="launcher.error" type="error" :bordered="false">{{ launcher.error.message }}</NAlert>
        <div class="modal-actions"><NButton @click="showLocal = false">取消</NButton><NButton type="primary" attr-type="submit" :disabled="!validName" :loading="launcher.busy.has('local-profile')">创建角色</NButton></div>
      </NForm>
    </NModal>
  </section>
</template>
