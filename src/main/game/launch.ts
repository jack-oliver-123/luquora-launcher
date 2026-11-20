import { generateArguments, LaunchPrecheck, MinecraftFolder, Version } from '@xmcl/core'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import type { AppError, GameStatus } from '../../shared/contracts'
import type { AccountService } from '../auth/accounts'
import { Store } from '../storage/store'
import { ensureManagedDirectory } from '../storage/paths'
import { LauncherError } from '../errors'
import { MetadataService } from './metadata'
import { InstallService } from './install'
import { resolveJava } from './java'
import { LogService } from '../logging'
import { processIdentity, sameProcess, type ProcessRecord } from './processes'

const execute = promisify(execFile)
export class LaunchService {
  private state: GameStatus = { instanceId: null, phase: 'idle', exitCode: null, userStopped: false }
  private child: ChildProcess | null = null
  private record: ProcessRecord | null = null
  private ended: Promise<void> = Promise.resolve()
  private starting: AbortController | null = null
  private startupCompleted: Promise<void> = Promise.resolve()
  private recoveryUncertain = false
  constructor(private store: Store, private accounts: AccountService, private metadata: MetadataService, private installer: InstallService, private logs: LogService, private changed: () => void, private report: (error: AppError) => void) {}
  status(): GameStatus { return { ...this.state } }
  blocksInstance(id: string): boolean { return this.recoveryUncertain || this.state.instanceId === id && ['checking', 'starting', 'running'].includes(this.state.phase) }
  get busy(): boolean { return this.recoveryUncertain || ['checking', 'starting', 'running'].includes(this.state.phase) }
  private get recordPath(): string { return join(this.store.userData, 'game-process.json') }
  async recover(): Promise<void> {
    let record: ProcessRecord
    try {
      record = JSON.parse(await readFile(this.recordPath, 'utf8'))
      if (!record || !Number.isSafeInteger(record.pid) || record.pid <= 0 || typeof record.executable !== 'string' || !isAbsolute(record.executable) || typeof record.startedAt !== 'string' || !Number.isFinite(Date.parse(record.startedAt)) || !this.store.config.instances.some(instance => instance.id === record.instanceId)) throw Error('invalid process record')
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; this.recoveryUncertain = true; this.report({ code: 'BUSY', stage: 'recovery', message: '上次游戏进程记录无法确认。', nextAction: '确认所有游戏已退出后，备份并移走 game-process.json，再重启 LQL。' }); return }
    try {
      const actual = await processIdentity(record.pid, record.instanceId)
      if (sameProcess(record, actual)) { this.record = record; this.state = { instanceId: record.instanceId, phase: 'running', exitCode: null, userStopped: false }; this.report({ code: 'BUSY', stage: 'recovery', message: '检测到上次运行的游戏仍在运行。', nextAction: '先退出该游戏；结束后可重新打开 LQL。' }) }
      else await rm(this.recordPath, { force: true })
    } catch { this.recoveryUncertain = true; this.report({ code: 'BUSY', stage: 'recovery', message: '无法检查上次游戏进程。', nextAction: '确认游戏已关闭并检查系统进程查询权限，再重启 LQL。' }) }
  }
  async start(id: string, accountId: string): Promise<void> {
    if (this.busy || this.installer.isBusy(id)) throw new LauncherError('BUSY', '游戏或安装任务仍在运行。')
    const instance = this.store.getInstance(id)
    let finishStartup!: () => void
    this.startupCompleted = new Promise(resolve => { finishStartup = resolve })
    this.starting = new AbortController()
    const signal = this.starting.signal
    this.state = { instanceId: id, phase: 'checking', exitCode: null, userStopped: false }; this.changed()
    let session = ''
    try {
      const local = accountId.startsWith('local:')
      const profile = local ? this.store.config.localProfiles.find(profile => profile.id === accountId) : null
      if (local && !profile) throw new LauncherError('AUTH_REQUIRED', '本地角色已移除，请重新选择角色。')
      const identity = profile ? { ...profile, accessToken: '0', xuid: '', clientId: '' } : await this.accounts.getLaunchIdentity(accountId)
      signal.throwIfAborted()
      if (!await this.installer.verifyInstance(id, signal)) throw new LauncherError('INTEGRITY', '实例文件缺失或校验失败。', '点击安装 / 修复后再启动。')
      const version = await this.metadata.resolve(instance.versionId, signal)
      const settings = this.store.settings(id)
      const java = await resolveJava(this.store.config.gameRoot, version, settings.javaPath, signal, () => {})
      const gamePath = await ensureManagedDirectory(this.store.config.gameRoot, join(this.store.instancePath(id), 'game'))
      const nativeRoot = await ensureManagedDirectory(this.store.config.gameRoot, join(this.store.instancePath(id), 'natives', randomUUID()))
      const resourcePath = join(this.store.config.gameRoot, 'shared')
      const core = await Version.parse(resourcePath, instance.launchVersionId ?? version.id)
      const options = { version: core, gamePath, resourcePath, javaPath: java.executable, maxMemory: settings.memoryMiB, minMemory: Math.min(512, settings.memoryMiB), resolution: { width: settings.width, height: settings.height, fullscreen: settings.fullscreen }, gameProfile: { name: identity.name, id: identity.uuid }, accessToken: identity.accessToken, ...(local ? { userType: 'legacy' as const } : {}), launcherName: 'Luquora Launcher', launcherBrand: 'LQL', nativeRoot, extraMCArgs: [] as string[] }
      const args = await generateArguments(options)
      for (let index = 0; index < args.length; index++) args[index] = args[index].replaceAll('${clientid}', identity.clientId).replaceAll('${auth_xuid}', identity.xuid)
      await LaunchPrecheck.checkNatives(new MinecraftFolder(resourcePath), core, options)
      signal.throwIfAborted()
      if (!local) this.logs.addSecret(identity.accessToken)
      session = await this.logs.begin({ instanceId: id, versionId: version.id, javaMajor: java.major })
      this.state.phase = 'starting'; this.changed()
      const child = spawn(java.executable, args.slice(1), { cwd: gamePath, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
      this.child = child
      const stdout = new StringDecoder('utf8')
      const stderr = new StringDecoder('utf8')
      child.stdout?.on('data', chunk => this.logs.write(session, stdout.write(chunk)))
      child.stderr?.on('data', chunk => this.logs.write(session, stderr.write(chunk)))
      this.ended = new Promise<void>(resolve => {
        child.once('error', () => { this.report({ code: 'SPAWN', stage: 'launch', message: '无法创建 Java 游戏进程。', nextAction: '检查 Java 路径、目录权限与安全软件拦截。' }) })
        child.once('close', (code) => {
          void (async () => {
            this.logs.write(session, stdout.end() + stderr.end() + `\n[exit ${code}; userStopped=${this.state.userStopped}]\n`)
            await this.logs.flush(session).catch(() => {})
            this.child = null; this.record = null
            this.state = { ...this.state, phase: code === 0 || this.state.userStopped ? 'exited' : 'failed', exitCode: code }
            await rm(this.recordPath, { force: true })
            if (this.state.phase === 'failed') this.report({ code: 'GAME_EXIT', stage: 'game', message: `游戏异常退出（${code ?? '无退出码'}）。`, nextAction: '打开日志查看 Java 和游戏输出。' })
            this.changed(); resolve()
          })().catch(() => { this.state.phase = 'failed'; this.changed(); resolve() })
        })
      })
      await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
      if (child.pid && child.exitCode === null && !child.killed) {
        this.state.phase = 'running'; this.changed()
        try {
          await writeFile(this.recordPath, JSON.stringify({ pid: child.pid, instanceId: id, uncertain: true }))
          const record = await processIdentity(child.pid, id)
          if (record && this.child === child) { this.record = record; await writeFile(this.recordPath, JSON.stringify(record)) }
          if (this.child !== child) await rm(this.recordPath, { force: true })
        } catch { this.report({ code: 'SERVICE', stage: 'process', message: '无法保存游戏进程恢复信息。', nextAction: '请保持 LQL 打开，正常结束游戏后再退出。' }) }
      }
    } catch (error) {
      if (signal.aborted && !this.child) { this.state.phase = 'exited'; this.state.userStopped = true; this.changed(); return }
      if (!this.child) { this.state.phase = 'failed'; this.changed() }
      throw error
    } finally { this.starting = null; finishStartup() }
  }
  async stop(force: boolean): Promise<void> {
    if (this.starting) { this.starting.abort(); await this.startupCompleted }
    if (!this.record) {
      if (this.child || this.recoveryUncertain) throw new LauncherError('BUSY', '无法确认游戏进程身份，未执行终止。', '请在游戏窗口中正常退出。')
      return
    }
    const actual = await processIdentity(this.record.pid, this.record.instanceId)
    if (!sameProcess(this.record, actual)) {
      if (!this.child) { this.record = null; this.state.phase = 'exited'; await rm(this.recordPath, { force: true }); this.changed(); return }
      throw new LauncherError('BUSY', '无法确认当前进程身份，未执行终止。', '在游戏窗口中正常退出后重试。')
    }
    this.state.userStopped = true
    await execute('taskkill.exe', ['/PID', String(this.record.pid), '/T', ...(force ? ['/F'] : [])], { windowsHide: true, timeout: 10000 }).catch(() => {})
    const exited = await Promise.race([this.ended.then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 5000))])
    if (!this.child && this.record) {
      const remaining = await processIdentity(this.record.pid, this.record.instanceId)
      if (!remaining) { this.record = null; this.state.phase = 'exited'; await rm(this.recordPath, { force: true }); this.changed(); return }
    }
    if (!exited || !this.child && this.record) throw new LauncherError('BUSY', '游戏尚未确认退出。', '在游戏内退出，或选择强制结束。')
  }
}
