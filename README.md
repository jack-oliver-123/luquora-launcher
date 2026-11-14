# Luquora Launcher · LQL

面向 Windows x64 的 Minecraft Java 版启动器。首版专注原版正式版本，使用 Electron、Vue 3、TypeScript、Naive UI 和 XMCL 核心库。

界面采用银灰与石墨配色，使用 Naive UI 的按钮、表单、选择器、对话框、开关和进度组件，图标使用 MIT 许可的 Ionicons。参考 Apple 的留白与层级，不附带 Apple 字体或品牌资源。

## 当前能力

- 创建、改名、选择实例；独立存档、配置和截图目录；删除移入 Windows 回收站。
- 从官方获取正式版本；下载游戏、依赖和资源；校验 SHA-1；取消后复用已完整校验文件。
- 检测兼容的本地 Java；缺少时下载 Mojang 运行时；支持 Java 8、17、25 等元数据声明的版本。
- 微软设备代码登录：自动复制代码并打开授权网页，明确显示复制结果；包含 Xbox/Minecraft 权限和角色检查、Windows 加密会话缓存的本地实现。
- 本地角色：填写昵称即可启动单人游戏，无需微软登录；固定离线 UUID，支持重启保留、角色切换与移除。
- 全局与实例启动设置、受控游戏进程、脱敏日志和用户选择位置的日志导出。

**当前是可审查的 0.1.0 候选构建。安装版本地角色已实际进入 1.16.5、1.20.1、26.3 主菜单并正常退出；构建已配置 LQL 自有微软公共 client ID，真实微软登录与授权刷新仍未验收。**

## 开发运行

需要 Windows x64、Node.js 24 和 npm。

```powershell
npm ci
npm run dev
```

默认使用 LQL 自有 Microsoft 公共应用。维护者如需改用自己注册的应用，可在同一 PowerShell 会话中运行：

```powershell
$env:LQL_MS_CLIENT_ID = '你的应用 client ID'
npm run dev
```

普通用户无需填写 client ID。在“账号”点击“微软登录”，代码会自动复制并打开微软网页，按 `Ctrl + V` 粘贴代码后完成登录。LQL 不借用其他启动器的应用标识。微软登录的注册和接入条件见 [开发文档](docs/development.md)。

## 无需登录开始游戏

1. 打开“账号” → “添加本地角色”，输入 3–16 位英文字母、数字或下划线，点击“创建角色”。
2. 返回“实例”，创建实例并安装游戏；首次下载游戏和 Java 需要联网。
3. 确认当前角色后点击“启动游戏”。

昵称按 Minecraft 离线规则决定 UUID，区分大小写；移除角色不删除存档，再次创建完全相同的昵称会获得同一 UUID。本地角色适用于单人游戏和允许离线身份的服务器；Realms、正版验证服务器与在线皮肤需要相应的微软身份。微软认证失败不会自动切换本地角色。当前启动仍会联网校验官方版本列表，不保证断网启动。

## 检查与打包

```powershell
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run dist:win
npm run dist:portable
```

安装包输出到 `release/Luquora Launcher Setup 0.1.0.exe`，免安装单文件版输出到 `release/Luquora Launcher Portable 0.1.0.exe`。前者为当前用户安装，无自动更新服务，卸载保留配置和游戏数据；后者运行时解压到临时目录，不创建安装项。两者均未配置代码签名证书。

## 数据和限制

默认配置位于 `%APPDATA%\LuquoraLauncher`，游戏数据位于其 `game-data` 子目录。可在创建首个实例前更改游戏根目录。首版不支持已有数据迁移、模组、整合包、镜像源或多游戏并发。

账号令牌保留在主进程，由 Windows `safeStorage` 加密保存；加密不可用时仅保留本次会话。日志不自动上传。导出日志仍可能含本地路径、聊天和游戏内容。

更多信息：[测试说明](docs/testing.md) · [验收记录](docs/acceptance-v0.1.md) · [开源启动器调研](docs/research/2026-11-13-open-source-minecraft-launchers.md) · [第三方许可](THIRD_PARTY_NOTICES.md)。项目自身的发布许可尚未选择。
