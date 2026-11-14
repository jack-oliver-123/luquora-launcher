import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { open, rename, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { LauncherError } from '../errors'
import { assertManagedPath, ensureManagedDirectory } from '../storage/paths'

export type DownloadFile = { url: string; path: string; sha1: string; size: number }
export async function fileValid(file: DownloadFile): Promise<boolean> {
  try {
    if ((await stat(file.path)).size !== file.size) return false
    const hash = createHash('sha1')
    for await (const chunk of createReadStream(file.path)) hash.update(chunk)
    return hash.digest('hex') === file.sha1
  } catch (error) { if (['ENOENT', 'EISDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return false; throw error }
}

export async function downloadFile(root: string, file: DownloadFile, signal: AbortSignal, progress: (bytes: number) => void, options: { allowLocalHttp?: boolean; retryDelay?: number } = {}): Promise<void> {
  signal.throwIfAborted()
  const url = new URL(file.url)
  if ((url.protocol !== 'https:' && !(options.allowLocalHttp && url.protocol === 'http:' && url.hostname === '127.0.0.1')) || url.username || url.password || !/^[a-f0-9]{40}$/i.test(file.sha1) || !Number.isSafeInteger(file.size) || file.size < 0) throw new LauncherError('INTEGRITY', '下载元数据无效。')
  await assertManagedPath(root, file.path)
  if (await fileValid(file)) { progress(file.size); return }
  await ensureManagedDirectory(root, dirname(file.path))
  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted()
    const temporary = `${file.path}.${randomUUID()}.part`
    let idle: ReturnType<typeof setTimeout> | undefined
    try {
      const timeout = new AbortController()
      const reset = () => { clearTimeout(idle); idle = setTimeout(() => timeout.abort(), 30000) }
      reset()
      const response = await fetch(url, { signal: AbortSignal.any([signal, timeout.signal]) })
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after')
        const waitMs = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : retryAfter ? Date.parse(retryAfter) - Date.now() : 1000
        await response.body?.cancel()
        if (!Number.isFinite(waitMs) || waitMs > 30000) throw new LauncherError('SERVICE', '下载服务要求稍后重试。', '等待片刻后手动重试。')
        await delay(Math.max(0, waitMs), undefined, { signal })
        throw new LauncherError('NETWORK', '下载请求过于频繁。')
      }
      if (!response.ok || !response.body) throw new LauncherError('NETWORK', `下载服务响应异常（${response.status}）。`)
      const handle = await open(temporary, 'wx')
      const hash = createHash('sha1')
      let received = 0
      try {
        for await (const chunk of response.body) {
          reset(); signal.throwIfAborted()
          received += chunk.byteLength
          if (received > file.size) throw new LauncherError('INTEGRITY', '文件尺寸与元数据不符。')
          hash.update(chunk)
          await handle.write(chunk)
        }
      } finally { await handle.close() }
      if (received !== file.size || hash.digest('hex') !== file.sha1) throw new LauncherError('INTEGRITY', '文件完整性校验失败。')
      signal.throwIfAborted()
      await assertManagedPath(root, file.path)
      await rename(temporary, file.path)
      progress(received)
      return
    } catch (error) {
      signal.throwIfAborted()
      if (attempt === 2 || ['ENOSPC', 'EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '') || error instanceof LauncherError && error.code === 'SERVICE') throw error
    } finally { clearTimeout(idle); await rm(temporary, { force: true }) }
    await delay((options.retryDelay ?? 1000) * (attempt + 1), undefined, { signal })
  }
}

export async function inParallel<T>(items: T[], operation: (item: T) => Promise<void>, signal: AbortSignal): Promise<void> {
  let cursor = 0
  let failure: unknown
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (cursor < items.length && !failure) {
      try { signal.throwIfAborted(); await operation(items[cursor++]) } catch (error) { failure = error }
    }
  }))
  if (failure) throw failure
}

export async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  if (new URL(url).protocol !== 'https:') throw new LauncherError('INTEGRITY', '仅接受 HTTPS 元数据。')
  try {
    const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) })
    if (!response.ok) throw new LauncherError('NETWORK', `元数据请求失败（${response.status}）。`, '检查网络连接后重试。')
    const text = await response.text()
    if (text.length > 32 * 1024 * 1024) throw new LauncherError('INTEGRITY', '元数据尺寸异常。')
    return JSON.parse(text) as T
  } catch (error) { signal.throwIfAborted(); if (error instanceof LauncherError) throw error; throw new LauncherError('NETWORK', '无法获取游戏元数据。', '检查网络连接后重试。') }
}
