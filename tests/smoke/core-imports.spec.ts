import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('Electron loads launcher dependencies and keeps renderer isolated', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'lql-smoke-'))
  const app = await electron.launch({ executablePath: process.env.LQL_INSTALLED_EXE, args: process.env.LQL_INSTALLED_EXE ? [] : ['.'], env: { ...process.env, LQL_USER_DATA: userData, LQL_HIDDEN: '1' } })
  try {
    const result = await app.evaluate(({ app }) => {
      const load = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json')
      const packages = ['@xmcl/core', '@xmcl/installer', '@xmcl/user', '@azure/msal-node'].map(name => load(name))
      return { loaded: packages.every(module => Object.keys(module).length > 0), node: process.versions.node }
    })
    expect(result.loaded).toBe(true)
    expect(Number(result.node.split('.')[0])).toBeGreaterThanOrEqual(22)
    const page = await app.firstWindow()
    await expect.poll(() => page.evaluate(() => typeof window.lql)).toBe('object')
    expect(await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require)).toBe('undefined')
  } finally {
    await app.close()
    await rm(userData, { recursive: true, force: true })
  }
})
