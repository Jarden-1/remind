import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { ReminderSettings } from '../contracts/reminder'
import { Toggle } from '../components/Toggle'
import type { SettingsIssue } from '../../../shared/schedule'

type Schedule = ReminderSettings['schedule']
type Mode = 'weekdays' | 'everyday' | 'custom'
const WEEKDAYS = [1, 2, 3, 4, 5]
const DAYS = [
  { value: 1, label: '一' }, { value: 2, label: '二' }, { value: 3, label: '三' },
  { value: 4, label: '四' }, { value: 5, label: '五' }, { value: 6, label: '六' }, { value: 0, label: '日' },
]
const PRESETS: { value: Mode; label: string; description: string }[] = [
  { value: 'weekdays', label: '工作日', description: '周一至周五' },
  { value: 'everyday', label: '每天', description: '周一至周日' },
  { value: 'custom', label: '自定义', description: '自己选日期' },
]

export function ScheduleEditor({ value, onChange, issue }: { value: Schedule; onChange: (value: Schedule) => void; issue?: SettingsIssue | null }) {
  const [mode, setMode] = useState<Mode>(() => value.days.length === 7 ? 'everyday'
    : value.days.length === 5 && WEEKDAYS.every(day => value.days.includes(day)) ? 'weekdays' : 'custom')
  function edit(patch: Partial<Schedule>) {
    onChange({ ...value, ...patch, enabled: true })
  }
  function choose(next: Mode) {
    setMode(next)
    edit({ days: next === 'weekdays' ? [...WEEKDAYS] : next === 'everyday' ? DAYS.map(day => day.value) : value.days })
  }

  return <div className="schedule-settings">
    <Toggle label="限定工作时段" description="时段外不提醒" checked={value.enabled} onChange={enabled => onChange({ ...value, enabled })} />
    <div className="schedule-editor">
      <p className="field-caption">重复日期</p>
      <div className="schedule-presets" aria-label="工作日期快捷选项">
        {PRESETS.map(preset => <button key={preset.value} title={preset.description} aria-pressed={mode === preset.value}
          className={mode === preset.value ? 'selected' : ''} onClick={() => choose(preset.value)}>
          {preset.label}
        </button>)}
      </div>
      {mode === 'custom' && <div className="day-picker" aria-label="自选工作日">
        {DAYS.map((day, index) => <button key={day.value} aria-label={`星期${day.label}`} aria-pressed={value.days.includes(day.value)} aria-invalid={issue?.field === 'days' && index === 0} aria-describedby={issue?.field === 'days' ? 'days-error' : undefined}
          className={value.days.includes(day.value) ? 'selected' : ''}
          onClick={() => edit({ days: value.days.includes(day.value) ? value.days.filter(item => item !== day.value) : [...value.days, day.value] })}>{day.label}</button>)}
      </div>}
      {issue?.field === 'days' && <p className="field-error" id="days-error" role="alert">{issue.message}</p>}
      <div className="schedule-time-heading"><p className="field-caption">提醒时段</p>
        <button className="text-button" onClick={() => edit({ ranges: [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '18:00' }] })}>午休分段</button>
      </div>
      {value.ranges.map((range, index) => <div className="time-range-field" key={index}><div className="time-range">
        <input type="time" aria-label={`时段 ${index + 1} 开始`} aria-invalid={issue?.field === 'ranges' && issue.index === index && issue.part === 'start'} aria-describedby={issue?.field === 'ranges' && issue.index === index ? `range-${index}-error` : undefined} value={range.start}
          onChange={event => edit({ ranges: value.ranges.map((item, i) => i === index ? { ...item, start: event.target.value } : item) })} />
        <span aria-hidden="true">至</span>
        <input type="time" aria-label={`时段 ${index + 1} 结束`} aria-invalid={issue?.field === 'ranges' && issue.index === index && issue.part === 'end'} aria-describedby={issue?.field === 'ranges' && issue.index === index ? `range-${index}-error` : undefined} value={range.end}
          onChange={event => edit({ ranges: value.ranges.map((item, i) => i === index ? { ...item, end: event.target.value } : item) })} />
        <button className="icon-button" aria-label={`删除时段 ${index + 1}`} disabled={value.ranges.length === 1}
          onClick={() => edit({ ranges: value.ranges.filter((_, i) => i !== index) })}><X size={15} /></button>
      </div>{issue?.field === 'ranges' && issue.index === index && <p className="field-error" id={`range-${index}-error`} role="alert">{issue.message}</p>}</div>)}
      <button className="text-button" disabled={value.ranges.length >= 12} onClick={() => edit({ ranges: [...value.ranges, { start: '', end: '' }] })}><Plus size={14} />添加时段</button>
      {issue?.field === 'ranges' && issue.index === undefined && <p className="field-error" role="alert">{issue.message}</p>}
    </div>
  </div>
}
