import { useEffect, useRef } from 'react'
import { Maximize2 } from 'lucide-react'
import type { ReminderClient, ReminderSnapshot } from '../contracts/reminder'
import { errorMessage } from '../lib/errors'
import { formatTime } from '../lib/format'

export function BreakScreen({ snapshot: s, client, notify, desktop = false }: { snapshot: ReminderSnapshot; client: ReminderClient; notify: (message: string) => void; desktop?: boolean }) {
  const surface = useRef<HTMLElement>(null)
  async function leave(action: 'end' | 'snooze') {
    try {
      if (action === 'snooze') await client.snooze()
      else await client.endBreak()
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})
    } catch (error) { notify(errorMessage(error)) }
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
  // Native windows paint once before confirmation starts the shared break clock.
  const preparing = desktop && s.phase !== 'break'
  const total = preparing ? (s.plannedBreakSeconds ?? s.settings.breakMinutes * 60) : s.totalSeconds
  const remaining = preparing ? total : s.remainingSeconds
  return <main className="break-screen" aria-label="休息时间" ref={surface} tabIndex={-1}>
    {!desktop && <button className="icon-button break-fullscreen" title="进入全屏" aria-label="进入全屏" onClick={() => { if (!document.fullscreenElement) void document.documentElement.requestFullscreen().catch(() => notify('当前浏览器不支持进入全屏')) }}><Maximize2 size={16} /></button>}
    <section className="break-content" aria-labelledby="break-title">
      <h1 id="break-title">休息一下</h1>
      <span className="break-time" aria-label={`剩余 ${formatTime(remaining)}`}>{formatTime(remaining)}</span>
    </section>
    <footer className="break-footer">
      <button className="end-break" onClick={() => void leave('snooze')}>延后 5 分钟</button>
      <button className="end-break" title="跳过这次休息（Esc）" onClick={() => void leave('end')}>跳过</button>
    </footer>
  </main>
}
