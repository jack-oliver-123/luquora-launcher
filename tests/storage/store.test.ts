import { expect, test, afterEach } from 'vitest'
import { mkdtemp, readFile, writeFile, readdir, rm, mkdir, symlink, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const roots: string[] = []
async function temporary() { const root = await mkdtemp(join(tmpdir(), 'lql-存储 ')); roots.push(root); return root }
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function storage() { const module = await import('../../src/main/storage/store').catch(() => null); expect(module, 'persistent config implementation missing').not.toBeNull(); return module! }

test('settings persist while mutable instance directories stay isolated through rename', async () => {
  const { Store } = await storage()
  const root = await temporary()
  const store = await Store.open(root)
  const first = await store.createInstance('世界 A', '1.20.1')
  const second = await store.createInstance('世界 B', '1.20.1')
  await store.updateInstance(first.id, { name: '改名' })
  expect(store.instancePath(first.id)).not.toBe(store.instancePath(second.id))
  const reloaded = await Store.open(root)
  expect(reloaded.config.instances.map(instance => instance.name)).toEqual(['改名', '世界 B'])
  expect(reloaded.config.instances[0].id).toBe(first.id)
})

test('corrupt settings are preserved and never silently replaced', async () => {
  const { Store } = await storage()
  const root = await temporary()
  await writeFile(join(root, 'config.json'), '{ broken')
  await expect(Store.open(root)).rejects.toMatchObject({ code: 'CONFIG_CORRUPT' })
  expect(await readFile(join(root, 'config.json'), 'utf8')).toBe('{ broken')
})

test('failed recycle bin operation preserves instance metadata', async () => {
  const { Store } = await storage()
  const store = await Store.open(await temporary())
  const instance = await store.createInstance('保留', '1.16.5')
  await expect(store.removeInstance(instance.id, async () => { throw new Error('recycle unavailable') })).rejects.toThrow()
  expect(store.getInstance(instance.id).name).toBe('保留')
  expect(await readdir(store.instancePath(instance.id))).toContain('game')
})

test('managed path checks reject sibling prefix, traversal and junction escapes', async () => {
  const module = await import('../../src/main/storage/paths').catch(() => null)
  expect(module, 'managed path protection missing').not.toBeNull()
  const root = await temporary()
  await mkdir(join(root, 'instances'))
  await expect(module!.assertManagedPath(join(root, 'instances'), join(root, 'instances-other', 'data'))).rejects.toThrow()
  const outside = await temporary()
  await symlink(outside, join(root, 'instances', 'escape'), 'junction')
  await expect(module!.assertManagedPath(root, join(root, 'instances', 'escape', 'save'))).rejects.toThrow()
})

test('invalid memory values and unknown schema cannot corrupt saved config', async () => {
  const { Store } = await storage()
  const root = await temporary()
  const store = await Store.open(root)
  await expect(store.saveSettings({ ...store.config.defaults, memoryMiB: -1 })).rejects.toThrow()
  expect((await Store.open(root)).config.defaults.memoryMiB).toBeGreaterThan(0)
})

test('instance override payload rejects primitive and array shapes', async () => {
  const { Store } = await storage()
  const store = await Store.open(await temporary())
  const instance = await store.createInstance('world', '1.20.1')
  for (const overrides of [[], null, 42, 'oops']) await expect(store.updateInstance(instance.id, { overrides } as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  expect(store.getInstance(instance.id).overrides).toEqual({})
})

test('failed atomic replacement retains prior config and restores the in-memory settings', async () => {
  const { Store } = await storage()
  const root = await temporary()
  const store = await Store.open(root)
  const previous = store.config.defaults.memoryMiB
  await rename(join(root, 'config.json'), join(root, 'config.backup.json'))
  await mkdir(join(root, 'config.json'))
  await expect(store.saveSettings({ ...store.config.defaults, memoryMiB: 256 })).rejects.toThrow()
  expect(JSON.parse(await readFile(join(root, 'config.backup.json'), 'utf8')).defaults.memoryMiB).toBe(previous)
  expect(store.config.defaults.memoryMiB).toBe(previous)
})
