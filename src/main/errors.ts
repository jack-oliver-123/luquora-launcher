import type { AppError, ErrorCode } from '../shared/contracts'

export class LauncherError extends Error {
  constructor(public code: ErrorCode, message: string, public nextAction = '查看日志后重试。', public stage = 'launcher') { super(message) }
}

export function publicError(error: unknown, stage = 'launcher'): AppError {
  if (error instanceof LauncherError) return { code: error.code, stage: error.stage, message: error.message, nextAction: error.nextAction }
  const code = (error as NodeJS.ErrnoException)?.code
  if (code === 'ENOSPC') return { code: 'DISK_FULL', stage, message: '磁盘空间不足。', nextAction: '清理游戏数据所在磁盘后重试。' }
  if (code === 'EACCES' || code === 'EPERM') return { code: 'NOT_WRITABLE', stage, message: '无法访问所选目录或文件。', nextAction: '检查目录权限，或选择可写的目录。' }
  if (typeof (error as { status?: unknown })?.status === 'number') return { code: 'SERVICE', stage, message: `服务返回 HTTP ${(error as { status: number }).status}。`, nextAction: '稍后重试；若持续失败，将界面中的阶段和 HTTP 状态反馈给维护者。' }
  return { code: 'SERVICE', stage, message: '操作未完成。', nextAction: '检查网络、目录权限和相关服务状态后重试。' }
}
