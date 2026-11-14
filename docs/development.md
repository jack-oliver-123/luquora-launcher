# 开发与维护

## 运行边界

`src/main` 负责文件、网络、认证、Java 与进程；`src/preload` 只暴露白名单业务 API；`src/renderer` 使用 Vue 3 和 Naive UI。窗口启用隔离上下文和沙箱，关闭 Node 集成，阻止导航和新窗口。令牌、启动命令和通用文件接口不进入 renderer。

数据布局：

```text
%APPDATA%/LuquoraLauncher/
  config.json
  auth.bin                    Windows 加密的账号记录与 MSAL 缓存
  game-process.json           活动或待确认的游戏进程
  game-data/
    instances/<UUID>/game/    独立 saves、options.txt、screenshots 等
    instances/<UUID>/natives/ 每次启动的原生库目录
    shared/                   官方版本描述、客户端、libraries、assets
    runtimes/                 官方 Java 运行时
    logs/                     最近十次游戏会话
```

实例改名保留 UUID，不移动存档。配置使用临时文件和原子替换；损坏的配置保留原文件并阻止启动。删除实例调用 Windows 回收站，失败时不进行永久删除。

## Microsoft 应用接入

1. 在自己的 Microsoft Entra/Azure 应用注册中创建适合个人 Microsoft 账号的公共客户端，按微软文档启用所需公共客户端/设备代码流程。LQL 当前使用 `consumers` authority。
2. 确认该应用有资格请求 `XboxLive.signin`、Xbox/XSTS 和 Minecraft 服务。普通应用注册成功并不等于取得 Minecraft 服务接入资格；政策、申请与授权要求以微软当前文档和实际返回为准。Mojang 的 [Java Edition Game Service API 审核说明](https://help.minecraft.net/hc/en-us/articles/16254801392141) 明确：新的第三方应用须通过 [Java Edition 应用审核表](https://aka.ms/mce-reviewappid) 提交审核，由 Mojang 人工加入 allow list；已有获批应用继续可用。`403` 返回的 `aka.ms/AppRegInfo` 指向该说明，不等于账号未登录或缺少 Xbox DeviceToken。
3. LQL 请求 `XboxLive.signin`、`offline_access`，交换 Xbox Live → Minecraft XSTS → Minecraft token，再检查 entitlement 和游戏角色。不要添加客户端密钥，不要从其他启动器复制 client ID。
4. 默认构建使用 LQL 自有的公共应用标识 `e3cb9f3c-2e1e-426a-8a07-2bc774342b94`。维护者可通过 `LQL_MS_CLIENT_ID` 覆盖；打包时相同环境变量嵌入 main 构建。标识是公共配置，不是 client secret。`.env` 不会被自动读取。
5. 取得设备代码后，LQL 自动将代码写入 Windows 剪贴板并打开微软官方授权网页；启动器弹窗提示“代码已自动复制”，用户在网页按 `Ctrl + V` 粘贴，再完成登录和多因素验证。复制或打开失败会显示准确提示，保留代码和网址；“复制代码并打开授权页”可重试。禁止在问题报告中提交密码、验证码、令牌或 `auth.bin`。

### 注册与本机配置

在 [Microsoft Entra 管理中心](https://entra.microsoft.com/) 打开“应用注册 → 新注册”，名称填写 `Luquora Launcher`。账号类型选择“仅个人 Microsoft 账号”，也可选择同时支持组织与个人账号的类型；仅支持组织账号的应用不适用于当前 `consumers` 登录端点。

注册后，在应用的“身份验证 → 高级设置”中启用“允许公共客户端流”。当前设备代码流程不需要重定向 URI，也不需要创建客户端密钥。返回“概述”，复制“应用程序（客户端）ID”，不要复制对象 ID 或目录（租户）ID。

如果把原先仅支持组织账号的应用改成个人账号应用时，保存报 `Property api.requestedAccessTokenVersion is invalid`，需要在 Microsoft Graph 应用清单中把 `api.requestedAccessTokenVersion` 设置为 `2`。微软要求支持个人账号的应用使用此值。当前 LQL 应用已配置 `signInAudience: PersonalMicrosoftAccount`、`isFallbackPublicClient: true` 与访问令牌版本 `2`。

在项目目录的 PowerShell 中设置该公共 ID，然后启动开发版：

```powershell
$env:LQL_MS_CLIENT_ID = '替换为自己应用的客户端 ID'
npm run dev
```

要让分发的 EXE 自带该标识，在设置变量的同一个 PowerShell 中执行 `npm run dist:win` 和 `npm run dist:portable`。已构建的 EXE 不会因后来设置构建变量而自动更新。

### 真实账号验收

添加微软账号后，先检查 LQL 能否取得设备代码、自动复制并打开官方网页，再由用户在网页粘贴代码并亲自登录。设备代码流程本身属于 OAuth 2.0；界面中的短代码供用户在微软页面输入，与授权码回调流程中由应用自动接收的 `authorization_code` 不同。当前沿用设备代码流程，不启用本机回调监听。授权完成后依次验证 Xbox/XSTS、Minecraft 使用权限及角色获取；应用注册或设备授权成功都不能单独证明 Minecraft 服务准入。若后续交换失败，需核查自有应用的服务接入资格和账号限制，不应通过更换成第三方应用标识处理。

账号显示成功后，关闭并重启 LQL，确认账号仍在，并通过启动游戏验证静默刷新。最后验证移除账号，确认不会删除游戏实例或存档。真实测试过程中不要把设备代码、访问令牌、刷新令牌或 `auth.bin` 放入截图、日志和问题报告。

参考：[MSAL Node 设备代码流程](https://learn.microsoft.com/en-us/entra/msal/javascript/node/acquire-token-requests#device-code-flow)、[应用注册](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)、[桌面应用注册与公共客户端流](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-desktop-app-registration#enable-public-client-flow)、[设备代码协议](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code)、[XMCL 用户模块](https://github.com/Voxelum/minecraft-launcher-core-node/tree/master/packages/user)。

LQL 自有应用注册与公共客户端配置已完成，但游戏服务 API 准入尚待审核。真实账号授权验收仍需用户在微软页面完成。认证单测在 MSAL/Xbox/Minecraft 边界替换响应；这些测试证明本地流程，不证明服务准入。

### 2026-11-14 403 对照结论

- [Prism Launcher](https://github.com/PrismLauncher/PrismLauncher) 的 `XboxAuthorizationStep` 不含 DeviceToken，随后使用 `POST https://api.minecraftservices.com/launcher/login`，请求体为 `xtoken` 与 `platform: PC_LAUNCHER`；它使用项目配置的 MSA client ID `c36a9fb6-4f2a-41ff-90bd-ae7cc92031eb`。
- [HMCL](https://github.com/HMCL-dev/HMCL) 的 `MicrosoftService` 不含 DeviceToken，仍调用 `POST https://api.minecraftservices.com/authentication/login_with_xbox`，请求体为 `identityToken`。
- LQL 依赖的 [@xmcl/user](https://github.com/Voxelum/minecraft-launcher-core-node) 完整流程 `acquireXBoxToken()` 会附加 Xbox DeviceToken，但低层 `authorizeXboxLive()` 和 `loginMinecraftWithXBox()` 不要求它。
- LQL 当前的 `auth:minecraft` 403 与另一新启动器在 Microsoft Q&A 报告的 `Invalid app registration` 情形一致；本机对照探针显示 Node `fetch` 与 Electron `net.fetch` 对这组端点返回相同状态，排除传输栈差异。先完成 Mojang 应用审核，不通过更换端点、DeviceToken 或第三方 client ID 绕过。

## Java 与版本

按官方版本 JSON 的 `javaVersion` 严格匹配 Java 主版本与 x64 架构；不假设高版本总能替代低版本。自动模式扫描受管运行时、JAVA_HOME、PATH、常用安装目录和 JavaSoft 注册表，不递归扫描磁盘，不改变系统环境变量。显式路径不兼容会报错。

受管运行时来自 Mojang 清单，校验原始文件摘要。当前真实下载验证了 `1.16.5 → 8 / jre-legacy`、`1.20.1 → 17 / java-runtime-gamma`、`26.3 → 25 / java-runtime-epsilon`。

XMCL 最新包曾发布无法解析的 `workspace:^*` 依赖和缺失的入口；当前固定 core 2.15.1 / installer 6.1.2 / user 4.4.2，`undici` 覆盖为 7.30.1。实际 DLL 解压复验发现旧 yauzl 2 文件流在当前 Node 24 环境中无法完成，已将 `@xmcl/unzip` 的该依赖限定为 yauzl 3.4.0，并以真实三个基线解压复验；不改其他打包工具的依赖边。不要直接升级后跳过真实 Electron 导入和三个基线验证。安装写入使用本项目的受管下载器，以统一路径检查、摘要、并发和取消等待。

## 故障恢复

- `CONFIG_CORRUPT`：备份配置，修复 `config.json`；或改名保存原件，再启动生成新配置。不要删除实例目录。
- 账号无法读取：保留原 `auth.bin`；确认使用原 Windows 用户、原应用标识，必要时重新授权。
- 游戏残留：检查游戏窗口、任务管理器与 `game-process.json`。LQL 使用 PID、创建时间和可执行路径核对身份；无法核实时拒绝终止。先正常退出游戏再重启。只有人工确认所有游戏已退出后，才备份并移走不确定的进程记录。
- 下载失败：解决网络、磁盘或权限后重试；已验证完整文件可复用，部分文件不会充当完整文件，不支持网络断点续传。
- 游戏异常：查看日志；默认保留十次、每次约 10 MiB，界面显示最后 2000 行。日志不记录完整启动命令。

每次启动使用新的 natives 目录以避免信任旧的解压缓存；旧 natives 目录目前随实例保留，删除实例时一并移入回收站。

## 构建和维护

`npm run dist:win` 重新生成许可清单并构建当前用户 NSIS 包。`build/icon.svg` 是自有几何图标源；变更后在 Windows 执行 `powershell -File scripts/generate-icon.ps1` 生成 PNG/ICO。`npm run notices` 从实际锁文件生成许可索引及可获得的许可原文；Ionicons 上游许可原文来自 https://raw.githubusercontent.com/ionic-team/ionicons/main/LICENSE 。

`npm run dist:portable` 使用 `electron-builder.portable.yml` 构建单文件免安装版，不改动 NSIS 安装包配置。便携版每次运行会把应用解压到 Windows 临时目录，数据仍写入 `%APPDATA%\LuquoraLauncher`，除非用 `LQL_USER_DATA` 指向独立目录；它不是绿色版随身存档，也不应同时启动多个实例。Playwright 因 NSIS 启动外壳吞掉 `electron.launch` 所需的调试输出，便携版验收改用显式 CDP 端口连接真实窗口。

`LQL_USER_DATA` 可为验收设置独立数据目录；`LQL_HIDDEN=1` 用于自动化隐藏测试窗口。这些开关不会绕过账号或文件校验，不应指向未经确认的已有用户数据。
