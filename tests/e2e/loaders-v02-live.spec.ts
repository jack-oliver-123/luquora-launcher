import { test, expect, _electron as electron } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

test.skip(!process.env.LQL_V02_MENUS, 'Explicit isolated game menu acceptance only')
test('installed loaders and online/local pack reach their visible menus and exit normally', async () => {
  test.setTimeout(1800000)
  const directory = resolve('.superpowers/acceptance-v02')
  const app = await electron.launch({ args: ['.'], env: { ...process.env, LQL_USER_DATA: directory, LQL_HIDDEN: '1' } })
  const records: unknown[] = []
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('heading', { name: '我的实例' })).toBeVisible()
    await page.evaluate(async () => {
      const snapshot = await window.lql.getSnapshot()
      const profile = snapshot.accounts.find(account => account.name === 'LQL_v02') ?? await window.lql.addLocalProfile('LQL_v02')
      await window.lql.selectAccount(profile.id)
      await window.lql.saveSettings({ ...snapshot.config.defaults, memoryMiB: 2048, width: 854, height: 480, fullscreen: false })
    })
    const instances = (await page.evaluate(() => window.lql.getSnapshot())).config.instances.filter(instance => instance.name.startsWith('v02 '))
    expect(instances).toHaveLength(6)
    for (const instance of instances) {
      console.log('LAUNCH', instance.name)
      await writeFile(join(directory, 'active-game.json'), JSON.stringify({ name: instance.name, id: instance.id, phase: 'starting' }))
      await page.evaluate(id => window.lql.launchInstance(id), instance.id)
      await expect.poll(async () => {
        const state = (await page.evaluate(() => window.lql.getSnapshot())).game
        if (state.phase === 'failed') throw new Error(`${instance.name} exited early`)
        return readFile(join(directory, 'game-data', 'instances', instance.id, 'game', 'logs', 'latest.log'), 'utf8').catch(() => '')
      }, { timeout: 180000, intervals: [1000] }).toMatch(/Sound engine started/)
      await writeFile(join(directory, 'active-game.json'), JSON.stringify({ name: instance.name, id: instance.id, phase: 'inspect-menu' }))
      console.log('INSPECT_MENU', instance.name)
      await expect.poll(async () => (await page.evaluate(() => window.lql.getSnapshot())).game.phase, { timeout: 240000, intervals: [1000] }).toBe('exited')
      const status = (await page.evaluate(() => window.lql.getSnapshot())).game
      expect(status.exitCode).toBe(0)
      records.push({ name: instance.name, loader: instance.loader, exitCode: status.exitCode, checkedAt: new Date().toISOString() })
      await writeFile(join(directory, 'menus-results.json'), JSON.stringify(records, null, 2))
    }
  } finally { await app.close() }
})
