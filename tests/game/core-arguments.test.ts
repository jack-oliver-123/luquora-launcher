import { expect, test } from 'vitest'
import { generateArguments } from '@xmcl/core'

test('installed XMCL returns executable at index zero followed by Java arguments', async () => {
  const command = await generateArguments({
    javaPath: 'C:\\Java\\bin\\java.exe', gamePath: 'C:\\LQL\\instance', resourcePath: 'C:\\LQL\\shared',
    accessToken: 'synthetic-argument-contract-probe', gameProfile: { name: 'ContractProbe', id: 'a'.repeat(32) },
    version: { id: 'contract-probe', minecraftVersion: 'contract-probe', type: 'release', mainClass: 'net.minecraft.client.main.Main', assets: 'contract-probe', libraries: [], arguments: { jvm: ['-cp', '${classpath}'], game: [] } } as never,
  })
  expect(command[0]).toBe('C:\\Java\\bin\\java.exe')
  expect(command.slice(1)[0]).toBe('-cp')
  expect(command.filter(argument => argument === 'C:\\Java\\bin\\java.exe')).toHaveLength(1)
})

test('real XMCL preserves explicit offline credentials instead of inventing a token or Microsoft user type', async () => {
  const command = await generateArguments({
    javaPath: 'C:\\Java\\bin\\java.exe', gamePath: 'C:\\LQL\\instance', resourcePath: 'C:\\LQL\\shared',
    accessToken: '0', userType: 'legacy', gameProfile: { name: 'Notch', id: 'b50ad385829d3141a2167e7d7539ba7f' },
    version: { id: 'contract-probe', minecraftVersion: 'contract-probe', type: 'release', mainClass: 'net.minecraft.client.main.Main', assets: 'contract-probe', libraries: [], arguments: { jvm: [], game: ['--username', '${auth_player_name}', '--uuid', '${auth_uuid}', '--accessToken', '${auth_access_token}', '--userType', '${user_type}'] } } as never,
  })
  expect(command.slice(command.indexOf('--username'), command.indexOf('--userType') + 2)).toEqual(['--username', 'Notch', '--uuid', 'b50ad385829d3141a2167e7d7539ba7f', '--accessToken', '0', '--userType', 'legacy'])
})
