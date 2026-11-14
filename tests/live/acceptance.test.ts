import { expect, test } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Store } from '../../src/main/storage/store'
import { MetadataService } from '../../src/main/game/metadata'
import { installJavaRuntime } from '../../src/main/game/java'
import { InstallService } from '../../src/main/game/install'
import type { AppError } from '../../src/shared/contracts'

test.skipIf(!process.env.LQL_LIVE_ACCEPTANCE)('official Windows runtimes and three vanilla baselines download and verify', async () => {
  const directory = resolve(process.env.LQL_ACCEPTANCE_ROOT ?? '.superpowers/acceptance-中文 path')
  await mkdir(directory, { recursive: true })
  const store = await Store.open(directory)
  const metadata = new MetadataService(() => store.config.gameRoot)
  const versions = await metadata.list(AbortSignal.timeout(30000))
  expect(versions.some(version => version.id === '1.20.1')).toBe(true)
  const records: unknown[] = []
  const failures: AppError[] = []
  let lastStage = ''
  let lastPrint = 0
  const service = new InstallService(store, metadata, () => {
    const task = service.progress
    if (task && (task.stage !== lastStage || Date.now() - lastPrint > 15000)) {
      console.log(JSON.stringify(task)); lastPrint = Date.now(); lastStage = task.stage
    }
  }, error => { failures.push(error); console.log('INSTALL ERROR', error) }, () => false)
  for (const id of ['1.16.5', '1.20.1', '26.3']) {
    console.log('BASELINE', id)
    const version = await metadata.resolve(id, AbortSignal.timeout(60000))
    const runtime = await installJavaRuntime(store.config.gameRoot, version, AbortSignal.timeout(600000), () => {})
    expect(runtime.managed).toBe(true)
    expect(runtime.major).toBe(version.javaMajor)
    await store.saveSettings({ ...store.config.defaults, javaPath: runtime.executable })
    const instance = store.config.instances.find(instance => instance.versionId === id) ?? await store.createInstance(`验收 ${id}`, id)
    if (id === '1.16.5' && instance.installation !== 'ready') {
      await service.start(instance.id)
      await service.cancel()
      expect(instance.installation).toBe('incomplete')
      expect(service.isBusy()).toBe(false)
    }
    await service.start(instance.id)
    await service.wait()
    expect(failures).toEqual([])
    expect(instance.installation).toBe('ready')
    expect(await service.verifyInstance(instance.id, AbortSignal.timeout(300000))).toBe(true)
    records.push({ id, java: runtime, installation: instance.installation, checkedAt: new Date().toISOString() })
    await writeFile(join(directory, 'results.json'), JSON.stringify(records, null, 2))
  }
}, 1800000)
