import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('device login copies to the Windows clipboard and displays native presentation results', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lql-ms-ui-'))
  const app = await electron.launch({ executablePath: process.env.LQL_INSTALLED_EXE, args: process.env.LQL_INSTALLED_EXE ? [] : ['.'], env: { ...process.env, LQL_USER_DATA: directory } })
  try {
    await app.evaluate(async ({ app, shell }) => {
      const load = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json')
      const path = load('node:path') as typeof import('node:path')
      const url = load('node:url') as typeof import('node:url')
      const vm = load('node:vm') as typeof import('node:vm')
      const entry = url.pathToFileURL(path.join(path.dirname(load.resolve('@azure/msal-node/package.json')), 'dist/index.mjs')).href
      const msal = await vm.runInThisContext(`import(${JSON.stringify(entry)})`, { importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER }) as typeof import('@azure/msal-node')
      msal.PublicClientApplication.prototype.acquireTokenByDeviceCode = request => {
        request.deviceCodeCallback({ userCode: 'LQL-TEST', deviceCode: 'synthetic-device-code', verificationUri: 'https://microsoft.com/devicelogin', expiresIn: 900, interval: 5, message: 'Synthetic UI acceptance' })
        return new Promise(() => {})
      }
      shell.openExternal = async target => { if (target !== 'https://microsoft.com/devicelogin') throw new Error('Unexpected authorization URL') }
    })
    const page = await app.firstWindow()
    await page.getByRole('button', { name: '账号', exact: true }).click()
    await page.getByRole('button', { name: '微软登录', exact: true }).click()
    const modal = page.getByRole('dialog')
    await expect(modal.getByRole('alert')).toContainText('代码已自动复制')
    await expect(modal).toContainText('已打开微软授权网页')
    await expect(modal).toContainText('网页显示“大功告成”只代表微软账号登录成功')
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('LQL-TEST')
    await page.screenshot({ path: 'test-results/launcher-microsoft-login.png', animations: 'disabled' })
    await app.evaluate(({ clipboard, shell }) => {
      clipboard.writeText = async () => { throw new Error('Clipboard unavailable') }
      shell.openExternal = async () => { throw new Error('Browser unavailable') }
    })
    await modal.getByRole('button', { name: '复制代码并打开授权页' }).click()
    await expect(modal.getByRole('alert')).toContainText('未能自动复制代码')
    await expect(modal).toContainText('未能自动打开浏览器')
    await expect(modal.locator('.device-code')).toHaveText('LQL-TEST')
    await modal.getByRole('button', { name: '取消授权' }).click()
    await expect(modal).not.toBeVisible()
    expect((await page.evaluate(() => window.lql.getSnapshot())).authPending).toBe(false)
  } finally {
    await app.windows()[0]?.evaluate(() => window.lql.cancelAuth()).catch(() => {})
    await app.evaluate(async ({ clipboard }) => { if (await clipboard.readText() === 'LQL-TEST') clipboard.clear() }).catch(() => {})
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
