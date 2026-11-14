import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execute = promisify(execFile)
export type ProcessRecord = { pid: number; startedAt: string; executable: string; instanceId: string }
export function sameProcess(expected: ProcessRecord, actual: ProcessRecord | null): boolean {
  return actual !== null && expected.pid === actual.pid && expected.startedAt === actual.startedAt && expected.executable.toLowerCase() === actual.executable.toLowerCase()
}
export async function processIdentity(pid: number, instanceId: string): Promise<ProcessRecord | null> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null
  const script = 'param([int]$TargetPid) $entry = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $TargetPid); if ($entry) { @{pid=$entry.ProcessId;startedAt=$entry.CreationDate.ToUniversalTime().ToString("o");executable=$entry.ExecutablePath} | ConvertTo-Json -Compress }'
  const encoded = Buffer.from(`& { ${script} } ${pid}`, 'utf16le').toString('base64')
  const result = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true, timeout: 10000, maxBuffer: 65536 })
  if (!result.stdout.trim()) return null
  const data = JSON.parse(result.stdout)
  if (typeof data.executable !== 'string' || typeof data.startedAt !== 'string') return null
  return { ...data, instanceId }
}
