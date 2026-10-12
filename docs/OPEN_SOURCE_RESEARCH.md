# 开源调研与复用计划

调研日期：2026-10-12（北京时间）

需求更新：默认休息 3 分钟且可自定义、提前 1 分钟轻提醒、支持工作时段已纳入第一版；本次未新增外部调研，继续采用下文固定源码依据。

范围：Windows／macOS 休息提醒、后台计时与窗口、会议检测、Electron 工程基础，以及未来展示层可扩展性。

## 1. 方法与证据边界

通过中英文搜索筛选项目，读取上游官方文档，并浅克隆 13 个仓库核对指定源码、测试、许可证和依赖。没有安装或运行这些应用，没有完成跨平台实测，也没有将它们的代码导入本仓库。

下文区分：

- **可直接依赖**：成熟基础库，仍需选择兼容稳定版本。
- **选择性复用**：在核对授权后提取必要实现，保留来源和署名，并按本项目测试。
- **仅参考**：行为、测试场景或思路值得研究，当前不导入代码。
- **暂不采用**：当前需求不需要，或者授权／平台覆盖不满足直接使用条件。

固定 commit 和最后提交时间来自本次下载的默认分支快照，不等于最后正式发行版，也不证明未来会持续维护。GitHub REST API 在调研期间受到未认证频率限制，因此没有把不完整的 stars／issues 数量当选择依据。

机器可读证据索引见 [source-manifest.json](research/source-manifest.json)，包含完整 SHA、核对路径与许可证文件。下面的源码链接固定在具体版本，避免后续上游变更使结论失去依据。

## 2. 总体结论

1. **基础系统行为优先参考 Stretchly。** 它与需求接近，BSD-2-Clause 允许在遵守保留声明等条件下选择性复用，没必要从零摸索多屏和电源事件。
2. **工程基础直接复用 electron-vite／create-electron 和 electron-builder。** 不自己构建脚手架、安装器或更新协议。
3. **设置、日志直接采用成熟组件。** electron-store 适合小型配置；electron-log 负责本地日志。大规模历史和养成账本以后再选事务存储。
4. **会议检测没有已核验的“一库解决两平台腾讯＋飞书”的完整方案。** Mac 的腾讯会议已找到 MIT 源码参考及测试；飞书与 Windows 仍要做专门验证。
5. **桌宠暂不开发。** 只确认 Electron 展示扩展路线已有实践，当前不引入宠物项目依赖、素材或玩法。

### 2.1 维护状态快照

| 项目 | 本次快照最后提交日（北京时间） | 采用判断 |
| --- | --- | --- |
| Stretchly | 2026-10-09 | 近期有代码更新，优先跟踪系统边界修复 |
| BreakTimer | 2026-09-30 | 近期有更新，行为参考；授权策略不同 |
| Workrave | 2026-10-08 | 长期工程，作为模型与边界研究 |
| BreakTime | 2026-05-04 | 作为 Windows 线索，不依赖其继续维护 |
| meeting-transcriber | 2026-10-08 | 近期更新，Mac 腾讯检测优先参考；仍需本地验证 |
| side-huddle | 2026-05-07 | Mac 实现可参考，不能把其他平台 stub 当支持 |
| elitan/meetingbar | 2026-09-21 | 授权未确认，不复制 |
| electron-vite | 2026-10-11 | HEAD 为 beta；选择稳定发行版 |
| create-electron 所在 quick-start | 2026-01-06 | 脚手架仓库提交时间不代表每个子包发行时间 |
| electron-store | 2026-09-20 | 小数据依赖候选，内置迁移有明确限制 |
| electron-log | 2026-09-27 | 本地日志依赖候选 |
| active-win / get-windows | 2026-03-09 | 备选窗口探测，谨慎处理权限 |
| desktop-pet | 2026-10-11 | 仅展示层可行性参考 |

这些日期只说明本次拿到的提交；未把维护频率、issue 响应速度或长期稳定性做成未经验证的评分。

## 3. Stretchly：优先参考的基础实现

[上游仓库](https://github.com/hovancik/stretchly) · 核对版本 `52929e5369403a2e88269c12648925e83ee4c15e`

许可证：[BSD-2-Clause 原文](https://github.com/hovancik/stretchly/blob/52929e5369403a2e88269c12648925e83ee4c15e/LICENSE)。

| 核对位置 | 已看到的实现 | 本项目处理 |
| --- | --- | --- |
| [breaksPlanner.js](https://github.com/hovancik/stretchly/blob/52929e5369403a2e88269c12648925e83ee4c15e/app/breaksPlanner.js) | 调度与自然休息、免打扰、应用排除通过事件协作 | 参考事件组织；按本项目组合暂停规则构建小核心 |
| [scheduler.js](https://github.com/hovancik/stretchly/blob/52929e5369403a2e88269c12648925e83ee4c15e/app/utils/scheduler.js) | setTimeout 调度，Date.now 计算剩余时间 | 参考取消／校正生命周期；不直接沿用墙上时钟计时 |
| [displayManager.js](https://github.com/hovancik/stretchly/blob/52929e5369403a2e88269c12648925e83ee4c15e/app/utils/displayManager.js) | 屏幕选择、边界和位置计算 | 优先选择性复用，经混合缩放、热插拔验证 |
| [main.js 电源事件](https://github.com/hovancik/stretchly/blob/52929e5369403a2e88269c12648925e83ee4c15e/app/main.js#L512) | 挂起／锁屏、恢复／解锁处理 | 参考监听和修复经验；采用分别记录原因的模型 |
| [main.js 窗口处理](https://github.com/hovancik/stretchly/blob/52929e5369403a2e88269c12648925e83ee4c15e/app/main.js#L855) | Mac kiosk、跨工作空间、置顶与多屏分支 | 参考已有边界，不混用互斥策略 |
| [appExclusionsManager.js](https://github.com/hovancik/stretchly/blob/52929e5369403a2e88269c12648925e83ee4c15e/app/utils/appExclusionsManager.js#L48) | 用进程列表匹配应用运行情况 | 不能直接代替“正在开会”的识别 |
| [displayManager 测试](https://github.com/hovancik/stretchly/blob/52929e5369403a2e88269c12648925e83ee4c15e/test/displayManager.js)、[scheduler 测试](https://github.com/hovancik/stretchly/blob/52929e5369403a2e88269c12648925e83ee4c15e/test/scheduler.js) | 已有边界用例 | 作为验收场景来源，移植时核对授权 |

不建议整体 fork：需要删除大量非目标功能，且现有调度核心直接依赖监测器与日志。保留已有窗口经验、重新约束本产品规则，改动范围更容易控制。这是本项目判断，并非上游架构质量评判。

## 4. 会议识别调研

### 4.1 meeting-transcriber：Mac 腾讯会议的首选代码参考

[上游](https://github.com/pasrom/meeting-transcriber) · 核对版本 `a4f6af6df2674bc4e18097084a128af469823fab` · [MIT](https://github.com/pasrom/meeting-transcriber/blob/a4f6af6df2674bc4e18097084a128af469823fab/LICENSE)

核对了 [MicInputDetector.swift](https://github.com/pasrom/meeting-transcriber/blob/a4f6af6df2674bc4e18097084a128af469823fab/app/MeetingTranscriber/Sources/MicInputDetector.swift)、[对应测试](https://github.com/pasrom/meeting-transcriber/blob/a4f6af6df2674bc4e18097084a128af469823fab/app/MeetingTranscriber/Tests/MicInputDetectorTests.swift)、[应用模式](https://github.com/pasrom/meeting-transcriber/blob/a4f6af6df2674bc4e18097084a128af469823fab/app/MeetingTranscriber/Sources/MeetingPatterns.swift)。

它通过 Core Audio 进程元数据观察输入占用，包含腾讯会议／VooV 标识及连续命中确认，相关开关默认关闭。代码注释明确说明麦克风检测会牺牲准确性；其中一个 wemeet 标识被标注为未经验证。腾讯相关测试使用模拟快照；另有真实 API 结果形状测试，均不等于实际客户端完整覆盖。

**复用计划：** 提取元数据查询、匹配和测试思路，封装最小 Swift helper。调整错误返回，区分 unknown 与 inactive；入会预览、静音、切换设备另测。不引入其录音、转写、模型或网络部分；不把它的“通话始终占用麦克风”假设当本产品保证。

**飞书结论：** 这个快照中没有对应的内置适配。不能只增加一个软件标识就宣布可靠支持。

### 4.2 side-huddle：底层查询和预览过滤参考

[上游](https://github.com/kenotron-ms/side-huddle) · 核对版本 `93a1185d97ba5534170b94a6d8af17023857ecbd` · [MIT](https://github.com/kenotron-ms/side-huddle/blob/93a1185d97ba5534170b94a6d8af17023857ecbd/LICENSE)

核对 [darwin/detect.rs](https://github.com/kenotron-ms/side-huddle/blob/93a1185d97ba5534170b94a6d8af17023857ecbd/crates/side-huddle/src/platform/darwin/detect.rs)、[apps.rs](https://github.com/kenotron-ms/side-huddle/blob/93a1185d97ba5534170b94a6d8af17023857ecbd/crates/side-huddle/src/apps.rs)。

实现会检查输入占用、识别软件，并过滤部分已知入会预览标题。源码也说明某些 Teams 预览标题不能与正式会议区分。默认软件映射没有腾讯和飞书；README 的 Windows、Linux 支持为 stub，不能误读成可用的跨平台会议库。

**处理：** 选择性参考 Mac 底层查询及反例；不把整个 Rust 录音库带入应用，不沿用返回空结果即无会议的错误处理。

### 4.3 BreakTime：Windows 的可用线索与明显误判

[上游](https://github.com/jaimaharaj1/BreakTime) · 核对版本 `bf323864d5b700a8196bf9116c8b15000c66ce72` · [MIT](https://github.com/jaimaharaj1/BreakTime/blob/bf323864d5b700a8196bf9116c8b15000c66ce72/LICENSE)

核对 [BreakTime.ps1 的检测函数](https://github.com/jaimaharaj1/BreakTime/blob/bf323864d5b700a8196bf9116c8b15000c66ce72/BreakTime.ps1#L763)。它检查 ConsentStore 的设备占用时间，也用软件进程和窗口关键词兜底。

实际代码把任意麦克风或摄像头占用立即认作会议，因此录音或设备预览也可能暂停。默认映射没有腾讯、飞书。注册表字段方案在本调研中没有找到稳定公共契约，不能用它替代正式会议状态。

**处理：** 仅参考为实验性信号；优先验证公开 Windows Core Audio 会话 API、应用身份和会议特征，不照搬整个 PowerShell/WPF 产品或其判定规则。

### 4.4 elitan/meetingbar：思路可读，授权未确认

[上游](https://github.com/elitan/meetingbar) · 核对版本 `2e646603ab6b022ed58f49daafa781d2a5b6686b`

核对 [OnlineMeetingMonitor.swift](https://github.com/elitan/meetingbar/blob/2e646603ab6b022ed58f49daafa781d2a5b6686b/MeetingBar/Services/OnlineMeetingMonitor.swift)：使用 Core Audio 进程输入状态及状态机组织提示。软件映射主要为 Zoom、Teams 和浏览器。

本次快照未发现覆盖本项目自身代码的根 LICENSE。`THIRD_PARTY_NOTICES.md` 中的依赖 MIT 声明不能替代作者对全部源码的授权。

**处理：** 仅了解公开 API 使用方向，不复制源码。已有明确 MIT 的替代参考，无需依赖授权不清的代码。

### 4.5 关键技术结论

- 麦克风设备在用、某个软件在用输入和某个软件正在会议，是三个不同层次。
- 静音可能仍持有输入流，也可能释放；不能依赖声音大小，也不能假定所有客户端行为一致。
- 辅助进程、全局设备占用和语音消息使“进程名＋麦克风”不足以保证正确。
- 需要明确的 unknown／unsupported，错误不能伪装成会议结束。
- 首轮以腾讯会议、飞书桌面客户端为目标；不因海外软件检测成功就扩大宣传范围。
- 不为简单休息提醒引入录音、AI 分析、账户授权或会议内容读取。

公开 API 依据：[Apple 输入状态属性](https://developer.apple.com/documentation/coreaudio/kaudioprocesspropertyisrunninginput)、[Microsoft 会话枚举](https://learn.microsoft.com/en-us/windows/win32/api/audiopolicy/nf-audiopolicy-iaudiosessionmanager2-getsessionenumerator)。后者明确提示只依赖枚举器可能不准确，验证时要包含会话新增和设备变化。

## 5. 其他休息提醒项目

### 5.1 BreakTimer

[上游](https://github.com/tom-james-watson/breaktimer-app) · 核对版本 `2d672434e9807d11ba91d126eaccfabd6af6931b` · package 标为 GPL-3.0-or-later，附 [GPL v3 文本](https://github.com/tom-james-watson/breaktimer-app/blob/2d672434e9807d11ba91d126eaccfabd6af6931b/LICENSE.md)

核对 [windows.ts](https://github.com/tom-james-watson/breaktimer-app/blob/2d672434e9807d11ba91d126eaccfabd6af6931b/app/main/lib/windows.ts)、[breaks.ts](https://github.com/tom-james-watson/breaktimer-app/blob/2d672434e9807d11ba91d126eaccfabd6af6931b/app/main/lib/breaks.ts) 及 [breaks.test.ts](https://github.com/tom-james-watson/breaktimer-app/blob/2d672434e9807d11ba91d126eaccfabd6af6931b/app/main/lib/breaks.test.ts)。可参考其窗口、主进程计时和可注入系统监测测试组织。

当前仅研究行为和测试场景，不复制实现。第三显示器显示失败的[公开问题](https://github.com/tom-james-watson/breaktimer-app/issues/461) 是需要增加真机验收的线索，不是证明该项目始终失败。

### 5.2 Workrave

[上游](https://github.com/rcaelers/workrave) · 核对版本 `cbcb1bb831120451d09903666d745db3573c8b7a` · [GPL v3 及部分文件的不同授权说明](https://github.com/rcaelers/workrave/blob/cbcb1bb831120451d09903666d745db3573c8b7a/LICENSES.md)

本次检查目录、README 和许可证，定位了 [Timer.cc](https://github.com/rcaelers/workrave/blob/cbcb1bb831120451d09903666d745db3573c8b7a/libs/core/src/Timer.cc)、[BreakControl.cc](https://github.com/rcaelers/workrave/blob/cbcb1bb831120451d09903666d745db3573c8b7a/libs/core/src/BreakControl.cc)，未对其完整 C++ 核心逐行审计。

官方的[休息模型](https://workrave.org/docs/breaks/)值得参考，但活动／空闲时间并不证明起身。当前不移植其引擎、跨机通信或统计体系，也不将它作为 Mac 现成基础库。

## 6. 工程与基础组件

### 6.1 electron-vite / create-electron

[electron-vite](https://github.com/alex8088/electron-vite) · 核对版本 `2ca5e40433bc7c2a851dbe703b974f6de96a2657` · [MIT](https://github.com/alex8088/electron-vite/blob/2ca5e40433bc7c2a851dbe703b974f6de96a2657/LICENSE)

[quick-start](https://github.com/alex8088/quick-start) · 核对版本 `6718c6f485e5d79f93094fe2c76c9ff87ac3669a` · [MIT](https://github.com/alex8088/quick-start/blob/6718c6f485e5d79f93094fe2c76c9ff87ac3669a/packages/create-electron/LICENSE)

**采用：** 稳定版 electron-vite 的构建能力及 create-electron react-ts 脚手架，不自己配置一套编译器插件组合。[官方入门](https://electron-vite.org/guide/)

核对 [main 模板](https://github.com/alex8088/quick-start/blob/6718c6f485e5d79f93094fe2c76c9ff87ac3669a/packages/create-electron/template/react-ts/src/main/index.ts)、[preload 模板](https://github.com/alex8088/quick-start/blob/6718c6f485e5d79f93094fe2c76c9ff87ac3669a/packages/create-electron/template/react-ts/src/preload/index.ts) 后发现必须调整：开启 sandbox；收窄桥接 API；关闭所有窗口时仍保留托盘进程；替换示例 appId；限制外链。

调研时 electron-vite HEAD 为 `6.0.0-beta.8`，不是正式初始化时应盲目追随的版本。初始化另核对稳定 tag 和相关 Node 要求。

### 6.2 electron-store

[上游](https://github.com/sindresorhus/electron-store) · 核对版本 `5ad69744c22ebe670995707a21d1a89822855b45` · [MIT](https://github.com/sindresorhus/electron-store/blob/5ad69744c22ebe670995707a21d1a89822855b45/license)

核对 readme、index.js、package.json。该快照版本 11.0.2，要求 Node ≥22，采用 ESM；需要核对 Electron 内置 Node，而不是只核对开发机 Node。

**采用：** 主进程内保存设置和受限的小量记录，复用原子写入与 schema 校验；不暴露其 renderer 存储访问，不做高频 tick 写盘。

**注意：** 上游明确说明内置 migrations 功能有已知问题且不承诺支持。使用仓储层显式 schemaVersion、备份和有测试的迁移步骤，不直接把内置迁移作为可靠性保证。[说明位置](https://github.com/sindresorhus/electron-store/blob/5ad69744c22ebe670995707a21d1a89822855b45/readme.md#L186)

### 6.3 electron-log

[上游](https://github.com/megahertz/electron-log) · 核对版本 `32be627dcb9279dc1d5b17cd5c67cf3b4e7409f9` · [MIT](https://github.com/megahertz/electron-log/blob/32be627dcb9279dc1d5b17cd5c67cf3b4e7409f9/LICENSE)

核对 README、package、主进程入口。**采用：** 本地诊断、轮转和进程异常日志，避免自建日志系统。限制可写入字段，不输出会议标题／完整进程列表；renderer 日志接入也须限制来源和大小。

### 6.4 get-windows（仓库仍名 active-win）

[上游](https://github.com/sindresorhus/active-win) · 核对版本 `8fbea97ecd6edc42295696c87081bd29432ab461` · [MIT](https://github.com/sindresorhus/active-win/blob/8fbea97ecd6edc42295696c87081bd29432ab461/license)

该快照 package 名为 `get-windows`，版本 9.3.0。读取窗口可用于会议辅助判断；其 README 提供 Mac 权限控制选项，禁止默认以获取窗口标题为由扩大权限。

**处理：** 备选，不作为首轮强制依赖。先验证只读音频元数据是否足够，再决定是否确实需要窗口访问及相应权限。

### 6.5 Electron / electron-builder / electron-updater

本项核对官方文档，未浅克隆或审计完整源码，不能与上面的源代码核对等量齐观。

- 复用 Electron 自带托盘、screen、powerMonitor、单实例、login item 能力。[API 文档](https://www.electronjs.org/docs/latest/api/app)
- 复用 electron-builder 打包及签名流程；代码授权见其[上游 LICENSE](https://github.com/electron-userland/electron-builder/blob/master/LICENSE)。正式引入时锁版本核对，不把链接 HEAD 当已冻结来源。
- 自动更新以后再引入 electron-updater；当前不自写更新器。[v26 官方更新文档](https://www.electron.build/v26/docs/features/auto-update/)
- 当前 electron-builder 主文档含 v27 next 内容，稳定 v26 应读对应版本文档，不能直接复制 next 配置。

## 7. 未来展示层的有限调研

[TonyNa-code/desktop-pet](https://github.com/TonyNa-code/desktop-pet) · 核对版本 `ce10304a80bdd9785f33e4bf1f43c576481ee71b` · [MIT](https://github.com/TonyNa-code/desktop-pet/blob/ce10304a80bdd9785f33e4bf1f43c576481ee71b/LICENSE)

核对 README、package 和 [main.js 窗口配置](https://github.com/TonyNa-code/desktop-pet/blob/ce10304a80bdd9785f33e4bf1f43c576481ee71b/src/main.js#L680)。透明、置顶、独立窗口说明未来展示层可以与提醒核心分离；不证明所有系统窗口场景已被验证。

当前不复制宠物实现、不导入角色包或 AI 功能；该快照的 sandbox 设置也不能直接照搬。代码 MIT 不自动证明第三方角色、音频和模型可按同样条件使用。

## 8. 复用清单：先用现成能力，再补产品差异

| 能力 | 首选来源 | 方式 | 必须新增／调整的部分 |
| --- | --- | --- | --- |
| 工程初始化、开发构建 | electron-vite / create-electron | 直接使用稳定工具与模板 | 托盘生命周期、安全桥接、目录与 appId |
| 多屏边界、休息窗口经验 | Stretchly + Electron screen | 选择性复用 | 非强制覆盖、热插拔、统一 breakId、焦点退出 |
| 系统挂起／恢复 | Electron powerMonitor + Stretchly | 官方 API + 上游经验 | 多原因暂停及幂等处理 |
| 基础休息规则 | Stretchly、BreakTimer、Workrave | 参考行为 | 单一工作／休息模型、明确手动和自动暂停语义 |
| 提前 1 分钟轻提醒 | Stretchly 的休息前提示调度 | 参考已有提醒节点 | 统一调度、每轮去重、静音非全屏提示 |
| 工作日／工作时段 | BreakTimer 的工作时间功能 | 参考已提供的产品能力 | 本项目显式定义午休、多原因暂停、时段边界与重置规则；具体调度实现仍需单独核对 |
| 设置保存 | electron-store | 直接依赖 | 字段 schema、备份恢复、显式迁移 |
| 本地日志 | electron-log | 直接依赖 | 脱敏、字段白名单、大小限制 |
| 托盘、单实例、开机启动 | Electron 内置 API | 直接使用 | 小看板定位、实际状态反馈 |
| Mac 腾讯会议输入状态 | meeting-transcriber | MIT 代码选择性适配 | 不录音、unknown 处理、真实客户端测试 |
| Mac 入会预览反例 | side-huddle | 参考 | 中文软件自己的证据和过滤规则 |
| Windows 会议状态 | Windows 官方 API，BreakTime 作线索 | 验证后选最小适配 | 腾讯／飞书身份关联和误判排除 |
| 安装、签名、公证 | electron-builder | 直接依赖 | 本项目身份、凭证配置与真机测试 |
| 自动更新 | electron-updater | 延后直接依赖 | 用户可控安装时机，不自建协议 |
| 桌宠展示 | Electron 官方窗口能力 | 本期只留边界 | 未来需求明确后另行设计 |

不会额外引入通用 Event Bus 库、工作流引擎、计时器框架或全局状态管理平台。少量明确业务事件与纯状态转换已经足够。

## 9. 授权与实际引入记录

当前状态：**仅调研，零第三方源码／素材导入。** 因此没有把候选项目列成“已使用”的版权清单，也没有替本仓库选择许可证。

实际引入时应记录：上游 URL、精确版本／SHA、原始文件、目标文件、改动内容、许可证全文及版权声明。BSD／MIT 代码保留相关声明；GPL 项目不在未确定相容发布策略时复制。不同文件授权及第三方素材单独核对，以实际文件许可证为准。

以后新增 `THIRD_PARTY_NOTICES.md` 时，只记录真正分发的组件和代码。许可证核对是复用工作的组成部分，不以“开源”两字代替具体授权。

## 10. 需要用户审核的建议与后续研究

产品建议集中在 [SPEC 第 10 节](SPEC.md#10-待审核决策清单)，避免散落在技术细节中。调研额外支持以下优先级：

1. 先确定休息自动结束、退出手段、暂停恢复和多屏行为。
2. 会议自动暂停按真实验证结果开放，不承诺一开始就覆盖所有中国会议软件。
3. 对“检测坏了该继续提醒还是继续暂停”做显式选择；这是体验取舍，任何一种都有代价。
4. 正式支持范围、签名与下载渠道早于公开发布确定。
5. 桌宠只保留展示与事件边界，避免未来设想拖慢基础版。

下一轮验证须产出实际系统／客户端版本、输入信号、误判案例、权限和资源测量。没有这些记录之前，本报告中的可复用代码只能降低摸索成本，不能替代验收。
