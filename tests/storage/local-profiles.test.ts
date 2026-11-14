import { afterEach, expect, test } from 'vitest'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from '../../src/main/storage/store'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))) })
async function setup() { const directory = await mkdtemp(join(tmpdir(), 'lql-local-')); directories.push(directory); return { directory, store: await Store.open(directory) } }

test('local profiles persist with the Java offline UUID and remain stable after recreation', async () => {
  const { directory, store } = await setup()
  const profile = await store.addLocalProfile(' Notch ')
  expect(profile).toEqual({ id: 'local:b50ad385829d3141a2167e7d7539ba7f', uuid: 'b50ad385829d3141a2167e7d7539ba7f', name: 'Notch', kind: 'local', status: 'ready' })
  const reopened = await Store.open(directory)
  expect(reopened.config.localProfiles).toEqual([profile])
  expect(reopened.config.selectedAccountId).toBe(profile.id)
  await reopened.removeLocalProfile(profile.id)
  expect(reopened.config.selectedAccountId).toBeNull()
  expect(await reopened.addLocalProfile('Notch')).toEqual(profile)
})

test('invalid and duplicate nicknames are rejected without changing persisted profiles', async () => {
  const { directory, store } = await setup()
  const profile = await store.addLocalProfile('Player_01')
  for (const name of ['', 'ab', 'a'.repeat(17), '中文角色', 'a b', '../player', 'player_01', null, 42]) await expect(store.addLocalProfile(name as string)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  await expect(store.removeLocalProfile('local:missing')).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  expect((await Store.open(directory)).config.localProfiles).toEqual([profile])
})

test('old configurations migrate without losing instances or Microsoft selection and malformed profiles are preserved', async () => {
  const { directory, store } = await setup()
  const instance = await store.createInstance('existing', '1.20.1')
  const config = { ...store.config, selectedAccountId: 'microsoft-account' } as Partial<typeof store.config>
  delete config.localProfiles
  await writeFile(join(directory, 'config.json'), JSON.stringify(config))
  const reopened = await Store.open(directory)
  expect(reopened.config.localProfiles).toEqual([])
  expect(reopened.config.instances[0].id).toBe(instance.id)
  expect(reopened.config.selectedAccountId).toBe('microsoft-account')
  const invalid = JSON.stringify({ ...reopened.config, localProfiles: [{ id: 'local:forged', name: 'Player', uuid: 'a'.repeat(32), kind: 'local', status: 'ready' }] })
  await writeFile(join(directory, 'config.json'), invalid)
  await expect(Store.open(directory)).rejects.toMatchObject({ code: 'CONFIG_CORRUPT' })
  expect(await readFile(join(directory, 'config.json'), 'utf8')).toBe(invalid)
})
