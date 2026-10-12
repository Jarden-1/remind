import { BellOff, BellRing, ChevronDown, Coffee, Pause, Play, Settings2, CalendarDays } from 'lucide-react'
import type { ReminderClient, ReminderSnapshot } from '../contracts/reminder'
import { Brand } from '../components/Brand'
import { TimerReadout } from '../components/TimerReadout'
import { nextWorkLabel } from '../lib/format'

export function Panel({ snapshot: s, client, onSettings, notify }: {
  snapshot: ReminderSnapshot; client: ReminderClient; onSettings: () => void; notify: (message: string) => void
}) {
  const manual = s.pauseReasons.includes('manual')
  const meeting = s.pauseReasons.includes('meeting')
  const outside = s.pauseReasons.includes('schedule')
  const paused = s.pauseReasons.length > 0
  const ready = s.phase === 'ready'
  const upcoming = !paused && !ready && s.remainingSeconds <= 60 && s.settings.workMinutes > 1 && s.settings.preReminder && !s.lastInPeriod
  const title = meeting ? '会议中' : manual ? '已暂停' : outside ? '时段外' : s.lastInPeriod ? '等待下一时段' : ready ? '未开始' : upcoming ? '即将休息' : '计时中'
  const pauseContext = meeting ? `腾讯会议${manual ? ' · 手动暂停' : ''}`
    : outside ? `${nextWorkLabel(s.nextWorkAt)}${manual ? ' · 手动暂停' : ''}` : null
  const primaryLabel = ready ? '开始提醒' : manual ? (meeting || outside ? '取消手动暂停' : '继续提醒') : paused ? '手动暂停' : '暂停提醒'
  function run(action: Promise<void>) { void action.catch(error => notify(error.message)) }

  return <section className="app-window panel" aria-label="休息提醒看板">
    <header className="window-header">
      <Brand />
      <button className="icon-button" aria-label="打开设置" title="设置" onClick={onSettings}><Settings2 size={18} strokeWidth={1.6} /></button>
    </header>
    <div className="panel-body">
      <div className="timer-heading">
        <h1>距离下次休息</h1>
        <span className={`timer-state ${paused || ready ? 'neutral' : ''}`}><span className="status-dot" />{title}</span>
      </div>
      <TimerReadout remaining={s.remainingSeconds} total={s.totalSeconds} paused={paused} />
      <div className="rhythm-controls">
        <button onClick={onSettings} aria-label={`提醒间隔 ${s.settings.workMinutes} 分钟，点击设置`}>间隔 <strong>{s.settings.workMinutes} 分钟</strong><ChevronDown size={12} /></button>
        <button onClick={onSettings} aria-label={`休息时长 ${s.settings.breakMinutes} 分钟，点击设置`}><span className="rest-dot" />休息 <strong>{s.settings.breakMinutes} 分钟</strong><ChevronDown size={12} /></button>
      </div>
      {pauseContext && <p className="pause-context">{pauseContext}</p>}
      <div className="timer-actions">
        <button className="button primary" onClick={() => run(ready ? client.start() : manual ? client.resume() : client.pause())}>
          {ready || manual ? <Play size={15} fill="currentColor" strokeWidth={1.5} /> : <Pause size={15} fill="currentColor" strokeWidth={1.5} />}{primaryLabel}
        </button>
        <button className="button secondary" disabled={meeting} onClick={() => run(client.startBreak())}><Coffee size={17} strokeWidth={1.6} />现在休息</button>
      </div>
    </div>
    <footer className="panel-footer">
      <button aria-label={s.settings.sound ? '关闭休息铃声' : '开启休息铃声'} aria-pressed={s.settings.sound} onClick={() => run(client.updateSettings({ ...s.settings, sound: !s.settings.sound }))}>
        {s.settings.sound ? <BellRing size={14} /> : <BellOff size={14} />}<span>{s.settings.sound ? '铃声开启' : '静音提醒'}</span>
      </button>
      <button onClick={onSettings} aria-label="设置工作时段"><CalendarDays size={14} /><span>{s.settings.schedule.enabled ? '工作时段内提醒' : '全天提醒'}</span></button>
    </footer>
    {s.storageError && <p className="storage-warning" role="alert">本地设置无法读取或保存，当前使用临时设置。</p>}
  </section>
}
