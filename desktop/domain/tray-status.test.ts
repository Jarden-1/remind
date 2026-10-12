import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type ReminderSnapshot } from '../../shared/reminder'
import { trayPresentation } from './tray-status'

function snap(partial: Partial<ReminderSnapshot> = {}): ReminderSnapshot {
  return {
    revision: 1, phase: 'work', settings: DEFAULT_SETTINGS,
    remainingSeconds: 32 * 60 + 18, totalSeconds: 45 * 60, pauseReasons: [],
    preReminderVisible: false, lastInPeriod: false, nextWorkAt: null, storageError: false,
    ...partial,
  }
}

describe('tray presentation', () => {
  it('shows the countdown to the next break while timing', () => {
    expect(trayPresentation(snap())).toEqual({ title: '32:18', tooltip: 'remind · 距离休息 32:18' })
  })

  it('shows a break state with the remaining rest time', () => {
    expect(trayPresentation(snap({ phase: 'break', remainingSeconds: 125, totalSeconds: 180 }))).toEqual({
      title: '休息 02:05', tooltip: 'remind · 休息中 · 剩余 02:05',
    })
  })

  it('shows a pause indicator and keeps the frozen countdown', () => {
    expect(trayPresentation(snap({ pauseReasons: ['manual'] }))).toEqual({
      title: '暂停 32:18', tooltip: 'remind · 已暂停 · 剩余 32:18',
    })
  })

  it('prefers a short state over the countdown when work is not progressing', () => {
    expect(trayPresentation(snap({ pauseReasons: ['meeting', 'manual'] })).title).toBe('会议')
    expect(trayPresentation(snap({ pauseReasons: ['manual', 'locked'] }))).toEqual({
      title: '暂停', tooltip: 'remind · 已暂停 · 已锁屏',
    })
    expect(trayPresentation(snap({ pauseReasons: ['schedule'] })).title).toBe('时段外')
    expect(trayPresentation(snap({ lastInPeriod: true })).title).toBe('等待')
    expect(trayPresentation(snap({ phase: 'ready' })).title).toBe('未开始')
    expect(trayPresentation(snap({ preparingBreak: true })).title).toBe('准备')
  })
})
