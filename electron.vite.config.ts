import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], define: { 'process.env.LQL_BUILD_MS_CLIENT_ID': JSON.stringify(process.env.LQL_MS_CLIENT_ID ?? 'e3cb9f3c-2e1e-426a-8a07-2bc774342b94') } },
  preload: { build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } } },
  renderer: { plugins: [vue()] },
})
