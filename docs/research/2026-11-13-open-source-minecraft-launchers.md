# Minecraft Java 版启动器功能调研

调研日期：2026-11-13。服务项目：Luquora Launcher（LQL），目前已确定面向 Windows、Minecraft Java 版。

## 范围与证据边界

- 样本为 HMCL、PCL（另核对 PCL CE 的定位与许可）、Prism Launcher、XMCL、ATLauncher、Modrinth App；不是 GitHub 启动器的穷尽名单。
- 依据为项目自己的 GitHub README、许可证、源码及官方文档。未安装运行这些启动器，也未测量速度、内存、启动成功率或 UI 易用性。
- GitHub 默认分支可能包含尚未发布的修改；下文“源码确认”只说明对应代码存在，不保证任意发行版均提供该功能。
- 部分官方网页通过抓取服务读取，可能有近期缓存。文档没有列出某功能，不代表启动器没有该功能。
- PCL 使用自定义有限许可，需单列为“公开源码参考项目”，不能因为源码放在 GitHub 就按 MIT、Apache 或 GPL 的方式理解其复用权限。
- 下文建议是供讨论的候选范围，不代表用户已批准 LQL 的功能、架构或技术栈。

## 1. 代表项目概览

| 项目与 GitHub | 已核实的功能重点 | 技术实现参考 | 许可要点 |
| --- | --- | --- | --- |
| [HMCL](https://github.com/HMCL-dev/HMCL) | 多实例/版本隔离；多种加载器自动安装；CurseForge、Modrinth 模组搜索安装；前置提示；Java 管理；错误报告与日志导出；下载源、代理和外观设置 | Java、JavaFX [H1][H2][H3][H4][H5] | GPLv3，附名称/版本区分及版权声明保留条款 [H1] |
| [PCL](https://github.com/Meloong-Git/PCL) | 正式版/预览版等分类；Forge、NeoForge、Fabric、OptiFine 安装选项；Java 选择与缺失时下载；微软及其他认证分支；整合包下载界面；崩溃日志收集；官方/BMCLAPI 下载源 [P1]—[P8] | VB.NET、C#、WPF；不能与 PCL CE 当前运行时要求混为一谈 [P9][P10] | 自定义《PCL 分发有限许可》及合理使用指南，不是通用宽松许可 [P11] |
| [Prism Launcher](https://github.com/PrismLauncher/PrismLauncher) | 多实例、多个账号；独立模组和配置；整合包安装更新；Modrinth/CurseForge 模组安装更新；主题和菜单自定义；Java 检测及全局/实例配置 [R1][R2] | C++、Qt [R1][R4] | 启动器代码 GPL-3.0-only；图标等资产另有许可 [R3] |
| [XMCL](https://github.com/Voxelum/x-minecraft-launcher) | 多实例；游戏/加载器/JVM 下载；并发分块下载；第三方镜像；双平台资源下载；整合包导入导出；多个认证系统；资源链接复用；P2P 联机 [X1] | Electron、Vue、TypeScript，并提供模块化启动器核心库 [X1][X2] | README 声明 MIT；具体依赖仍需分别核对 [X1] |
| [ATLauncher](https://github.com/ATLauncher/ATLauncher) | 多来源整合包；多实例、多账号；自动使用合适 Java；模组/地图/资源包管理；存档一键备份；部分整合包的服务器创建和运行 [A1] | Java/Kotlin 桌面应用 [A2] | GPLv3；项目明确区分代码许可与其 CDN、文件、资源、整合包的使用 [A2] |
| [Modrinth App](https://github.com/modrinth/code/tree/main/apps/app) | Modrinth 内容发现；模组安装、卸载、更新；整合包分享；已有实例导入；跨实例设置同步；皮肤选择 [M1] | Tauri、Rust、Vue [M2][M3] | App 代码 GPL-3.0-only；品牌标识另有限制，不可用整个 monorepo 的单一许可概括 [M4] |

### PCL 和 PCL CE 的区别

[PCL CE](https://github.com/PCL-Community/PCL-CE) 的 README 明确说它是基于 PCL 公开代码二次开发的社区版本，包含主线暂未制作的功能和改进，版本号不与主线严格对应。因此不能把社区版截图或功能直接当作 PCL 主线能力。[P10]

本次读取的 PCL CE 默认 `dev` 分支 README 列出 Windows 为实际运行平台，macOS/Linux 只提供交叉编译开发支持。其 `Plain Craft Launcher 2/` 使用自定义许可，其他目录为 Apache-2.0；不能说“整个 PCL CE 都是 Apache-2.0”。[P10][P12]

## 2. 功能可以归成哪些模块

下表给出有直接证据的代表项目；不作为所有样本逐项全支持的勾选矩阵。

| 模块 | 对玩家的实际价值 | 已核实的代表证据 |
| --- | --- | --- |
| 游戏版本安装 | 查找版本、安装依赖，再启动游戏；可以提供正式版、快照/预览版等分类 | PCL 版本分类及下载源码；HMCL 空实例时安装最新正式版 [P1][P4][H2] |
| 账号管理 | 选择玩家身份、切换账号；认证方式需单独确认 | Prism 多账号；XMCL 微软和第三方认证；PCL 登录分支 [R1][X1][P3] |
| 多实例与隔离 | 原版生存、Fabric 优化、Forge 整合包各有自己的模组、存档和配置 | HMCL、Prism、XMCL、ATLauncher [H2][H3][R1][X1][A1] |
| Java 管理 | 减少玩家手动寻找与游戏相容的 Java 的工作 | PCL 自动选择/缺失下载代码；XMCL JVM 下载；ATLauncher 自动选择合适 Java [P2][X1][A1] |
| 模组加载器 | 为不同游戏版本安装对应加载器，避免要求玩家手工操作安装器 | HMCL 列出 Forge、NeoForge、Fabric、Quilt 等；PCL 页面列出 Forge、NeoForge、Fabric；XMCL 列出 Forge、Fabric、Quilt 等 [H1][H3][P5][X1] |
| 模组管理 | 搜索、筛选、安装、更新、移除或禁用模组，查看前置要求 | HMCL 双平台搜索/前置提示/禁用排错；Prism 双平台安装更新；Modrinth 安装卸载更新 [H3][R1][M1] |
| 整合包管理 | 把一组游戏版本、加载器、模组和配置作为整体安装、分享或更新 | Prism 安装更新；XMCL CurseForge/Modrinth 导入导出；ATLauncher 多来源安装 [R1][X1][A1] |
| 资源包、光影与地图 | 把其他游戏内容纳入实例管理，减少手动找目录 | HMCL 下载导航明确列出这些类别；ATLauncher 列出地图和资源包下载 [H2][A1] |
| 下载与网络设置 | 面向不同网络环境提供并发、镜像、代理等选项 | HMCL 设置文档；PCL 官方/BMCLAPI 选择；XMCL 并发分块与镜像 [H4][P4][X1] |
| 启动设置 | 设置 Java、内存及实例独立参数，保留全局默认值 | HMCL 设置项；Prism Java 全局/实例配置 [H4][R2] |
| 日志与故障处理 | 让玩家在启动失败后获得可供排查的信息 | HMCL 常见错误提示和日志压缩包导出；PCL 崩溃日志收集代码 [H3][P6] |
| 备份与迁移 | 保护存档、迁入已有游戏环境 | ATLauncher 存档一键备份；Modrinth 其他启动器实例导入 [A1][M1] |
| 个性化 | 外观主题、菜单自定义、实例图标等体验功能 | HMCL 外观设置；Prism 主题和菜单自定义；Modrinth 官网列出实例分组/图标改进 [H2][R1][M1] |
| 联机与服务器辅助 | 降低联机、开服或进入服务器的操作成本 | XMCL P2P 联机；ATLauncher 部分整合包创建/运行服务器；HMCL 文档存在多人联机入口 [X1][A1][H2] |
| 跨实例同步与节省空间 | 在多个实例间同步选定内容，或复用相同资源文件 | Modrinth 设置同步；XMCL 硬链接/符号链接资源复用 [M1][X1] |

### 需要区分的功能边界

1. **离线游玩与离线账号不同。** 已有正版账号缓存后断网启动、创建自定义名称离线身份、第三方验证服务器登录，是不同能力，不能合并成一个“支持离线”的勾。本次未逐一核实所有样本的离线策略。PCL 的源码还明确存在购买/试玩等前置分支，不能只看 `Legacy` 登录分支就认为没有条件。[P3]
2. **安装加载器与安装模组不同。** Fabric Loader、Fabric API、具体模组分别承担不同职责；OptiFine 也不应简单等同于 Forge/Fabric 类型的通用模组加载器。HMCL 文档分别说明加载器、API 前置和光影安装。[H3]
3. **整合包能力不能只写“支持”。** 导入本地文件、在线搜索下载、导出分享、更新已安装整合包是四个不同范围；各项目有不同覆盖。[R1][X1][A1]
4. **日志展示与自动诊断不同。** 收集日志、导出日志、匹配常见错误规则，工作量不同；本次未验证任何项目能可靠诊断所有模组冲突。[H3][P6]
5. **资源去重与配置同步不同。** 链接复用解决磁盘副本，设置同步解决实例间配置一致性，不能把两者当作同一种机制。[X1][M1]

## 3. 对 LQL 的候选建议

这是基于样本功能的产品建议，尚待讨论确认。

### 第一阶段：能够可靠安装和启动

- 微软账号添加、选择和重新登录；明确独立的离线行为策略。
- 原版正式版安装与启动，提供可见的下载进度、失败重试和依赖完整性检查。
- 从开始就使用实例隔离，每个实例有独立游戏目录及设置。
- Java 检测、兼容版本选择和缺失时的安装引导或自动下载。
- 内存、分辨率、Java 路径等基本设置。
- 启动过程日志、退出状态和日志导出。
- Windows 下的目录选择、中文/空格路径和进程启动需要实际验收。

建议以“全新环境完成账号添加 → 安装一个约定版本 → 正确选择 Java → 启动进入游戏 → 退出后可查看日志”作为基础验收，再验证两个实例的模组与存档不会互相混用。

### 第二阶段：满足常见模组玩法

- Fabric、Forge、NeoForge 安装，按实际目标游戏版本逐项验证。
- Modrinth 搜索、下载和版本/加载器筛选，前置依赖提示。
- 本地模组添加、启用/禁用、删除与更新提示。
- `.mrpack` 整合包导入；CurseForge 的搜索、整合包和 API 接入另定范围。
- 资源包、光影文件管理和实例复制。

### 第三阶段：选择差异化方向

- 面向新玩家：更清楚的错误提示、Java/网络修复引导，参考 HMCL/PCL。
- 面向整合包玩家：更新保护、备份恢复、多个整合包环境管理，参考 Prism/ATLauncher。
- 面向内容发现：模组浏览、版本兼容筛选、实例导入，参考 Modrinth。
- 面向朋友联机：联机与共享整合包体验，参考 XMCL；需要单独评估服务和网络维护成本。
- 跨实例同步、资源去重、复杂主题系统可按定位选择，不必全部成为首版目标。

我的建议是优先把“安装省心、实例清楚、失败可排查”做好，再选择模组/整合包或联机作为重点。当前信息不足以确定 LQL 的最终差异化定位。

## 4. 功能参考与代码复用分别决策

- 调研可用于理解功能和玩家操作流程；本次没有复制任何启动器实现代码。
- 如果以后决定复用 GPL 项目实现，需要按对应代码许可处理衍生作品的分发、源码提供等义务；图标、商标、资源和服务不自动随代码许可一并授权。[H1][R3][A2][M4]
- PCL 上游 README 说明仅公开“大部分”源码，按发布同步；其自定义使用指南对较大量参考或二次开发提出名称、署名、源码等要求。以独立品牌 LQL 为目标时，不应未经进一步核对就把它当作直接改名的底座。[P7][P11]
- PCL CE 的 Apache-2.0 不覆盖全部目录。[P10][P12]
- XMCL 的模块化 `@xmcl/*` 核心库值得在技术选型时进一步评估，但本次未验证接口、版本、Windows 兼容性和传递依赖许可，因此不将其定为 LQL 依赖。[X1]
- Microsoft 登录和 CurseForge 集成也涉及应用标识/API 密钥。Prism 和 ATLauncher 均要求派生项目替换相应配置，代码能阅读不代表上游凭据可直接沿用。[R3][A2]

## 5. 官方来源索引

### HMCL

- [H1：项目介绍、加载器名单、GPL 附加条款](https://github.com/HMCL-dev/HMCL/blob/main/docs/README.md)
- [H2：界面功能与 Java 管理入口](https://docs.hmcl.net/launcher/gui-features.html)
- [H3：自动安装、模组平台、前置提示、错误报告、日志导出](https://docs.hmcl.net/launcher/auto-installing.html)
- [H4：Java、内存、下载源、并发和代理设置](https://docs.hmcl.net/launcher/set-item-details.html)
- [H5：微软账号界面源码，含 JavaFX imports](https://github.com/HMCL-dev/HMCL/blob/main/HMCL/src/main/java/org/jackhuang/hmcl/ui/account/MicrosoftAccountLoginPane.java)

### PCL / PCL CE

- [P1：安装界面逻辑，含正式版、预览版等分类](https://github.com/Meloong-Git/PCL/blob/main/Plain%20Craft%20Launcher%202/Pages/PageDownload/PageDownloadInstall.xaml.vb)
- [P2：Java 兼容选择及下载流程](https://github.com/Meloong-Git/PCL/blob/main/Plain%20Craft%20Launcher%202/Modules/Minecraft/ModJava.vb)
- [P3：启动、认证类型及购买/试玩检查分支](https://github.com/Meloong-Git/PCL/blob/main/Plain%20Craft%20Launcher%202/Modules/Minecraft/ModLaunch.vb)
- [P4：游戏下载与官方/BMCLAPI 来源](https://github.com/Meloong-Git/PCL/blob/main/Plain%20Craft%20Launcher%202/Modules/Minecraft/ModDownload.vb)
- [P5：Forge、NeoForge、Fabric、OptiFine 安装界面](https://github.com/Meloong-Git/PCL/blob/main/Plain%20Craft%20Launcher%202/Pages/PageDownload/PageDownloadInstall.xaml)
- [P6：崩溃日志收集源码](https://github.com/Meloong-Git/PCL/blob/main/Plain%20Craft%20Launcher%202/Modules/Minecraft/ModCrash.vb)
- [P7：上游 README，说明源码覆盖及同步方式](https://github.com/Meloong-Git/PCL/blob/main/README.md)
- [P8：整合包下载分类界面](https://github.com/Meloong-Git/PCL/blob/main/Plain%20Craft%20Launcher%202/Pages/PageDownload/Resource/PageDownloadPack.xaml)
- [P9：VB 工程、.NET Framework 目标及 C#/WPF 项目引用](https://github.com/Meloong-Git/PCL/blob/main/Plain%20Craft%20Launcher%202/Plain%20Craft%20Launcher%202.vbproj)
- [P10：社区版定位、平台及分目录许可](https://github.com/PCL-Community/PCL-CE/blob/dev/README.md)
- [P11：上游自定义许可与合理使用指南](https://github.com/Meloong-Git/PCL/blob/main/LICENCE)
- [P12：社区版原 PCL 目录的自定义许可](https://github.com/PCL-Community/PCL-CE/blob/dev/Plain%20Craft%20Launcher%202/LICENCE)

### Prism Launcher

- [R1：官网功能说明](https://prismlauncher.org/)
- [R2：Java 检测、全局及实例配置](https://prismlauncher.org/wiki/getting-started/installing-java/)
- [R3：README，含许可及分发配置说明](https://github.com/PrismLauncher/PrismLauncher/blob/develop/README.md)
- [R4：C++ 构建配置](https://github.com/PrismLauncher/PrismLauncher/blob/develop/CMakeLists.txt)

### XMCL

- [X1：功能、核心库与 MIT 声明](https://github.com/Voxelum/x-minecraft-launcher/blob/master/README.md)
- [X2：Vue/TypeScript UI 工程依赖](https://github.com/Voxelum/x-minecraft-launcher/blob/master/xmcl-keystone-ui/package.json)

### ATLauncher

- [A1：官网功能列表](https://atlauncher.com/about)
- [A2：README、Java/Kotlin 开发、GPL 及服务/凭据说明](https://github.com/ATLauncher/ATLauncher/blob/master/README.md)

### Modrinth App

- [M1：官网功能列表](https://modrinth.com/app)
- [M2：App README，Tauri 与 Vue](https://github.com/modrinth/code/blob/main/apps/app/README.md)
- [M3：Rust/Tauri 工程及 GPL-3.0-only 声明](https://github.com/modrinth/code/blob/main/apps/app/Cargo.toml)
- [M4：App 复制与品牌许可说明](https://github.com/modrinth/code/blob/main/apps/app/COPYING.md)
