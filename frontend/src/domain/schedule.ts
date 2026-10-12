import type { ReminderSettings } from '../contracts/reminder'

export function toMinutes(value: string) {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

export function validateSettings(settings: ReminderSettings): string | null {
  if (!Number.isInteger(settings.workMinutes) || settings.workMinutes < 1 || settings.workMinutes > 240)
    return '提醒间隔需要是 1–240 之间的整数。'
  if (!Number.isInteger(settings.breakMinutes) || settings.breakMinutes < 1 || settings.breakMinutes > 30)
    return '休息时长需要是 1–30 之间的整数。'
  if (!['system', 'light', 'dark'].includes(settings.theme)) return '请选择有效的外观。'
  if (!settings.schedule.days.length || settings.schedule.days.some(day => !Number.isInteger(day) || day < 0 || day > 6))
    return '请至少选择一个工作日。'
  if (!settings.schedule.ranges.length) return '请至少添加一个工作时段。'
  const ranges = [...settings.schedule.ranges].sort((a, b) => a.start.localeCompare(b.start))
  for (let index = 0; index < ranges.length; index++) {
    const { start, end } = ranges[index]
    if (![start, end].every(value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value))) return '请填写完整的开始和结束时间。'
    if (toMinutes(start) >= toMinutes(end)) return '结束时间需要晚于开始时间；跨午夜请拆成两个时段。'
    if (index > 0 && toMinutes(start) < toMinutes(ranges[index - 1].end)) return '工作时段有重叠，请调整后保存。'
  }
  return null
}

export function getScheduleState(settings: ReminderSettings, now: Date) {
  if (!settings.schedule.enabled) return { allowed: true, endAt: null, nextAt: null }
  const minutes = now.getHours() * 60 + now.getMinutes()
  const ranges = [...settings.schedule.ranges].sort((a, b) => a.start.localeCompare(b.start))
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
