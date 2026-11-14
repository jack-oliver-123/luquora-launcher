import { expect, test } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from '../../src/main/storage/store'

test('install coordinator rejects overlapping tasks and waits for cancellation cleanup', async () => {
  const module = await import('../../src/main/game/install').catch(() => null)
  expect(module, 'install coordinator missing').not.toBeNull()
  const directory = await mkdtemp(join(tmpdir(), 'lql-coordinator-'))
  try {
    const store = await Store.open(directory)
    const first = await store.createInstance('first', '1.20.1')
    const second = await store.createInstance('second', '1.16.5')
    const metadata = { resolve: async (_id: string, signal: AbortSignal) => new Promise<never>((_resolve, reject) => { signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }) }) }
    const service = new module!.InstallService(store, metadata, () => {}, () => {}, () => false)
    await service.start(first.id)
    await expect(service.start(second.id)).rejects.toMatchObject({ code: 'BUSY' })
    await service.cancel()
    expect(service.isBusy()).toBe(false)
    expect(store.getInstance(first.id).installation).toBe('incomplete')
  } finally { await rm(directory, { recursive: true, force: true }) }
})
