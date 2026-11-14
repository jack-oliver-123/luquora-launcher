import { expect, test } from 'vitest'

test('runtime requirement follows metadata including Java 25 rather than a latest-version guess', async () => {
  const module = await import('../../src/main/game/metadata').catch(() => null)
  expect(module, 'version parser missing').not.toBeNull()
  for (const [id, majorVersion, component] of [['1.16.5', 8, 'jre-legacy'], ['1.20.1', 17, 'java-runtime-gamma'], ['26.3', 25, 'java-runtime-epsilon']] as const) {
    expect(module!.javaRequirement({ id, javaVersion: { majorVersion, component } })).toEqual({ major: majorVersion, component })
  }
  expect(() => module!.javaRequirement({ id: 'old' })).toThrow()
})

test('Java probe parser rejects x86 and reads legacy as well as modern versions', async () => {
  const module = await import('../../src/main/game/java').catch(() => null)
  expect(module, 'Java validation missing').not.toBeNull()
  expect(module!.parseJavaProperties('java.version = 1.8.0_401\nos.arch = amd64')).toEqual({ major: 8, arch: 'x64' })
  expect(module!.parseJavaProperties('java.version = 25.0.1\nos.arch = amd64')).toEqual({ major: 25, arch: 'x64' })
  expect(() => module!.parseJavaProperties('java.version = 17.0.1\nos.arch = x86')).toThrow()
})
