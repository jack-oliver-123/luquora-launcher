# LQL 0.1.0 候选构建验收

日期：2026-11-13，2026-11-14 补充本地角色、设备代码登录及网络诊断。环境：Windows 11 x64（构建 26200），Node 24.16.0、npm 11.13.0、Electron 45.3.1。最新交付文件与哈希见本文末尾的补充验收，替代 11 月 13 日文件。

## 已验证

| 范围 | 实际证据 | 结论 |
| --- | --- | --- |
| 组件库 UI | Naive UI 2.45.3、Ionicons；真实 Electron 的创建/改名/设置/导航/空状态截图 | 通过 |
| 类型与本地测试 | 11 月 14 日 `npm run typecheck` 退出 0；`npm test` 39 通过 / 2 跳过 | 通过 |
| 真实桥接交互 | 11 月 14 日 `npm run test:e2e` 7/7 通过，无浏览器假桥接；包含本地角色创建/重启/切换/移除、安装版复验和便携版角色创建 | 通过 |
| 本地身份游戏启动 | 最终安装版 1.16.5 / Java8、1.20.1 / Java17、26.3 / Java25 实际进入主菜单，再通过 Quit Game 退出，均退出码 0 | 通过此边界 |
| 原版 1.16.5 | 官方 Java 8、游戏文件下载及完整性复验，2026-11-13 20:02:40 +08:00 | 通过安装 |
| 原版 1.20.1 | 官方 Java 17、游戏文件下载及完整性复验，20:03:44 +08:00 | 通过安装 |
| 原版 26.3 | 官方 Java 25、游戏文件下载及完整性复验，20:06:09 +08:00 | 通过安装 |
| 自动运行时隔离 | 测试直接安装/执行 `game-data/runtimes` 内三个运行时，不选择开发机 JDK | 通过此边界 |
| 原生库与参数 | 真实 XMCL 对三个基线解压，并验证实际生成向量的可执行项和主类；最终安装包内再次复验 | 通过；未创建游戏进程 |
| 中文与空格目录 | `.superpowers/acceptance-中文 path`；UI 测试临时目录同样包含中文/空格 | 通过 |
| 取消与复用 | 安装协调器立即取消后重试；HTTP 本地服务校验重试与缓存复用 | 通过此边界 |
| 退出与恢复 | 可控进程边界测试验证实际 close、非零退出、PID 复用、不确定身份拒绝终止 | 通过自动化；非真实游戏 |
| 页面缩放 | 960×640 内容视口，Electron 页面缩放 100%/125%/150% | 通过；非系统 DPI |
| Windows 包 | `npm run dist:win` 退出 0；当前用户安装配置、自有图标、96 个生产依赖索引 / 90 份许可原文 | 已构建并安装，记录见下 |

官方下载测试 `tests/live/acceptance.test.ts`：1/1 通过，耗时 304.24 秒。临时完整日志：`%TEMP%\lql-live.log`；本地结果：`.superpowers/acceptance-中文 path/results.json`。原生库测试 `tests/live/natives.test.ts` 1/1 通过，结果在同目录 `native-results.json`；最终安装版还在 `.superpowers/acceptance-中文 path/packaged-native-results.json` 记录三个版本的真实 DLL 解压及参数契约。所有“通过安装”均不代表进入游戏主菜单。

## 外部条件未验收

- 此处“未配置”是 11 月 13 日的历史状态。当前构建已配置 LQL 自有公共 client ID；真实用户设备代码授权、Xbox/Minecraft 服务准入、账号重启刷新及账号移除后的真实服务验证仍未完成。
- 真实微软身份启动尚未验收。本地身份三个版本已进入主菜单；没有实际创建两份存档验证游戏写入隔离，也未测试在线服务器、Realms 或皮肤服务。
- 未使用全新 Windows 用户/虚拟机验证整机无 Java 情形。受管 Java 下载隔离测试不能替代干净系统。
- 未模拟真实磁盘耗尽、实际 ACL 拒绝、连接中途断网或 Windows 系统 125%/150% DPI。原子写失败、错误映射与 HTTP 边界测试不能替代这些系统场景。
- 关闭协调器已有实现，真实游戏窗口关闭/强制结束、安装过程中操作系统退出尚待人工验收。
- 独立审阅代理因当前 `group/smart-split` 不支持工具继承的 reasoning effort 而无法启动；采用作者逐项复查及失败回归测试，不能等同独立审阅。

## 设计核对

概念图：`C:/Users/Jack/.codex/generated_images/01a1d42b-e90a-7a83-9938-ad3aee975cdd/call_a40d17c46240464ca000755df540092c.png`。真实 Electron 截图：`test-results/launcher-empty.png`、`settings.png`、`launcher-instances.png`、`launcher-accounts.png` 和缩放截图。

已逐图检查银灰侧栏、白色内容区、石墨按钮、账号横条、立方体空状态、文字层级和底部状态栏。用户要求避免亮蓝主色，最终主按钮与品牌均为石墨色；账号页明确显示自有 Microsoft 登录尚未配置。文案保留概念中的主标题、空状态和操作名称；将概念图误写的 LOL 修正为 LQL。Windows 系统标题栏、系统字体、Ionicons 和 Naive UI 原生细节是有意采用的差异；未宣称与生成图像逐像素一致。

## 维护与交付限制

生产依赖审计为 0 漏洞；完整审计仍有 6 项 moderate，来自 electron-builder 的 minimatch 传递链（GHSA-g3hv-75wg-m249），只涉及开发/构建依赖。未使用强制降级/跨主版本修复。构建工具只处理本仓库受控路径；打包工具升级后需复验。

首版保留每次启动的 natives 目录直到实例删除；没有后台清理服务。上游原生库解压器未显式关闭归档句柄，共享 jar 可能保持打开至启动器退出；当前不提供共享库删除或迁移，应在后续依赖更新时检查。项目自身许可证待用户选择；不影响本地开发和本次审查，但不能据此声称已确定公开发布许可。

没有自动创建分支、提交、推送或发布。仓库初始 main 尚无提交，执行账本保留在 `.superpowers/sdd/2026-11-13-lql-v0.1-implementation/progress.md`，未因技能的提交脚本而建立虚假 Git 历史。

## 2026-11-13 首次检查记录

最终复验时间：2026-11-13 20:35–20:46 +08:00。命令与结果：

- `npm test -- tests/ipc/commands.test.ts`：3/3 通过；Java 路径白名单回归转绿。
- `npm test`：32 通过 / 2 跳过；两项显式真实下载/原生库测试默认跳过，另有已单独完成的在线验收。
- `npm run typecheck`：退出 0；安装版 E2E 补充后再次退出 0。
- `npm audit --omit=dev --json`：退出 0，生产依赖 0 漏洞。完整 `npm audit --json` 为 6 项 moderate（开发依赖）。
- `npm run dist:win`：退出 0，耗时 51 秒；重新生成许可清单并构建 NSIS。日志 `%TEMP%\lql-dist-final.log`。
- 最终安装包：`release/Luquora Launcher Setup 0.1.0.exe`，134,498,335 字节，构建时间 20:37:04，SHA-256 `38EFA5F5E535C987DCA19859A099C2CB625C3705CA0FB1633687FFBBE634C1F7`。未配置代码签名证书。
- 静默安装：`/S /D=C:\Users\Jack\AppData\Local\Programs\LuquoraLauncher-Acceptance` 退出 0，耗时 9.5 秒；安装版 `Luquora Launcher.exe` 250,091,008 字节，SHA-256 `954BEF44AF64ADF167075D0F6537A4F829B2D74010675F1886662C27F0CE2D75`。卸载配置保留用户数据。
- 最终 `npm run test:e2e`：6/6 通过，耗时 42.1 秒；含安装版三基线校验、Windows `safeStorage`、安装包内 `@xmcl/core` 原生库解压/参数生成、便携版启动、真实 UI 工作流、缩放检查和依赖导入。日志 `%TEMP%\lql-all-e2e-final.log`。
- 视觉证据：`test-results/launcher-empty.png`、`settings.png`、`launcher-installed.png`、`launcher-instances.png`、`launcher-accounts.png` 及三张 `launcher-zoom-*.png` 已最终生成并逐图检查。
- 追加单文件便携版：`npm run dist:portable` 退出 0，耗时 154.8 秒；`release/Luquora Launcher Portable 0.1.0.exe` 118,226,603 字节，SHA-256 `E25200D4E93D2A5F347DDE9888BD93A5994D3F3DF22BBF6D8341AA9CF04804A7`。构建前后 NSIS 安装包哈希均为 `38EFA5F5E535C987DCA19859A099C2CB625C3705CA0FB1633687FFBBE634C1F7`。
- 便携版专属 E2E：显式 CDP 连接真实窗口，验证空状态、`window.lql` 桥接、渲染器隔离和实例创建，1/1 通过；日志 `%TEMP%\lql-portable-e2e5.log`。NSIS 启动外壳会吞掉 `electron.launch` 所需的调试输出，所以不把该方式的超时当作应用启动失败。便携版数据仍默认写 `%APPDATA%\LuquoraLauncher`，不表示随身存档。

E2E 调试裁定：首次完整运行两处 `page.screenshot` 在 `LQL_HIDDEN=1` 下超时；最小对照显示隐藏窗口 8 秒超时、可见窗口约 305ms 完成，`fullPage` 也不能绕过。根因是 Electron/Chromium 不为隐藏窗口产生普通截屏，不是 UI 组件或动画故障。需要视觉证据的两个测试改为可见窗口并重新 5/5 通过；无截图需求的测试继续隐藏运行。没有把首次失败的业务断言包装为通过。

以上为首次构建的历史记录。当时真实 Microsoft 授权和游戏主菜单尚未验收；本地角色的后续结果与最新文件如下。

## 2026-11-14 本地角色补充验收

用户已确认增加无需微软登录的本地角色，取代原设计的 Microsoft-only 范围。昵称为 3–16 位英文字母、数字或下划线，使用 `OfflinePlayer:<name>` 的 UTF-8 MD5 / UUID v3 规则生成身份。`local:` ID 与微软账号分开，原子配置持久化；旧配置迁移为空角色列表，损坏数据仍保留并报错。微软账号认证失败不会自动降级。

- 测试先红后绿：存储/启动测试最初 5 失败 / 5 通过，实现后 10/10 通过。新增真正 XMCL 参数契约，确认令牌 `0` 和 `legacy` 类型原样传递。
- 最终 `npm test`：39 通过 / 2 默认跳过，日志 `%TEMP%\lql-local-tests.log`；`npm run typecheck` 退出 0，日志 `%TEMP%\lql-local-types.log`。
- 最终 `npm run test:e2e`：7/7 通过，44.6 秒，日志 `%TEMP%\lql-local-all-e2e.log`。含安装版官方基线复验、Windows 加密、原生库解压、无微软配置下的角色表单/完整重启/切换/移除、便携版角色创建、原有工作流和隔离。
- `npm audit --omit=dev --json`：0 漏洞，日志 `%TEMP%\lql-local-audit.json`；开发依赖限制沿用前述记录。
- `npm run dist:win` 与 `npm run dist:portable` 均退出 0；最终 NSIS 静默安装到隔离目标，退出 0。日志 `%TEMP%\lql-local-dist-win.log` 与 `%TEMP%\lql-local-dist-portable.log`。
- 安装版与便携构建的 `resources/app.asar` SHA-256 均为 `D4A995F21D92533167AA569C6B7018341F9B97B7ADE7DE18166CA7B8A9646DEC`，确保验证的安装程序包含相同功能代码。
- 已检查最新实际截图 `test-results/launcher-local-profiles.png` 与 `launcher-accounts.png`，保留银灰/石墨色、Naive UI 组件；创建表单、列表及空状态均使用真实 preload。

最新交付文件（均为 Windows x64，未签名）：

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| `release/Luquora Launcher Setup 0.1.0.exe` | 134,501,153 | `FA68846E43EA409B0DCDC8363C6F4511BE4645ED52E6CC03A9F9AAC346B500FF` |
| `release/Luquora Launcher Portable 0.1.0.exe` | 118,227,654 | `A69A818A442F267C908B87B13682BBE648960C2B08762604C88B98CA695EE0BF` |

真实本地游戏验收使用隔离目录 `.superpowers/acceptance-中文 path` 和其受管 Java，没有借用 `C:\Develop\JDK`。角色 `LQL_LocalTest` 的 UUID 为 `953b17ae2d82303c8c58bdcae14537b1`，未配置微软 client ID。使用 Windows Computer Use 实际观察窗口并点击 Quit Game，记录如下：

| 构建 | 版本 | 观察与退出 | 会话日志 ID |
| --- | --- | --- | --- |
| 开发构建 | 1.20.1 | 主菜单可见，退出码 0 | `6dc4ef1e-f23a-4b46-8b66-243c7bd4b1e6` |
| 最终安装版 | 1.16.5 | 主菜单可见，退出码 0 | `72e24333-2f02-40e8-a7b7-c773849f0ec9` |
| 最终安装版 | 1.20.1 | 主菜单可见，退出码 0 | `06596465-aacd-4ff0-9db8-83a5d942c05c` |
| 最终安装版 | 26.3 | 主菜单可见，退出码 0 | `1d62358f-cb03-46ef-9e2b-49f6bdc32a47` |

机器可读结果在该目录的 `local-game-results.json`，均为正常退出，`userStopped=false`。测试角色已移除，用户原有数据未参与本次验收。菜单验收不代表存档创建、长时间游玩或多人连接已验收。本地角色适用于单人游戏和允许离线身份的服务器；启动器仍会联网校验官方版本列表，因此不保证断网启动。微软登录的外部条件与独立审阅限制仍沿用前述说明。

## 2026-11-14 微软设备代码交互补充

用户选择保留 OAuth 2.0 设备代码登录，并要求自动复制、自动打开网页和明确提醒。当前构建已包含 LQL 自有公共 client ID；此前“缺少 client ID”的记录是历史状态，不表示已经验证 Minecraft 服务准入。

收到微软允许域名的 HTTPS 验证地址后，主进程等待 Windows 异步剪贴板写入完成，再调用系统浏览器打开该地址。Naive UI 弹窗显示“代码已自动复制，请在微软网页中按 Ctrl + V 粘贴”。复制或打开失败分别显示对应提示，保留代码、网址和重试按钮。重试仅使用当前主进程保存的代码和地址，拒绝过期、取消的请求；取消后不会因迟到的剪贴板或浏览器结果重新显示弹窗，等待加密缓存保存期间也不再触发浏览器。

测试边界：自动化界面测试替换 MSAL 设备代码响应及系统浏览器打开结果，使用明确的合成代码 `LQL-TEST`；Windows 剪贴板、主进程、preload 和 Naive UI 弹窗实际运行。该测试不代表真实账号已授权，也不代表已进入正版游戏或完成 Xbox/XSTS/Minecraft 全链路验收。实际密码与多因素验证仍由用户在微软网页完成。本轮没有启用本机 OAuth 回调监听。

- `npm test`：45 通过 / 2 默认跳过，日志 `%TEMP%\lql-ms-auto-tests.log`；`npm run typecheck` 退出 0，日志 `%TEMP%\lql-ms-auto-types.log`。新增交互、异步剪贴板和缓存保存期间取消的回归均先观察失败，再实现通过。
- 开发构建的登录提示、本地角色和设置工作流 E2E 3/3 通过；最终安装版重新静默安装退出 0，安装版专项 E2E 5/5 通过，33.5 秒，日志 `%TEMP%\lql-ms-auto-installed.log`。覆盖真实剪贴板、复制和打开失败提示、取消、本地角色重启、设置、官方缓存及原生库复验、Windows 加密和沙箱。已检查实际登录弹窗截图。
- 最终便携 EXE 启动/桥接/本地角色 E2E 1/1 通过，9.5 秒，日志 `%TEMP%\lql-ms-auto-portable.log`。
- 两个最终构建命令均退出 0。安装版与便携构建的 `resources/app.asar` SHA-256 相同，均为 `4C33AD6A888401403FEE4E9AE765B308FF75005721AC504DB49620E83AE0C0B5`。无分支、提交、推送或发布；EXE 仍未签名。独立审阅与真实微软完整授权的限制保留。

以下文件取代前述本地角色阶段的交付文件：

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| `release/Luquora Launcher Setup 0.1.0.exe` | 134,501,498 | `D9A9D880E2B0B91A82211B9647E9430DF8B70A6F858A9063ECD6538E09209577` |
| `release/Luquora Launcher Portable 0.1.0.exe` | 118,227,012 | `5E69E0C3B0D44DBFB82435A91DE511486A962E57D6826FF994D9BC37F071563A` |

## 2026-11-14 微软登录网络诊断补充

用户的微软页面显示“大功告成”，但 LQL 未生成微软账号记录。该页面是微软账号远程登录完成页，不证明 LQL 已取得 OAuth 令牌、完成 Xbox/XSTS/Minecraft/权益/角色链路并加密保存。旧实现把所有非 `LauncherError` 的登录异常统一显示为“授权未完成或已过期”，掩盖了实际失败阶段。

独立诊断中，真实设备代码轮询约 18.9 秒后返回 `network_error: Network request failed: fetch failed`；同一环境下 Electron `net.fetch` 访问 Microsoft 端点返回 200。MSAL 默认 Node `fetch` 使用 Node HTTP/TLS 栈，LQL 主进程现改用 Electron `net.fetch` 访问 `login.microsoftonline.com`，使用 Chromium 网络栈及系统网络设置。

- 真实 MSAL 设备代码探针成功取得设备码，使用 `net.fetch` 轮询 7 秒后被明确取消，返回 `device_code_polling_cancelled`，未再出现 `fetch failed`。没有记录或显示令牌，也未代替用户完成微软登录。
- Electron `net.fetch` 分别访问 Xbox 用户认证、XSTS、Minecraft 登录、权益和角色端点，均在 233–780 毫秒内收到 400/401 的预期拒绝，证明五个真实服务端点可达；伪造凭据不会获得账号或游戏权益。
- 新增 `Microsoft authorization uses the Electron network stack` 回归；所有登录异常输出安全的 `auth:microsoft`、`auth:xbox`、`auth:xsts`、`auth:minecraft` 或 `auth:entitlement` 阶段，危险响应正文、令牌和验证码不进入界面。
- 授权弹窗明确提示：网页显示“大功告成”只代表微软账号登录成功，仍需回到 LQL 等待 Xbox 与 Minecraft 检查完成。真实登录 UI 测试覆盖此提示；复制和浏览器操作为合成结果，Windows 剪贴板与真实界面实际运行。
- 本轮 `npm test`：51 通过 / 2 默认跳过；`npm run typecheck` 退出 0。最终安装版 E2E 8/8 通过，43.0 秒，仅因未指定便携路径跳过便携用例；随后针对新便携包的专项 E2E 1/1 通过，9.6 秒。已检查实例页、账号页和登录授权弹窗截图。
- `npm run dist:win` 首次打包下载 Electron 时出现 TLS 断连，随后显式使用本地完整 Electron 45.3.1 发行目录完成 NSIS 与便携版本地打包。便携版另输出到隔离目录，因为用户当时运行的旧便携实例占用了正式输出文件；未结束该用户进程。安装版和便携构建的 `resources/app.asar` 均为 `464C1BD8CF52881D01E7D097E9EFA8E39C33FF5D5D7DD803B36D225E54F10CA9`。NSIS 静默覆盖隔离安装目录退出 0。
- 本轮 `npm audit --omit=dev` 未能重新取得结果：npm 审计端点在直连和系统代理下均发生 TLS 握手断连。此前生产审计 0 漏洞的结果不代表本轮复验通过；依赖未在本轮变更。

真实微软账号授权、令牌获取后的 Xbox/Minecraft/权益/角色链路、重启静默刷新及正版服务器登录仍待用户在微软页面亲自登录后验收。禁止在报告中提交真实设备代码、令牌、密码或 `auth.bin`。

本轮交付文件（取代前述设备代码交互补充的交付文件）：

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| `release/Luquora Launcher Setup 0.1.0.exe` | 134,585,352 | `C8454C17BEFF4D8531513ED6330506126E64C738B0BA68FE56DE20104FA93F7C` |
| `.superpowers/acceptance-auth/release/Luquora Launcher Portable 0.1.0.exe` | 118,328,191 | `BF8316E060BDEE079BC3DA7DE4C48581F016EF89DF8DCA2AF827F8B9D30B520A` |

正式 `release/Luquora Launcher Portable 0.1.0.exe` 在构建时被正在运行的旧便携实例锁定，仍是 12:55:55 的旧版本，不得与上述安装版配对交付。关闭该便携实例后可重新执行便携打包以替换正式文件。两份 EXE 均未签名。

## 2026-11-14 Minecraft 403 应用准入调研

用户完成微软网页授权后，LQL 停在 `auth:minecraft` 并收到真实 HTTP 403。此时 MSAL 登录、Xbox 用户认证和 Minecraft XSTS 已经成功，失败发生在 `POST https://api.minecraftservices.com/authentication/login_with_xbox`。微软“大功告成”页面不证明应用已取得 Minecraft 服务准入。

- Mojang 的 [Java Edition Game Service API 审核说明](https://help.minecraft.net/hc/en-us/articles/16254801392141) 说明：新的第三方应用访问 Java 版游戏服务 API 必须通过 [审核表](https://aka.ms/mce-reviewappid) 申请，由 Mojang 人工加入 allow list；已有获批应用可继续使用。`aka.ms/AppRegInfo` 重定向到该说明。
- 对照 [Prism Launcher](https://github.com/PrismLauncher/PrismLauncher) `00f216ce`：`AuthFlow` 的 XSTS 步骤之后调用 `POST /launcher/login`，请求体为 `xtoken` 加 `platform: PC_LAUNCHER`，其 XSTS 请求不带 DeviceToken，并用项目自己的公开 MSA client ID。
- 对照 [HMCL](https://github.com/HMCL-dev/HMCL) `5054d6d`：仍调用 `POST /authentication/login_with_xbox`，请求体为 `identityToken`，其 XSTS 请求也不带 DeviceToken。接口选择或 DeviceToken 均不是本次 403 的已知充分修复。
- 对照 [@xmcl/user](https://github.com/Voxelum/minecraft-launcher-core-node)：完整 `acquireXBoxToken()` 会附加 Xbox DeviceToken；LQL 当前使用的低层方法与 HMCL 形态相近，但未传 DeviceToken。未把这条差异直接认定为根因。
- 微软 Q&A 中 [另一位新第三方启动器作者](https://learn.microsoft.com/en-us/answers/questions/6065074/minecraft-services-returns-403-invalid-app-registr) 记录了微软账号、Xbox 和 XSTS 成功，但 Minecraft 端点返回 403 `Invalid app registration`，即使其 Xbox Developer Program 与 Partner Center 注册已完成，仍在询问 Minecraft Services 的具体准入步骤。
- LQL 的传输对照探针使用伪凭据，分别以 Node `fetch` 和 Electron `net.fetch` 请求 Xbox 用户、XSTS、旧 `login_with_xbox` 与 `/launcher/login`：状态依次均为 401、400、401、401。没有发起真实账号请求、没有记录真实令牌，也不能证明真实请求的响应正文。结论是本机两条网络栈在该组端点上未显示差异，不能把 403 归为 Electron 网络栈故障。

据此，403 属于 **LQL 自有 Microsoft 应用尚未取得 Minecraft Java 版服务 API 准入** 的待审核问题。未借用 Prism/HMCL/官方启动器标识，未加离线绕过，也未切换到其他登录接口。审核表需要应用所有者提交，涉及外部申请；本轮未提交、未写入 Entra/Partner Center。

本地已修复该错误的提示：`auth:minecraft` 的 HTTP 401/403 不再建议“稍后重试”，而是明确说明账号登录成功、应用被 Minecraft 服务拒绝并指向服务 API 准入；页面错误条与登录弹窗都显示安全的阶段标签。失败弹窗保留可读原因直到用户关闭或重新授权，不显示响应正文。新回归先观察到旧行为 RED，再通过；`npm test` 53 通过 / 2 跳过，`npm run typecheck` 退出 0，开发与独立安装版 UI E2E 均通过，安装版 E2E 1/1、安装版工作流 1/1、诊断 E2E 1/1。已检查实际诊断截图。

本轮 NSIS 用本地 Electron 发行目录构建，安装到隔离目录 `C:\Users\Jack\AppData\Local\Programs\LuquoraLauncher-Study`，安装退出 0；安装前的备份位置记录在本轮命令输出中。**新增安装文件** `release/Luquora Launcher Setup 0.1.0.exe`：134,585,553 字节，SHA-256 `82AC4A799CA69BBCB9A4F65D50A258507B62976611A95FFDEF07E213167F3FF0`。正式便携包仍被用户正在运行的旧实例占用，未结束该进程；此前的便携包不包含本轮错误提示修复。仍需应用所有者提交审核，然后以真实授权账号验证 Minecraft 令牌、权益、角色和正版服务器登录。既有应用注册经确认获批前，不宣称正版登录已完成。
