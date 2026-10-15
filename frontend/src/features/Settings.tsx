import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ArrowLeft, CalendarDays, Check, Clock3, Minus, Monitor, Moon, Plus, Power, Sun, Volume2, X } from 'lucide-react'
import type { ReminderClient, ReminderSettings, Theme } from '../contracts/reminder'
import { errorMessage } from '../lib/errors'
import { Toggle } from '../components/Toggle'
import { getSettingsIssue } from '../domain/schedule'
import { ScheduleEditor } from './ScheduleEditor'
import { SoftwareUpdate } from './SoftwareUpdate'
import { MeetingSettings } from './MeetingSettings'
import { windowControlHandlers } from '../lib/window-control'
import type { ShellClient, UpdateClient } from '../services/desktop-client'

function LaunchAtLogin({ shell, notify }: { shell: ShellClient; notify: (message: string) => void }) {
  const item = useSyncExternalStore(shell.subscribe, shell.getLoginItem)
  const [pending, setPending] = useState(false)
  useEffect(() => {
    const refresh = () => { void shell.refreshLaunchAtLogin().catch(() => {}) }
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [shell])
  return <div className="login-setting">
    <Toggle label="开机自启动" description="登录后停在菜单栏或托盘，不打开看板" checked={item.openAtLogin} disabled={pending || item.status === 'unsupported'} onChange={value => {
      setPending(true)
      void shell.setLaunchAtLogin(value).then(message => { if (message) notify(message) }).catch(() => notify('无法更改开机自启动')).finally(() => setPending(false))
    }} />
    {item.message && <div className="login-hint" role="status">
      <p>{item.message}</p>
      {item.approvalNeeded && <button type="button" className="text-button" onClick={() => void shell.openLoginItemsSettings().catch(() => notify('无法打开系统设置'))}>打开系统设置</button>}
    </div>}
  </div>
}

export function Settings({ settings, client, onClose, notify, playSound, updates, shell, onPreviewTheme }: {
  settings: ReminderSettings; client: ReminderClient; onClose: () => void; notify: (message: string) => void; playSound: () => void
  updates?: UpdateClient
  shell?: ShellClient
  onPreviewTheme?: (theme: Theme) => void
}) {
  const surface = useRef<HTMLElement>(null)
  const [draft, setDraft] = useState(() => structuredClone(settings))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [focusIssue, setFocusIssue] = useState(0)
  const issue = submitted ? getSettingsIssue(draft) : null
  const update = <K extends keyof ReminderSettings>(key: K, value: ReminderSettings[K]) => { setDraft(d => ({ ...d, [key]: value })); setError(null) }
  async function save() {
    if (saving) return
    const invalid = getSettingsIssue(draft)
    setSubmitted(true)
    if (invalid) {
      setFocusIssue(value => value + 1)
      return
    }
    setSaving(true)
    try {
      await client.updateSettings(draft)
      notify('设置已保存'); onClose()
    } catch (error) { setError(errorMessage(error, '保存失败，请重试。')) }
    finally { setSaving(false) }
  }
  useEffect(() => { surface.current?.focus() }, [])
  useEffect(() => { if (focusIssue) surface.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus() }, [focusIssue])
  return <section ref={surface} tabIndex={-1} className="app-window settings-window" aria-labelledby="settings-title" onKeyDown={event => {
    if (saving || event.defaultPrevented) return
    if (event.key === 'Escape') { event.preventDefault(); onClose() }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void save() }
  }}>
    <header className="window-header settings-header">
      <button className="icon-button" disabled={saving} aria-label="取消修改，返回看板" {...windowControlHandlers(onClose)}><ArrowLeft size={16} strokeWidth={1.8} /></button>
      <h1 id="settings-title">提醒设置</h1>
      {shell && <div className="window-controls">
        <button className="icon-button" aria-label="最小化" title="最小化" {...windowControlHandlers(() => void shell.minimize().catch(error => notify(errorMessage(error))))}><Minus size={16} strokeWidth={1.8} /></button>
        <button className="icon-button window-close" aria-label="退出 remind" title="退出" {...windowControlHandlers(() => void shell.quit().catch(error => notify(errorMessage(error))))}><X size={16} strokeWidth={1.8} /></button>
      </div>}
    </header>
    <div className="settings-scroll"><fieldset className="settings-fields" disabled={saving} aria-label="提醒设置选项">
      <section className="settings-section"><h2><Clock3 size={15} />时间与提醒</h2>
        <div className="field-heading"><label htmlFor="work-minutes">提醒间隔</label><span>分钟</span></div>
        <div className="duration-row"><div className="presets">{[30, 45, 60].map(value => <button key={value} className={draft.workMinutes === value ? 'selected' : ''} aria-pressed={draft.workMinutes === value} onClick={() => update('workMinutes', value)}>{value}</button>)}</div><input id="work-minutes" aria-label="自定义提醒间隔，分钟" aria-invalid={issue?.field === 'workMinutes'} aria-describedby={issue?.field === 'workMinutes' ? 'work-error' : undefined} type="number" min="1" max="240" step="1" value={Number.isNaN(draft.workMinutes) ? '' : draft.workMinutes} onChange={event => update('workMinutes', event.target.valueAsNumber)} /></div>
        {issue?.field === 'workMinutes' && <p id="work-error" className="field-error" role="alert">{issue.message}</p>}
        <div className="break-duration"><div><label htmlFor="break-minutes">休息时长</label></div><div className="stepper"><button aria-label="减少休息时长" disabled={draft.breakMinutes <= 1} onClick={() => update('breakMinutes', Math.max(1, (draft.breakMinutes || 1) - 1))}><Minus size={14} /></button><input id="break-minutes" aria-invalid={issue?.field === 'breakMinutes'} aria-describedby={issue?.field === 'breakMinutes' ? 'break-error' : undefined} type="number" min="1" max="30" value={Number.isNaN(draft.breakMinutes) ? '' : draft.breakMinutes} onChange={event => update('breakMinutes', event.target.valueAsNumber)} /><span>分</span><button aria-label="增加休息时长" disabled={draft.breakMinutes >= 30} onClick={() => update('breakMinutes', Math.min(30, (draft.breakMinutes || 0) + 1))}><Plus size={14} /></button></div></div>
        {issue?.field === 'breakMinutes' && <p id="break-error" className="field-error" role="alert">{issue.message}</p>}
        <Toggle label="提前 1 分钟提醒" description="显示 5 秒后自动关闭" checked={draft.preReminder} onChange={value => update('preReminder', value)} />
        <Toggle label="休息铃声" description="开始时响一次" checked={draft.sound} onChange={value => update('sound', value)} />
        {draft.sound && <button className="text-button sound-test" onClick={playSound}><Volume2 size={14} />试听铃声</button>}
      </section>
      <section className="settings-section"><h2><CalendarDays size={15} />工作时段</h2>
        <ScheduleEditor value={draft.schedule} issue={issue} onChange={value => update('schedule', value)} />
      </section>
      <section className="settings-section">
        <MeetingSettings client={client} enabled={draft.meetingPause} onChange={value => update('meetingPause', value)} notify={notify} />
      </section>
      <section className="settings-section appearance-section"><h2><Sun size={15} />外观</h2><div className="theme-picker" role="group" aria-label="外观">{([{ value: 'system', label: '跟随系统', icon: Monitor }, { value: 'light', label: '浅色', icon: Sun }, { value: 'dark', label: '深色', icon: Moon }] as { value: Theme; label: string; icon: typeof Sun }[]).map(({ value, label, icon: Icon }) => <button key={value} className={draft.theme === value ? 'selected' : ''} aria-pressed={draft.theme === value} onClick={() => { update('theme', value); onPreviewTheme?.(value) }}><Icon size={15} />{label}</button>)}</div></section>
      {shell && <section className="settings-section"><h2><Power size={15} />系统</h2><LaunchAtLogin shell={shell} notify={notify} /></section>}
      {updates && <SoftwareUpdate client={updates} />}
    </fieldset></div>
    <footer className="settings-footer">{error && <p className="form-error" role="alert">{error}</p>}<div><button className="button secondary" disabled={saving} onClick={onClose}>取消</button><button className="button primary" disabled={saving} title="保存设置 (⌘ / Ctrl + Enter)" onClick={() => void save()}><Check size={16} />{saving ? '保存中…' : '保存设置'}</button></div></footer>
  </section>
}
