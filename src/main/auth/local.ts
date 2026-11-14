import { createHash } from 'node:crypto'
import type { LocalProfile } from '../../shared/contracts'
import { LauncherError } from '../errors'

export function createLocalProfile(value: string): LocalProfile {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_]{3,16}$/.test(value.trim())) throw new LauncherError('INVALID_INPUT', '角色昵称需为 3–16 位英文字母、数字或下划线。')
  const name = value.trim()
  const digest = createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest()
  digest[6] = (digest[6] & 0x0f) | 0x30
  digest[8] = (digest[8] & 0x3f) | 0x80
  const uuid = digest.toString('hex')
  return { id: `local:${uuid}`, uuid, name, kind: 'local', status: 'ready' }
}
