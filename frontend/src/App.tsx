import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Info, X } from 'lucide-react'
import type { ReminderClient, PreviewControls } from './contracts/reminder'
import { errorMessage } from './lib/errors'
import { Panel } from './features/Panel'
import { Settings } from './features/Settings'
import { BreakScreen } from './features/BreakScreen'
import { PreviewToolbar } from './features/PreviewToolbar'
import { Chime } from './lib/sound'
import type { DesktopView } from '../../shared/desktop'
import type { ShellClient, UpdateClient } from './services/desktop-client'
import type { Theme } from '../../shared/reminder'
import { TrayActions } from './features/TrayActions'

export function App({ client, preview, updates, shell, desktopView, desktopSound = false }: { client: ReminderClient; preview?: PreviewControls; updates?: UpdateClient; shell?: ShellClient; desktopView?: DesktopView; desktopSound?: boolean }) {
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [previewTheme, setPreviewTheme] = useState<Theme | null>(null)
  const restoreSettingsFocus = useRef(false)
  const keyboardInput = useRef(false)
  const [toast, setToast] = useState('')
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const chime = useRef(new Chime())
  const wasBreak = useRef(false)
  const previousMeeting = useRef(snapshot.pauseReasons.includes('meeting'))
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  const theme = previewTheme ?? snapshot.settings.theme
  const dark = theme === 'dark' || (theme === 'system' && systemDark)
  function openSettings() { setSettingsOpen(true) }
  function closeSettings() { restoreSettingsFocus.current = true; setPreviewTheme(null); setSettingsOpen(false) }
  useEffect(() => {
    if (settingsOpen || !restoreSettingsFocus.current) return
    restoreSettingsFocus.current = false
    document.querySelector<HTMLElement>(keyboardInput.current ? '[aria-label="打开设置"]' : '.panel')?.focus({ preventScroll: true })
  }, [settingsOpen])
  useEffect(() => {
    const keyboard = () => { keyboardInput.current = true }
    const pointer = () => { keyboardInput.current = false }
    const focusPanel = () => document.querySelector<HTMLElement>('.panel')?.focus({ preventScroll: true })
    window.addEventListener('keydown', keyboard, true)
    window.addEventListener('pointerdown', pointer, true)
    if (desktopView === 'panel') focusPanel()
    const unsubscribe = desktopView === 'panel' ? window.remind?.onPanelShown?.(focusPanel) : undefined
    return () => { window.removeEventListener('keydown', keyboard, true); window.removeEventListener('pointerdown', pointer, true); unsubscribe?.() }
  }, [desktopView])
  function notify(message: string) { clearTimeout(toastTimer.current); setToast(message); toastTimer.current = setTimeout(() => setToast(''), 4000) }
  function playSound() { void chime.current.play().catch(() => notify('暂时无法播放铃声，请重试')) }
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const update = () => setSystemDark(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light' }, [dark])
  useEffect(() => {
    const isBreak = snapshot.phase === 'break'
    if (isBreak && !wasBreak.current && snapshot.settings.sound && (!desktopView || desktopSound)) playSound()
    if (!isBreak || !snapshot.settings.sound) chime.current.stop()
    wasBreak.current = isBreak
  }, [snapshot.phase, snapshot.settings.sound])
  useEffect(() => { if (desktopView === 'panel') void window.remind?.panel(settingsOpen).catch(error => notify(errorMessage(error))) }, [settingsOpen, desktopView])
  useEffect(() => {
    if (desktopView !== 'panel' || settingsOpen || !window.remind) return
    const content = document.querySelector<HTMLElement>('.panel-content')
    const header = document.querySelector<HTMLElement>('.panel > .window-header')
    if (!content || !header) return
    let previous = 0
    const measure = () => {
      const height = Math.ceil(content.getBoundingClientRect().height + header.getBoundingClientRect().height)
      if (height === previous) return
      previous = height
      void window.remind?.resizePanel(height).catch(error => notify(errorMessage(error)))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(content); observer.observe(header); measure()
    return () => observer.disconnect()
  }, [desktopView, settingsOpen])
  useEffect(() => { if (desktopView) void window.remind?.ready().catch(error => notify(errorMessage(error))) }, [desktopView])
  useEffect(() => {
    const meeting = snapshot.pauseReasons.includes('meeting')
    if (meeting !== previousMeeting.current) {
      const ended = snapshot.meeting?.status === 'ignored' ? '已忽略本次会议识别' : snapshot.meeting?.status === 'disabled' ? '会议自动暂停已关闭' : '会议已结束'
      notify(meeting ? `检测到会议，提醒已暂停${preview ? '（模拟）' : ''}` : `${ended}${snapshot.pauseReasons.length ? '，其他暂停仍生效' : snapshot.phase === 'ready' ? '' : '，下一轮将重新计时'}`)
      previousMeeting.current = meeting
    }
  }, [snapshot.pauseReasons])
  useEffect(() => () => { clearTimeout(toastTimer.current); chime.current.stop() }, [])
  const breaking = snapshot.phase === 'break'
  const preReminder = <aside className="pre-reminder" role="status"><span>1 分钟后休息</span><button className="icon-button" aria-label="关闭提前提醒" onClick={() => void client.dismissPreReminder().catch(error => notify(errorMessage(error)))}><X size={14} strokeWidth={1.6} /></button></aside>
  const feedback = toast && <div className="toast" role="status"><Info size={16} />{toast}</div>
  if (desktopView === 'notice') return <>{snapshot.preReminderVisible && preReminder}{feedback}</>
  if (desktopView === 'tray-menu') return <TrayActions snapshot={snapshot} client={client} />
  if (desktopView === 'break') return <><BreakScreen snapshot={snapshot} client={client} notify={notify} desktop />{feedback}</>
  return <>
    <main className="preview-stage" hidden={breaking && !desktopView}><div className="window-wrap">{settingsOpen ? <Settings settings={snapshot.settings} client={client} updates={updates} shell={shell} onClose={closeSettings} onPreviewTheme={setPreviewTheme} notify={notify} playSound={playSound} /> : <Panel snapshot={snapshot} client={client} updates={updates} shell={shell} onSettings={openSettings} notify={notify} />}</div>{preview && <PreviewToolbar controls={preview} snapshot={snapshot} />}</main>
    {breaking && !desktopView && <BreakScreen snapshot={snapshot} client={client} notify={notify} />}
    {!desktopView && !breaking && snapshot.preReminderVisible && preReminder}
    {feedback}
  </>
}
