import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export type Encryption = { available(): boolean; encrypt(value: string): Buffer; decrypt(value: Buffer): string }
export class EncryptedCache {
  private memory = ''
  constructor(private directory: string, private encryption: Encryption) {}
  get persistent(): boolean { return this.encryption.available() }
  async load(): Promise<string> {
    if (!this.persistent) return this.memory
    try { this.memory = this.encryption.decrypt(await readFile(join(this.directory, 'auth.bin'))); return this.memory }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw error }
  }
  async save(value: string): Promise<void> {
    this.memory = value
    if (!this.persistent) return
    await mkdir(this.directory, { recursive: true })
    const temporary = join(this.directory, `auth.${randomUUID()}.tmp`)
    await writeFile(temporary, this.encryption.encrypt(value), { flag: 'wx' })
    await rename(temporary, join(this.directory, 'auth.bin'))
  }
}
