import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('local profile UI works without Microsoft authorization and survives a full launcher restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lql-本地角色 '))
  const options = { executablePath: process.env.LQL_INSTALLED_EXE, args: process.env.LQL_INSTALLED_EXE ? [] : ['.'], env: { ...process.env, LQL_USER_DATA: directory } }
  let app = await electron.launch(options)
  try {
    let page = await app.firstWindow()
    await page.getByRole('button', { name: '账号', exact: true }).click()
    expect((await page.evaluate(() => window.lql.getSnapshot())).accounts).toEqual([])
    await page.getByRole('button', { name: '添加本地角色', exact: true }).first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByPlaceholder('例如：Luquora').fill('ab')
    await expect(dialog.getByRole('button', { name: '创建角色' })).toBeDisabled()
    await dialog.getByPlaceholder('例如：Luquora').fill('LQL_Player')
    await dialog.getByRole('button', { name: '创建角色' }).click()
    await expect(dialog).not.toBeVisible()
    await expect(page.locator('.account-row')).toContainText('LQL_Player')
    const profile = (await page.evaluate(() => window.lql.getSnapshot())).accounts[0]
    expect(profile.kind).toBe('local')
    await app.close()
    app = await electron.launch(options)
    page = await app.firstWindow()
    await expect(page.locator('.account-strip')).toContainText('LQL_Player · 本地角色')
    expect((await page.evaluate(() => window.lql.getSnapshot())).config.selectedAccountId).toBe(profile.id)
    const second = await page.evaluate(() => window.lql.addLocalProfile('SecondPlayer'))
    await page.getByRole('button', { name: '账号', exact: true }).click()
    const firstRow = page.locator('.account-row').filter({ hasText: 'LQL_Player' })
    await firstRow.getByRole('button', { name: '设为当前' }).click()
    await expect(firstRow).toContainText('当前使用')
    await page.screenshot({ path: 'test-results/launcher-local-profiles.png', animations: 'disabled' })
    await firstRow.getByRole('button', { name: '移除', exact: true }).click()
    await page.getByRole('button', { name: '确认', exact: true }).click()
    await expect(firstRow).toHaveCount(0)
    expect((await page.evaluate(() => window.lql.getSnapshot())).config.selectedAccountId).toBe(second.id)
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }) }
})
