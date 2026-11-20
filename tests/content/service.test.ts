import { test, expect, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../../src/main/storage/store'
import { InstallService } from '../../src/main/game/install'
import { ContentService } from '../../src/main/content/service'
import { CatalogService } from '../../src/main/content/catalog'

test('unknown local mods are listed and disabling keeps their bytes and persists', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lql-content-'))
  try {
    const store = await Store.open(root)
    const instance = await store.createInstance('mods', '1.20.1', { kind: 'fabric', version: '0.16.14' })
    await mkdir(join(store.instancePath(instance.id), 'game', 'mods'))
    await writeFile(join(store.instancePath(instance.id), 'game', 'mods', 'local.jar'), 'local artifact')
    const installer = new InstallService(store, {} as never, () => {}, () => {}, () => false)
    const service = new ContentService(store, installer, () => {}, () => false, async () => {})
    const before = await service.list(instance.id)
    expect(before.files[0].projectId).toBeUndefined()
    await service.toggle(instance.id, 'mods/local.jar')
    const after = await new ContentService(store, installer, () => {}, () => false, async () => {}).list(instance.id)
    expect(after.files[0].path).toBe('mods/local.jar.disabled')
    expect(after.files[0].disabled).toBe(true)
    expect(after.files[0].sha512).toBe(before.files[0].sha512)
    expect(after.backupsBytes).toBeGreaterThan(0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('cancelling a queued task does not cancel the installer owned by the active task', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lql-content-cancel-'))
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let installing = false
  const installer = { isBusy: () => installing, cancel: vi.fn(async () => {}) } as unknown as InstallService
  try {
    const service = new ContentService(await Store.open(root), installer, () => {}, () => false, async () => {})
    const active = service.run('active', undefined, async () => { await gate })
    const queued = service.run('queued', undefined, async () => {})
    const queuedResult = queued.catch(() => {})
    await Promise.resolve(); await Promise.resolve(); installing = true
    const cancel = service.cancel(service.tasks[1].id)
    expect(installer.cancel).not.toHaveBeenCalled()
    release(); await active; await queuedResult; await cancel
    expect(service.tasks[0].phase).toBe('complete')
    expect(service.tasks[1].phase).toBe('cancelled')
  } finally { release(); await rm(root, { recursive: true, force: true }) }
})

test('running instances reject mutations and expired resource previews cannot execute', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lql-content-busy-'))
  try {
    const store = await Store.open(root)
    const instance = await store.createInstance('running', '1.20.1')
    const installer = new InstallService(store, {} as never, () => {}, () => {}, () => false)
    const service = new ContentService(store, installer, () => {}, () => true, async () => {})
    await expect(service.toggle(instance.id, 'mods/local.jar')).rejects.toThrow()
    await expect(service.applyResource('forged-preview')).rejects.toThrow()
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('project popularity changes between preview and confirmation do not invalidate identical installation files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lql-content-preview-'))
  try {
    const store = await Store.open(root); const instance = await store.createInstance('preview', '1.20.1')
    const catalog = new CatalogService()
    vi.spyOn(catalog, 'plan').mockResolvedValueOnce({ id: 'preview', instanceId: instance.id, title: 'resource', files: [] }).mockResolvedValueOnce({ id: 'new-preview', instanceId: instance.id, title: 'resource renamed', files: [] })
    const installer = new InstallService(store, {} as never, () => {}, () => {}, () => false)
    const service = new ContentService(store, installer, () => {}, () => false, async () => {}, catalog)
    const preview = await service.previewResource(instance.id, 'version')
    await expect(service.applyResource(preview.id)).resolves.toBeUndefined()
  } finally { await rm(root, { recursive: true, force: true }) }
})
