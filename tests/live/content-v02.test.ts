import { test, expect } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Store } from '../../src/main/storage/store'
import { MetadataService } from '../../src/main/game/metadata'
import { InstallService } from '../../src/main/game/install'
import { ContentService } from '../../src/main/content/service'

test.skipIf(!process.env.LQL_V02_CONTENT_LIVE)('real required dependency and online/local mrpack install in isolated instances', async () => {
  const directory = resolve('.superpowers/acceptance-v02')
  const store = await Store.open(directory)
  const installer = new InstallService(store, new MetadataService(() => store.config.gameRoot), () => {}, error => console.log('INSTALL_ERROR', error), () => false)
  const service = new ContentService(store, installer, () => {}, () => false, async () => {})
  await service.initialize()
  const signal = AbortSignal.timeout(180000)
  const target = store.config.instances.find(instance => instance.loader?.kind === 'fabric' && !instance.staging)!
  const project = await service.catalog.project('appleskin', signal)
  const versions = await service.catalog.versions(project.id, target.versionId, 'fabric', signal)
  const preview = await service.previewResource(target.id, versions.find(version => version.version_type === 'release')!.id)
  console.log('RESOURCE_PLAN', preview.files.map(file => `${file.project.title} ${file.version.version_number}`))
  expect(preview.files.length).toBeGreaterThan(1)
  await service.applyResource(preview.id)
  const listing = await service.list(target.id)
  expect(listing.files.some(file => file.projectId === project.id)).toBe(true)
  expect(listing.files.some(file => file.modified)).toBe(false)
  const packProject = await service.catalog.project('sop', signal)
  const packVersion = (await service.catalog.versions(packProject.id, '1.20.1', 'fabric', signal)).find(version => version.version_type === 'release')!
  expect(packVersion).toBeTruthy()
  console.log('PACK_VERSION', packVersion.id, packVersion.version_number)
  const pack = await service.previewPack(packVersion.id, true)
  await service.installPack(pack.id, 'v02 Simply Optimized online', [])
  const installed = store.config.instances.find(instance => instance.name === 'v02 Simply Optimized online' && !instance.staging)!
  expect(installed.installation).toBe('ready')
  const local = await service.previewPack(join(store.config.gameRoot, 'content-cache', 'packs', `${packVersion.id}.mrpack`), false)
  await service.installPack(local.id, 'v02 Simply Optimized local', [])
  const imported = store.config.instances.find(instance => instance.name === 'v02 Simply Optimized local' && !instance.staging)!
  expect(imported.installation).toBe('ready')
  await writeFile(join(directory, 'content-results.json'), JSON.stringify({ mod: { project: project.id, version: versions[0].id, files: preview.files.map(file => ({ project: file.project.title, version: file.version.version_number, filename: file.file.filename })), instanceId: target.id }, pack: { project: packProject.id, version: packVersion.id, name: pack.name, gameVersion: pack.gameVersion, loader: pack.loader, onlineId: installed.id, localId: imported.id, required: pack.required, optional: pack.optional }, checkedAt: new Date().toISOString() }, null, 2))
}, 1800000)
