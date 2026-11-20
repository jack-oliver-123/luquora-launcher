import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('real Electron searches Modrinth, previews required dependencies and manages an unknown local mod', async () => {
  test.setTimeout(180000)
  const directory = await mkdtemp(join(tmpdir(), 'lql-v02-ui-'))
  const app = await electron.launch({ args: ['.'], env: { ...process.env, LQL_USER_DATA: directory, LQL_HIDDEN: '1' } })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    await expect(page.getByRole('heading', { name: '我的实例' })).toBeVisible()
    const instance = await page.evaluate(() => window.lql.createInstance('Fabric 内容验收', '1.20.1', { kind: 'fabric', version: '0.16.14' }))
    const mods = join(directory, 'game-data', 'instances', instance.id, 'game', 'mods')
    await mkdir(mods, { recursive: true }); await writeFile(join(mods, 'unknown.jar'), 'local mod')
    await page.getByRole('button', { name: '资源中心', exact: true }).click()
    await expect(page.getByRole('heading', { name: '资源中心' })).toBeVisible()
    await page.getByPlaceholder('搜索 Modrinth 资源').fill('AppleSkin')
    await page.getByPlaceholder('游戏版本，例如 1.20.1').fill('1.20.1')
    await page.getByRole('button').filter({ has: page.getByRole('heading', { name: 'AppleSkin', exact: true }) }).first().click({ timeout: 60000 })
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('button', { name: '预览安装与依赖' })).toBeEnabled({ timeout: 60000 })
    await dialog.getByRole('button', { name: '预览安装与依赖' }).click()
    await expect(page.getByText('Fabric API', { exact: true })).toBeVisible({ timeout: 60000 })
    await expect(page.getByRole('button', { name: '安装 2 个资源' })).toBeVisible()
    await page.screenshot({ path: 'test-results/v02-resource-plan.png' })
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await page.locator('.resource-tabs').getByText('光影', { exact: true }).click()
    await expect(page.getByText(/光影需要实例已有兼容的渲染模组/)).toBeVisible()
    await page.getByRole('button', { name: '实例内容', exact: true }).click()
    await expect(page.getByText('unknown.jar', { exact: true })).toBeVisible()
    await expect(page.getByText('本地文件，兼容性未验证', { exact: true })).toBeVisible()
    await page.getByRole('switch', { name: '启用 unknown.jar' }).click()
    await expect(page.getByText('mods/unknown.jar.disabled', { exact: true })).toBeVisible()
    for (const zoom of [1, 1.25, 1.5]) {
      await app.evaluate(({ BrowserWindow }, factor) => { const window = BrowserWindow.getAllWindows()[0]; window.setContentSize(960, 640); window.webContents.setZoomFactor(factor) }, zoom)
      expect(await page.evaluate(() => { const area = document.querySelector('.page-content')!; return area.scrollWidth <= area.clientWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth })).toBe(true)
      await page.screenshot({ path: `test-results/v02-content-zoom-${zoom}.png` })
    }
    await page.getByRole('button', { name: '下载任务', exact: true }).click()
    await expect(page.getByText('切换模组状态', { exact: true })).toBeVisible()
    expect(errors).toEqual([])
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }) }
})
