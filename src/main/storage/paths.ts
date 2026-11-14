import { lstat, mkdir } from 'node:fs/promises'
import { isAbsolute, relative, resolve, parse, sep } from 'node:path'
import { LauncherError } from '../errors'

export async function assertManagedPath(root: string, candidate: string): Promise<string> {
  const absoluteRoot = resolve(root)
  const absolute = resolve(candidate)
  const suffix = relative(absoluteRoot, absolute)
  if (!suffix || suffix === '..' || suffix.startsWith(`..${sep}`) || isAbsolute(suffix)) throw new LauncherError('INVALID_INPUT', '路径不在受管子目录中。')
  let cursor = parse(absolute).root
  for (const part of absolute.slice(cursor.length).split(sep)) {
    if (!part || /[:\x00]/.test(part) || /[. ]$/.test(part)) throw new LauncherError('INVALID_INPUT', '目录名称无效。')
    cursor = resolve(cursor, part)
    try { if ((await lstat(cursor)).isSymbolicLink()) throw new LauncherError('INVALID_INPUT', '受管路径不能经过链接或重解析目录。') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  return absolute
}

export async function ensureManagedDirectory(root: string, candidate: string): Promise<string> {
  const absolute = await assertManagedPath(root, candidate)
  await mkdir(absolute, { recursive: true })
  return assertManagedPath(root, absolute)
}
