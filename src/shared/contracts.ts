export type LaunchSettings = { memoryMiB: number; width: number; height: number; fullscreen: boolean; javaPath: string | null }
import type { ContentKind, ContentListing, ContentProject, ContentTask, ContentVersion, LoaderKind, LoaderSpec, LoaderVersion, PackPreview, ResourcePlan, SearchQuery, SearchResult } from './content'
export type Instance = { id: string; name: string; versionId: string; createdAt: string; installation: 'incomplete' | 'ready'; overrides: Partial<LaunchSettings>; loader?: LoaderSpec; launchVersionId?: string; staging?: boolean }
export type AccountSummary = { id: string; name: string; uuid: string; kind: 'microsoft' | 'local'; status: 'ready' | 'reauth-required' }
export type LocalProfile = AccountSummary & { kind: 'local'; status: 'ready' }
export type AppConfig = { schemaVersion: 1; gameRoot: string; selectedInstanceId: string | null; selectedAccountId: string | null; defaults: LaunchSettings; instances: Instance[]; localProfiles: LocalProfile[] }
export type ErrorCode = 'NETWORK' | 'AUTH_CANCELLED' | 'AUTH_EXPIRED' | 'AUTH_REQUIRED' | 'NO_ENTITLEMENT' | 'NO_PROFILE' | 'DISK_FULL' | 'NOT_WRITABLE' | 'INTEGRITY' | 'JAVA_MISSING' | 'JAVA_INCOMPATIBLE' | 'SPAWN' | 'GAME_EXIT' | 'INVALID_INPUT' | 'BUSY' | 'CONFIG_CORRUPT' | 'SERVICE'
export type AppError = { code: ErrorCode; stage: string; message: string; nextAction: string }
export type InstallProgress = { instanceId: string; stage: 'metadata' | 'java' | 'files' | 'loader' | 'verify' | 'complete'; completed: number; total: number | null; unit: 'bytes' | 'files' }
export type GameStatus = { instanceId: string | null; phase: 'idle' | 'checking' | 'starting' | 'running' | 'exited' | 'failed'; exitCode: number | null; userStopped: boolean }
export type LogSummary = { id: string; instanceId: string; versionId: string; createdAt: string }
export type AppSnapshot = { config: AppConfig; accounts: AccountSummary[]; installation: InstallProgress | null; game: GameStatus; logs: LogSummary[]; authPending: boolean; persistentAuth: boolean; clientConfigured: boolean; contentTasks?: ContentTask[] }
export type VersionSummary = { id: string; releasedAt: string }
export type AuthCode = { code: string; verificationUri: string; expiresAt: string; copied: boolean; browserOpened: boolean | null }
export type AppEvent = { type: 'snapshot'; data: AppSnapshot } | { type: 'auth-code'; data: AuthCode } | { type: 'auth-ended'; data: { outcome: 'success' | 'cancelled' | 'failed'; failure?: AppError } } | { type: 'error'; data: AppError } | { type: 'log-lines'; data: { sessionId: string; lines: string[] } }
export interface LauncherAPI {
  listLoaders(gameVersion: string, kind: LoaderKind): Promise<LoaderVersion[]>
  searchContent(query: SearchQuery): Promise<SearchResult>
  getContentProject(id: string): Promise<ContentProject>
  listContentVersions(projectId: string, instanceId: string | null): Promise<ContentVersion[]>
  previewResource(instanceId: string, versionId: string): Promise<ResourcePlan>
  applyResource(previewId: string): Promise<void>
  listInstanceContent(instanceId: string): Promise<ContentListing>
  toggleContent(instanceId: string, path: string): Promise<void>
  removeContent(instanceId: string, path: string): Promise<void>
  importContent(instanceId: string, kind: Exclude<ContentKind, 'modpack'>): Promise<void>
  checkContentUpdates(instanceId: string): Promise<{ projectId: string; title: string; version: string; versionId: string }[]>
  previewPack(versionId: string | null): Promise<PackPreview | null>
  previewPackUpdate(instanceId: string, versionId: string | null): Promise<PackPreview | null>
  installPack(previewId: string, name: string, optional: string[]): Promise<void>
  applyPackUpdate(previewId: string, optional: string[]): Promise<void>
  restoreContent(instanceId: string): Promise<void>
  clearContentBackups(instanceId: string): Promise<void>
  cancelContentTask(taskId: string): Promise<void>
  openContentProject(projectId: string): Promise<void>
  getSnapshot(): Promise<AppSnapshot>
  listVersions(): Promise<VersionSummary[]>
  createInstance(name: string, versionId: string, loader?: LoaderSpec): Promise<Instance>
  updateInstance(id: string, patch: { name?: string; overrides?: Partial<LaunchSettings> }): Promise<Instance>
  removeInstance(id: string): Promise<void>
  selectInstance(id: string | null): Promise<void>
  selectAccount(id: string | null): Promise<void>
  saveSettings(settings: LaunchSettings): Promise<void>
  chooseGameRoot(): Promise<void>
  chooseJavaPath(instanceId: string | null): Promise<string | null>
  openInstanceFolder(id: string): Promise<void>
  addAccount(): Promise<void>
  addLocalProfile(name: string): Promise<LocalProfile>
  cancelAuth(): Promise<void>
  removeAccount(id: string): Promise<void>
  installInstance(id: string): Promise<void>
  cancelInstall(): Promise<void>
  launchInstance(id: string): Promise<void>
  stopGame(force: boolean): Promise<void>
  readLog(sessionId: string): Promise<string[]>
  exportLog(sessionId: string): Promise<string | null>
  openAuthPage(): Promise<void>
  onEvent(listener: (event: AppEvent) => void): () => void
}
