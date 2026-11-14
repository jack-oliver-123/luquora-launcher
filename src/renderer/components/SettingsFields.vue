<script setup lang="ts">
import { NButton, NFormItem, NInput, NInputNumber, NSwitch } from 'naive-ui'
import type { LaunchSettings } from '../../shared/contracts'

defineProps<{ model: LaunchSettings; disabled?: boolean }>()
defineEmits<{ chooseJava: []; automaticJava: [] }>()
</script>

<template>
  <div class="settings-fields">
    <NFormItem label="最大内存（MiB）">
      <NInputNumber v-model:value="model.memoryMiB" :min="256" :step="256" :disabled="disabled" style="width: 200px" />
    </NFormItem>
    <p class="field-hint">为游戏分配内存，建议为系统和其他应用保留足够空间。</p>
    <div class="field-pair">
      <NFormItem label="窗口宽度"><NInputNumber v-model:value="model.width" :min="320" :max="16384" :disabled="disabled" /></NFormItem>
      <NFormItem label="窗口高度"><NInputNumber v-model:value="model.height" :min="320" :max="16384" :disabled="disabled" /></NFormItem>
    </div>
    <div class="setting-row">
      <div><strong>全屏启动</strong><p>使用游戏的全屏模式打开。</p></div>
      <NSwitch v-model:value="model.fullscreen" :disabled="disabled" aria-label="全屏启动" />
    </div>
    <NFormItem label="Java 运行时" class="java-field">
      <div class="full-width">
        <NInput :value="model.javaPath ?? '自动选择并准备兼容的 Java'" readonly :disabled="disabled" aria-label="Java 运行时" />
        <div class="inline-actions"><NButton size="small" :disabled="disabled" @click="$emit('chooseJava')">选择 java.exe</NButton><NButton size="small" quaternary :disabled="disabled || !model.javaPath" @click="$emit('automaticJava')">恢复自动选择</NButton></div>
      </div>
    </NFormItem>
  </div>
</template>
