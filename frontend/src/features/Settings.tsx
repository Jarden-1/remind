import { useState } from 'react'
import { ArrowLeft, CalendarDays, Check, Clock3, Minus, Monitor, Moon, Plus, Sun, Volume2 } from 'lucide-react'
import type { ReminderClient, ReminderSettings, Theme } from '../contracts/reminder'
import { Toggle } from '../components/Toggle'
import { validateSettings } from '../domain/schedule'
import { ScheduleEditor } from './ScheduleEditor'
import { SoftwareUpdate } from './SoftwareUpdate'
import type { UpdateClient } from '../services/desktop-client'

export function Settings({ settings, client, onClose, notify, playSound, updates }: {
  settings: ReminderSettings; client: ReminderClient; onClose: () => void; notify: (message: string) => void; playSound: () => void
  updates?: UpdateClient
}) {
  const [draft, setDraft] = useState(() => structuredClone(settings))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const update = <K extends keyof ReminderSettings>(key: K, value: ReminderSettings[K]) => { setDraft(d => ({ ...d, [key]: value })); setError(null) }
  async function save() {
    const message = validateSettings(draft)
    if (message) { setError(message); return }
    setSaving(true)
    try {
      await client.updateSettings(draft)
      const changed = settings.workMinutes !== draft.workMinutes || JSON.stringify(settings.schedule) !== JSON.stringify(draft.schedule)
      notify(changed ? '设置已保存，下一次提醒已调整' : '设置已保存'); onClose()
    } catch (error) { setError(error instanceof Error ? error.message : '保存失败，请重试。') }
    finally { setSaving(false) }
  }
  return <section className="app-window settings-window" aria-labelledby="settings-title">
    <header className="window-header settings-header"><button className="icon-button" aria-label="取消修改，返回看板" onClick={onClose}><ArrowLeft size={19} /></button><h1 id="settings-title">提醒设置</h1><span className="header-spacer" /></header>
    <div className="settings-scroll">
      <section className="settings-section"><h2><Clock3 size={15} />时间与提醒</h2>
        <div className="field-heading"><label htmlFor="work-minutes">提醒间隔</label><span>分钟</span></div>
        <div className="duration-row"><div className="presets">{[30, 45, 60].map(value => <button key={value} className={draft.workMinutes === value ? 'selected' : ''} aria-pressed={draft.workMinutes === value} onClick={() => update('workMinutes', value)}>{value}</button>)}</div><input id="work-minutes" aria-label="自定义提醒间隔，分钟" type="number" min="1" max="240" step="1" value={Number.isNaN(draft.workMinutes) ? '' : draft.workMinutes} onChange={event => update('workMinutes', event.target.valueAsNumber)} /></div>
        <div className="break-duration"><div><label htmlFor="break-minutes">休息时长</label></div><div className="stepper"><button aria-label="减少休息时长" disabled={draft.breakMinutes <= 1} onClick={() => update('breakMinutes', Math.max(1, draft.breakMinutes - 1))}><Minus size={14} /></button><input id="break-minutes" type="number" min="1" max="30" value={Number.isNaN(draft.breakMinutes) ? '' : draft.breakMinutes} onChange={event => update('breakMinutes', event.target.valueAsNumber)} /><span>分</span><button aria-label="增加休息时长" disabled={draft.breakMinutes >= 30} onClick={() => update('breakMinutes', Math.min(30, draft.breakMinutes + 1))}><Plus size={14} /></button></div></div>
        <Toggle label="提前 1 分钟提醒" checked={draft.preReminder} onChange={value => update('preReminder', value)} />
        <Toggle label="休息铃声" description="开始时响一次" checked={draft.sound} onChange={value => update('sound', value)} />
        {draft.sound && <button className="text-button sound-test" onClick={playSound}><Volume2 size={14} />试听铃声</button>}
      </section>
      <section className="settings-section"><h2><CalendarDays size={15} />工作时段与会议</h2>
        <ScheduleEditor value={draft.schedule} onChange={value => update('schedule', value)} />
        <div className="future-setting"><div><span className="setting-label">会议自动暂停</span><span className="helper">腾讯会议、飞书会议</span></div><span className="subtle-badge">待接入</span></div>
      </section>
      <section className="settings-section appearance-section"><h2><Sun size={15} />外观</h2><div className="theme-picker">{([{ value: 'system', label: '跟随系统', icon: Monitor }, { value: 'light', label: '浅色', icon: Sun }, { value: 'dark', label: '深色', icon: Moon }] as { value: Theme; label: string; icon: typeof Sun }[]).map(({ value, label, icon: Icon }) => <button key={value} className={draft.theme === value ? 'selected' : ''} aria-pressed={draft.theme === value} onClick={() => update('theme', value)}><Icon size={15} />{label}</button>)}</div></section>
      {updates && <SoftwareUpdate client={updates} />}
    </div>
    <footer className="settings-footer">{error && <p className="form-error" role="alert">{error}</p>}<div><button className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={saving} onClick={() => void save()}><Check size={16} />{saving ? '保存中…' : '保存设置'}</button></div></footer>
  </section>
}
