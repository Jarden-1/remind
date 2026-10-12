import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Check, Coffee, X } from 'lucide-react'
import type { ReminderClient, PreviewControls } from './contracts/reminder'
import { Panel } from './features/Panel'
import { Settings } from './features/Settings'
import { BreakScreen } from './features/BreakScreen'
import { PreviewToolbar } from './features/PreviewToolbar'
import { Chime } from './lib/sound'

export function App({ client, preview }: { client: ReminderClient; preview?: PreviewControls }) {
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [toast, setToast] = useState('')
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const chime = useRef(new Chime())
  const wasBreak = useRef(false)
  const previousMeeting = useRef(snapshot.pauseReasons.includes('meeting'))
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  const dark = snapshot.settings.theme === 'dark' || (snapshot.settings.theme === 'system' && systemDark)
  function notify(message: string) { clearTimeout(toastTimer.current); setToast(message); toastTimer.current = setTimeout(() => setToast(''), 4000) }
  function playSound() { void chime.current.play().catch(() => notify('浏览器暂时无法播放铃声，请先与页面交互后重试。')) }
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const update = () => setSystemDark(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light' }, [dark])
  useEffect(() => {
    const isBreak = snapshot.phase === 'break'
    if (isBreak && !wasBreak.current && snapshot.settings.sound) playSound()
    if (!isBreak || !snapshot.settings.sound) chime.current.stop()
    wasBreak.current = isBreak
  }, [snapshot.phase, snapshot.settings.sound])
  useEffect(() => {
    const meeting = snapshot.pauseReasons.includes('meeting')
    if (meeting !== previousMeeting.current) {
      notify(meeting ? '检测到会议，提醒已暂停（模拟）' : snapshot.pauseReasons.includes('manual') ? '会议已结束，手动暂停仍生效' : '会议已结束，下一轮将重新计时')
      previousMeeting.current = meeting
    }
  }, [snapshot.pauseReasons])
  useEffect(() => () => { clearTimeout(toastTimer.current); chime.current.stop() }, [])
  const breaking = snapshot.phase === 'break'
  return <>
    <main className="preview-stage" hidden={breaking}><div className="window-wrap">{settingsOpen ? <Settings settings={snapshot.settings} client={client} onClose={() => setSettingsOpen(false)} notify={notify} playSound={playSound} /> : <Panel snapshot={snapshot} client={client} onSettings={() => setSettingsOpen(true)} notify={notify} />}</div>{preview && <PreviewToolbar controls={preview} snapshot={snapshot} />}</main>
    {breaking && <BreakScreen snapshot={snapshot} client={client} notify={notify} />}
    {!breaking && snapshot.preReminderVisible && <aside className="pre-reminder" role="status"><span className="pre-icon"><Coffee size={21} /></span><div><strong>还有 1 分钟休息</strong><p>可以准备收尾了。</p></div><button className="icon-button" aria-label="关闭提前提醒" onClick={() => void client.dismissPreReminder()}><X size={16} /></button><span className="pre-reminder-line" /></aside>}
    {toast && <div className="toast" role="status"><Check size={16} />{toast}</div>}
  </>
}
