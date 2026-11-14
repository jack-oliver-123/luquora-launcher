import { test, expect, _electron as electron } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

test('installed executable verifies cached baselines, packaged native extraction and Windows encryption', async () => {
  test.skip(!process.env.LQL_INSTALLED_EXE || !process.env.LQL_PACKAGED_ACCEPTANCE_ROOT, 'requires an installed executable and isolated official acceptance data')
  test.setTimeout(300000)
  const app = await electron.launch({ executablePath: process.env.LQL_INSTALLED_EXE, env: { ...process.env, LQL_USER_DATA: process.env.LQL_PACKAGED_ACCEPTANCE_ROOT! } })
  try {
    const encryption = await app.evaluate(({ safeStorage }) => {
      const available = safeStorage.isEncryptionAvailable()
      const ciphertext = available ? safeStorage.encryptString('synthetic-encryption-probe') : null
      return { available, roundtrip: ciphertext ? safeStorage.decryptString(ciphertext) === 'synthetic-encryption-probe' : false, plaintext: ciphertext ? ciphertext.includes(Buffer.from('synthetic-encryption-probe')) : false }
    })
    expect(encryption).toEqual({ available: true, roundtrip: true, plaintext: false })
    const page = await app.firstWindow()
    await expect(page.getByRole('heading', { name: '我的实例' })).toBeVisible()
    const errors: string[] = []
    await page.exposeFunction('acceptanceError', (message: string) => errors.push(message))
    await page.evaluate(() => window.lql.onEvent(event => { if (event.type === 'error') void (window as unknown as { acceptanceError: (message: string) => Promise<void> }).acceptanceError(event.data.message) }))
    for (const version of ['1.16.5', '1.20.1', '26.3']) {
      const instance = await page.evaluate(async ({ version }) => {
        const snapshot = await window.lql.getSnapshot()
        const instance = snapshot.config.instances.find(instance => instance.versionId === version)!
        await window.lql.updateInstance(instance.id, { overrides: { javaPath: null } })
        await window.lql.selectInstance(instance.id)
        await window.lql.installInstance(instance.id)
        return instance
      }, { version })
      await expect.poll(async () => (await page.evaluate(() => window.lql.getSnapshot())).installation, { timeout: 90000, intervals: [300, 1000] }).toBeNull()
      expect((await page.evaluate(() => window.lql.getSnapshot())).config.instances.find(item => item.id === instance.id)?.installation).toBe('ready')
    }
    expect(errors).toEqual([])
    const rejected = await page.evaluate(async () => { try { await window.lql.launchInstance((await window.lql.getSnapshot()).config.selectedInstanceId!); return false } catch { return true } })
    expect(rejected).toBe(true)
    const snapshot = await page.evaluate(() => window.lql.getSnapshot())
    const probes = []
    for (const instance of snapshot.config.instances) {
      const probe = await app.evaluate(async ({ app }, data) => {
        const load = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json')
        const core = load('@xmcl/core') as typeof import('@xmcl/core')
        const path = load('node:path') as typeof import('node:path')
        const fs = load('node:fs/promises') as typeof import('node:fs/promises')
        const crypto = load('node:crypto') as typeof import('node:crypto')
        const shared = path.join(data.gameRoot, 'shared')
        const instanceRoot = path.join(data.gameRoot, 'instances', data.id)
        const nativeRoot = path.join(instanceRoot, 'natives', crypto.randomUUID())
        await fs.mkdir(nativeRoot, { recursive: true })
        const version = await core.Version.parse(shared, data.versionId)
        const javaPath = 'C:\\ContractProbe\\java.exe'
        const options = { version, javaPath, gamePath: path.join(instanceRoot, 'game'), resourcePath: shared, nativeRoot, accessToken: 'synthetic-not-a-session', gameProfile: { id: 'a'.repeat(32), name: 'ContractProbe' } }
        await core.LaunchPrecheck.checkNatives(new core.MinecraftFolder(shared), version, options)
        const files = await fs.readdir(nativeRoot)
        const command = await core.generateArguments(options)
        return { id: data.versionId, files, command0: command[0], javaPath, mainClass: version.mainClass, hasMainClass: command.includes(version.mainClass), checkedAt: new Date().toISOString() }
      }, { id: instance.id, versionId: instance.versionId, gameRoot: snapshot.config.gameRoot })
      expect(probe.files.length).toBeGreaterThan(0)
      expect(probe.command0).toBe(probe.javaPath)
      expect(probe.hasMainClass).toBe(true)
      if (instance.versionId === '1.16.5') expect(probe.files.some(file => file.endsWith('.dll'))).toBe(true)
      probes.push(probe)
    }
    await writeFile(join(process.env.LQL_PACKAGED_ACCEPTANCE_ROOT!, 'packaged-native-results.json'), JSON.stringify(probes, null, 2))
    await page.screenshot({ path: 'test-results/launcher-installed.png', animations: 'disabled' })
  } finally { await app.close() }
})
