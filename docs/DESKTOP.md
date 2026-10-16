# 桌面后台与发布说明

日期：2026-10-15。此文描述当前代码；技术设计中的后续能力不代表已实现。

## 1. 当前实现

Electron 主进程是唯一计时与设置权威。React 只发送用户操作、订阅状态；不读文件、不扫描进程、不自行生成正式休息事件。没有业务 HTTP 服务或云端数据库。

```text
shared/
  reminder.ts                    前后端共享的提醒契约
  desktop.ts                     受限桌面桥接与更新契约
  schedule.ts                    本机日历时段计算与表单校验

desktop/
  domain/reminder-engine.ts       独立计时核心、暂停原因、休息事件
  domain/validation.ts            主进程入口的 Zod 运行时校验
  services/preferences.ts        electron-store 设置及有限记录
  services/updates.ts            更新检查、下载与安装状态机
  main/index.ts                  托盘、窗口、电源事件、IPC、更新库适配
  preload/index.ts               沙箱桥接，仅暴露固定操作

frontend/src/services/
  desktop-client.ts              正式 IPC 适配器及状态缓存
  mock-reminder-client.ts        浏览器预览适配器
```

构建采用 npm workspace，前端仍可独立开发。桌面使用 electron-vite 5／Vite 7，独立前端保留 Vite 8；插件版本分别匹配，不强行共用不兼容版本。构建环境采用 Node 24，锁文件固定 Electron 44.7、electron-builder 26.15、electron-updater 6.8、electron-store 11 等实际依赖。

### 计时与暂停

- 主进程通过单调时钟计算实际经过时间，250ms 唤醒检查，不按回调次数盲目递减。隐藏看板停止推送渲染消息，后台计时继续。
- 手动暂停冻结剩余时间。可以暂停 30 分钟、1 小时或直到本地明天 0 点，到点自动继续；也可以一直暂停。锁屏、休眠、工作时段和更新安装是独立原因；自动原因解除不会解除手动暂停。休息中可以延后 5 分钟，或跳过这一次。
- 解锁／唤醒重新计满间隔；唤醒保留 2 秒恢复窗口并复核锁屏。出现长时间调度空档或系统时钟跳变也重新计时，避免立刻全屏补发。
- 工作时段按系统本地时间判断，开始包含、结束排除。午休及下班不累计欠账；预计提醒到达当前时段终点或之后，不发本轮提前提示或自动休息。
- 手动休息可在手动暂停／工作时段外开始，结束后保留原暂停原因；锁屏、休眠及更新安装期间不能开始覆盖。
- 应用重启保留设置、是否开始及手动暂停意图，从完整间隔重新计时，不恢复旧休息窗口。

### 窗口与退出

- 单实例；重复启动打开已有看板。菜单栏／托盘支持开始、暂停、继续、立即休息、重置计时和退出。看板是无边框窗口。标题栏右侧依次是设置、最小化“−”和退出“×”；“×”与托盘退出相同，会清掉计时并结束进程。最小化只收起看板：macOS 上这个无边框、置顶、没有程序坞图标的窗口调用 minimize 后仍会留在屏幕上，所以改为隐藏，托盘点击再打开；Windows 先最小化，窗口若仍可见再隐藏。标题栏按钮在可拖拽区域内用 mousedown 触发，避免 macOS 吃掉 click 后按钮停在按下状态。
- 开机自启动默认打开。偏好里用 `loginItemChosen` 区分“从未设置”和“用户改过”。没有这个标记时，即使旧文件里 `openAtLogin` 为 false，升级后也会登记为打开。用户拨动开关后写入 `loginItemChosen`，之后尊重该选择。自动登记失败不会把选择标成已确认，移到“应用程序”后下次启动会再试。
- macOS 使用 `SMAppService`（`type: 'mainAppService'`），只在应用位于 `/Applications` 时调用 `setLoginItemSettings`。开关以 `getLoginItemSettings().status` 为准：`enabled` 为开；`requires-approval` 保持开，设置里提示到“系统设置 → 通用 → 登录项”，按钮打开 `x-apple.systempreferences:com.apple.LoginItems-Settings.extension`；`not-registered` / `not-found` 显示为关。窗口重新获得焦点时只重新读取，不重复登记。从 DMG（`/Volumes`）或 App Translocation 路径运行时不登记，并提示移到“应用程序”。
- Windows 仍通过 `args: ['--hidden']` 和 `enabled` 登记。Electron 44 已移除 `openAsHidden`。macOS 登录启动靠 `wasOpenedAtLogin`，Windows 靠 `--hidden`，两种都会在不打开看板的情况下留在菜单栏或托盘。
- macOS 菜单栏使用模板图标，并在图标旁显示短状态：计时中为距离下次休息的 `mm:ss`，休息中为 `休息 mm:ss`，暂停、会议、时段外、未开始等用短词标出。Windows 不支持 `Tray.setTitle`，同一段倒计时和状态写在托盘提示里。
- 小看板按托盘位置与当前显示器工作区定位，支持负坐标。设置窗口不超过屏幕高度，保存／取消不因失焦丢失。
- 每个显示器一个不透明覆盖窗口，不使用 kiosk。全部界面就绪并复核系统状态后展示，休息时钟从展示后开始；准备超过 5 秒取消本轮、记录失败并尝试静音系统通知。
- 覆盖使用完整 display.bounds，关闭圆角、阴影与 Windows thickFrame，Mac 启用 enableLargerThanScreen。显示后核对原生窗口及内容边界，避免菜单栏裁切；不将 DIP 再乘缩放系数。休息时小看板隐藏，重新激活应用只聚焦休息窗口，结束后恢复之前打开的看板。
- Esc、结束按钮或任一休息窗口异常退出会关闭整轮覆盖。渲染进程崩溃会触发失败处理，不遗留其他屏幕的窗口。
- 休息进行中增减显示器或改变缩放时，调整已有窗口并为新屏创建窗口，沿用同一时钟；新屏不重复响铃。准备阶段改变显示器会取消本轮并提示失败。
- 主进程指定唯一播放铃声的休息窗口，默认静音。提前提醒使用独立小窗，不启动休息计时。
- 窗口销毁时解除本轮覆盖；尚未实现精确恢复之前第三方应用焦点。

### 本地数据与扩展

设置位于系统 userData 目录下的 `preferences.json`，应用名固定为 `remind`，appId 为 `com.jarden.remind`。浏览器预览的 localStorage 不自动导入正式设置。

electron-store 提供原子写入。设置额外保存 schemaVersion 并用 Zod 验证；损坏／非法文件保留副本，未知的更高版本只读。保存失败明确提示，不报告已保存。活动倒计时不落盘。

`history.json` 独立保留最多 500 条、90 天的休息事件。新事件使用 v2，包含跨运行唯一的休息 ID、UTC 时间、计划秒数、实际观察到的展示秒数和结果（完成、跳过、延后、中断、展示失败）；旧 v1 事件仍可读取。未知长空档不计为有效休息，正常退出记为中断；重复事件不再次落盘，损坏文件保留备份，来自更高版本的记录只读。养成以后消费这些由后台确认的事件；当前不结算奖励，不把前端倒计时作为奖励凭证。统计界面、崩溃后结算与事务奖励存储仍属后续工作。历史存储不可用时只停用记录，不阻止提醒启动。

### 安全边界

渲染进程开启 sandbox、contextIsolation，禁用 Node 集成。正式页面 CSP 禁止远程连接和脚本；新窗口、导航、webview 与权限请求被拒绝。IPC 验证受管理窗口、主 frame、完整加载 URL、视图权限和参数结构。更新入口只允许固定动作，手动下载只打开固定的 GitHub Releases 页面。

## 2. 软件更新

使用成熟的 electron-updater；不自建下载、差分更新或安装器。

```text
启动 15 秒后 / 每 6 小时 / 用户点击检查
        ↓
   已发布的更高版本？ ——否→ 自动检查保持安静；手动检查显示结果
        ↓ 是
 静音系统通知 + 看板和设置提示
        ↓
 Windows，或带 Developer ID 的 Mac：用户点击下载 → 校验 → 用户点击重启安装
 无 Developer ID 的 Mac（含 ad-hoc）：用户点击后打开 GitHub Releases 下载页
```

关键规则：

- `autoDownload = false`、`autoInstallOnAppQuit = false`。不调用 `checkForUpdatesAndNotify()`，以免库自己下载或安装。
- 正式包在启动约 15 秒后检查一次，之后每 6 小时检查一次。自动检查失败不改界面状态，也不显示成“已是最新版本”。
- 发现新版本只通知，不下载。同一版本不重复通知。设置中的“检查更新”仍然可用，手动检查失败会显示原因并可重试。
- Windows 走应用内下载和安装。下载显示百分比，下载完成后仍等待用户点击重启安装。
- 无 Developer ID 签名的 macOS 包不能通过 Squirrel.Mac 完成应用内安装。启动时用 `codesign` 查看是否带有 Developer ID Application 签名；没有时，新版本提示改为打开固定的 GitHub Releases 页面，不调用应用内下载或安装。带 Developer ID 的 Mac 包仍使用应用内流程。
- 休息、准备覆盖、锁屏、休眠、会议和更新安装期间拒绝安装，保留已下载结果。安装期间暂停提醒；用户手动暂停意图保留。
- 重复点击检查、下载、安装不会重复发起同一操作。失败显示可重试状态，不能误报“最新版本”；可转到公开版本页手动下载。
- 不允许预发布版本或降级。更新源固定为公开的 `Jarden-1/remind` Releases，客户端不包含 GitHub token。自动检查只看已发布版本，看不到草稿。
- 更新库校验下载哈希，正式包使用原生签名校验；不提供关闭签名验证的开关。
- 开发模式及缺少更新配置的目录测试包只提供“查看版本”，也不会发起自动检查。安装包需有 `app-update.yml`，发布端需有 `latest.yml`／`latest-mac.yml` 及对应产物。
- macOS 应用内更新需要签名，且发布 ZIP；只有 DMG 不足以支持更新。[electron-builder v26 更新说明](https://www.electron.build/v26/docs/features/auto-update/)

实际打包页面已核对更新检查，缺少发布版本时显示“暂时没有可用的发布版本”。截图：[更新入口](previews/software-update.jpg)、[完整设置窗口](previews/desktop-settings.jpg)。

截至 2026-10-15，仓库已公开发布 v0.1.0 至 v0.1.4，现有安装包带 ad-hoc 签名。v0.1.5 修复处于审核阶段，尚未公开发布；跨版本在线安装及真实系统登录验收仍需使用正式安装环境完成。

## 3. 构建与发布

根目录 `npm ci` 会通过 `install-electron` 下载运行时。需要 Node 22.12+，建议 Node 24 LTS。

- `npm run dev`：启动桌面开发端，渲染服务端口 5174。
- `npm test`：后台、存储、更新状态机及前端测试。
- `npm run build`：类型检查，生成 `out/main`、`out/preload`、`out/renderer`，也验证独立前端构建。
- `npm run pack`：当前平台测试应用目录，不带完整更新发布文件。
- `npm run dist`：当前平台安装包和更新文件，全部输出到 `release/`，不会上传。

Mac 当前配置同时构建 arm64／x64 的 DMG 与 ZIP；Windows 构建 x64 NSIS，允许选择安装目录，卸载保留用户数据。Windows 应在 Windows 上构建、运行验收。Intel 包已能生成，但尚未做 Intel 真机验证。

`.github/workflows/desktop.yml` 使用 Mac 与 Windows runner：

1. 手动运行：执行测试和构建，产物保存为 Actions artifacts，不发布。
2. 推送与根目录 package.json 版本相同的 `vX.Y.Z` 标签：两个平台都成功后，把 DMG、ZIP、NSIS 和更新元数据上传到 GitHub Release **草稿**。版本不匹配直接失败。没有 Developer ID 凭证时，Mac 使用 ad-hoc 签名（`mac.identity: "-"`），构建日志会打印 `codesign --verify --deep --strict` 和 `spctl` 的结果；凭证齐全时改用该证书签名，Mac 同时公证。只配置了一部分凭证也会失败，避免发出半签名包。
3. 草稿不会自动公开。维护者检查两个平台的安装包和更新元数据后，在 GitHub 上发布该草稿。应用内更新只看已发布的版本。macOS 在线更新仍需要签名，ad-hoc ZIP 不能当作已验收的自动更新。

仓库 Secrets：

| 名称 | 用途 |
| --- | --- |
| `MAC_CSC_LINK` | Developer ID Application 的 p12 证书（受保护 URL 或 base64） |
| `MAC_CSC_KEY_PASSWORD` | p12 密码 |
| `APPLE_ID` | 公证使用的 Apple 开发者账号 |
| `APPLE_APP_SPECIFIC_PASSWORD` | Apple 应用专用密码 |
| `APPLE_TEAM_ID` | Apple 开发者团队 |
| `WIN_CSC_LINK` | Windows 代码签名 p12 |
| `WIN_CSC_KEY_PASSWORD` | Windows p12 密码 |

上传使用该次任务的 `GITHUB_TOKEN`，桌面构建任务拥有 contents:write，用于写入发布草稿；这些凭证只在 CI 使用，不进入安装包。首次发布前还需确认应用标识、发布者身份和项目对外许可证。GitHub 在中国部分网络环境不稳定；后续可将同一更新协议迁移到国内 HTTPS 静态存储，无需改计时核心。

## 4. 验证与待完成事项

已完成：v0.1.5 本地 102 项自动测试、TypeScript 检查、独立前端与桌面生产构建、计时／存储／更新／IPC 快照竞态的自动测试；Mac arm64 本地打包及真实界面验证，包括原生看板、设置入口、多屏休息显示、Esc 退出、关闭看板后后台计时、重复启动恢复同一计时、保存设置与重启后保留手动暂停，以及正式打包页面使用本地文件加载。使用 ad-hoc 签名的 Mac arm64／x64 DMG、ZIP 和 `latest-mac.yml` 已生成。

双屏覆盖修正已在 Mac arm64 应用中复验：1920×1080（0, 0）与 1512×982（220, 1080），两块屏均为 2× 缩放。显示后原生窗口、内容区与对应 display.bounds 完全一致；Esc 结束整轮并恢复原看板。当前看板两个操作等宽，底栏已删除。[当前看板](previews/panel-polished-native.png) · [精简休息页](previews/break-minimal.jpg)。上次验证的 Mac arm64／x64 安装包早于最新会议与界面实现，需从最终源码重新打包；GitHub Actions 手动构建可生成两平台测试包。打上与 `package.json` 相同的版本标签后，工作流把 ad-hoc（或凭证齐全时正式签名）的 Mac 安装包及 Windows 安装包放进 Release 草稿，仍需维护者手动发布。

生产依赖审计为 0；构建依赖链有 8 项 moderate 报告，来自 sprintf-js 经 roarr/global-agent 传入的工具依赖链。2026-10-15 查询时上游尚无修复版本，未强制降级打包器或覆盖为不兼容日志库。[上游公告](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)。

尚未完成：Windows／Intel Mac 真机验证，真实锁屏／休眠和热插拔全组合，后台资源基准、签名公证、两版本在线安装、断网中断及安装失败真机恢复、开机自启动在已安装应用上的系统验收、腾讯／飞书真实会议组合验收。会议设置现为实验性接入，见 [会议说明](MEETINGS.md)。这些边界不能被当前单元测试替代。


## 5. v0.1.5 检查与修复

详细修复、验证证据与剩余外部条件见 [修复记录](FIXES-0.1.5.md)。开发运行现在使用独立的 remind-development 数据目录；可以通过 REMIND_DEV_DATA_DIR 指向临时测试目录。开发包不登记登录项，不修改已安装版本的数据。

v0.1.6 调整：macOS 悬浮打开轻量操作卡、点击只切换看板、右键打开原生菜单；三个窗口互斥。Mac 会议扫描改为主应用内异步原生模块，签名检查不再阻塞启动，登录项查询避免重复，设置切换不抢焦点。详见 [响应与权限修复](FIXES-0.1.6.md)。

Quality checks 在 PR 和 main 推送时执行 Mac／Windows 测试、构建和生产依赖审计。发布仍要求两个平台都构建成功；上传前对版本、必需架构、文件大小、SHA-512、主更新路径及 blockmap 进行验证。手动构建同样检查不完整签名配置；预发布标记与稳定渠道区分；已公开版本的文件禁止覆盖，须发新版本。Developer ID 构建还须通过 Gatekeeper 校验，ad-hoc 构建不宣称通过该校验。
