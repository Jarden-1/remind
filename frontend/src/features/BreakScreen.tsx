import { useEffect, useRef } from 'react'
import { ArrowUpRight, Maximize2, Volume2, VolumeX } from 'lucide-react'
import type { ReminderClient, ReminderSnapshot } from '../contracts/reminder'
import { Brand } from '../components/Brand'
import { formatTime } from '../lib/format'

export function BreakScreen({ snapshot: s, client, notify, desktop = false }: { snapshot: ReminderSnapshot; client: ReminderClient; notify: (message: string) => void; desktop?: boolean }) {
  const surface = useRef<HTMLElement>(null)
  async function leave(action: 'end' | 'snooze') {
    if (action === 'snooze') await client.snooze()
    else await client.endBreak()
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})
  }
  useEffect(() => {
    const focusSurface = () => surface.current?.focus({ preventScroll: true })
    focusSurface()
    window.addEventListener('focus', focusSurface)
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); void leave('end') } }
    window.addEventListener('keydown', keydown)
    return () => { window.removeEventListener('focus', focusSurface); window.removeEventListener('keydown', keydown); if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}) }
    // The bridge instance is stable for the lifetime of the app.
  }, [client])
  const progress = Math.max(0, Math.min(1, 1 - s.remainingSeconds / s.totalSeconds))
  return <main className="break-screen" aria-label="休息时间" ref={surface} tabIndex={-1}>
    <header className="break-header">
      <Brand small />
      <div className="break-utilities">
        <span className="break-sound" role="img" aria-label={s.settings.sound ? '铃声已开启' : '静音休息'} title={s.settings.sound ? '铃声已开启' : '静音休息'}>{s.settings.sound ? <Volume2 size={16} /> : <VolumeX size={16} />}</span>
        {!desktop && <button className="icon-button" title="进入全屏" aria-label="进入全屏" onClick={() => { if (!document.fullscreenElement) void document.documentElement.requestFullscreen().catch(() => notify('当前浏览器不支持进入全屏')) }}><Maximize2 size={16} /></button>}
      </div>
    </header>
    <section className="break-content" aria-labelledby="break-title">
      <div className="rest-sculpture" aria-hidden="true"><div className="rest-stones"><span /><span /></div><span className="rest-shadow" /></div>
      <h1 id="break-title">休息一下</h1>
      <p>起身走走，放松一下。</p>
      <div className="break-countdown" aria-label={`剩余 ${formatTime(s.remainingSeconds)}`}>
        <div><span className="break-time">{formatTime(s.remainingSeconds)}</span><span className="countdown-caption">后继续</span></div>
        <div className="break-progress" role="progressbar" aria-label="休息进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><span style={{ transform: `scaleX(${progress})` }} /></div>
      </div>
      <footer className="break-footer">
        <button className="end-break" onClick={() => void leave('snooze')}>再给我 5 分钟</button>
        <button className="end-break" onClick={() => void leave('end')}>跳过这次<ArrowUpRight size={15} /><kbd>esc</kbd></button>
      </footer>
    </section>
  </main>
}
