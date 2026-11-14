import { test, expect } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('unavailable encryption never persists plaintext credentials', async () => {
  const module = await import('../../src/main/auth/cache').catch(() => null)
  expect(module, 'encrypted auth cache missing').not.toBeNull()
  const directory = await mkdtemp(join(tmpdir(), 'lql-auth-'))
  try {
    const cache = new module!.EncryptedCache(directory, { available: () => false, encrypt: () => { throw Error('must not encrypt') }, decrypt: () => '' })
    await cache.save('super-secret')
    expect(await cache.load()).toBe('super-secret')
    await expect(readFile(join(directory, 'auth.bin'))).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('credential cache persists encrypted content and roundtrips on restart', async () => {
  const module = await import('../../src/main/auth/cache').catch(() => null)
  expect(module, 'encrypted auth cache missing').not.toBeNull()
  const directory = await mkdtemp(join(tmpdir(), 'lql-auth-'))
  const encryption = { available: () => true, encrypt: (value: string) => Buffer.from(value.split('').reverse().join('')), decrypt: (value: Buffer) => value.toString().split('').reverse().join('') }
  try {
    await new module!.EncryptedCache(directory, encryption).save('sensitive-session')
    expect((await readFile(join(directory, 'auth.bin'))).toString()).not.toContain('sensitive-session')
    expect(await new module!.EncryptedCache(directory, encryption).load()).toBe('sensitive-session')
  } finally { await rm(directory, { recursive: true, force: true }) }
})
