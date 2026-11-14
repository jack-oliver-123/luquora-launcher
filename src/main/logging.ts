import { appendFile, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AppEvent, LogSummary } from '../shared/contracts'
import { assertManagedPath, ensureManagedDirectory } from './storage/paths'
import { LauncherError } from './errors'

export class StreamRedactor {
  private buffer = ''
  constructor(private secrets: string[]) {}
  private replace(text: string): string { for (const secret of this.secrets) if (secret) text = text.split(secret).join('[REDACTED]'); return text }
  push(chunk: string): string {
    this.buffer += chunk
    const keep = Math.max(1, ...this.secrets.map(secret => secret.length)) - 1
    let cutoff = Math.max(0, this.buffer.length - keep)
    for (const secret of this.secrets) {
      if (!secret) continue
      let offset = this.buffer.indexOf(secret)
      while (offset >= 0) { if (offset < cutoff && offset + secret.length > cutoff) cutoff = offset; offset = this.buffer.indexOf(secret, offset + 1) }
    }
    const output = this.replace(this.buffer.slice(0, cutoff))
    this.buffer = this.buffer.slice(cutoff)
    return output
  }
  flush(): string { const output = this.replace(this.buffer); this.buffer = ''; return output }
}

export class LogService {
  summaries: LogSummary[] = []
  private secrets: string[] = []
  private sessions = new Map<string, { redactor: StreamRedactor; bytes: number; lineBytes: number; skipLine: boolean; truncated: boolean; queue: Promise<void> }>()
  constructor(private root: () => string, private emit: (event: AppEvent) => void) {}
  addSecret(value: string): void { if (value && !this.secrets.includes(value)) this.secrets.push(value) }
  async initialize(): Promise<void> {
    this.summaries = []
    const directory = join(this.root(), 'logs')
    await ensureManagedDirectory(this.root(), directory)
    const names = await readdir(directory)
    for (const name of names.filter(name => /^[a-f0-9-]{36}\.json$/.test(name))) {
      try { const summary = JSON.parse(await readFile(await assertManagedPath(this.root(), join(directory, name)), 'utf8')) as LogSummary; if (`${summary.id}.json` === name && typeof summary.instanceId === 'string' && typeof summary.versionId === 'string' && typeof summary.createdAt === 'string' && Number.isFinite(Date.parse(summary.createdAt))) this.summaries.push(summary) } catch {}
    }
    this.summaries.sort((first, second) => second.createdAt.localeCompare(first.createdAt))
  }
  async begin(metadata: { instanceId: string; versionId: string; javaMajor: number }): Promise<string> {
    const id = randomUUID()
    const summary = { id, instanceId: metadata.instanceId, versionId: metadata.versionId, createdAt: new Date().toISOString() }
    this.summaries.unshift(summary)
    this.sessions.set(id, { redactor: new StreamRedactor(this.secrets), bytes: 0, lineBytes: 0, skipLine: false, truncated: false, queue: Promise.resolve() })
    const directory = await ensureManagedDirectory(this.root(), join(this.root(), 'logs'))
    await writeFile(join(directory, `${id}.json`), JSON.stringify(summary))
    await writeFile(join(directory, `${id}.log`), `Luquora Launcher 0.1.0\nMinecraft ${metadata.versionId}\nJava ${metadata.javaMajor}\n${summary.createdAt}\n`)
    for (const old of this.summaries.splice(10)) { this.sessions.delete(old.id); for (const extension of ['log', 'json']) await rm(await assertManagedPath(this.root(), join(directory, `${old.id}.${extension}`)), { force: true }) }
    return id
  }
  write(id: string, chunk: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    const safe = session.redactor.push(chunk)
    this.append(id, safe)
  }
  private append(id: string, safe: string): void {
    const session = this.sessions.get(id)
    if (!session || !safe || session.truncated) return
    let text = ''
    const parts = safe.split('\n')
    const marker = ' [line truncated]'
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index]
      if (!session.skipLine) {
        const remaining = 65536 - Buffer.byteLength(marker) - session.lineBytes
        if (Buffer.byteLength(part) <= remaining) { text += part; session.lineBytes += Buffer.byteLength(part) }
        else { text += Buffer.from(part).subarray(0, remaining).toString('utf8').replace(/\uFFFD$/, '') + marker; session.skipLine = true }
      }
      if (index < parts.length - 1) { text += '\n'; session.lineBytes = 0; session.skipLine = false }
    }
    const remaining = 10 * 1024 * 1024 - session.bytes
    if (Buffer.byteLength(text) > remaining) { text = Buffer.from(text).subarray(0, Math.max(0, remaining)).toString('utf8') + '\n[日志已达到会话上限，后续输出不再保存]\n'; session.truncated = true }
    session.bytes += Buffer.byteLength(text)
    session.queue = session.queue.then(async () => { const destination = await assertManagedPath(this.root(), join(this.root(), 'logs', `${id}.log`)); await appendFile(destination, text); this.emit({ type: 'log-lines', data: { sessionId: id, lines: text.split('\n') } }) })
    session.queue.catch(() => {})
  }
  async flush(id: string): Promise<void> { const session = this.sessions.get(id); if (!session) return; this.append(id, session.redactor.flush()); await session.queue }
  async read(id: string): Promise<string[]> {
    if (!this.summaries.some(summary => summary.id === id)) throw new LauncherError('INVALID_INPUT', '日志不存在。')
    await this.sessions.get(id)?.queue
    return (await readFile(await assertManagedPath(this.root(), join(this.root(), 'logs', `${id}.log`)), 'utf8')).split('\n').slice(-2000)
  }
  async export(id: string, destination: string): Promise<void> {
    await this.read(id)
    const source = await readFile(await assertManagedPath(this.root(), join(this.root(), 'logs', `${id}.log`)))
    await writeFile(destination, source)
  }
}
