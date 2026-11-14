import { afterEach, expect, test, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from '../../src/main/storage/store'
import { LogService } from '../../src/main/logging'
import { LaunchService } from '../../src/main/game/launch'

const boundary = vi.hoisted(() => ({ spawn: vi.fn(), identity: vi.fn(), kill: vi.fn(), arguments: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: boundary.spawn, execFile: (file: string, args: string[], _options: unknown, callback: (error: Error | null, stdout: string) => void) => { boundary.kill(file, args); callback(null, '') } }))
vi.mock('../../src/main/game/processes', async original => ({ ...await original<typeof import('../../src/main/game/processes')>(), processIdentity: boundary.identity }))
vi.mock('../../src/main/game/java', () => ({ resolveJava: async () => ({ executable: 'C:\\Java\\bin\\java.exe', major: 17 }) }))
vi.mock('@xmcl/core', () => ({ Version: { parse: async () => ({}) }, generateArguments: boundary.arguments, LaunchPrecheck: { checkNatives: async () => {} }, MinecraftFolder: class {} }))

const directories: string[] = []
afterEach(async () => { vi.clearAllMocks(); await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))) })
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'lql-process-')); directories.push(directory)
  const store = await Store.open(directory)
  const instance = await store.createInstance('world', '1.20.1')
  const logs = new LogService(() => store.config.gameRoot, () => {}); await logs.initialize()
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), pid: 12345, exitCode: null, killed: false, kill: vi.fn() })
  boundary.arguments.mockResolvedValue(['C:\\Java\\bin\\java.exe', '--accessToken', 'secret-token'])
  boundary.spawn.mockImplementation(() => { queueMicrotask(() => child.emit('spawn')); return child })
  boundary.identity.mockResolvedValue({ pid: child.pid, startedAt: '2026-11-13T01:00:00.000Z', executable: 'C:\\Java\\bin\\java.exe', instanceId: instance.id })
  const errors: unknown[] = []
  const accounts = { getLaunchIdentity: vi.fn().mockResolvedValue({ name: 'Player', uuid: 'a'.repeat(32), accessToken: 'secret-token', xuid: '', clientId: 'own-app' }) }
  const service = new LaunchService(store, accounts as never, { resolve: async () => ({ id: '1.20.1' }) } as never, { isBusy: () => false, verifyInstance: async () => true } as never, logs, () => {}, error => errors.push(error))
  return { directory, store, instance, child, service, errors, logs, accounts }
}
async function settled(service: LaunchService) { await vi.waitFor(() => expect(['exited', 'failed']).toContain(service.status().phase)) }

test('single game ownership follows actual close and nonzero exit is logged as a crash', async () => {
  const { service, instance, child, errors, logs } = await setup()
  await service.start(instance.id, 'account')
  expect(boundary.spawn.mock.calls[0][0]).toBe('C:\\Java\\bin\\java.exe')
  expect(boundary.spawn.mock.calls[0][1][0]).toBe('--accessToken')
  expect(service.status().phase).toBe('running')
  await expect(service.start(instance.id, 'account')).rejects.toMatchObject({ code: 'BUSY' })
  child.stdout.write('contains secret-token\n')
  child.emit('close', 9)
  await settled(service)
  expect(service.status()).toMatchObject({ phase: 'failed', exitCode: 9, userStopped: false })
  expect(errors).toContainEqual(expect.objectContaining({ code: 'GAME_EXIT' }))
  expect((await logs.read(logs.summaries[0].id)).join('\n')).not.toContain('secret-token')
})

test('user stop is recorded before a fast taskkill exit arrives', async () => {
  const { service, instance, child } = await setup()
  await service.start(instance.id, 'account')
  boundary.kill.mockImplementation(() => child.emit('close', 1))
  await service.stop(true)
  await settled(service)
  expect(service.status()).toMatchObject({ phase: 'exited', userStopped: true })
})

test('unconfirmed identity never kills a child and leaves a recoverable uncertainty record', async () => {
  const { service, instance, child, directory } = await setup()
  boundary.identity.mockResolvedValue(null)
  await service.start(instance.id, 'account')
  await expect(service.stop(true)).rejects.toMatchObject({ code: 'BUSY' })
  expect(child.kill).not.toHaveBeenCalled()
  expect(boundary.kill).not.toHaveBeenCalled()
  expect(JSON.parse(await readFile(join(directory, 'game-process.json'), 'utf8'))).toMatchObject({ uncertain: true, instanceId: instance.id })
  child.emit('close', 0); await settled(service)
})

test('invalid recovered process records block mutation without querying or killing a PID', async () => {
  const { service, instance, directory } = await setup()
  await writeFile(join(directory, 'game-process.json'), JSON.stringify({ pid: -5, instanceId: instance.id, startedAt: 'bad', executable: 'bad' }))
  await service.recover()
  expect(service.busy).toBe(true)
  expect(service.blocksInstance(instance.id)).toBe(true)
  expect(boundary.identity).not.toHaveBeenCalled()
})

test('stop during startup waits for pending work and prevents spawning after cancellation', async () => {
  const { service, instance, accounts } = await setup()
  const identity = await accounts.getLaunchIdentity()
  let release!: (value: unknown) => void
  accounts.getLaunchIdentity.mockImplementation(() => new Promise(resolve => { release = resolve }))
  const starting = service.start(instance.id, 'account')
  let stopped = false
  const stopping = service.stop(false).then(() => { stopped = true })
  void stopping.catch(() => {})
  await new Promise(resolve => setTimeout(resolve, 5))
  expect(stopped).toBe(false)
  release(identity)
  await Promise.allSettled([starting, stopping])
  expect(stopped).toBe(true)
  expect(service.busy).toBe(false)
  expect(boundary.spawn).not.toHaveBeenCalled()
})

test('local launch uses the persisted offline identity without Microsoft authentication', async () => {
  const { service, instance, store, child, accounts } = await setup()
  const profile = await store.addLocalProfile('Notch')
  await service.start(instance.id, profile.id)
  expect(accounts.getLaunchIdentity).not.toHaveBeenCalled()
  expect(boundary.arguments).toHaveBeenCalledWith(expect.objectContaining({ gameProfile: { name: 'Notch', id: profile.uuid }, accessToken: '0', userType: 'legacy' }))
  expect(service.status().phase).toBe('running')
  child.emit('close', 0); await settled(service)
})

test('removed local identities fail instead of falling through to Microsoft or spawning', async () => {
  const { service, instance, store, accounts } = await setup()
  const profile = await store.addLocalProfile('Player')
  await store.removeLocalProfile(profile.id)
  await expect(service.start(instance.id, profile.id)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
  expect(accounts.getLaunchIdentity).not.toHaveBeenCalled()
  expect(boundary.spawn).not.toHaveBeenCalled()
})
