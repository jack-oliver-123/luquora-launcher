<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { NAlert, NButton, NConfigProvider, NGlobalStyle, NIcon, NModal, NSpin, zhCN, dateZhCN, type GlobalThemeOverrides } from 'naive-ui'
import { CheckmarkCircleOutline, CubeOutline, DocumentTextOutline, PersonOutline, SettingsOutline } from '@vicons/ionicons5'
import { api, connect, launcher, perform } from './state'
import InstancesView from './views/InstancesView.vue'
import AccountsView from './views/AccountsView.vue'
import SettingsView from './views/SettingsView.vue'
import LogsView from './views/LogsView.vue'

const page = ref('instances')
const navigation = [{ id: 'instances', label: '实例', icon: CubeOutline }, { id: 'accounts', label: '账号', icon: PersonOutline }, { id: 'settings', label: '设置', icon: SettingsOutline }, { id: 'logs', label: '日志', icon: DocumentTextOutline }]
const theme: GlobalThemeOverrides = {
  common: { primaryColor: '#29292d', primaryColorHover: '#45454b', primaryColorPressed: '#18181b', primaryColorSuppl: '#45454b', infoColor: '#60606b', textColorBase: '#1d1d1f', textColor1: '#1d1d1f', textColor2: '#52525a', textColor3: '#85858e', bodyColor: '#f8f8fa', cardColor: '#ffffff', modalColor: '#ffffff', borderColor: '#e4e4e9', borderRadius: '9px', fontFamily: '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", sans-serif', fontSize: '14px', heightMedium: '38px', heightLarge: '44px' },
  Button: { fontWeight: '500', borderRadiusLarge: '11px' },
  Input: { color: '#fafafa', colorFocus: '#ffffff' },
  Select: { peers: { InternalSelection: { color: '#fafafa' } } },
  Card: { borderRadius: '18px', titleFontSizeMedium: '21px', titleFontWeight: '600' },
  Switch: { railColorActive: '#414148' },
}
const status = computed(() => launcher.snapshot?.installation ? '正在安装' : launcher.snapshot?.game.phase === 'running' ? '游戏运行中' : ['checking', 'starting'].includes(launcher.snapshot?.game.phase ?? '') ? '正在启动' : launcher.snapshot?.authPending ? '等待微软授权' : '就绪')
let unsubscribe: (() => void) | undefined
onMounted(() => { unsubscribe = connect() })
onUnmounted(() => unsubscribe?.())
</script>

<template>
  <NConfigProvider :theme-overrides="theme" :locale="zhCN" :date-locale="dateZhCN">
    <NGlobalStyle />
    <div class="launcher-shell">
      <aside class="sidebar"><div class="brand"><svg class="brand-mark" viewBox="0 0 110 138" aria-hidden="true"><path d="M0 0h39v104h71l-19 34H0z" fill="#29292d" /><path d="M0 138l39-34h71l-19 34z" fill="#686872" /></svg><div><strong>Luquora</strong><span>Launcher</span></div></div><nav aria-label="主导航"><NButton v-for="item in navigation" :key="item.id" quaternary :class="['nav-button', { active: page === item.id }]" :aria-label="item.label" :aria-current="page === item.id ? 'page' : undefined" @click="page = item.id"><template #icon><NIcon :component="item.icon" :size="23" /></template>{{ item.label }}</NButton></nav><div class="sidebar-foot">Minecraft Java Edition<br><span>LQL 0.1.0</span></div></aside>
      <div class="workspace"><main class="page-content"><NAlert v-if="launcher.error" type="error" closable class="spaced-alert" @close="launcher.error = null"><strong>{{ launcher.error.message }}</strong><p v-if="launcher.error.nextAction">{{ launcher.error.nextAction }}</p><p class="error-stage">阶段 {{ launcher.error.stage }}</p></NAlert><NAlert v-if="launcher.notice" type="success" closable class="spaced-alert" @close="launcher.notice = ''">{{ launcher.notice }}</NAlert><template v-if="launcher.snapshot"><InstancesView v-if="page === 'instances'" @accounts="page = 'accounts'" @logs="page = 'logs'" /><AccountsView v-else-if="page === 'accounts'" /><SettingsView v-else-if="page === 'settings'" /><LogsView v-else /></template><div v-else class="startup-state"><NSpin size="large" /><p>正在准备你的启动器…</p><NButton v-if="launcher.error" @click="perform('initialize', async () => { launcher.snapshot = await api.getSnapshot() })">重试</NButton></div></main><footer class="status-bar"><span><NIcon :component="CheckmarkCircleOutline" :size="17" />{{ status }}</span><span>Windows x64</span></footer></div>
    </div>
    <NModal :show="!!launcher.authCode || !!launcher.authFailure" preset="card" :title="launcher.authFailure ? '微软账号未添加' : '在微软页面完成授权'" class="auth-modal" :mask-closable="false" :closable="false"><template v-if="launcher.authFailure"><NAlert type="error" role="alert"><strong>{{ launcher.authFailure.message }}</strong><p v-if="launcher.authFailure.nextAction">{{ launcher.authFailure.nextAction }}</p><p class="error-stage">阶段 {{ launcher.authFailure.stage }}</p></NAlert><div class="modal-actions"><NButton @click="launcher.authFailure = null">关闭</NButton><NButton type="primary" :loading="launcher.busy.has('add-account')" @click="perform('add-account', () => api.addAccount())">重新授权</NButton></div></template><template v-else><NAlert :type="launcher.authCode?.copied ? 'success' : 'warning'" role="status">{{ launcher.authCode?.copied ? '代码已自动复制，请在微软网页中按 Ctrl + V 粘贴并完成登录。' : '未能自动复制代码，请手动输入下方代码，或点击按钮重试。' }}</NAlert><p class="modal-intro">{{ launcher.authCode?.browserOpened === true ? '已打开微软授权网页。网页显示“大功告成”只代表微软账号登录成功；请回到 LQL，等待 Xbox 与 Minecraft 检查完成。' : launcher.authCode?.browserOpened === false ? '未能自动打开浏览器，请点击下方按钮重试，或手动访问以下网址。' : '正在打开微软授权网页…' }}</p><div class="device-code">{{ launcher.authCode?.code }}</div><p class="small muted">{{ launcher.authCode?.verificationUri }}<br>有效期至 {{ launcher.authCode ? new Date(launcher.authCode.expiresAt).toLocaleTimeString('zh-CN') : '' }}</p><div class="modal-actions"><NButton @click="perform('cancel-auth', () => api.cancelAuth())">取消授权</NButton><NButton type="primary" :loading="launcher.busy.has('open-auth')" @click="perform('open-auth', () => api.openAuthPage())">复制代码并打开授权页</NButton></div></template></NModal>
  </NConfigProvider>
</template>
