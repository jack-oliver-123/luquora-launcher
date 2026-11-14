import { reactive } from 'vue'
import type { AppError, AppSnapshot, AuthCode, LauncherAPI } from '../shared/contracts'

export const launcher = reactive({
  snapshot: null as AppSnapshot | null,
  error: null as AppError | null,
  notice: '',
  busy: new Set<string>(),
  authCode: null as AuthCode | null,
  authFailure: null as AppError | null,
  logId: null as string | null,
  logLines: [] as string[],
})
export const api: LauncherAPI = window.lql
export async function perform<T>(key: string, operation: () => Promise<T>): Promise<T | undefined> {
  if (launcher.busy.has(key)) return
  launcher.busy.add(key)
  launcher.error = null
  try { return await operation() }
  catch (error) { launcher.error = { code: 'SERVICE', stage: 'renderer', message: error instanceof Error ? error.message : '操作未完成，请重试。', nextAction: '' } }
  finally { launcher.busy.delete(key) }
}
export function connect(): () => void {
  const unsubscribe = api.onEvent(event => {
    if (event.type === 'snapshot') launcher.snapshot = event.data
    else if (event.type === 'error') launcher.error = event.data
    else if (event.type === 'auth-code') launcher.authCode = event.data
    else if (event.type === 'auth-ended') { launcher.authCode = null; launcher.authFailure = event.data.failure ?? null; if (event.data.outcome === 'success') launcher.notice = '微软账号已添加，请选择用于启动的账号。' }
    else if (event.type === 'log-lines' && event.data.sessionId === launcher.logId) launcher.logLines = [...launcher.logLines, ...event.data.lines].slice(-2000)
  })
  void perform('initialize', async () => { launcher.snapshot = await api.getSnapshot() })
  return unsubscribe
}
