import { app, autoUpdater as nativeAutoUpdater, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, Notification, powerMonitor, screen, shell, Tray, type IpcMainInvokeEvent } from 'electron'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { existsSync } from 'node:fs'
import log from 'electron-log/main'
import electronUpdater from 'electron-updater'
import { z } from 'zod'
import { commands, type DesktopView, type DesktopState } from '../../shared/desktop'
import { settingsSchema } from '../domain/validation'
import { ReminderEngine } from '../domain/reminder-engine'
import { PreferencesStore, HistoryStore } from '../services/preferences'
import { macNativeUpdateSupported } from '../services/code-signature'
import { Updates, type UpdatePort } from '../services/updates'
import { trayPresentation } from '../domain/tray-status'

const here = dirname(fileURLToPath(import.meta.url))
const releasesUrl = 'https://github.com/Jarden-1/remind/releases'
app.setName('remind')
let quitting = false
let panel: BrowserWindow | null = null
let notice: BrowserWindow | null = null
let tray: Tray | null = null
let engine: ReminderEngine
let updates!: Updates
let preferences: PreferencesStore
const managed = new Map<number, { window: BrowserWindow; view: DesktopView; url: string }>()
const readiness = new Map<number, () => void>()
let breakWindows: BrowserWindow[] = []
let restorePanelAfterBreak = false
const windowDisplays = new Map<number, number>()
let preparingGeneration: number | null = null
let tickTimer: ReturnType<typeof setInterval> | undefined
let recoveryTimer: ReturnType<typeof setTimeout> | undefined

function state(): DesktopState { return { reminder: engine.snapshot, update: updates.snapshot } }
function broadcast() {
  for (const { window, view } of managed.values()) if (!window.isDestroyed() && (window.isVisible() || view === 'break')) window.webContents.send('remind:changed', state())
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
function showPanel() {
  if (breakWindows.length && (engine.snapshot.phase === 'break' || engine.snapshot.preparingBreak)) {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const active = breakWindows.find(window => windowDisplays.get(window.id) === display.id) ?? breakWindows[0]
    if (!active.isDestroyed() && active.isVisible()) active.focus()
    return
  }
  if (!panel || panel.isDestroyed()) {
    const created = makeWindow('panel', { width: 368, height: 420, resizable: false, frame: false, skipTaskbar: true, alwaysOnTop: true })
    panel = created.window
    panel.on('close', event => { if (!quitting) { event.preventDefault(); panel?.hide() } })
    void created.load().then(() => placePanel()).catch(error => log.error('Panel failed to load', error))
  } else { placePanel(); broadcast() }
}
function placePanel() {
  if (!panel || panel.isDestroyed()) return
  const anchor = tray?.getBounds()
  const point = anchor && anchor.width > 0 ? { x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height / 2 } : screen.getCursorScreenPoint()
  const area = screen.getDisplayNearestPoint(point).workArea
  const [width, height] = panel.getSize()
  const x = Math.max(area.x + 8, Math.min(point.x - width / 2, area.x + area.width - width - 8))
  const y = Math.max(area.y + 8, Math.min(process.platform === 'darwin' ? area.y + 8 : area.y + area.height - height - 8, area.y + area.height - height - 8))
  panel.setPosition(Math.round(x), Math.round(y)); panel.show(); panel.focus()
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
  const failed = () => { if (engine.generation === generation && breakWindows.includes(window)) engine.failBreak(generation) }
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
  if (engine.snapshot.preparingBreak) { engine.failBreak(generation); return }
  if (engine.snapshot.phase !== 'break') return
  const displays = screen.getAllDisplays()
  const removed = breakWindows.filter(window => !displays.some(display => display.id === windowDisplays.get(window.id)))
  breakWindows = breakWindows.filter(window => !removed.includes(window))
  for (const window of removed) { windowDisplays.delete(window.id); if (!window.isDestroyed()) window.destroy() }
  for (const display of displays) {
    const existing = breakWindows.find(window => windowDisplays.get(window.id) === display.id)
    if (existing) {
      try { coverDisplay(existing, display) }
      catch (error) { log.error(error); engine.failBreak(generation); return }
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
      .catch(error => { log.error(error); if (engine.generation === generation && breakWindows.includes(created.window)) engine.failBreak(generation) })
      .finally(() => clearTimeout(timeout))
  }
  if (removed.length) breakWindows[0]?.focus()
}
async function prepareBreak(generation: number) {
  preparingGeneration = generation
  closeBreakWindows()
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const displays = screen.getAllDisplays()
    const primary = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const pending = displays.map(display => {
      return makeBreakWindow(display, generation, display.id === primary.id).loaded
    })
    await Promise.race([Promise.all(pending), new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('Break readiness timed out')), 5000) })])
    engine.tick()
    if (powerMonitor.getSystemIdleState(60) === 'locked') engine.setSystemPause('locked', true)
    if (engine.generation !== generation || !engine.snapshot.preparingBreak) return
    restorePanelAfterBreak = panel?.isVisible() ?? false
    panel?.hide()
    for (const window of breakWindows) {
      const display = screen.getAllDisplays().find(item => item.id === windowDisplays.get(window.id))
      if (!display) throw new Error('Display disconnected while opening break')
      coverDisplay(window, display, true)
    }
    breakWindows.find(window => windowDisplays.get(window.id) === primary.id)?.focus()
    if (!engine.confirmBreak(generation)) closeBreakWindows()
  } catch (error) {
    log.error('Break display failed', error)
    if (engine.generation === generation) {
      engine.failBreak(generation)
      if (Notification.isSupported()) new Notification({ title: '该起来活动一下了', body: '休息窗口未能打开', silent: true }).show()
    }
  } finally { clearTimeout(timeout); if (preparingGeneration === generation) preparingGeneration = null }
}
function syncWindows() {
  const s = engine.snapshot
  if (s.preparingBreak && preparingGeneration !== engine.generation) void prepareBreak(engine.generation)
  if (!s.preparingBreak && s.phase !== 'break') closeBreakWindows()
  if (s.preReminderVisible && !notice) {
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    const created = makeWindow('notice', { width: 330, height: 96, x: area.x + area.width - 346, y: area.y + 16, frame: false, resizable: false, skipTaskbar: true, alwaysOnTop: true })
    notice = created.window
    notice.on('closed', () => { notice = null })
    void created.load().then(() => { if (engine.snapshot.preReminderVisible && !created.window.isDestroyed()) created.window.showInactive() }).catch(error => log.error(error))
  } else if (!s.preReminderVisible && notice) { const old = notice; notice = null; old.destroy() }
}
function trusted(event: IpcMainInvokeEvent, views: DesktopView[] = ['panel', 'break', 'notice']) {
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
    if (entry.view === 'break' && command !== 'endBreak') throw new Error('不允许的操作')
    engine.command(command)
    if (['start', 'pause', 'resume'].includes(command)) persist()
  })
  ipcMain.handle('remind:settings', (event, input: unknown) => {
    trusted(event, ['panel'])
    const settings = settingsSchema.parse(input)
    try { preferences.write({ ...engine.getPreferences(), settings }) }
    catch (error) { engine.setStorageError(true); log.error(error); throw new Error('设置保存失败，请重试') }
    engine.updateSettings(settings); engine.setStorageError(false)
  })
  ipcMain.handle('remind:update', async (event, input: unknown) => {
    trusted(event, ['panel'])
    const action = z.enum(['check', 'download', 'install', 'releases']).parse(input)
    if (action === 'releases') { await shell.openExternal(releasesUrl); return }
    await updates.action(action)
  })
  ipcMain.handle('remind:panel', (event, input: unknown) => {
    const entry = trusted(event, ['panel'])
    const open = z.boolean().parse(input)
    const area = screen.getDisplayMatching(entry.window.getBounds()).workArea
    entry.window.setSize(368, open ? Math.min(740, area.height - 24) : 420)
    placePanel()
  })
  ipcMain.handle('remind:ready', event => { trusted(event); readiness.get(event.sender.id)?.(); readiness.delete(event.sender.id) })
}
function setupTray() {
  const icon = () => {
    const image = nativeImage.createFromBuffer(Buffer.from(process.platform === 'win32' && nativeTheme.shouldUseDarkColors ? trayWhitePng : trayPng, 'base64')).resize({ width: 18, height: 18 })
    image.setTemplateImage(process.platform === 'darwin')
    return image
  }
  tray = new Tray(icon())
  nativeTheme.on('updated', () => tray?.setImage(icon()))
  tray.on('click', () => { if (panel?.isVisible()) panel.hide(); else showPanel() })
  const rebuildMenu = () => {
    const s = engine.snapshot
    tray?.setContextMenu(Menu.buildFromTemplate([
      { label: '打开看板', click: showPanel },
      { label: s.phase === 'ready' ? '开始提醒' : s.pauseReasons.includes('manual') ? '继续提醒' : '暂停提醒', click: () => { engine.command(s.phase === 'ready' ? 'start' : s.pauseReasons.includes('manual') ? 'resume' : 'pause'); persist() } },
      { label: '现在休息', enabled: !s.pauseReasons.some(reason => ['locked', 'suspended', 'meeting', 'updating'].includes(reason)) && s.phase !== 'break' && !s.preparingBreak, click: () => engine.command('startBreak') },
      { type: 'separator' }, { label: '退出 remind', click: () => { quitting = true; app.quit() } },
    ]))
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
    tray?.setToolTip(tooltip)
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
  app.on('before-quit', () => { quitting = true; clearInterval(tickTimer); clearTimeout(recoveryTimer); updates?.stop() })
  void app.whenReady().then(async () => {
    log.initialize(); log.transports.file.maxSize = 1024 * 1024
    Menu.setApplicationMenu(null)
    if (process.platform === 'darwin') app.dock?.hide()
    preferences = new PreferencesStore(app.getPath('userData'))
    engine = new ReminderEngine({ monotonic: () => performance.now(), now: () => new Date() }, preferences.initial)
    engine.setStorageError(preferences.recovered)
    const history = new HistoryStore(app.getPath('userData'))
    engine.onEvent(event => { try { history.append(event) } catch (error) { log.error('Cannot save break history', error) } })
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
    const delivery = packagedUpdates && process.platform === 'darwin' && !await macNativeUpdateSupported() ? 'browser' : 'native'
    updates = new Updates(port, app.getVersion(), packagedUpdates, () => !engine.snapshot.preparingBreak && engine.snapshot.phase !== 'break' && !engine.snapshot.pauseReasons.some(reason => ['meeting', 'locked', 'suspended', 'updating'].includes(reason)), app.isPackaged ? '此测试包不支持在线更新' : undefined, delivery)
    updates.onDiscovered(version => {
      if (quitting || !Notification.isSupported()) return
      const browser = updates?.snapshot.delivery === 'browser'
      const notice = new Notification({ title: '发现新版本', body: browser ? `remind ${version} 已发布，点击打开下载页面` : `remind ${version} 已发布，可在看板中下载并安装`, silent: true })
      notice.on('click', () => { if (browser) void shell.openExternal(releasesUrl); else showPanel() })
      notice.show()
    })
    updates.arm()
    setupIpc(); setupTray()
    engine.subscribe(() => { broadcast(); syncWindows() })
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
    const displaysChanged = () => { refreshBreakDisplays(); if (panel?.isVisible()) placePanel() }
    screen.on('display-added', displaysChanged); screen.on('display-removed', displaysChanged); screen.on('display-metrics-changed', displaysChanged)
    tickTimer = setInterval(() => engine.tick(), 250)
    showPanel()
  }).catch(error => { log.error('Startup failed', error); dialog.showErrorBox('remind 无法启动', '请检查本地数据目录是否可写，然后重试。'); quitting = true; app.quit() })
}
