import { test, expect } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileTransactions, mergePackFiles } from '../../src/main/content/transactions'
import { hashFile } from '../../src/main/game/loaders'

test('three-way merge preserves user changes, refuses conflicts and removes only unchanged owned files', () => {
  expect(mergePackFiles({ 'config/a': 'old', 'mods/old.jar': 'old' }, { 'config/a': 'user', 'mods/old.jar': 'old', 'mods/local.jar': 'local' }, { 'config/a': 'old' })).toEqual(['mods/old.jar'])
  expect(() => mergePackFiles({ 'config/a': 'old' }, { 'config/a': 'user' }, { 'config/a': 'new' })).toThrow(/冲突/)
  expect(() => mergePackFiles({}, { 'mods/local.jar': 'local' }, { 'mods/local.jar': 'remote' })).toThrow(/冲突/)
  expect(() => mergePackFiles({}, {}, { 'saves/world': 'pack' })).toThrow()
})

test('transaction backup can restore a previous version without changing saves', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lql-transaction-'))
  try {
    await mkdir(join(root, 'game', 'mods'), { recursive: true })
    await mkdir(join(root, 'game', 'saves'), { recursive: true })
    const target = join(root, 'game', 'mods', 'a.jar')
    await writeFile(target, 'old'); await writeFile(join(root, 'game', 'saves', 'world'), 'world')
    const source = join(root, 'new.jar'); await writeFile(source, 'new')
    const transactions = new FileTransactions(root)
    await transactions.apply([{ path: 'game/mods/a.jar', source, expected: await hashFile(target) }], new AbortController().signal)
    expect(await readFile(target, 'utf8')).toBe('new')
    await transactions.restore()
    expect(await readFile(target, 'utf8')).toBe('old')
    expect(await readFile(join(root, 'game', 'saves', 'world'), 'utf8')).toBe('world')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('stale plan and restore after user edits both stop before overwriting files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lql-conflict-'))
  try {
    await mkdir(join(root, 'game', 'mods'), { recursive: true })
    const target = join(root, 'game', 'mods', 'a.jar'); const source = join(root, 'new.jar')
    await writeFile(target, 'old'); await writeFile(source, 'new')
    const transactions = new FileTransactions(root)
    await expect(transactions.apply([{ path: 'game/mods/a.jar', source, expected: null }], new AbortController().signal)).rejects.toThrow(/冲突/)
    await transactions.apply([{ path: 'game/mods/a.jar', source, expected: await hashFile(target) }], new AbortController().signal)
    await writeFile(target, 'user')
    await expect(transactions.restore()).rejects.toThrow(/冲突/)
    expect(await readFile(target, 'utf8')).toBe('user')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('startup recovery rolls back an interrupted partially written transaction', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lql-recover-'))
  try {
    await mkdir(join(root, 'game', 'mods'), { recursive: true })
    await mkdir(join(root, '.updates', 'interrupted', 'backup'), { recursive: true })
    await writeFile(join(root, 'game', 'mods', 'a.jar'), 'half-new')
    await writeFile(join(root, '.updates', 'interrupted', 'backup', '0'), 'old')
    await writeFile(join(root, '.updates', 'active.json'), JSON.stringify({ id: 'interrupted', phase: 'applying', changes: [{ path: 'game/mods/a.jar', existed: true, before: await hashFile(join(root, '.updates', 'interrupted', 'backup', '0')), after: 'a'.repeat(128) }] }))
    await new FileTransactions(root).recover()
    expect(await readFile(join(root, 'game', 'mods', 'a.jar'), 'utf8')).toBe('old')
  } finally { await rm(root, { recursive: true, force: true }) }
})
