import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('real Electron bridge persists instances and rejects invalid commands', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lql-ui-'))
  const app = await electron.launch({ args: ['.'], env: { ...process.env, LQL_USER_DATA: directory, LQL_HIDDEN: '1' } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('heading', { name: '我的实例' })).toBeVisible()
    const result = await page.evaluate(async () => {
      const first = await window.lql.createInstance('测试世界', '1.20.1')
      await window.lql.updateInstance(first.id, { name: '新名称' })
      let invalidRejected = false
      try { await window.lql.updateInstance('../../outside', { name: 'invalid' }) } catch { invalidRejected = true }
      return { invalidRejected, snapshot: await window.lql.getSnapshot() }
    })
    expect(result.invalidRejected).toBe(true)
    expect(result.snapshot.config.instances[0].name).toBe('新名称')
    await expect(page.getByText('新名称', { exact: true }).first()).toBeVisible()
    await page.getByRole('button', { name: '账号', exact: true }).click()
    await expect(page.getByRole('heading', { name: '账号与角色' })).toBeVisible()
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await expect(page.getByRole('heading', { name: '启动器设置' })).toBeVisible()
    await page.screenshot({ path: 'test-results/settings.png', fullPage: true })
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }) }
})

test('empty desktop surface renders with real preload and no horizontal overflow', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lql-empty-'))
  const app = await electron.launch({ args: ['.'], env: { ...process.env, LQL_USER_DATA: directory, LQL_HIDDEN: '1' } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('heading', { name: '创建你的第一个世界' })).toBeVisible()
    await page.screenshot({ path: 'test-results/launcher-empty.png', fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByRole('button', { name: '创建实例', exact: true }).last().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('button', { name: '取消', exact: true }).click()
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }) }
})
