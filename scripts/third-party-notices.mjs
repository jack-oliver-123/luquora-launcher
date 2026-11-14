import { mkdir, readFile, readdir, writeFile, copyFile } from 'node:fs/promises'
import { join } from 'node:path'

const lock = JSON.parse(await readFile('package-lock.json', 'utf8'))
const destination = 'build/third-party-licenses'
await mkdir(destination, { recursive: true })
const rows = []
for (const [directory, entry] of Object.entries(lock.packages)) {
  if (!directory || entry.dev || entry.link) continue
  const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
  const label = `${metadata.name.replaceAll('/', '+')}@${metadata.version}`
  const files = (await readdir(directory)).filter(name => /^(licen[sc]e|copying|notice|copyright)(\.|$)/i.test(name))
  const licenses = []
  for (const name of files) {
    const targetName = `${label}-${name}`
    await copyFile(join(directory, name), join(destination, targetName))
    licenses.push(targetName)
  }
  const repository = typeof metadata.repository === 'string' ? metadata.repository : metadata.repository?.url ?? metadata.homepage ?? ''
  rows.push({ name: metadata.name, version: metadata.version, license: metadata.license ?? entry.license ?? 'SEE PACKAGE', repository, files: licenses })
}
rows.sort((first, second) => first.name.localeCompare(second.name))
await copyFile('build/licenses-source/ionicons-LICENSE.txt', join(destination, 'ionicons-LICENSE.txt'))
const lines = ['# Third-party notices', '', 'Generated from package-lock.json by npm run notices. LQL has no project license selected yet.', '', 'Production dependencies are listed below. Frontend Vue, Naive UI and Ionicons components are bundled into the renderer; backend packages ship inside app.asar. Complete available license texts accompany the application under resources/third-party-licenses.', '', '| Package | Version | License | Source |', '| --- | --- | --- | --- |']
for (const row of rows) lines.push(`| ${row.name} | ${row.version} | ${row.license} | ${row.repository.replaceAll('|', '%7C')} |`)
lines.push('', 'Electron includes Chromium and Node.js. Electron LICENSE and LICENSES.chromium.html ship beside the Windows executable. Downloaded Minecraft and Mojang Java files remain subject to their publishers\' terms and are not embedded in the launcher installer.', '')
await writeFile('THIRD_PARTY_NOTICES.md', lines.join('\n'))
await writeFile(join(destination, 'index.json'), JSON.stringify(rows, null, 2))
console.log(`Recorded ${rows.length} production packages and their license files.`)
