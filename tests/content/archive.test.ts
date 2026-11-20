import { test, expect } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ZipFile } from 'yazl'
import { readPack, extractOverrides, safePackPath } from '../../src/main/content/archive'

const index = { formatVersion: 1, game: 'minecraft', versionId: 'v1', name: 'Test pack', files: [], dependencies: { minecraft: '1.20.1', 'fabric-loader': '0.16.14' } }

test('Windows dangerous archive paths and protected user directories are refused', () => {
  for (const path of ['../out', 'C:/out', '//server/file', 'mods/a.jar:secret', 'mods/CON.jar', 'mods/A. /file', 'saves/world/data', 'mods/../out', 'mods\\file.jar']) expect(() => safePackPath(path)).toThrow()
  expect(safePackPath('config/中文 settings.json')).toBe('config/中文 settings.json')
})

test('client overrides take precedence and server overrides are never installed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lql-pack-'))
  try {
    const archive = new ZipFile()
    archive.addBuffer(Buffer.from(JSON.stringify(index)), 'modrinth.index.json')
    archive.addBuffer(Buffer.from('base'), 'overrides/config/test.txt')
    archive.addBuffer(Buffer.from('client'), 'client-overrides/config/test.txt')
    archive.addBuffer(Buffer.from('server'), 'server-overrides/config/server.txt')
    archive.end()
    const path = join(root, 'pack.mrpack')
    await pipeline(archive.outputStream, createWriteStream(path))
    const pack = await readPack(path, new AbortController().signal)
    expect(pack.loader).toEqual({ kind: 'fabric', version: '0.16.14' })
    await extractOverrides(pack, join(root, 'extracted'), new AbortController().signal)
    expect(await readFile(join(root, 'extracted', 'config', 'test.txt'), 'utf8')).toBe('client')
    await expect(readFile(join(root, 'extracted', 'config', 'server.txt'))).rejects.toThrow()
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('unsupported dependencies and case-colliding ZIP entries reject the whole pack', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lql-pack-bad-'))
  try {
    for (const bad of ['dependency', 'collision']) {
      const archive = new ZipFile()
      archive.addBuffer(Buffer.from(JSON.stringify(bad === 'dependency' ? { ...index, dependencies: { ...index.dependencies, unknown: '1' } } : index)), 'modrinth.index.json')
      if (bad === 'collision') { archive.addBuffer(Buffer.from('a'), 'overrides/mods/A.jar'); archive.addBuffer(Buffer.from('b'), 'overrides/mods/a.jar') }
      archive.end()
      const path = join(root, `${bad}.mrpack`)
      await pipeline(archive.outputStream, createWriteStream(path))
      await expect(readPack(path, new AbortController().signal)).rejects.toThrow()
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})
