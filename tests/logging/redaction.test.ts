import { expect, test } from 'vitest'

test('stream redaction handles credentials split across chunks and flushes its tail', async () => {
  const module = await import('../../src/main/logging').catch(() => null)
  expect(module, 'stream redaction missing').not.toBeNull()
  const redactor = new module!.StreamRedactor(['secret-token-123'])
  const output = redactor.push('request failed secret-') + redactor.push('token-123 at endpoint\n') + redactor.flush()
  expect(output).toContain('[REDACTED]')
  expect(output).not.toContain('secret-token-123')
  expect(output).toContain('request failed')
})
