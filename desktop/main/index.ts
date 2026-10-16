import { app, autoUpdater as nativeAutoUpdater, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, Notification, powerMonitor, screen, shell, systemPreferences, Tray, type IpcMainInvokeEvent } from 'electron'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { existsSync, mkdirSync } from 'node:fs'
import log from 'electron-log/main'
import electronUpdater from 'electron-updater'
import { z } from 'zod'
import { MeetingService, nativeMeetingProbe, macMeetingProbe } from '../services/meetings/service'
import { meetingNames } from '../../shared/meeting'
import { commands, type DesktopView, type DesktopState } from '../../shared/desktop'
import { settingsSchema } from '../domain/validation'
import { ReminderEngine } from '../domain/reminder-engine'
import { PreferencesStore, HistoryStore } from '../services/preferences'
import { macNativeUpdateSupported } from '../services/code-signature'
import { Updates, type UpdatePort } from '../services/updates'
import { shouldHidePanel, shouldDismissPanelOnBlur, panelBounds, DEFAULT_PANEL_HEIGHT, fitPanelHeight } from '../domain/panel-window'
import { trayPresentation } from '../domain/tray-status'
import { TrayHover } from '../domain/tray-hover'
import { classifyInstallLocation, desiredOpenAtLogin, launchedHidden, loginItemsSettingsUrl, LoginItems, type LoginItemState } from '../services/login-item'

const here = dirname(fileURLToPath(import.meta.url))
const releasesUrl = 'https://github.com/Jarden-1/remind/releases'
app.setName('remind')
if (!app.isPackaged) {
  const directory = process.env.REMIND_DEV_DATA_DIR ? resolve(process.env.REMIND_DEV_DATA_DIR) : join(app.getPath('appData'), 'remind-development')
  mkdirSync(directory, { recursive: true })
  app.setPath('userData', directory)
}
let quitting = false
let panel: BrowserWindow | null = null
let notice: BrowserWindow | null = null
let tray: Tray | null = null
let trayCard: BrowserWindow | null = null
let trayCardLoad: Promise<void> | undefined
let trayHover: TrayHover | undefined
let engine: ReminderEngine
let updates!: Updates
let meetings: MeetingService | undefined
let preferences: PreferencesStore
let loginItems: LoginItems
let stateRevision = 0
const managed = new Map<number, { window: BrowserWindow; view: DesktopView; url: string }>()
const readiness = new Map<number, () => void>()
let breakWindows: BrowserWindow[] = []
let restorePanelAfterBreak = false
const windowDisplays = new Map<number, number>()
let preparingGeneration: number | null = null
let tickTimer: ReturnType<typeof setInterval> | undefined
let recoveryTimer: ReturnType<typeof setTimeout> | undefined
let loginItem: LoginItemState = { openAtLogin: false, status: 'unsupported', approvalNeeded: false, message: null }
let panelSettingsOpen = false
let lastLoginRefresh = 0
let loginRefreshRequired = false
const panelWidth = 368
let panelContentHeight = DEFAULT_PANEL_HEIGHT

function state(): DesktopState { return { revision: ++stateRevision, reminder: engine.snapshot, update: updates.snapshot, launchAtLogin: loginItem.openAtLogin, loginItem } }
function broadcast() {
  const snapshot = state()
  for (const { window, view } of managed.values()) {
    if (window.isDestroyed() || window.webContents.isDestroyed() || (!window.isVisible() && view !== 'break')) continue
    try { window.webContents.send('remind:changed', snapshot) }
    catch (error) { log.error('Cannot deliver window state', error) }
  }
}
function notifySystem(title: string, body: string, clicked?: () => void) {
  try {
    if (!Notification.isSupported()) return
    const notification = new Notification({ title, body, silent: true })
    if (clicked) notification.on('click', clicked)
    notification.show()
  } catch (error) { log.warn('System notification unavailable', error) }
}
function failBreakDisplay(generation: number, error: unknown) {
  log.error('Break display failed', error)
  if (engine.generation !== generation || (!engine.snapshot.preparingBreak && engine.snapshot.phase !== 'break')) return
  engine.failBreak(generation)
  notifySystem('该起来活动一下了', '休息窗口未能打开')
}
function rendererUrl(view: DesktopView, sound = false) {
  const url = process.env.ELECTRON_RENDERER_URL && !app.isPackaged
    ? new URL(process.env.ELECTRON_RENDERER_URL)
    : pathToFileURL(join(here, '../renderer/index.html'))
  url.searchParams.set('view', view)
  if (sound) url.searchParams.set('sound', '1')
  return url.href
}
function makeWindow(view: DesktopView, options: Electron.BrowserWindowConstructorOptions, sound = false) {
  const window = new BrowserWindow({
    show: false, backgroundColor: '#fafcfb', autoHideMenuBar: true,
    webPreferences: { preload: join(here, '../preload/index.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: view === 'panel', devTools: !app.isPackaged, autoplayPolicy: 'no-user-gesture-required' },
    ...options,
  })
  const id = window.webContents.id
  const url = rendererUrl(view, sound)
  managed.set(id, { window, view, url })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.webContents.on('will-attach-webview', event => event.preventDefault())
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  window.on('closed', () => { managed.delete(id); readiness.delete(id) })
  return { window, load: () => window.loadURL(url) }
}
function quitApp() {
  quitting = true
  hideTrayCard()
  engine?.shutdown()
  clearInterval(tickTimer)
  clearTimeout(recoveryTimer)
  updates?.stop()
  meetings?.stop()
  app.quit()
}
function minimizePanel(target: BrowserWindow) {
  if (target.isDestroyed()) return
  target.setAlwaysOnTop(false)
  // Windows can minimize a skip-taskbar window. macOS cannot: the Dock is hidden,
  // and minimize() may report success while this always-on-top panel stays on screen.
  if (process.platform === 'win32') target.minimize()
  if (!target.isDestroyed() && shouldHidePanel(process.platform, target.isVisible())) target.hide()
}
function showPanel() {
  hideTrayCard()
  openPanel(true)
}
function openPanel(reveal: boolean) {
  if (breakWindows.length && (engine.snapshot.phase === 'break' || engine.snapshot.preparingBreak)) {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const active = breakWindows.find(window => windowDisplays.get(window.id) === display.id) ?? breakWindows[0]
    if (reveal && !active.isDestroyed() && active.isVisible()) active.focus()
    return
  }
  if (!panel || panel.isDestroyed()) {
    const created = makeWindow('panel', { width: panelWidth, height: panelContentHeight, resizable: false, frame: false, minimizable: true, skipTaskbar: true, alwaysOnTop: true })
    panel = created.window
    panelSettingsOpen = false
    panel.webContents.on('render-process-gone', (_event, details) => {
      log.error('Panel renderer exited', details.reason)
      if (!created.window.isDestroyed()) created.window.destroy()
    })
    panel.on('close', event => { if (!quitting) { event.preventDefault(); panel?.hide() } })
    panel.on('blur', () => {
      const window = created.window
      if (quitting || window.isDestroyed() || !window.isVisible()) return
      if (shouldDismissPanelOnBlur(screen.getCursorScreenPoint(), window.getBounds(), tray?.getBounds(), panelSettingsOpen)) window.hide()
    })
    panel.on('focus', () => {
      if (loginRefreshRequired) { loginRefreshRequired = false; refreshLoginFromOs(true) }
      void meetings?.checkNow()
    })
    const started = performance.now()
    void created.load().then(() => { log.info('Panel loaded in', Math.round(performance.now() - started), 'ms'); if (reveal) placePanel() }).catch(error => log.error('Panel failed to load', error))
  } else if (reveal) { placePanel(); broadcast() }
}
function placePanel(reveal = true) {
  if (!panel || panel.isDestroyed() || engine.snapshot.preparingBreak || engine.snapshot.phase === 'break') return
  if (!reveal && !panel.isVisible()) return
  if (panel.isMinimized()) panel.restore()
  panel.setAlwaysOnTop(true)
  const anchor = tray?.getBounds()
  const point = anchor && anchor.width > 0 ? { x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height / 2 } : screen.getCursorScreenPoint()
  const area = screen.getDisplayNearestPoint(point).workArea
  panel.setBounds(panelBounds(area, point, process.platform, panelSettingsOpen, panelContentHeight), false)
  if (reveal) {
    panel.show(); panel.focus()
    if (!panelSettingsOpen) panel.webContents.send('remind:panel-shown')
  }
}
function hideTrayCard() {
  trayHover?.cancel()
}
function prepareTrayCard() {
  if (trayCard && !trayCard.isDestroyed()) return trayCardLoad!
  const created = makeWindow('tray-menu', { width: 176, height: 172, resizable: false, frame: false, skipTaskbar: true, alwaysOnTop: true, focusable: false })
  trayCard = created.window
  trayCardLoad = created.load().catch(error => { created.window.destroy(); trayCard = null; throw error })
  return trayCardLoad
}
function showTrayCard() {
  if (!trayCard || trayCard.isDestroyed() || panel?.isVisible() || engine.snapshot.preparingBreak || engine.snapshot.phase === 'break') return
  const anchor = tray!.getBounds()
  const point = { x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height }
  const area = screen.getDisplayNearestPoint(point).workArea
  const bounds = panelBounds(area, point, process.platform, false, 172)
  trayCard.setBounds({ ...bounds, width: 176, x: Math.round(Math.max(area.x + 8, Math.min(point.x - 88, area.x + area.width - 184))) })
  trayCard.showInactive(); broadcast()
}
function closeBreakWindows() {
  const windows = breakWindows; breakWindows = []
  windowDisplays.clear()
  for (const window of windows) if (!window.isDestroyed()) window.destroy()
  if (restorePanelAfterBreak) {
    restorePanelAfterBreak = false
    if (!quitting) showPanel()
  }
}
function makeBreakWindow(display: Electron.Display, generation: number, sound = false) {
  const { window, load } = makeWindow('break', {
    ...display.bounds, frame: false, roundedCorners: false, hasShadow: false,
    thickFrame: false, enableLargerThanScreen: true,
    resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, alwaysOnTop: true,
  }, sound)
  breakWindows.push(window); windowDisplays.set(window.id, display.id)
  window.setAlwaysOnTop(true, 'screen-saver')
  if (process.platform === 'darwin') window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  window.webContents.on('before-input-event', (event, input) => { if (input.key === 'Escape') { event.preventDefault(); engine.command('endBreak') } })
  const failed = () => { if (!quitting && engine.generation === generation && breakWindows.includes(window)) failBreakDisplay(generation, new Error('Break window exited unexpectedly')) }
  window.on('closed', failed); window.webContents.on('render-process-gone', failed)
  const ready = new Promise<void>(resolve => readiness.set(window.webContents.id, resolve))
  return { window, loaded: Promise.all([ready, load()]) }
}
function coverDisplay(window: BrowserWindow, display: Electron.Display, show = false) {
  // macOS constrains normal windows beneath the menu bar when they become visible.
  // Borderless windows with enableLargerThanScreen bypass that constraint, without
  // creating fullscreen Spaces. Bounds are already in DIP; never scale them again.
  window.setBounds(display.bounds, false)
  if (show) window.showInactive()
  window.setBounds(display.bounds, false)
  const actual = window.getBounds()
  const content = window.getContentBounds()
  log.debug('Break display coverage', { display: display.id, expected: display.bounds, actual, content, scaleFactor: display.scaleFactor })
  if (['x', 'y', 'width', 'height'].some(key => actual[key as keyof Electron.Rectangle] !== display.bounds[key as keyof Electron.Rectangle] || content[key as keyof Electron.Rectangle] !== display.bounds[key as keyof Electron.Rectangle])) {
    throw new Error('Break window does not cover its display')
  }
}
function refreshBreakDisplays() {
  const generation = engine.generation
  try { refreshBreakDisplayLayout() } catch (error) { failBreakDisplay(generation, error) }
}
function refreshBreakDisplayLayout() {
  const generation = engine.generation
  if (engine.snapshot.preparingBreak) { engine.failBreak(generation); return }
  if (engine.snapshot.phase !== 'break') return
  const displays = screen.getAllDisplays()
  if (!displays.length) throw new Error('No displays available')
  const removed = breakWindows.filter(window => !displays.some(display => display.id === windowDisplays.get(window.id)))
  breakWindows = breakWindows.filter(window => !removed.includes(window))
  for (const window of removed) { windowDisplays.delete(window.id); if (!window.isDestroyed()) window.destroy() }
  for (const display of displays) {
    const existing = breakWindows.find(window => windowDisplays.get(window.id) === display.id)
    if (existing) {
      try { coverDisplay(existing, display) }
      catch (error) { failBreakDisplay(generation, error); return }
      continue
    }
    const created = makeBreakWindow(display, generation)
    let timeout: ReturnType<typeof setTimeout> | undefined
    void Promise.race([created.loaded, new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('Display readiness timed out')), 5000) })])
      .then(() => {
        if (engine.generation !== generation || engine.snapshot.phase !== 'break' || !breakWindows.includes(created.window) || created.window.isDestroyed()) return
        const current = screen.getAllDisplays().find(item => item.id === display.id)
        if (current) coverDisplay(created.window, current, true)
      })
      .catch(error => { if (breakWindows.includes(created.window)) failBreakDisplay(generation, error) })
      .finally(() => clearTimeout(timeout))
  }
  if (removed.length) breakWindows[0]?.focus()
}
async function prepareBreak(generation: number) {
  hideTrayCard()
  preparingGeneration = generation
  closeBreakWindows()
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await meetings?.checkNow()
    if (engine.generation !== generation || !engine.snapshot.preparingBreak) return
    if (meetings && !meetings.allowOverlay && engine.deferAutomaticBreak()) {
      notifySystem('该起来活动一下了', '会议状态未确认，本次使用静音提醒'); return
    }
    const displays = screen.getAllDisplays()
    if (!displays.length) throw new Error('No displays available')
    const primary = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const pending = displays.map(display => {
      return makeBreakWindow(display, generation, display.id === primary.id).loaded
    })
    await Promise.race([Promise.all(pending), new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('Break readiness timed out')), 5000) })])
    engine.tick()
    await meetings?.checkNow()
    if (engine.generation !== generation || !engine.snapshot.preparingBreak) return
    if (meetings && !meetings.allowOverlay && engine.deferAutomaticBreak()) {
      notifySystem('该起来活动一下了', '会议状态未确认，本次使用静音提醒'); return
    }
    if (powerMonitor.getSystemIdleState(60) === 'locked') engine.setSystemPause('locked', true)
    if (engine.generation !== generation || !engine.snapshot.preparingBreak) return
    restorePanelAfterBreak = panel?.isVisible() ?? false
    hideTrayCard()
    panel?.hide()
    for (const window of breakWindows) {
      const display = screen.getAllDisplays().find(item => item.id === windowDisplays.get(window.id))
      if (!display) throw new Error('Display disconnected while opening break')
      coverDisplay(window, display, true)
    }
    breakWindows.find(window => windowDisplays.get(window.id) === primary.id)?.focus()
    if (!engine.confirmBreak(generation)) closeBreakWindows()
  } catch (error) {
    failBreakDisplay(generation, error)
  } finally { clearTimeout(timeout); if (preparingGeneration === generation) preparingGeneration = null }
}
function syncWindows() {
  const s = engine.snapshot
  if (s.preparingBreak && preparingGeneration !== engine.generation) void prepareBreak(engine.generation)
  if (!s.preparingBreak && s.phase !== 'break') closeBreakWindows()
  if (s.preReminderVisible && !notice) {
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    const created = makeWindow('notice', { width: 260, height: 56, x: area.x + area.width - 276, y: area.y + 16, frame: false, resizable: false, skipTaskbar: true, alwaysOnTop: true })
    notice = created.window
    notice.on('closed', () => { notice = null })
    void created.load().then(() => { if (engine.snapshot.preReminderVisible && !created.window.isDestroyed()) created.window.showInactive() }).catch(error => log.error(error))
  } else if (!s.preReminderVisible && notice) { const old = notice; notice = null; old.destroy() }
}
function trusted(event: IpcMainInvokeEvent, views: DesktopView[] = ['panel', 'break', 'notice', 'tray-menu']) {
  const entry = managed.get(event.sender.id)
  if (!entry || !views.includes(entry.view) || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== entry.url) throw new Error('不允许的请求')
  return entry
}
function persist() {
  try { preferences.write(engine.getPreferences()); engine.setStorageError(false) }
  catch (error) { log.error('Cannot save preferences', error); engine.setStorageError(true) }
}
function setupIpc() {
  ipcMain.handle('remind:state', event => { trusted(event); return state() })
  ipcMain.handle('remind:command', (event, input: unknown) => {
    const entry = trusted(event)
    const command = z.enum(commands).parse(input)
    if (entry.view === 'notice' && command !== 'dismissPreReminder') throw new Error('不允许的操作')
    if (entry.view === 'break' && command !== 'endBreak' && command !== 'snooze') throw new Error('不允许的操作')
    if (entry.view === 'tray-menu') {
      if (!['start', 'pause', 'resume', 'resetTimer'].includes(command)) throw new Error('不允许的操作')
      hideTrayCard()
    }
    engine.command(command)
    if (['start', 'pause', 'pause30', 'pause60', 'pauseUntilTomorrow', 'resume', 'resetTimer', 'snooze'].includes(command)) persist()
  })
  ipcMain.handle('remind:settings', (event, input: unknown) => {
    trusted(event, ['panel'])
    const settings = settingsSchema.parse(input)
    try { preferences.write({ ...engine.getPreferences(), settings }) }
    catch (error) { engine.setStorageError(true); log.error(error); throw new Error('设置保存失败，请重试') }
    engine.updateSettings(settings); engine.setStorageError(false)
    meetings?.configure(settings.meetingPause)
  })
  ipcMain.handle('remind:update', async (event, input: unknown) => {
    trusted(event, ['panel'])
    const action = z.enum(['check', 'download', 'install', 'releases']).parse(input)
    if (action === 'releases') { await shell.openExternal(releasesUrl); return }
    await updates.action(action)
  })
  ipcMain.handle('remind:panel', (event, input: unknown) => {
    trusted(event, ['panel'])
    panelSettingsOpen = z.boolean().parse(input)
    placePanel(false)
  })
  ipcMain.handle('remind:panel-size', (event, input: unknown) => {
    const entry = trusted(event, ['panel'])
    const height = z.number().int().min(200).max(1200).parse(input)
    if (panelSettingsOpen || engine.snapshot.preparingBreak || engine.snapshot.phase === 'break') return
    panelContentHeight = height
    if (!entry.window.isVisible() || entry.window.isMinimized()) return
    const bounds = entry.window.getBounds()
    const area = screen.getDisplayMatching(bounds).workArea
    const next = fitPanelHeight(bounds, area, height, process.platform)
    if (bounds.height !== next.height || bounds.y !== next.y) entry.window.setBounds(next, false)
  })
  ipcMain.handle('remind:window', (event, input: unknown) => {
    const entry = trusted(event, ['panel'])
    const action = z.enum(['minimize', 'quit']).parse(input)
    if (action === 'minimize') minimizePanel(entry.window)
    else quitApp()
  })
  ipcMain.handle('remind:launch-at-login', (event, input: unknown) => {
    trusted(event, ['panel'])
    const enabled = z.boolean().parse(input)
    if (process.platform !== 'darwin' && process.platform !== 'win32') {
      loginItem = { openAtLogin: false, status: 'unsupported', approvalNeeded: false, message: '当前系统不支持开机自启动' }
      engine.setLoginItem(false, true)
      return { openAtLogin: false, message: loginItem.message, approvalNeeded: false }
    }
    engine.setLoginItem(enabled, true)
    applyLoginItem(enabled)
    persistLogin()
    broadcast()
    return { openAtLogin: loginItem.openAtLogin, message: loginItem.message, approvalNeeded: loginItem.approvalNeeded }
  })
  ipcMain.handle('remind:launch-at-login-refresh', (event, force: unknown) => { trusted(event, ['panel']); refreshLoginFromOs(z.boolean().parse(force ?? false)) })
  ipcMain.handle('remind:login-item-settings', event => { trusted(event, ['panel']); loginRefreshRequired = true; return shell.openExternal(loginItemsSettingsUrl) })
  ipcMain.handle('remind:tray', (event, input: unknown) => {
    trusted(event, ['tray-menu'])
    const action = z.enum(['open', 'enter', 'leave', 'quit']).parse(input)
    if (action === 'open') showPanel()
    else if (action === 'quit') quitApp()
    else if (action === 'enter') trayHover?.enterCard()
    else trayHover?.leave()
  })
  ipcMain.handle('remind:meeting', async (event, input: unknown) => {
    trusted(event, ['panel'])
    const action = z.enum(['ignore', 'permissions', 'refresh']).parse(input)
    if (action === 'ignore') meetings?.ignore()
    else if (action === 'refresh') await meetings?.checkNow()
    else if (process.platform === 'darwin') {
      // Register the running app in the OS authorization flow, rather than leaving users to guess which app to add.
      systemPreferences.isTrustedAccessibilityClient(true)
      await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')
    }
  })
  ipcMain.handle('remind:ready', event => { trusted(event); readiness.get(event.sender.id)?.(); readiness.delete(event.sender.id) })
}
function loginPlatform(): 'darwin' | 'win32' | null {
  return process.platform === 'darwin' || process.platform === 'win32' ? process.platform : null
}
function installLocation() {
  if (process.platform !== 'darwin') return 'unsupported' as const
  return classifyInstallLocation(app.getPath('exe'), app.isInApplicationsFolder())
}
function applyLoginItem(enabled: boolean) { loginItem = loginItems.apply(enabled) }
function persistLogin() {
  try { preferences.write(engine.getPreferences()); engine.setStorageError(false) }
  catch (error) { engine.setStorageError(true); log.error(error); throw new Error('开机自启动状态无法保存，请重试') }
}
function refreshLoginFromOs(force = false) {
  if (!engine) return
  if (!force && performance.now() - lastLoginRefresh < 15_000) return
  lastLoginRefresh = performance.now()
  const prefs = engine.getPreferences()
  loginItem = loginItems.refresh(desiredOpenAtLogin(prefs.loginItemChosen, prefs.openAtLogin))
  broadcast()
}
function setupTray() {
  const icon = () => {
    const image = nativeImage.createFromBuffer(Buffer.from(process.platform === 'win32' && nativeTheme.shouldUseDarkColors ? trayWhitePng : trayPng, 'base64')).resize({ width: 18, height: 18 })
    image.setTemplateImage(process.platform === 'darwin')
    return image
  }
  tray = new Tray(icon())
  nativeTheme.on('updated', () => tray?.setImage(icon()))
  trayHover = new TrayHover({
    prepare: prepareTrayCard,
    canShow: () => !quitting && !panel?.isVisible() && !engine.snapshot.preparingBreak && engine.snapshot.phase !== 'break',
    show: showTrayCard, hide: () => { if (trayCard && !trayCard.isDestroyed()) trayCard.hide() }, report: error => log.error('Tray hover failed', error),
  })
  tray.on('click', () => { hideTrayCard(); if (panel?.isVisible()) panel.hide(); else showPanel() })
  if (process.platform === 'darwin') tray.setIgnoreDoubleClickEvents(true)
  tray.on('mouse-enter', () => trayHover?.enter())
  tray.on('mouse-leave', () => trayHover?.leave())
  let contextMenu: Menu
  tray.on('right-click', () => { hideTrayCard(); panel?.hide(); if (contextMenu) tray?.popUpContextMenu(contextMenu) })
  const rebuildMenu = () => {
    const s = engine.snapshot
    contextMenu = Menu.buildFromTemplate([
      { label: '打开看板', click: showPanel },
      { label: s.phase === 'ready' ? '开始提醒' : s.pauseReasons.includes('manual') ? '继续提醒' : '暂停提醒', click: () => { engine.command(s.phase === 'ready' ? 'start' : s.pauseReasons.includes('manual') ? 'resume' : 'pause'); persist() } },
      { label: '重置计时', click: () => { engine.command('resetTimer'); persist() } },
      { type: 'separator' }, { label: '退出 remind', click: quitApp },
    ])
  }
  let menuKey = ''
  let statusKey = ''
  const refreshStatus = () => {
    const { title, tooltip } = trayPresentation(engine.snapshot)
    const next = `${title}\n${tooltip}`
    if (next === statusKey) return
    statusKey = next
    // setTitle is macOS-only. A leading space separates the template icon from the live text.
    if (process.platform === 'darwin') tray?.setTitle(title ? ` ${title}` : '')
    if (process.platform !== 'darwin') tray?.setToolTip(`${tooltip}\n点击打开看板 · 右键快捷操作`)
  }
  engine.subscribe(() => {
    refreshStatus()
    const key = JSON.stringify([engine.snapshot.phase, engine.snapshot.pauseReasons, Boolean(engine.snapshot.preparingBreak)])
    if (key !== menuKey) { menuKey = key; rebuildMenu() }
  })
  refreshStatus()
  rebuildMenu()
}
// A source-owned monochrome glyph; kept embedded so packaged paths cannot go missing.
const trayPng = 'iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAYAAADhAJiYAAAASElEQVR4nO3OuQkAIAAEQXsRBPsvUDvQwF8m2OTgYELMKdzUcQDQ96DSaMkX6AZQbwMCAgICAgICAgICmvgFGgVt7zgA6HlQBauBcB5bXUM4AAAAAElFTkSuQmCC'

const trayWhitePng = 'iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAYAAADhAJiYAAAAR0lEQVR4nO3OuQkAIAAEQfvvVzHTDjTwlwk2OTiYEHMKN3UcAPQ9qDRa8gW6AdTbgICAgICAgICAgIAmfoFGQds7DgB6HlQB4bnM4oc+4JkAAAAASUVORK5CYII='

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => { if (engine) showPanel() })
  app.on('window-all-closed', () => {})
  app.on('activate', () => { if (engine) showPanel() })
  app.on('before-quit', () => { quitting = true; hideTrayCard(); engine?.shutdown(); clearInterval(tickTimer); clearTimeout(recoveryTimer); updates?.stop(); meetings?.stop() })
  void app.whenReady().then(async () => {
    log.initialize(); log.transports.file.maxSize = 1024 * 1024
    Menu.setApplicationMenu(null)
    if (process.platform === 'darwin') app.dock?.hide()
    preferences = new PreferencesStore(app.getPath('userData'))
    loginItems = new LoginItems(loginPlatform(), app.isPackaged, {
      read: query => app.getLoginItemSettings(query),
      write: request => app.setLoginItemSettings(request),
      location: installLocation,
      report: error => log.error('Login item unavailable', error),
    })
    loginItem = loginItems.refresh(preferences.initial.openAtLogin)
    lastLoginRefresh = performance.now()
    const loginReading = loginItems.launchReading
    const chosen = preferences.initial.loginItemChosen
    const desired = desiredOpenAtLogin(chosen, preferences.initial.openAtLogin)
    if (loginItem.openAtLogin !== desired && !loginItem.approvalNeeded) applyLoginItem(desired)
    const initial = { ...preferences.initial, openAtLogin: desired, loginItemChosen: chosen }
    if (preferences.initial.openAtLogin !== desired || preferences.initial.loginItemChosen !== chosen) {
      try { preferences.write(initial) } catch (error) { log.error('Cannot sync login item', error) }
    }
    const openedHidden = launchedHidden(process.argv, loginReading)
    engine = new ReminderEngine({ monotonic: () => performance.now(), now: () => new Date() }, initial)
    engine.setStorageError(preferences.recovered)
    if (initial.manualPaused !== engine.getPreferences().manualPaused || initial.pauseUntil !== engine.getPreferences().pauseUntil) persist()
    let history: HistoryStore | undefined
    try { history = new HistoryStore(app.getPath('userData')) }
    catch (error) { log.error('History unavailable; reminders remain active', error) }
    engine.onEvent(event => { try { history?.append(event) } catch (error) { log.error('Cannot save break history', error) } })
    const nativeDirectory = app.isPackaged ? join(process.resourcesPath, 'native') : join(app.getAppPath(), 'desktop/native/bin')
    const probe = process.platform === 'darwin' ? macMeetingProbe(join(nativeDirectory, 'meeting-probe.node')) : () => nativeMeetingProbe(join(nativeDirectory, 'meeting-probe.exe'))
    meetings = new MeetingService(() => ['darwin', 'win32'].includes(process.platform) ? probe() : Promise.resolve({ protocol: 1, permission: 'unsupported', apps: [] }), state => {
      const wasMeeting = engine.snapshot.pauseReasons.includes('meeting')
      const previousStatus = engine.snapshot.meeting?.status
      engine.setMeeting(state)
      const isMeeting = engine.snapshot.pauseReasons.includes('meeting')
      if (!quitting && wasMeeting !== isMeeting) {
        const names = state.apps.map(id => meetingNames[id]).join('、')
        notifySystem(isMeeting ? '会议中，提醒已暂停' : state.status === 'ignored' || state.status === 'disabled' ? '已停止会议自动暂停' : '会议已结束', isMeeting ? names : engine.snapshot.pauseReasons.length ? '其他暂停仍生效' : '下一轮将重新计时')
      }
      if (!quitting && state.status === 'confirmation' && previousStatus !== 'confirmation') notifySystem('会议状态待确认', '提醒仍暂停，可在看板中选择本次忽略')
    })
    const { autoUpdater } = electronUpdater
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.allowPrerelease = false
    autoUpdater.allowDowngrade = false
    autoUpdater.logger = log
    const port: UpdatePort = {
      subscribe(listener) {
        autoUpdater.on('update-available', info => listener({ type: 'available', version: info.version }))
        autoUpdater.on('update-not-available', () => listener({ type: 'current' }))
        autoUpdater.on('download-progress', info => listener({ type: 'progress', percent: info.percent }))
        autoUpdater.on('update-downloaded', info => listener({ type: 'downloaded', version: info.version }))
        autoUpdater.on('error', error => { log.error('Update failed', error); listener({ type: 'error', error }) })
      },
      async check() { await autoUpdater.checkForUpdates() },
      async download() { await autoUpdater.downloadUpdate() },
      install() { autoUpdater.quitAndInstall(false, true) },
    }
    const packagedUpdates = app.isPackaged && existsSync(join(process.resourcesPath, 'app-update.yml')) && (process.platform === 'darwin' || process.platform === 'win32')
    // Start with the safe manual path. Signature inspection must not delay the UI or IPC registration.
    const delivery = process.platform === 'darwin' ? 'browser' : 'native'
    updates = new Updates(port, app.getVersion(), packagedUpdates, () => !engine.snapshot.preparingBreak && engine.snapshot.phase !== 'break' && !engine.snapshot.pauseReasons.some(reason => ['meeting', 'locked', 'suspended', 'updating'].includes(reason)), app.isPackaged ? '此测试包不支持在线更新' : undefined, delivery)
    updates.onDiscovered(version => {
      if (quitting) return
      const browser = updates?.snapshot.delivery === 'browser'
      notifySystem('发现新版本', browser ? `remind ${version} 已发布，点击打开下载页面` : `remind ${version} 已发布，可在看板中下载并安装`, () => {
        if (browser) void shell.openExternal(releasesUrl).catch(error => log.error('Cannot open release page', error))
        else showPanel()
      })
    })
    updates.arm()
    setupIpc(); setupTray()
    if (packagedUpdates && process.platform === 'darwin') void macNativeUpdateSupported().then(supported => { if (!quitting) updates.setDelivery(supported ? 'native' : 'browser') })
    engine.subscribe(() => { meetings?.suspend(engine.snapshot.pauseReasons.some(reason => reason === 'locked' || reason === 'suspended')); broadcast(); syncWindows() })
    updates.subscribe(() => { engine.setSystemPause('updating', updates?.snapshot.status === 'installing'); broadcast() })
    nativeAutoUpdater.on('before-quit-for-update', () => { quitting = true })
    powerMonitor.on('suspend', () => { clearTimeout(recoveryTimer); engine.setSystemPause('suspended', true) })
    powerMonitor.on('resume', () => {
      clearTimeout(recoveryTimer)
      recoveryTimer = setTimeout(() => {
        if (powerMonitor.getSystemIdleState(60) === 'locked') engine.setSystemPause('locked', true)
        engine.setSystemPause('suspended', false)
      }, 2000)
    })
    powerMonitor.on('lock-screen', () => engine.setSystemPause('locked', true))
    powerMonitor.on('unlock-screen', () => engine.setSystemPause('locked', false))
    if (powerMonitor.getSystemIdleState(60) === 'locked') engine.setSystemPause('locked', true)
    meetings.configure(initial.settings.meetingPause)
    const displaysChanged = () => { refreshBreakDisplays(); if (panel?.isVisible()) placePanel() }
    screen.on('display-added', displaysChanged); screen.on('display-removed', displaysChanged); screen.on('display-metrics-changed', displaysChanged)
    tickTimer = setInterval(() => { engine.tick(); if (engine.takePauseExpired()) persist() }, 250)
    if (!openedHidden) showPanel()
    else openPanel(false)
    setTimeout(() => { if (!quitting) void prepareTrayCard().catch(error => log.error('Tray warmup failed', error)) }, 1000)
  }).catch(error => { log.error('Startup failed', error); dialog.showErrorBox('remind 无法启动', '请检查本地数据目录是否可写，然后重试。'); quitting = true; app.quit() })
}
