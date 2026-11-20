import { test, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { downloadFile, fileValid } from '../../src/main/game/download'

test('SHA-512 resources are verified and reused without a second request', async () => {
  const data = Buffer.from('modrinth artifact')
  let requests = 0
  const server = createServer((_request, response) => { requests++; response.end(data) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const root = await mkdtemp(join(tmpdir(), 'lql-sha512-'))
  try {
    const file = { url: `http://127.0.0.1:${(server.address() as { port: number }).port}/mod`, path: join(root, 'mod.jar'), size: data.length, sha512: createHash('sha512').update(data).digest('hex') }
    await downloadFile(root, file, new AbortController().signal, () => {}, { allowLocalHttp: true })
    expect(await readFile(file.path)).toEqual(data)
    expect(await fileValid(file)).toBe(true)
    await downloadFile(root, file, new AbortController().signal, () => {}, { allowLocalHttp: true })
    expect(requests).toBe(1)
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }) }
})

test('content downloads refuse unapproved redirect destinations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lql-redirect-'))
  try {
    await expect(downloadFile(root, { url: 'https://localhost/secret', path: join(root, 'file'), size: 0, sha1: 'a'.repeat(40) }, new AbortController().signal, () => {}, { allowedHosts: ['cdn.modrinth.com'] })).rejects.toThrow()
  } finally { await rm(root, { recursive: true, force: true }) }
})
