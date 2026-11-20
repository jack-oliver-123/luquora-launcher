import { test, expect } from 'vitest'
import { cp, mkdir, writeFile, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Store } from '../../src/main/storage/store'
import { MetadataService } from '../../src/main/game/metadata'
import { InstallService } from '../../src/main/game/install'
import type { LoaderKind } from '../../src/shared/content'
import type { AppError } from '../../src/shared/contracts'

test.skipIf(!process.env.LQL_V02_LIVE)('four official loader installations resolve and verify in an isolated store', async () => {
  const directory = resolve('.superpowers/acceptance-v02')
  await mkdir(directory, { recursive: true })
  const store = await Store.open(directory)
  const shared = join(store.config.gameRoot, 'shared')
  try { await access(shared) } catch { await cp(resolve('.superpowers/acceptance-中文 path/game-data/shared'), shared, { recursive: true }) }
  const metadata = new MetadataService(() => store.config.gameRoot)
  const failures: AppError[] = []
  let lastPrint = 0
  const installer = new InstallService(store, metadata, () => { if (Date.now() - lastPrint > 15000) { console.log(JSON.stringify(installer.progress)); lastPrint = Date.now() } }, error => { failures.push(error); console.log(JSON.stringify(error)) }, () => false)
  const records: unknown[] = []
  for (const kind of ['fabric', 'quilt', 'forge', 'neoforge'] as LoaderKind[]) {
    const gameVersion = kind === 'neoforge' ? '1.21.1' : '1.20.1'
    const versions = await installer.loaders.list(gameVersion, kind, AbortSignal.timeout(30000))
    const version = versions.find(item => item.stable)?.version
    expect(version).toBeTruthy()
    console.log('INSTALL', kind, gameVersion, version)
    const instance = store.config.instances.find(item => item.loader?.kind === kind && item.loader.version === version) ?? await store.createInstance(`v02 ${kind}`, gameVersion, { kind, version: version! })
    failures.length = 0
    await installer.start(instance.id); await installer.wait()
    records.push({ kind, gameVersion, version, installation: instance.installation, launchVersionId: instance.launchVersionId, failures: [...failures], checkedAt: new Date().toISOString() })
    await writeFile(join(directory, 'loaders-results.json'), JSON.stringify(records, null, 2))
    expect(failures).toEqual([])
    expect(instance.installation).toBe('ready')
    expect(await installer.verifyInstance(instance.id, AbortSignal.timeout(180000))).toBe(true)
  }
}, 1800000)
