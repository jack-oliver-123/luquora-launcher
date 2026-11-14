# 测试说明

## 本地自动化

```powershell
npm run typecheck
npm test
npm run build
npm run test:e2e
```

单元测试覆盖持久化/损坏配置/原子替换失败、junction 与相似路径前缀、回收站失败、账号取消及迟到响应、权限和角色检查、缓存加密降级、Java 要求、摘要与重试、并行取消等待、安装互斥、进程身份/退出/停止和跨块日志脱敏/行长度。本地角色补充验证 Java 离线 UUID、旧配置迁移、昵称/重复校验、重建身份稳定，以及启动不调用微软认证、已移除身份拒绝启动。

Playwright 使用真实 Electron main/preload，检查动态官方版本列表、创建/改名、设置保存、非法业务请求、账号配置提示、空日志页、沙箱、库导入、安装包内原生库解压和截图。它没有注入浏览器假 API。Electron/Chromium 不会为 `LQL_HIDDEN=1` 的窗口产生普通页面截图，因此有截图断言的测试使用可见窗口；其余自动化仍可隐藏运行。

`tests/e2e/microsoft-login.spec.ts` 在主进程替换 MSAL 设备代码响应和系统浏览器打开结果，使用合成代码检查真实 Windows 剪贴板、Naive UI 复制提示、失败回退、重试与取消。合成响应不会生成真实微软账号或游戏会话。单元测试另行覆盖异步复制完成前不打开浏览器，以及等待加密缓存保存时取消仍阻止迟到的网页打开操作。

当前脚本检查最小 960×640 内容视口及 Electron 页面缩放 1、1.25、1.5 的可操作性和横向溢出。页面缩放不等同 Windows 系统 DPI；实际 125%/150% 系统缩放仍待人工验收。截图位于 `test-results`；Windows 字体渲染可能与概念图不同。

## 官方下载验收

该测试访问官方服务并下载三个版本与 Java，消耗数百 MiB 或更多空间，默认跳过：

```powershell
$env:LQL_LIVE_ACCEPTANCE = '1'
$env:LQL_ACCEPTANCE_ROOT = 'C:\LQL-Acceptance'
npm run test:live
```

该测试直接调用受管运行时安装，不借用开发机已安装的 JDK；再安装游戏并重新校验客户端、依赖和资源。`results.json` 记录实际运行时路径、主版本与完成时间。没有移除本机 Java，也没有模拟“干净 Windows”。

## 打包版本

```powershell
npm run dist:win
$env:LQL_INSTALLED_EXE = '实际安装目录\Luquora Launcher.exe'
npm run test:e2e -- tests/smoke/core-imports.spec.ts tests/e2e/workflows.spec.ts
```

可选的安装版基线复验使用独立验收数据：

```powershell
$env:LQL_PACKAGED_ACCEPTANCE_ROOT = '已有官方下载安装证据的数据目录'
npm run test:e2e -- tests/e2e/installed.spec.ts
```

单文件便携版启动验收（需要已生成 `release/Luquora Launcher Portable 0.1.0.exe`）：

```powershell
$env:LQL_PORTABLE_EXE = 'C:\Code\LuquoraLauncher\release\Luquora Launcher Portable 0.1.0.exe'
npm run test:e2e -- tests/e2e/portable.spec.ts
```

该测试通过真实 CDP 端口检查窗口、安全桥接和实例创建，不用模拟登录或游戏进程。测试结束会终止便携版启动外壳及其子进程，再清理临时数据目录。

`tests/e2e/local-profiles.spec.ts` 通过真实组件表单验证无微软配置时的角色创建、完整进程重启后的保留、选择和移除。真实本地游戏使用隔离验收目录中的官方游戏文件和受管 Java，单独记录游戏主菜单观察与正常退出；结果位于该目录 `local-game-results.json`。此结果不能证明微软登录或正版服务器认证。

真实微软流程仍需拥有 Java 版权限的账号，单独记录登录、重启刷新及在线身份启动。子进程边界测试与 `java -version` 不能替代真实游戏结果。

详细执行证据和未覆盖的环境故障见 [验收记录](acceptance-v0.1.md)。
