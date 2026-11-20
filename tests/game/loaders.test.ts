import { test, expect, vi } from 'vitest'
import { LoaderService, neoGameVersion, validateProfile } from '../../src/main/game/loaders'

test('NeoForge versions map to exact Minecraft patches and reject unrelated Maven versions', () => {
  expect(neoGameVersion('21.1.210')).toBe('1.21.1')
  expect(neoGameVersion('20.2.88')).toBe('1.20.2')
  expect(neoGameVersion('21.0.12-beta')).toBe('1.21')
  expect(neoGameVersion('public-ip-secret')).toBeNull()
})

test('derived profile must inherit the chosen base and cannot escape version paths', () => {
  expect(() => validateProfile({ id: '../escape', inheritsFrom: '1.20.1', mainClass: 'Main', libraries: [] }, '1.20.1')).toThrow()
  expect(() => validateProfile({ id: 'fabric-test', inheritsFrom: '1.19.4', mainClass: 'Main', libraries: [] }, '1.20.1')).toThrow()
  expect(() => validateProfile({ id: 'fabric-test', inheritsFrom: '1.20.1', mainClass: 'Main', libraries: [] }, '1.20.1')).not.toThrow()
})

test('loader catalog filters Forge versions by exact game version', async () => {
  const request = vi.fn().mockResolvedValue(new Response('<metadata><version>1.20.1-47.4.0</version><version>1.20.2-48.0.0</version><version>1.20.1-47.3.0</version></metadata>'))
  const service = new LoaderService(() => 'unused', request)
  expect((await service.list('1.20.1', 'forge', new AbortController().signal)).map(item => item.version)).toEqual(['47.4.0', '47.3.0'])
  await expect(service.list('../escape', 'fabric', new AbortController().signal)).rejects.toThrow()
})
