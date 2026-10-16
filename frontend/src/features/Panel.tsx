import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Check, ChevronDown, Minus, Settings2, X } from 'lucide-react'
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

function MinuteChoices({ minutes, max, presets, label, pending, onApply }: { minutes: number; max: number; presets: number[]; label: string; pending: boolean; onApply: (value: number) => void }) {
  const [text, setText] = useState(String(minutes))
  const [error, setError] = useState(false)
  return <>
    {presets.map(value => <button disabled={pending} key={value} role="menuitemradio" aria-checked={minutes === value} onClick={() => onApply(value)}><span>{value} 分钟</span>{minutes === value && <Check size={14} />}</button>)}
    <form className="choice-custom" onSubmit={event => {
      event.preventDefault()
      const value = Number(text)
      if (!Number.isInteger(value) || value < 1 || value > max) { setError(true); return }
      onApply(value)
    }}>
      <div className="choice-input"><input disabled={pending} aria-label={label} aria-invalid={error} aria-describedby={error ? `${label}-error` : undefined} inputMode="numeric" value={text} onChange={event => { setText(event.target.value.replace(/\D/g, '').slice(0, 3)); setError(false) }} /><span>分</span></div>
      <button disabled={pending} type="submit">{pending ? '…' : '确定'}</button>
    </form>
    {error && <p className="choice-error" id={`${label}-error`} role="alert">请输入 1–{max} 的整数</p>}
  </>
}

function IntervalEditor({ minutes, pending, onApply, onCancel }: { minutes: number; pending: boolean; onApply: (value: number) => void; onCancel: () => void }) {
  const [text, setText] = useState(String(minutes))
  const [error, setError] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  function adjust(delta: number) { setError(false); setText(current => String(clamp((Number(current) || minutes) + delta, 1, 240))) }
  function apply() {
    const next = Number(text)
    if (Number.isInteger(next) && next >= 1 && next <= 240) onApply(next)
    else setError(true)
  }
  useEffect(() => {
    const input = ref.current
    if (!input) return
    input.focus(); input.select()
    const wheel = (event: WheelEvent) => { if (event.deltaY === 0) return; event.preventDefault(); adjust(event.deltaY < 0 ? 1 : -1) }
    input.addEventListener('wheel', wheel, { passive: false })
    return () => input.removeEventListener('wheel', wheel)
  }, [minutes])
  return <form className="interval-editor-wrap" onSubmit={event => { event.preventDefault(); apply() }}>
    <input ref={ref} disabled={pending} className="interval-editor" inputMode="numeric" aria-label="提醒间隔，分钟" aria-invalid={error} aria-describedby="interval-hint" value={text}
      onChange={event => { setText(event.target.value.replace(/\D/g, '').slice(0, 3)); setError(false) }}
      onKeyDown={event => {
        if (event.key === 'Enter') { event.preventDefault(); apply() }
        if (event.key === 'Escape') { event.preventDefault(); onCancel() }
        if (event.key === 'ArrowUp') { event.preventDefault(); adjust(1) }
        if (event.key === 'ArrowDown') { event.preventDefault(); adjust(-1) }
      }} />
    <div className="editor-controls"><span id="interval-hint" className={error ? 'choice-error' : 'editor-hint'} role={error ? 'alert' : undefined}>{error ? '请输入 1–240 的整数' : '分钟'}</span><button type="button" className="text-button" disabled={pending} onClick={onCancel}>取消</button><button type="submit" className="text-button" disabled={pending}>{pending ? '保存中…' : '确认'}</button></div>
  </form>
}

export function Panel({ snapshot: s, client, onSettings, notify, updates, shell }: {
  snapshot: ReminderSnapshot; client: ReminderClient; onSettings: () => void; notify: (message: string) => void; updates?: UpdateClient; shell?: ShellClient
}) {
  const workAnchor = useRef<HTMLDivElement>(null), breakAnchor = useRef<HTMLDivElement>(null), pauseAnchor = useRef<HTMLDivElement>(null)
  const pending = useRef(false)
  const [changing, setChanging] = useState(false)
  const [menu, setMenu] = useState<'work' | 'break' | 'pause' | null>(null)
  const [editing, setEditing] = useState(false)
  const timeButton = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef<'work' | 'break' | null>(null)
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
    if (await changeSettings(next)) {
      restoreFocus.current = kind
      setMenu(null); setEditing(false)
    }
  }
  useEffect(() => { if (s.phase === 'break' || s.preparingBreak) setMenu(null) }, [s.phase, s.preparingBreak])
  useEffect(() => {
    if (!restoreFocus.current || changing || menu || editing) return
    const anchor = restoreFocus.current === 'work' ? workAnchor : breakAnchor
    restoreFocus.current = null
    anchor.current?.querySelector('button')?.focus()
  }, [changing, menu, editing])
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
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, menu, ready, manual, s.phase, s.preparingBreak, client])

  return <section className="app-window panel" tabIndex={-1} aria-label="休息提醒看板">
    <header className="window-header">
      <Brand />
      <div className="window-controls">
        <button className="icon-button" disabled={changing} aria-label="打开设置" title="设置" {...windowControlHandlers(onSettings)}><Settings2 size={16} strokeWidth={1.8} /></button>
        {shell && <>
          <button className="icon-button" aria-label="最小化" title="最小化" {...windowControlHandlers(() => run(shell.minimize()))}><Minus size={16} strokeWidth={1.8} /></button>
          <button className="icon-button window-close" aria-label="退出 remind" title="退出" {...windowControlHandlers(() => run(shell.quit()))}><X size={16} strokeWidth={1.8} /></button>
        </>}
      </div>
    </header>
    <div className="panel-scroll"><div className="panel-content"><div className="panel-body">
      <div className="timer-heading">
        <h1>距离下次休息</h1>
        <div className="timer-heading-tools">
          <span className={`timer-state ${paused || ready ? 'neutral' : ''}`}><span className="status-dot" />{title}</span>
        </div>
      </div>
      <div className="time-block">
        {editing ? <IntervalEditor minutes={s.settings.workMinutes} pending={changing} onApply={value => void applyMinutes('work', value)} onCancel={() => { setEditing(false); requestAnimationFrame(() => timeButton.current?.focus()) }} /> : <button ref={timeButton} className="time-hit" aria-label={`剩余 ${Math.floor(s.remainingSeconds / 60)} 分 ${s.remainingSeconds % 60} 秒，点击修改提醒间隔`} title="点击修改提醒间隔" disabled={changing} onClick={() => { setMenu(null); setEditing(true) }}>
          <TimerReadout remaining={s.remainingSeconds} total={s.totalSeconds} paused={paused} />
        </button>}
      </div>
      <div className="rhythm-controls">
        <div className="menu-anchor" data-choice ref={workAnchor}>
          <button disabled={changing} aria-expanded={menu === 'work'} aria-haspopup="menu" aria-label={`提醒间隔 ${s.settings.workMinutes} 分钟`} onClick={() => setMenu(menu === 'work' ? null : 'work')}>间隔 <strong>{s.settings.workMinutes} 分钟</strong><ChevronDown size={12} /></button>
          <ChoiceMenu open={menu === 'work'} anchor={workAnchor} onClose={() => setMenu(null)}>
            <MinuteChoices minutes={s.settings.workMinutes} max={240} presets={[30, 45, 60]} label="自定义间隔分钟" pending={changing} onApply={value => void applyMinutes('work', value)} />
          </ChoiceMenu>
        </div>
        <div className="menu-anchor" data-choice ref={breakAnchor}>
          <button disabled={changing} aria-expanded={menu === 'break'} aria-haspopup="menu" aria-label={`休息时长 ${s.settings.breakMinutes} 分钟`} onClick={() => setMenu(menu === 'break' ? null : 'break')}>休息 <strong>{s.settings.breakMinutes} 分钟</strong><ChevronDown size={12} /></button>
          <ChoiceMenu open={menu === 'break'} anchor={breakAnchor} onClose={() => setMenu(null)} alignEnd>
            <MinuteChoices minutes={s.settings.breakMinutes} max={30} presets={[1, 3, 5]} label="自定义休息分钟" pending={changing} onApply={value => void applyMinutes('break', value)} />
          </ChoiceMenu>
        </div>
      </div>
      {pauseContext && <div className="pause-context">{pauseContext}
        {needsMeetingPermission && client.openMeetingPermissions && <button className="text-button meeting-permission" aria-label="去开启辅助功能权限" title="打开系统辅助功能设置" onClick={() => run(client.openMeetingPermissions!())}>去开启</button>}
        {client.ignoreMeeting && ['active', 'unknown', 'confirmation', 'checking'].includes(s.meeting?.status ?? '') && <button className="text-button meeting-ignore" onClick={() => run(client.ignoreMeeting!())}>本次忽略</button>}
      </div>}
      <div className="timer-actions">
        <div className="menu-anchor" data-choice ref={pauseAnchor}>
          <button className="button primary" aria-expanded={ready || manual ? undefined : menu === 'pause'} aria-haspopup={ready || manual ? undefined : 'menu'} title={ready || manual ? '空格' : '选择暂停时长'} onClick={() => {
            if (ready) run(client.start())
            else if (manual) run(client.resume())
            else setMenu(menu === 'pause' ? null : 'pause')
          }}>
            {primaryLabel}
          </button>
          <ChoiceMenu open={menu === 'pause'} anchor={pauseAnchor} onClose={() => setMenu(null)} above>
            <button role="menuitem" onClick={() => { setMenu(null); run(client.pauseFor('30')) }}>30 分钟</button>
            <button role="menuitem" onClick={() => { setMenu(null); run(client.pauseFor('60')) }}>1 小时</button>
            <button role="menuitem" onClick={() => { setMenu(null); run(client.pauseFor('tomorrow')) }}>直到明天</button>
            <button role="menuitem" onClick={() => { setMenu(null); run(client.pauseFor('indefinite')) }}>一直暂停</button>
          </ChoiceMenu>
        </div>
        <button className="button secondary" title="重置时间 (R)" disabled={changing || s.preparingBreak} onClick={() => run(client.resetTimer())}>重置时间</button>
      </div>
    </div>
    {updates && <UpdateNotice client={updates} notify={notify} />}
    {s.storageError && <p className="storage-warning" role="alert">本地设置无法读取或保存，当前使用临时设置。</p>}
    {s.displayError && <p className="storage-warning" role="alert">休息窗口未能打开，请重试。</p>}
    </div></div>
  </section>
}
