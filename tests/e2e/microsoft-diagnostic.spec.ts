import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('Microsoft failures identify the safe retry stage in the real UI', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lql-ms-diagnostic-'))
  const app = await electron.launch({ args: ['.'], env: { ...process.env, LQL_USER_DATA: directory } })
  try {
    await app.evaluate(async ({ app }) => {
      const load = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json')
      const path = load('node:path') as typeof import('node:path')
      const url = load('node:url') as typeof import('node:url')
      const vm = load('node:vm') as typeof import('node:vm')
      const entry = url.pathToFileURL(path.join(path.dirname(load.resolve('@azure/msal-node/package.json')), 'dist/index.mjs')).href
      const msal = await vm.runInThisContext(`import(${JSON.stringify(entry)})`, { importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER }) as typeof import('@azure/msal-node')
      msal.PublicClientApplication.prototype.acquireTokenByDeviceCode = () => Promise.reject(Object.assign(new Error('synthetic network detail'), { name: 'AuthError', errorCode: 'network_error' }))
    })
    const page = await app.firstWindow()
    await page.getByRole('button', { name: '账号', exact: true }).click()
    await page.getByRole('button', { name: '微软登录', exact: true }).click()
    const alert = page.getByRole('alert').filter({ hasText: '无法连接 Microsoft 登录服务。' }).first()
    const dialogAlert = page.getByRole('dialog').getByRole('alert')
    await Promise.all([expect(alert).toContainText('阶段 auth:microsoft'), expect(dialogAlert).toContainText('阶段 auth:microsoft')])
    await expect(page.getByRole('dialog')).toContainText('微软账号未添加')
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await expect(page.getByText('synthetic network detail')).toHaveCount(0)
    await page.screenshot({ path: 'test-results/launcher-microsoft-diagnostic.png', animations: 'disabled' })
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
