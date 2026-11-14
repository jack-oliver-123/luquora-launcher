import { expect, test } from 'vitest'
import { generateArguments, LaunchPrecheck, MinecraftFolder, Version } from '@xmcl/core'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readdir, writeFile } from 'node:fs/promises'
import { Store } from '../../src/main/storage/store'
import { ensureManagedDirectory } from '../../src/main/storage/paths'

test.skipIf(!process.env.LQL_LIVE_ACCEPTANCE)('verified baseline libraries extract with actual XMCL and generate complete commands', async () => {
  const store = await Store.open(resolve(process.env.LQL_ACCEPTANCE_ROOT ?? '.superpowers/acceptance-中文 path'))
  const evidence: unknown[] = []
  for (const id of ['1.16.5', '1.20.1', '26.3']) {
    const instance = store.config.instances.find(instance => instance.versionId === id)!
    expect(instance.installation).toBe('ready')
    const shared = join(store.config.gameRoot, 'shared')
    const version = await Version.parse(shared, id)
    const nativeRoot = await ensureManagedDirectory(store.config.gameRoot, join(store.instancePath(instance.id), 'natives', randomUUID()))
    const options = { version, javaPath: 'C:\\ContractProbe\\java.exe', gamePath: join(store.instancePath(instance.id), 'game'), resourcePath: shared, nativeRoot, accessToken: 'synthetic-not-a-session', gameProfile: { id: 'a'.repeat(32), name: 'ContractProbe' } }
    await LaunchPrecheck.checkNatives(new MinecraftFolder(shared), version, options)
    const files = await readdir(nativeRoot)
    if (id === '1.16.5') expect(files.some(file => file.endsWith('.dll'))).toBe(true)
    const command = await generateArguments(options)
    expect(command[0]).toBe(options.javaPath)
    expect(command).toContain(version.mainClass)
    expect(command.slice(1)).not.toContain(options.javaPath)
    evidence.push({ id, nativeFiles: files, argumentCount: command.length, mainClass: version.mainClass, checkedAt: new Date().toISOString() })
  }
  await writeFile(join(store.userData, 'native-results.json'), JSON.stringify(evidence, null, 2))
}, 120000)
