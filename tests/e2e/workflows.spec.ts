import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('real UI creates, renames, saves settings and stays usable at desktop zoom', async () => {
  test.setTimeout(90000)
  const directory = await mkdtemp(join(tmpdir(), 'lql-界面 path '))
  const app = await electron.launch({ executablePath: process.env.LQL_INSTALLED_EXE, args: process.env.LQL_INSTALLED_EXE ? [] : ['.'], env: { ...process.env, LQL_USER_DATA: directory } })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.getByRole('button', { name: '创建实例', exact: true }).last().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByPlaceholder('例如：我的生存世界').fill('中文 世界 Alpha')
    await expect(dialog.getByRole('button', { name: '创建实例', exact: true })).toBeEnabled({ timeout: 40000 })
    await dialog.getByRole('button', { name: '创建实例', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await expect(page.getByRole('heading', { name: '中文 世界 Alpha' })).toBeVisible()
    await page.getByRole('button', { name: '中文 世界 Alpha 更多操作' }).click()
    await page.getByText('实例设置', { exact: true }).click()
    await dialog.getByPlaceholder('例如：我的生存世界').fill('中文 生存世界')
    await dialog.getByRole('button', { name: '保存设置' }).click()
    await expect(dialog).not.toBeVisible()
    await expect(page.getByRole('heading', { name: '中文 生存世界' })).toBeVisible()
    await page.screenshot({ path: 'test-results/launcher-instances.png', animations: 'disabled' })
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.locator('.n-input-number input').first().fill('2048')
    await page.getByRole('button', { name: '保存设置' }).click()
    await expect(page.getByText('启动设置已保存。', { exact: true })).toBeVisible()
    expect((await page.evaluate(() => window.lql.getSnapshot())).config.defaults.memoryMiB).toBe(2048)
    await page.getByRole('button', { name: '账号', exact: true }).click()
    await expect(page.getByRole('button', { name: '微软登录', exact: true })).toBeVisible()
    await page.screenshot({ path: 'test-results/launcher-accounts.png', animations: 'disabled' })
    await page.getByRole('button', { name: '日志', exact: true }).click()
    await expect(page.getByRole('heading', { name: '还没有启动记录' })).toBeVisible()
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setContentSize(960, 640) })
    for (const zoom of [1, 1.25, 1.5]) {
      await app.evaluate(({ BrowserWindow }, factor) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(factor), zoom)
      await page.getByRole('button', { name: '设置', exact: true }).click()
      await expect(page.getByRole('button', { name: '设置', exact: true })).toHaveAttribute('aria-current', 'page')
      await expect(page.getByRole('heading', { name: '启动器设置' })).toBeVisible()
      expect(await page.evaluate(() => { const area = document.querySelector('.page-content')!; return area.scrollWidth <= area.clientWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth })).toBe(true)
      await page.screenshot({ path: `test-results/launcher-zoom-${zoom}.png`, animations: 'disabled' })
    }
    expect(errors).toEqual([])
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }) }
})
