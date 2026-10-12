import { useSyncExternalStore } from 'react'
import { BellOff, BellRing, ChevronDown, Coffee, Minus, Pause, Play, RotateCcw, Settings2, CalendarDays } from 'lucide-react'
import type { ReminderClient, ReminderSnapshot } from '../contracts/reminder'
import { Brand } from '../components/Brand'
import { TimerReadout } from '../components/TimerReadout'
import { nextWorkLabel } from '../lib/format'
import type { ShellClient, UpdateClient } from '../services/desktop-client'

function UpdateNotice({ client }: { client: UpdateClient }) {
  const update = useSyncExternalStore(client.subscribe, client.getUpdateSnapshot)
  if (update.status !== 'available' && update.status !== 'downloading' && update.status !== 'downloaded' && update.status !== 'installing') return null
  const browser = update.delivery === 'browser'
  const busy = update.status === 'downloading' || update.status === 'installing'
  const action = browser ? 'releases' : update.status === 'downloaded' ? 'install' : 'download'
  const label = busy ? (update.status === 'installing' ? '安装中…' : `下载中 ${Math.floor(update.progress)}%`) : browser ? '前往下载' : update.status === 'downloaded' ? '重启安装' : '下载更新'
  const text = browser ? `发现新版本 ${update.version}` : update.status === 'downloaded' || update.status === 'installing' ? `${update.version} 已下载` : `发现新版本 ${update.version}`
  return <div className="update-banner" role="status"><span>{text}</span><button disabled={busy} onClick={() => void client.update(action)}>{label}</button></div>
}

export function Panel({ snapshot: s, client, onSettings, notify, updates, shell }: {
  snapshot: ReminderSnapshot; client: ReminderClient; onSettings: () => void; notify: (message: string) => void; updates?: UpdateClient; shell?: ShellClient
}) {
  const manual = s.pauseReasons.includes('manual')
  const meeting = s.pauseReasons.includes('meeting')
  const outside = s.pauseReasons.includes('schedule')
  const systemPaused = s.pauseReasons.includes('locked') || s.pauseReasons.includes('suspended') || s.pauseReasons.includes('updating')
  const paused = s.pauseReasons.length > 0
  const ready = s.phase === 'ready'
  const upcoming = !paused && !ready && s.remainingSeconds <= 60 && s.settings.workMinutes > 1 && s.settings.preReminder && !s.lastInPeriod
  const title = s.preparingBreak ? '准备休息' : s.phase === 'break' ? '休息中' : systemPaused ? '已暂停' : meeting ? '会议中' : manual ? '已暂停' : outside ? '时段外' : s.lastInPeriod ? '等待下一时段' : ready ? '未开始' : upcoming ? '即将休息' : '计时中'
  const pauseContext = meeting ? `腾讯会议${manual ? ' · 手动暂停' : ''}`
    : outside ? `${nextWorkLabel(s.nextWorkAt)}${manual ? ' · 手动暂停' : ''}` : null
  const primaryLabel = ready ? '开始提醒' : manual ? (meeting || outside ? '取消手动暂停' : '继续提醒') : paused ? '手动暂停' : '暂停提醒'
  function run(action: Promise<void>) { void action.catch(error => notify(error.message)) }

  return <section className="app-window panel" aria-label="休息提醒看板">
    <header className="window-header">
      <Brand />
      <div className="window-controls">
        {shell && <button className="icon-button" aria-label="最小化" title="最小化" onClick={() => void shell.minimize()}><Minus size={16} /></button>}
        <button className="icon-button" aria-label="打开设置" title="设置" onClick={onSettings}><Settings2 size={18} strokeWidth={1.6} /></button>
      </div>
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
        <button className="button secondary" disabled={meeting || systemPaused || s.preparingBreak || s.phase === 'break'} onClick={() => run(client.startBreak())}><Coffee size={17} strokeWidth={1.6} />现在休息</button>
        <button className="button reset-timer" onClick={() => run(client.resetTimer())}><RotateCcw size={15} />重置计时</button>
      </div>
    </div>
    {updates && <UpdateNotice client={updates} />}
    <footer className="panel-footer">
      <button aria-label={s.settings.sound ? '关闭休息铃声' : '开启休息铃声'} aria-pressed={s.settings.sound} onClick={() => run(client.updateSettings({ ...s.settings, sound: !s.settings.sound }))}>
        {s.settings.sound ? <BellRing size={14} /> : <BellOff size={14} />}<span>{s.settings.sound ? '铃声开启' : '静音提醒'}</span>
      </button>
      <button onClick={onSettings} aria-label="设置工作时段"><CalendarDays size={14} /><span>{s.settings.schedule.enabled ? '工作时段内提醒' : '全天提醒'}</span></button>
    </footer>
    {shell && <button className="quit-app" onClick={() => void shell.quit()}>退出 remind</button>}
    {s.storageError && <p className="storage-warning" role="alert">本地设置无法读取或保存，当前使用临时设置。</p>}
    {s.displayError && <p className="storage-warning" role="alert">休息窗口未能打开，请重试。</p>}
  </section>
}
