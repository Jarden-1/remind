import { useEffect, useRef } from 'react'
import { ArrowRight, Clock3, Maximize2, Volume2, VolumeX, PersonStanding } from 'lucide-react'
import type { ReminderClient, ReminderSnapshot } from '../contracts/reminder'
import { Brand } from '../components/Brand'
import { formatTime } from '../lib/format'

export function BreakScreen({ snapshot: s, client, notify }: { snapshot: ReminderSnapshot; client: ReminderClient; notify: (message: string) => void }) {
  const endButton = useRef<HTMLButtonElement>(null)
  async function end() {
    await client.endBreak()
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})
  }
  useEffect(() => {
    endButton.current?.focus()
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); void end() } }
    window.addEventListener('keydown', keydown)
    return () => { window.removeEventListener('keydown', keydown); if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}) }
    // The bridge instance is stable for the lifetime of the app.
  }, [client])
  return <main className="break-screen" aria-label="休息时间">
    <header className="break-header"><Brand small /><div><span>{s.settings.sound ? <Volume2 size={16} /> : <VolumeX size={16} />}{s.settings.sound ? '铃声已开启' : '静音休息'}</span><button className="icon-button" title="进入全屏" aria-label="进入全屏" onClick={() => { if (!document.fullscreenElement) void document.documentElement.requestFullscreen().catch(() => notify('当前浏览器不支持进入全屏')) }}><Maximize2 size={18} /></button></div></header>
    <div className="break-content"><span className="break-symbol" aria-hidden="true"><PersonStanding size={30} strokeWidth={1.4} /></span><h1>休息一下</h1><p>离开屏幕，起来活动一下。</p><div className="break-countdown"><Clock3 size={16} /><span>{formatTime(s.remainingSeconds)}</span><span className="countdown-caption">后继续</span></div></div>
    <footer className="break-footer"><button className="end-break" ref={endButton} onClick={() => void end()}>结束休息<ArrowRight size={18} /></button><span>也可以按 <kbd>esc</kbd> 提前结束</span></footer>
    <div className="break-progress" style={{ width: `${(1 - s.remainingSeconds / s.totalSeconds) * 100}%` }} />
  </main>
}
