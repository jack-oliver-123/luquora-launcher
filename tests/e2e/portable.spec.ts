import { test, expect, chromium } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const execFileAsync = promisify(execFile)

async function terminateProcessTree(rootPid: number): Promise<void> {
  try {
    await execFileAsync('taskkill', ['/PID', String(rootPid), '/T', '/F'], { windowsHide: true })
  } catch {
    return
  }
}

test('portable executable starts its real bridge and bundled dependencies', async () => {
  test.skip(!process.env.LQL_PORTABLE_EXE, 'requires a portable executable')
  test.setTimeout(90000)
  const directory = await mkdtemp(join(tmpdir(), 'lql-portable-'))
  const port = 34000 + Math.floor(Math.random() * 1000)
  const processHandle = spawn(process.env.LQL_PORTABLE_EXE!, [`--remote-debugging-port=${port}`], { env: { ...process.env, LQL_USER_DATA: directory }, stdio: 'ignore', windowsHide: true })
  let browser
  try {
    const started = Date.now()
    while (Date.now() - started < 30000) {
      try {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 })
        break
      } catch {
        await new Promise(resolve => setTimeout(resolve, 400))
      }
    }
    expect(browser, 'portable executable should expose Chromium CDP').toBeDefined()
    const context = browser!.contexts()[0]
    expect(context, 'portable executable should create an Electron context').toBeDefined()
    const page = context!.pages()[0]
    expect(page, 'portable executable should create an Electron window').toBeDefined()
    await expect(page.getByRole('heading', { name: '创建你的第一个世界' })).toBeVisible()
    expect(await page.evaluate(() => typeof window.lql)).toBe('object')
    expect(await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require)).toBe('undefined')
    const instance = await page.evaluate(async () => window.lql.createInstance('便携验收', '1.20.1'))
    expect(instance.name).toBe('便携验收')
    expect(await page.getByText('便携验收', { exact: true }).first().isVisible()).toBe(true)
    const profile = await page.evaluate(() => window.lql.addLocalProfile('PortablePlayer'))
    expect(profile.kind).toBe('local')
    await page.getByRole('button', { name: '账号', exact: true }).click()
    await expect(page.locator('.account-row')).toContainText('PortablePlayer')
  } finally {
    await browser?.close()
    if (processHandle.pid) await terminateProcessTree(processHandle.pid)
    processHandle.kill()
    if (!processHandle.killed || processHandle.exitCode === null) await new Promise(resolve => processHandle.once('exit', resolve))
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 500))
      try {
        await rm(directory, { recursive: true, force: true })
        break
      } catch (error) {
        if (attempt === 9) throw error
      }
    }
  }
})
