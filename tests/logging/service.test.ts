import { expect, test } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { LogService } from '../../src/main/logging'

test('line limits apply across output chunks and reset after a newline', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lql-line-'))
  try {
    const logs = new LogService(() => root, () => {}); await logs.initialize()
    const id = await logs.begin({ instanceId: 'instance', versionId: '1.20.1', javaMajor: 17 })
    for (let index = 0; index < 5; index++) logs.write(id, 'a'.repeat(30000))
    logs.write(id, '\nnext line\n')
    await logs.flush(id)
    const lines = await logs.read(id)
    expect(Math.max(...lines.map(line => Buffer.byteLength(line)))).toBeLessThanOrEqual(65536)
    expect(lines).toContain('next line')
    expect(lines.some(line => line.includes('[line truncated]'))).toBe(true)
  } finally { await rm(root, { recursive: true, force: true }) }
})
