# 桌面后台与发布说明

日期：2026-10-12。此文描述当前代码；技术设计中的后续能力不代表已实现。

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
  services/updates.ts            用户主动更新状态机
  main/index.ts                  托盘、窗口、电源事件、IPC、更新库适配
  preload/index.ts               沙箱桥接，仅暴露固定操作

frontend/src/services/
  desktop-client.ts              正式 IPC 适配器及状态缓存
  mock-reminder-client.ts        浏览器预览适配器
```

构建采用 npm workspace，前端仍可独立开发。桌面使用 electron-vite 5／Vite 7，独立前端保留 Vite 8；插件版本分别匹配，不强行共用不兼容版本。构建环境采用 Node 24，锁文件固定 Electron 44.7、electron-builder 26.15、electron-updater 6.8、electron-store 11 等实际依赖。

### 计时与暂停

- 主进程通过单调时钟计算实际经过时间，250ms 唤醒检查，不按回调次数盲目递减。隐藏看板停止推送渲染消息，后台计时继续。
- 手动暂停冻结剩余时间。锁屏、休眠、工作时段和更新安装是独立原因；自动原因解除不会解除手动暂停。
- 解锁／唤醒重新计满间隔；唤醒保留 2 秒恢复窗口并复核锁屏。出现长时间调度空档或系统时钟跳变也重新计时，避免立刻全屏补发。
- 工作时段按系统本地时间判断，开始包含、结束排除。午休及下班不累计欠账；预计提醒到达当前时段终点或之后，不发本轮提前提示或自动休息。
- 手动休息可在手动暂停／工作时段外开始，结束后保留原暂停原因；锁屏、休眠及更新安装期间不能开始覆盖。
- 应用重启保留设置、是否开始及手动暂停意图，从完整间隔重新计时，不恢复旧休息窗口。

### 窗口与退出

- 单实例；重复启动打开已有看板。菜单栏／托盘支持开始、暂停、继续、立即休息和退出。
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

`history.json` 独立保留最多 500 条、90 天的休息事件。事件包含版本、跨运行唯一的休息 ID、UTC 时间和结果（完成、提前结束、中断、展示失败）。养成以后消费这些由后台确认的事件；当前不结算奖励，不把前端倒计时作为奖励凭证。完整时长统计、崩溃后结算与事务存储仍属后续工作。

### 安全边界

渲染进程开启 sandbox、contextIsolation，禁用 Node 集成。正式页面 CSP 禁止远程连接和脚本；新窗口、导航、webview 与权限请求被拒绝。IPC 验证受管理窗口、主 frame、完整加载 URL、视图权限和参数结构。更新入口只允许固定动作，手动下载只打开固定的 GitHub Releases 页面。

## 2. 用户主动更新

使用成熟的 electron-updater；不自建下载、差分更新或安装器。

```text
检查更新 → 有新版本 → 用户点击下载 → 下载与校验
                                   ↓
                      用户点击重启安装 → 原生安装器
```

关键规则：

- `autoDownload = false`、`autoInstallOnAppQuit = false`；没有启动检查、周期检查或 `checkForUpdatesAndNotify()`。
- 只由用户触发检查；发现新版本后等待用户点击下载，显示百分比。下载完成仍等待用户点击重启安装。
- 休息、准备覆盖、锁屏／休眠期间拒绝安装，保留下载结果。安装期间暂停提醒；用户手动暂停意图保留。
- 重复点击检查、下载、安装不会重复发起同一操作。失败显示可重试状态，不能误报“最新版本”；可转到公开版本页手动下载。
- 不允许预发布版本或降级。更新源固定为公开的 `Jarden-1/remind` Releases，客户端不包含 GitHub token。
- 更新库校验下载哈希，正式包使用原生签名校验；不提供关闭签名验证的开关。
- 开发模式及缺少更新配置的目录测试包只提供“查看版本”。安装包需有 `app-update.yml`，发布端需有 `latest.yml`／`latest-mac.yml` 及对应产物。
- macOS 更新需要签名，且发布 ZIP；只有 DMG 不足以支持更新。当前机器没有 Developer ID 签名，故本地测试包不能代表签名更新已验收。[electron-builder v26 更新说明](https://www.electron.build/v26/docs/features/auto-update/)

实际打包页面已核对更新检查，缺少发布版本时显示“暂时没有可用的发布版本”。截图：[更新入口](previews/software-update.jpg)、[完整设置窗口](previews/desktop-settings.jpg)。

当前仓库公开但尚无 Release；完整的“旧版 → 新版”在线安装必须在首次正式版本发布后，使用第二个更高版本完成验收。未进行虚构更新或自动安装来掩盖这一限制。

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
2. 推送与根目录 package.json 版本相同的 `vX.Y.Z` 标签：要求签名凭证，生成并上传到 GitHub Release **草稿**。缺少凭证或版本不匹配直接失败。
3. 检查两个平台都成功、产物和更新元数据齐全、签名及公证通过后，由维护者发布草稿。用户仅看到已发布的稳定版。

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

已完成：34 项自动测试、TypeScript 检查、独立前端与桌面生产构建、计时／存储／更新／IPC 快照竞态的自动测试；Mac arm64 本地打包及真实界面验证，包括原生看板、设置入口、多屏休息显示、Esc 退出、关闭看板后后台计时、重复启动恢复同一计时、保存设置与重启后保留手动暂停，以及正式打包页面使用本地文件加载。未签名的 Mac arm64／x64 DMG、ZIP 和 `latest-mac.yml` 已生成。

双屏覆盖修正已在当前 Mac arm64 应用中复验：1920×1080（0, 0）与 1512×982（220, 1080），两块屏均为 2× 缩放。显示后原生窗口、内容区与对应 display.bounds 完全一致；Esc 结束整轮并恢复原看板。看板两个操作等宽，底栏贴合窗口高度。[看板截图](previews/desktop-panel-aligned.jpg) · [休息窗口截图](previews/desktop-break-fullscreen.jpg)。Mac arm64／x64 测试安装包随当前源码重新生成；GitHub Actions 手动构建提供两平台测试包，正式版本仍要求签名和公证。

生产依赖审计无已知漏洞；构建依赖链仍有 8 项 moderate 报告，集中于 electron-builder 的附带工具依赖，未通过强制降级破坏打包链。升级时重新评估，不将其当成生产运行依赖已消除的问题。

尚未完成：Windows／Intel Mac 真机验证，真实锁屏／休眠和热插拔全组合，后台资源基准、签名公证、两版本在线安装、断网中断及安装失败真机恢复、开机启动、腾讯／飞书真实会议识别。会议设置继续标记“待接入”。这些边界不能被当前单元测试替代。
