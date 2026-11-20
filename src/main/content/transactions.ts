import { readdir, stat, readFile, writeFile, rename, copyFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { hashFile } from '../game/loaders'
import { assertManagedPath, ensureManagedDirectory } from '../storage/paths'
import { safePackPath } from './archive'
import { LauncherError } from '../errors'

export type FileChange = { path: string; source: string | null; expected: string | null }
type Journal = { id: string; phase: 'prepared' | 'applying' | 'complete'; changes: { path: string; existed: boolean; before: string | null; after: string | null }[] }
export async function maybeHash(path: string): Promise<string | null> {
  try { return await hashFile(path) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
}
export function mergePackFiles(previous: Record<string, string>, current: Record<string, string>, next: Record<string, string>): string[] {
  const changes: string[] = []
  for (const path of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    safePackPath(path)
    if (previous[path] === next[path]) continue
    if (current[path] !== previous[path] && current[path] !== next[path]) throw new LauncherError('INVALID_INPUT', `更新冲突：${path}。请备份或处理自己的修改后重试。`)
    if (current[path] !== next[path]) changes.push(path)
  }
  return changes
}
export class FileTransactions {
  constructor(private root: string) {}
  private async path(relative: string): Promise<string> {
    safePackPath(relative, false)
    if (relative.startsWith('game/')) safePackPath(relative.slice(5))
    else if (!['content.json', 'instance-state.json'].includes(relative)) throw new LauncherError('INTEGRITY', '事务目标不属于实例内容。')
    return assertManagedPath(this.root, join(this.root, relative))
  }
  private async write(path: string, value: unknown): Promise<void> {
    const temporary = `${path}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(value))
    await rename(temporary, path)
  }
  private async load(name: string): Promise<Journal | null> {
    const path = await assertManagedPath(this.root, join(this.root, '.updates', `${name}.json`))
    let journal: Journal
    try { journal = JSON.parse(await readFile(path, 'utf8')) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
    if (!journal || !/^[a-zA-Z0-9-]{1,80}$/.test(journal.id) || !['prepared', 'applying', 'complete'].includes(journal.phase) || !Array.isArray(journal.changes) || journal.changes.length > 100002) throw new LauncherError('CONFIG_CORRUPT', '实例更新恢复记录损坏。')
    if (new Set(journal.changes.map(change => change.path?.toLowerCase())).size !== journal.changes.length) throw new LauncherError('CONFIG_CORRUPT', '恢复记录包含重复目标。')
    for (const change of journal.changes) {
      if (typeof change.existed !== 'boolean' || change.existed !== (change.before !== null) || ![change.before, change.after].every(hash => hash === null || typeof hash === 'string' && /^[a-f0-9]{128}$/.test(hash))) throw new LauncherError('CONFIG_CORRUPT', '恢复记录摘要无效。')
      await this.path(change.path)
    }
    return journal
  }
  private async replace(source: string | null, destination: string): Promise<void> {
    if (!source) { await rm(destination, { force: true }); return }
    if (dirname(destination) !== this.root) await ensureManagedDirectory(this.root, dirname(destination))
    const temporary = `${destination}.${randomUUID()}.tmp`
    try { await copyFile(source, temporary); await assertManagedPath(this.root, destination); await rename(temporary, destination) }
    finally { await rm(temporary, { force: true }) }
  }
  private async rollback(journal: Journal): Promise<void> {
    for (const [index, change] of journal.changes.entries()) if (change.existed && await maybeHash(await assertManagedPath(this.root, join(this.root, '.updates', journal.id, 'backup', String(index)))) !== change.before) throw new LauncherError('INTEGRITY', '备份文件损坏，已停止自动恢复。')
    for (const [index, change] of journal.changes.entries()) {
      const source = change.existed ? await assertManagedPath(this.root, join(this.root, '.updates', journal.id, 'backup', String(index))) : null
      await this.replace(source, await this.path(change.path))
    }
  }
  async recover(): Promise<void> {
    const journal = await this.load('active')
    if (!journal) return
    if (journal.phase === 'applying') await this.rollback(journal)
    if (journal.phase === 'complete') await this.write(join(this.root, '.updates', 'last.json'), journal)
    await rm(join(this.root, '.updates', 'active.json'), { force: true })
  }
  async canRestore(): Promise<boolean> { return !!await this.load('last') }
  async backupSize(): Promise<number> {
    const size = async (directory: string): Promise<number> => {
      const entries = await readdir(directory, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
      let bytes = 0
      for (const entry of entries) {
        const path = await assertManagedPath(this.root, join(directory, entry.name))
        bytes += entry.isDirectory() ? await size(path) : (await stat(path)).size
      }
      return bytes
    }
    return size(await assertManagedPath(this.root, join(this.root, '.updates')))
  }
  async apply(changes: FileChange[], signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    await this.recover()
    if (new Set(changes.map(change => change.path.toLowerCase())).size !== changes.length) throw new LauncherError('INTEGRITY', '事务目标存在重复文件。')
    const journal: Journal = { id: randomUUID(), phase: 'prepared', changes: [] }
    const directory = await ensureManagedDirectory(this.root, join(this.root, '.updates', journal.id, 'backup'))
    for (const [index, change] of changes.entries()) {
      signal.throwIfAborted()
      const path = await this.path(change.path)
      const before = await maybeHash(path)
      if (before !== change.expected) throw new LauncherError('INVALID_INPUT', `文件冲突：${change.path} 已改变，请重新预览。`)
      if (before) await copyFile(path, join(directory, String(index)))
      journal.changes.push({ path: change.path, existed: before !== null, before, after: change.source ? await hashFile(change.source) : null })
    }
    const active = join(this.root, '.updates', 'active.json')
    await this.write(active, journal)
    journal.phase = 'applying'; await this.write(active, journal)
    try {
      for (const change of changes) { signal.throwIfAborted(); await this.replace(change.source, await this.path(change.path)) }
      for (const change of journal.changes) if (await maybeHash(await this.path(change.path)) !== change.after) throw new LauncherError('INTEGRITY', '变更后的文件校验失败。')
      journal.phase = 'complete'; await this.write(active, journal)
      await this.write(join(this.root, '.updates', 'last.json'), journal)
      await rm(active, { force: true })
    } catch (error) { await this.rollback(journal); await rm(active, { force: true }); throw error }
  }
  async restore(): Promise<void> {
    await this.recover()
    const journal = await this.load('last')
    if (!journal) throw new LauncherError('INVALID_INPUT', '没有可恢复的更新备份。')
    const changes: FileChange[] = []
    for (const [index, change] of journal.changes.entries()) {
      if (await maybeHash(await this.path(change.path)) !== change.after) throw new LauncherError('INVALID_INPUT', `恢复冲突：${change.path} 在更新后已被修改。`)
      changes.push({ path: change.path, source: change.existed ? await assertManagedPath(this.root, join(this.root, '.updates', journal.id, 'backup', String(index))) : null, expected: change.after })
    }
    await this.apply(changes, new AbortController().signal)
  }
}
