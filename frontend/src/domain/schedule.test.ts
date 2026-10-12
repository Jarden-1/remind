import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../contracts/reminder'
import { getScheduleState, validateSettings } from './schedule'

function scheduled() {
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.schedule.enabled = true
  settings.schedule.ranges = [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '18:00' }]
  return settings
}

describe('work schedule', () => {
  it('includes the start and excludes the end, with a lunch break', () => {
    const settings = scheduled()
    expect(getScheduleState(settings, new Date(2026, 9, 12, 9, 0)).allowed).toBe(true)
    const lunch = getScheduleState(settings, new Date(2026, 9, 12, 12, 0))
    expect(lunch.allowed).toBe(false)
    expect(lunch.nextAt).toEqual(new Date(2026, 9, 12, 13, 0))
    expect(getScheduleState(settings, new Date(2026, 9, 12, 18, 0)).allowed).toBe(false)
  })
  it('finds Monday after Friday evening', () => {
    expect(getScheduleState(scheduled(), new Date(2026, 9, 16, 19, 0)).nextAt).toEqual(new Date(2026, 9, 19, 9, 0))
  })
  it('rejects overlapping and overnight periods, and invalid durations', () => {
    const settings = scheduled()
    settings.schedule.ranges[1].start = '11:00'
    expect(validateSettings(settings)).toContain('重叠')
    settings.schedule.ranges = [{ start: '22:00', end: '06:00' }]
    expect(validateSettings(settings)).toContain('跨午夜')
    settings.workMinutes = NaN
    expect(validateSettings(settings)).toContain('整数')
  })
})
