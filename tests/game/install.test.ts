import { expect, test } from 'vitest'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'

test('download rejects bad checksum, retries, and preserves a verified existing file', async () => {
  const module = await import('../../src/main/game/download').catch(() => null)
  expect(module, 'verified downloader missing').not.toBeNull()
  let attempts = 0
  const server = createServer((_request, response) => { attempts++; response.end(attempts === 1 ? 'wrong!' : 'valid!') })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const root = await mkdtemp(join(tmpdir(), 'lql-download-'))
  try {
    const address = server.address() as { port: number }
    const file = { url: `http://127.0.0.1:${address.port}/file`, path: join(root, 'files', 'client.jar'), sha1: createHash('sha1').update('valid!').digest('hex'), size: 6 }
    await module!.downloadFile(root, file, new AbortController().signal, () => {}, { allowLocalHttp: true, retryDelay: 1 })
    expect(await readFile(file.path, 'utf8')).toBe('valid!')
    expect(attempts).toBe(2)
    await module!.downloadFile(root, file, new AbortController().signal, () => {}, { allowLocalHttp: true, retryDelay: 1 })
    expect(attempts).toBe(2)
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }) }
})

test('cancelled downloads never replace destination with partial data', async () => {
  const module = await import('../../src/main/game/download').catch(() => null)
  expect(module, 'cancellation missing').not.toBeNull()
  const root = await mkdtemp(join(tmpdir(), 'lql-cancel-'))
  try {
    const abort = new AbortController(); abort.abort()
    const target = join(root, 'files', 'incomplete')
    await expect(module!.downloadFile(root, { url: 'https://example.com/file', path: target, sha1: 'a'.repeat(40), size: 5 }, abort.signal, () => {})).rejects.toThrow()
    await expect(readFile(target)).rejects.toThrow()
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('parallel cancellation waits for all active writers to settle', async () => {
  const module = await import('../../src/main/game/download')
  const controller = new AbortController()
  let slowWriterStopped = false
  const batch = module.inParallel([1, 2, 3, 4, 5], async item => {
    if (item === 1) { await delay(5); controller.abort() }
    else { await delay(30); slowWriterStopped = true }
  }, controller.signal)
  await expect(batch).rejects.toThrow()
  expect(slowWriterStopped).toBe(true)
})
