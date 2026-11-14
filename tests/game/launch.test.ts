import { expect, test } from 'vitest'

test('reused PID is not proof of the managed game process', async () => {
  const module = await import('../../src/main/game/processes').catch(() => null)
  expect(module, 'process identity check missing').not.toBeNull()
  const record = { pid: 1234, startedAt: '2026-11-13T00:00:00.000Z', executable: 'C:\\java\\bin\\java.exe', instanceId: 'instance' }
  expect(module!.sameProcess(record, { ...record, startedAt: '2026-11-13T01:00:00.000Z' })).toBe(false)
  expect(module!.sameProcess(record, { ...record })).toBe(true)
})
