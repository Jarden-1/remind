import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { BellOff, BellRing, ChevronDown, Coffee, Minus, Pause, Play, RotateCcw, Settings2, X } from 'lucide-react'
import type { ReminderClient, ReminderSnapshot } from '../contracts/reminder'
import { ChoiceMenu } from '../components/ChoiceMenu'
import { errorMessage } from '../lib/errors'
import { meetingNames } from '../../../shared/meeting'
import { Brand } from '../components/Brand'
import { TimerReadout } from '../components/TimerReadout'
import { nextWorkLabel } from '../lib/format'
import { windowControlHandlers } from '../lib/window-control'
import type { ShellClient, UpdateClient } from '../services/desktop-client'

function UpdateNotice({ client, notify }: { client: UpdateClient; notify: (message: string) => void }) {
  const update = useSyncExternalStore(client.subscribe, client.getUpdateSnapshot)
  if (update.status !== 'available' && update.status !== 'downloading' && update.status !== 'downloaded' && update.status !== 'installing' && !(update.status === 'error' && update.version)) return null
  const browser = update.delivery === 'browser'
  const busy = update.status === 'downloading' || update.status === 'installing'
  const action = update.status === 'error' ? 'check' : browser ? 'releases' : update.status === 'downloaded' ? 'install' : 'download'
  const label = update.status === 'error' ? '重试' : busy ? (update.status === 'installing' ? '安装中…' : `下载中 ${Math.floor(update.progress)}%`) : browser ? '前往下载' : update.status === 'downloaded' ? '重启安装' : '下载更新'
  const text = update.message || (browser ? `发现新版本 ${update.version}` : update.status === 'downloaded' || update.status === 'installing' ? `${update.version} 已下载` : `发现新版本 ${update.version}`)
  return <div className="update-banner" role="status"><span>{text}</span><button disabled={busy} onClick={() => void client.update(action).catch(error => notify(errorMessage(error)))}>{label}</button></div>
}

function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)) }

function pauseCountdown(until: string) {
  const ms = Date.parse(until) - Date.now()
  if (!Number.isFinite(ms)) return null
  if (ms <= 0) return '即将继续'
  if (ms >= 6 * 60 * 60_000) return '明天继续'
  const minutes = Math.max(1, Math.ceil(ms / 60_000))
  if (minutes < 60) return `${minutes} 分钟后继续`
  const hours = Math.floor(minutes / 60), rest = minutes % 60
  return rest ? `${hours} 小时 ${rest} 分钟后继续` : `${hours} 小时后继续`
}

function IntervalEditor({ minutes, onApply, onCancel }: { minutes: number; onApply: (value: number) => void; onCancel: () => void }) {
  const [text, setText] = useState(String(minutes))
  const ref = useRef<HTMLInputElement>(null)
  function adjust(delta: number) { setText(current => String(clamp((Number(current) || minutes) + delta, 1, 240))) }
  function apply() {
    const next = Number(text)
    if (Number.isInteger(next) && next >= 1 && next <= 240) onApply(next)
  }
  useEffect(() => {
    const input = ref.current
    if (!input) return
    input.focus(); input.select()
    const wheel = (event: WheelEvent) => { if (event.deltaY === 0) return; event.preventDefault(); adjust(event.deltaY < 0 ? 1 : -1) }
    input.addEventListener('wheel', wheel, { passive: false })
    return () => input.removeEventListener('wheel', wheel)
  }, [minutes])
  return <div className="interval-editor-wrap">
    <input ref={ref} className="interval-editor" inputMode="numeric" aria-label="提醒间隔，分钟" value={text}
      onChange={event => setText(event.target.value.replace(/\D/g, '').slice(0, 3))}
      onKeyDown={event => {
        if (event.key === 'Enter') { event.preventDefault(); apply() }
        if (event.key === 'Escape') { event.preventDefault(); onCancel() }
        if (event.key === 'ArrowUp') { event.preventDefault(); adjust(1) }
        if (event.key === 'ArrowDown') { event.preventDefault(); adjust(-1) }
      }} />
    <p className="editor-hint">分钟 · 方向键或滚轮 · 回车确认</p>
  </div>
}

export function Panel({ snapshot: s, client, onSettings, notify, updates, shell }: {
  snapshot: ReminderSnapshot; client: ReminderClient; onSettings: () => void; notify: (message: string) => void; updates?: UpdateClient; shell?: ShellClient
}) {
  const workAnchor = useRef<HTMLDivElement>(null), breakAnchor = useRef<HTMLDivElement>(null), pauseAnchor = useRef<HTMLDivElement>(null)
  const pending = useRef(false)
  const [changing, setChanging] = useState(false)
  const [menu, setMenu] = useState<'work' | 'break' | 'pause' | null>(null)
  const [editing, setEditing] = useState(false)
  const [customWork, setCustomWork] = useState(String(s.settings.workMinutes))
  const [customBreak, setCustomBreak] = useState(String(s.settings.breakMinutes))
  const manual = s.pauseReasons.includes('manual')
  const meeting = s.pauseReasons.includes('meeting')
  const outside = s.pauseReasons.includes('schedule')
  const systemPaused = s.pauseReasons.includes('locked') || s.pauseReasons.includes('suspended') || s.pauseReasons.includes('updating')
  const paused = s.pauseReasons.length > 0
  const ready = s.phase === 'ready'
  const upcoming = !paused && !ready && s.remainingSeconds <= 60 && s.totalSeconds > 60 && s.settings.preReminder && !s.lastInPeriod
  const title = s.preparingBreak ? '准备休息' : s.phase === 'break' ? '休息中' : systemPaused ? '已暂停' : meeting ? '会议中' : manual ? '已暂停' : outside ? '时段外' : s.lastInPeriod ? '等待下一时段' : ready ? '未开始' : upcoming ? '即将休息' : '计时中'
  const timed = manual && s.pauseUntil ? pauseCountdown(s.pauseUntil) : null
  const needsMeetingPermission = s.settings.meetingPause && s.meeting?.permission === 'required'
  const meetingLabel = s.meeting?.apps.length ? s.meeting.apps.map(id => meetingNames[id]).join('、') : '会议进行中'
  const pauseContext = [timed, meeting ? `${meetingLabel}${manual && !timed ? ' · 手动暂停' : ''}` : null, !meeting && outside ? `${nextWorkLabel(s.nextWorkAt)}${manual && !timed ? ' · 手动暂停' : ''}` : null, s.meeting?.message ?? (needsMeetingPermission ? '需要辅助功能权限' : null)].filter(Boolean).join(' · ') || null
  const primaryLabel = ready ? '开始提醒' : manual ? (meeting || outside ? '取消手动暂停' : '继续提醒') : paused ? '手动暂停' : '暂停提醒'
  const breakBlocked = meeting || systemPaused || s.preparingBreak || s.phase === 'break'
  function run(action: Promise<void>) { void action.catch(error => notify(errorMessage(error))) }
  async function changeSettings(next: ReminderSnapshot['settings']) {
    if (pending.current) return false
    pending.current = true; setChanging(true)
    try { await client.updateSettings(next); return true }
    catch (error) { notify(errorMessage(error)); return false }
    finally { pending.current = false; setChanging(false) }
  }
  async function applyMinutes(kind: 'work' | 'break', value: number) {
    const next = kind === 'work' ? { ...s.settings, workMinutes: value } : { ...s.settings, breakMinutes: value }
    if (await changeSettings(next)) { setMenu(null); setEditing(false) }
  }
  useEffect(() => { if (s.phase === 'break' || s.preparingBreak) setMenu(null) }, [s.phase, s.preparingBreak])
  useEffect(() => { setCustomWork(String(s.settings.workMinutes)); setCustomBreak(String(s.settings.breakMinutes)) }, [s.settings.workMinutes, s.settings.breakMinutes])
  useEffect(() => {
    if (!s.settings.meetingPause || !client.refreshMeeting) return
    const refresh = () => { void client.refreshMeeting!().catch(error => notify(errorMessage(error))) }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [client, s.settings.meetingPause])
  useEffect(() => {
    if (!menu) return
    const close = (event: MouseEvent) => { if (event.target instanceof Element && event.target.closest('[data-choice]')) return; setMenu(null) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menu])
  useEffect(() => {
    if (s.phase === 'break' || s.preparingBreak || editing) return
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return
      if (event.defaultPrevented) return
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"], [role="menu"]')) return
      if (event.key === ' ' && event.target instanceof HTMLElement && event.target.closest('button, a, [role="button"]')) return
      if (event.key === 'Escape') { setMenu(null); return }
      if (menu) return
      if (event.key === ' ') { event.preventDefault(); run(ready ? client.start() : manual ? client.resume() : client.pause()) }
      else if (event.key === 'r' || event.key === 'R') { event.preventDefault(); run(client.resetTimer()) }
      else if ((event.key === 'b' || event.key === 'B') && !breakBlocked) { event.preventDefault(); run(client.startBreak()) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, menu, ready, manual, breakBlocked, s.phase, s.preparingBreak, client])

  return <section className="app-window panel" aria-label="休息提醒看板">
    <header className="window-header">
      <Brand />
      <div className="window-controls">
        <button className="icon-button" aria-label="打开设置" title="设置" {...windowControlHandlers(onSettings)}><Settings2 size={16} strokeWidth={1.8} /></button>
        {shell && <>
          <span className="window-divider" aria-hidden="true" />
          <button className="icon-button" aria-label="最小化" title="最小化" {...windowControlHandlers(() => run(shell.minimize()))}><Minus size={16} strokeWidth={1.8} /></button>
          <button className="icon-button window-close" aria-label="退出 remind" title="退出" {...windowControlHandlers(() => run(shell.quit()))}><X size={16} strokeWidth={1.8} /></button>
        </>}
      </div>
    </header>
    <div className="panel-body">
      <div className="timer-heading">
        <h1>距离下次休息</h1>
        <div className="timer-heading-tools">
          <span className={`timer-state ${paused || ready ? 'neutral' : ''}`}><span className="status-dot" />{title}</span>
          {!editing && <button className="time-reset" aria-label="重置计时" title="重置计时 (R)" onClick={() => run(client.resetTimer())}><RotateCcw size={14} strokeWidth={1.8} /></button>}
        </div>
      </div>
      <div className="time-block">
        {editing ? <IntervalEditor minutes={s.settings.workMinutes} onApply={value => applyMinutes('work', value)} onCancel={() => setEditing(false)} /> : <button className="time-hit" aria-label={`剩余 ${Math.floor(s.remainingSeconds / 60)} 分 ${s.remainingSeconds % 60} 秒，点击修改提醒间隔`} title="点击修改提醒间隔" disabled={changing} onClick={() => { setMenu(null); setEditing(true) }}>
          <TimerReadout remaining={s.remainingSeconds} total={s.totalSeconds} paused={paused} />
        </button>}
      </div>
      <div className="rhythm-controls">
        <div className="menu-anchor" data-choice ref={workAnchor}>
          <button disabled={changing} aria-expanded={menu === 'work'} aria-haspopup="menu" aria-label={`提醒间隔 ${s.settings.workMinutes} 分钟`} onClick={() => setMenu(menu === 'work' ? null : 'work')}>间隔 <strong>{s.settings.workMinutes} 分钟</strong><ChevronDown size={12} /></button>
          <ChoiceMenu open={menu === 'work'} anchor={workAnchor} onClose={() => setMenu(null)}>
            {[25, 45, 60].map(value => <button key={value} role="menuitemradio" aria-checked={s.settings.workMinutes === value} onClick={() => applyMinutes('work', value)}>{value} 分钟</button>)}
            <form className="choice-custom" onSubmit={event => { event.preventDefault(); const value = Number(customWork); if (Number.isInteger(value) && value >= 1 && value <= 240) applyMinutes('work', value) }}>
              <input aria-label="自定义间隔分钟" inputMode="numeric" value={customWork} onChange={event => setCustomWork(event.target.value.replace(/\D/g, '').slice(0, 3))} />
              <button type="submit">确定</button>
            </form>
          </ChoiceMenu>
        </div>
        <div className="menu-anchor" data-choice ref={breakAnchor}>
          <button disabled={changing} aria-expanded={menu === 'break'} aria-haspopup="menu" aria-label={`休息时长 ${s.settings.breakMinutes} 分钟`} onClick={() => setMenu(menu === 'break' ? null : 'break')}><span className="rest-dot" />休息 <strong>{s.settings.breakMinutes} 分钟</strong><ChevronDown size={12} /></button>
          <ChoiceMenu open={menu === 'break'} anchor={breakAnchor} onClose={() => setMenu(null)} alignEnd>
            {[1, 3, 5].map(value => <button key={value} role="menuitemradio" aria-checked={s.settings.breakMinutes === value} onClick={() => applyMinutes('break', value)}>{value} 分钟</button>)}
            <form className="choice-custom" onSubmit={event => { event.preventDefault(); const value = Number(customBreak); if (Number.isInteger(value) && value >= 1 && value <= 30) applyMinutes('break', value) }}>
              <input aria-label="自定义休息分钟" inputMode="numeric" value={customBreak} onChange={event => setCustomBreak(event.target.value.replace(/\D/g, '').slice(0, 2))} />
              <button type="submit">确定</button>
            </form>
          </ChoiceMenu>
        </div>
      </div>
      {pauseContext && <div className="pause-context">{pauseContext}
        {needsMeetingPermission && client.openMeetingPermissions && <button className="text-button meeting-permission" aria-label="去开启辅助功能权限" title="打开系统辅助功能设置" onClick={() => run(client.openMeetingPermissions!())}>去开启</button>}
        {client.ignoreMeeting && ['active', 'unknown', 'confirmation', 'checking'].includes(s.meeting?.status ?? '') && <button className="text-button meeting-ignore" onClick={() => run(client.ignoreMeeting!())}>本次忽略</button>}
      </div>}
      <div className="timer-actions">
        <div className="menu-anchor" data-choice ref={pauseAnchor}>
          <button className="button primary" aria-expanded={menu === 'pause'} aria-haspopup={ready || manual ? undefined : 'menu'} title={ready || manual ? '空格' : '选择暂停时长'} onClick={() => {
            if (ready) run(client.start())
            else if (manual) run(client.resume())
            else setMenu(menu === 'pause' ? null : 'pause')
          }}>
            {ready || manual ? <Play size={15} fill="currentColor" strokeWidth={1.5} /> : <Pause size={15} fill="currentColor" strokeWidth={1.5} />}{primaryLabel}
          </button>
          <ChoiceMenu open={menu === 'pause'} anchor={pauseAnchor} onClose={() => setMenu(null)} above>
            <button role="menuitem" onClick={() => { setMenu(null); run(client.pauseFor('30')) }}>30 分钟</button>
            <button role="menuitem" onClick={() => { setMenu(null); run(client.pauseFor('60')) }}>1 小时</button>
            <button role="menuitem" onClick={() => { setMenu(null); run(client.pauseFor('tomorrow')) }}>直到明天</button>
            <button role="menuitem" onClick={() => { setMenu(null); run(client.pauseFor('indefinite')) }}>一直暂停</button>
          </ChoiceMenu>
        </div>
        <button className="button secondary" title="B" disabled={breakBlocked} onClick={() => run(client.startBreak())}><Coffee size={17} strokeWidth={1.6} />现在休息</button>
      </div>
    </div>
    {updates && <UpdateNotice client={updates} notify={notify} />}
    <footer className="panel-footer">
      <button aria-label={s.settings.sound ? '休息铃声已开启，点击关闭' : '休息铃声已关闭，点击开启'} aria-pressed={s.settings.sound} disabled={changing} onClick={() => void changeSettings({ ...s.settings, sound: !s.settings.sound })}>
        {s.settings.sound ? <BellRing size={14} /> : <BellOff size={14} />}<span>铃声</span><span className={`state-pill${s.settings.sound ? ' on' : ''}`}>{s.settings.sound ? '开' : '关'}</span>
      </button>
      <button aria-label={s.settings.schedule.enabled ? '工作时段已开启，点击设置' : '工作时段已关闭，点击设置'} aria-pressed={s.settings.schedule.enabled} onClick={onSettings}>
        <Settings2 size={14} /><span>工作时段</span><span className={`state-pill${s.settings.schedule.enabled ? ' on' : ''}`}>{s.settings.schedule.enabled ? '开' : '关'}</span>
      </button>
    </footer>
    {s.storageError && <p className="storage-warning" role="alert">本地设置无法读取或保存，当前使用临时设置。</p>}
    {s.displayError && <p className="storage-warning" role="alert">休息窗口未能打开，请重试。</p>}
  </section>
}
