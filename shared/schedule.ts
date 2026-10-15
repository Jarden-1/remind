import type { ReminderSettings } from './reminder'

export function toMinutes(value: string) {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

export interface SettingsIssue { field: 'workMinutes' | 'breakMinutes' | 'theme' | 'days' | 'ranges'; message: string; index?: number; part?: 'start' | 'end' }

export function getSettingsIssue(settings: ReminderSettings): SettingsIssue | null {
  if (!Number.isInteger(settings.workMinutes) || settings.workMinutes < 1 || settings.workMinutes > 240)
    return { field: 'workMinutes', message: '请输入 1–240 的整数' }
  if (!Number.isInteger(settings.breakMinutes) || settings.breakMinutes < 1 || settings.breakMinutes > 30)
    return { field: 'breakMinutes', message: '请输入 1–30 的整数' }
  if (!['system', 'light', 'dark'].includes(settings.theme)) return { field: 'theme', message: '请选择有效的外观' }
  if (!settings.schedule.days.length || settings.schedule.days.some(day => !Number.isInteger(day) || day < 0 || day > 6))
    return { field: 'days', message: '请至少选择一个工作日' }
  if (!settings.schedule.ranges.length || settings.schedule.ranges.length > 12) return { field: 'ranges', message: '请设置 1–12 个工作时段' }
  const ranges = settings.schedule.ranges.map((range, index) => ({ ...range, index })).sort((a, b) => a.start.localeCompare(b.start))
  for (let index = 0; index < ranges.length; index++) {
    const { start, end, index: originalIndex } = ranges[index]
    for (const part of ['start', 'end'] as const) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(ranges[index][part])) return { field: 'ranges', index: originalIndex, part, message: '请填写完整的开始和结束时间' }
    }
    if (toMinutes(start) >= toMinutes(end)) return { field: 'ranges', index: originalIndex, part: 'end', message: '结束需晚于开始，跨午夜请拆成两个时段' }
    if (index > 0 && toMinutes(start) < toMinutes(ranges[index - 1].end)) return { field: 'ranges', index: originalIndex, part: 'start', message: '时段有重叠，请调整后保存' }
  }
  return null
}

export function validateSettings(settings: ReminderSettings): string | null { return getSettingsIssue(settings)?.message ?? null }

export function getScheduleState(settings: ReminderSettings, now: Date) {
  if (!settings.schedule.enabled) return { allowed: true, endAt: null, nextAt: null }
  const minutes = now.getHours() * 60 + now.getMinutes()
  // Adjacent ranges are continuous work, not an artificial end-of-period boundary.
  const ranges: typeof settings.schedule.ranges = []
  for (const range of [...settings.schedule.ranges].sort((a, b) => a.start.localeCompare(b.start))) {
    const previous = ranges.at(-1)
    if (previous && toMinutes(range.start) <= toMinutes(previous.end)) {
      if (toMinutes(range.end) > toMinutes(previous.end)) previous.end = range.end
    } else ranges.push({ ...range })
  }
  if (settings.schedule.days.includes(now.getDay())) {
    const current = ranges.find(range => minutes >= toMinutes(range.start) && minutes < toMinutes(range.end))
    if (current) {
      const endAt = new Date(now)
      endAt.setHours(Math.floor(toMinutes(current.end) / 60), toMinutes(current.end) % 60, 0, 0)
      return { allowed: true, endAt, nextAt: null }
    }
  }
  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(now)
    day.setDate(day.getDate() + offset)
    if (!settings.schedule.days.includes(day.getDay())) continue
    for (const range of ranges) {
      const startAt = new Date(day)
      startAt.setHours(Math.floor(toMinutes(range.start) / 60), toMinutes(range.start) % 60, 0, 0)
      if (startAt > now) return { allowed: false, endAt: null, nextAt: startAt }
    }
  }
  return { allowed: false, endAt: null, nextAt: null }
}
