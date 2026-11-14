<script setup lang="ts">
import { ref, watch } from 'vue'
import { NButton, NForm } from 'naive-ui'
import type { LaunchSettings } from '../../shared/contracts'
import { api, launcher, perform } from '../state'
import SettingsFields from '../components/SettingsFields.vue'

const settings = ref<LaunchSettings>({ memoryMiB: 2048, width: 1280, height: 720, fullscreen: false, javaPath: null })
watch(() => JSON.stringify(launcher.snapshot?.config.defaults), () => { if (launcher.snapshot) settings.value = { ...launcher.snapshot.config.defaults } }, { immediate: true })
async function save() {
  await perform('settings', async () => { await api.saveSettings({ ...settings.value }); launcher.notice = '启动设置已保存。' })
}
async function chooseJava() { const path = await perform('java', () => api.chooseJavaPath(null)); if (path) settings.value.javaPath = path }
</script>

<template>
  <section v-if="launcher.snapshot">
    <header class="page-header"><div><h1>启动器设置</h1><p>恰到好处的设置，留给每一次启动。</p></div></header>
    <div class="settings-layout"><div class="surface settings-card"><div class="card-heading"><h2>默认启动设置</h2><p>应用到所有未单独设置的实例。</p></div><NForm label-placement="top" @submit.prevent="save"><SettingsFields :model="settings" :disabled="launcher.busy.has('settings')" @choose-java="chooseJava" @automatic-java="settings.javaPath = null" /><div class="settings-save"><NButton type="primary" attr-type="submit" :loading="launcher.busy.has('settings')">保存设置</NButton></div></NForm></div>
      <aside class="settings-aside"><div class="surface settings-card"><h2>游戏数据</h2><p class="muted">实例存档彼此独立，游戏资源与 Java 运行时共享。</p><div class="path-display">{{ launcher.snapshot.config.gameRoot }}</div><NButton :disabled="!!launcher.snapshot.config.instances.length" :loading="launcher.busy.has('root')" @click="perform('root', () => api.chooseGameRoot())">更改数据目录</NButton><p class="small muted">{{ launcher.snapshot.config.instances.length ? '已有实例，当前版本暂不支持目录迁移。' : '可在创建第一个实例前选择目录。' }}</p></div><div class="about-note"><strong>Luquora Launcher</strong><p>LQL 0.1.0 · Windows x64</p><p>专注于 Minecraft Java 版原版游戏。</p><p class="small">独立项目，与 Mojang 或 Microsoft 无隶属关系。</p></div></aside>
    </div>
  </section>
</template>
