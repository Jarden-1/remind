import { describe, expect, it } from 'vitest'
import { ReminderEngine, freshPreferences, type BreakEvent } from './reminder-engine'

function setup(overrides: Partial<ReturnType<typeof freshPreferences>> = {}) {
  let mono = 0, wall = new Date(2026, 9, 12, 9, 0).getTime()
  const engine = new ReminderEngine({ monotonic: () => mono, now: () => new Date(wall) }, { ...freshPreferences(), ...overrides })
  const advance = (ms: number) => { while (ms > 0) { const step = Math.min(ms, 1000); mono += step; wall += step; engine.tick(); ms -= step } }
  const jump = (ms: number) => { mono += ms; wall += ms; engine.tick() }
  return { engine, advance, jump, clockJump: (ms: number) => { wall += ms; engine.tick() } }
}
describe('native reminder engine', () => {
  it('holds manual pause across ticks and restart, keeping it independent of lock and suspend', () => {
    const { engine, advance } = setup()
    engine.command('start'); advance(75_000); engine.command('pause')
    const remaining = engine.snapshot.remainingSeconds
    advance(10_000); expect(engine.snapshot.remainingSeconds).toBe(remaining)
    engine.setSystemPause('locked', true); engine.setSystemPause('suspended', true)
    engine.setSystemPause('locked', false)
    expect(engine.snapshot.pauseReasons).toEqual(['manual', 'suspended'])
    engine.setSystemPause('suspended', false)
    expect(engine.snapshot.pauseReasons).toEqual(['manual'])
    const restarted = setup(engine.getPreferences()).engine
    expect(restarted.snapshot.pauseReasons).toEqual(['manual'])
    expect(restarted.snapshot.remainingSeconds).toBe(2700)
  })
  it('pre-reminds once, waits for native readiness, starts a full three minutes, and completes once', () => {
    const { engine, advance } = setup()
    const events: BreakEvent[] = []; engine.onEvent(event => events.push(event))
    engine.command('start'); advance(44 * 60_000)
    expect(engine.snapshot.preReminderVisible).toBe(true)
    engine.command('dismissPreReminder'); advance(30_000)
    expect(engine.snapshot.preReminderVisible).toBe(false)
    advance(30_000)
    expect(engine.snapshot.preparingBreak).toBe(true)
    expect(engine.snapshot.phase).toBe('work')
    advance(4000)
    expect(engine.confirmBreak(engine.generation)).toBe(true)
    expect(engine.snapshot.remainingSeconds).toBe(180)
    advance(180_000)
    expect(engine.snapshot.phase).toBe('work')
    expect(engine.snapshot.remainingSeconds).toBe(2700)
    expect(events.map(event => [event.type, event.outcome])).toEqual([['break.started', undefined], ['break.ended', 'completed']])
  })
  it('restarts the countdown at the full interval and keeps it running', () => {
    const { engine, advance } = setup()
    engine.command('start'); advance(5 * 60_000); engine.command('pause')
    engine.command('resetTimer')
    expect(engine.snapshot.phase).toBe('work')
    expect(engine.snapshot.pauseReasons).toEqual([])
    expect(engine.snapshot.remainingSeconds).toBe(2700)
    advance(60_000)
    expect(engine.snapshot.remainingSeconds).toBe(2640)
  })
  it('ends an active break when the timer is reset and leaves a system pause in place', () => {
    const { engine, advance } = setup()
    engine.command('startBreak'); engine.confirmBreak(engine.generation)
    engine.command('resetTimer')
    expect(engine.snapshot.phase).toBe('work')
    expect(engine.snapshot.remainingSeconds).toBe(2700)
    engine.setSystemPause('locked', true)
    engine.command('resetTimer')
    expect(engine.snapshot.pauseReasons).toEqual(['locked'])
    advance(10_000)
    expect(engine.snapshot.remainingSeconds).toBe(2700)
  })
  it('does not pre-remind for a one minute interval', () => {
    const prefs = freshPreferences(); prefs.settings.workMinutes = 1
    const { engine, advance } = setup(prefs)
    engine.command('start'); advance(30_000)
    expect(engine.snapshot.preReminderVisible).toBe(false)
  })
  it('invalidates delayed window readiness on lock and does not unlock a manual pause', () => {
    const { engine } = setup()
    engine.command('startBreak'); const generation = engine.generation
    engine.setSystemPause('locked', true)
    expect(engine.confirmBreak(generation)).toBe(false)
    expect(engine.snapshot.phase).toBe('ready')
  })
  it('allows voluntary breaks while manually paused or outside work hours, preserving both reasons', () => {
    const prefs = freshPreferences(); prefs.settings.schedule.enabled = true
    prefs.settings.schedule.ranges = [{ start: '10:00', end: '18:00' }]
    const { engine, advance } = setup(prefs)
    engine.command('pause'); engine.command('startBreak'); engine.confirmBreak(engine.generation)
    advance(180_000)
    expect(engine.snapshot.pauseReasons).toEqual(['manual', 'schedule'])
    expect(engine.snapshot.phase).toBe('ready')
  })
  it('ends a break at schedule boundaries and resets for the next period', () => {
    const prefs = freshPreferences(); prefs.settings.schedule.enabled = true
    prefs.settings.schedule.ranges = [{ start: '09:00', end: '09:01' }, { start: '09:02', end: '18:00' }]
    const { engine, advance } = setup(prefs)
    engine.command('start'); engine.command('startBreak'); engine.confirmBreak(engine.generation)
    advance(60_000)
    expect(engine.snapshot.phase).toBe('work')
    expect(engine.snapshot.pauseReasons).toEqual(['schedule'])
    advance(60_000)
    expect(engine.snapshot.pauseReasons).toEqual([])
    expect(engine.snapshot.remainingSeconds).toBe(2700)
  })
  it('keeps the active break duration when settings change', () => {
    const { engine, advance } = setup()
    engine.command('startBreak'); engine.confirmBreak(engine.generation); advance(20_000)
    engine.updateSettings({ ...engine.snapshot.settings, breakMinutes: 5 })
    expect(engine.snapshot.remainingSeconds).toBe(160)
    expect(engine.snapshot.totalSeconds).toBe(180)
    engine.command('endBreak'); engine.command('startBreak'); engine.confirmBreak(engine.generation)
    expect(engine.snapshot.remainingSeconds).toBe(300)
  })
  it('resets after long clock gaps and clock changes instead of immediately covering the screen', () => {
    const { engine, advance, jump, clockJump } = setup()
    engine.command('start'); advance(44 * 60_000)
    jump(10 * 60_000)
    expect(engine.snapshot.remainingSeconds).toBe(2700)
    expect(engine.snapshot.preparingBreak).toBe(false)
    advance(30_000); clockJump(-3600_000)
    expect(engine.snapshot.remainingSeconds).toBe(2700)
  })
  it('does not report a failed window as a completed rest', () => {
    const { engine } = setup()
    const events: BreakEvent[] = []; engine.onEvent(event => events.push(event))
    engine.command('startBreak'); engine.failBreak(engine.generation)
    expect(engine.snapshot.displayError).toBe(true)
    expect(events.map(event => event.outcome)).toEqual(['display_failed'])
    expect(engine.snapshot.remainingSeconds).toBe(2700)
  })
  it('does not pre-remind or open an automatic break due at the end of the current work period', () => {
    const prefs = freshPreferences(); prefs.settings.schedule.enabled = true
    prefs.settings.schedule.ranges = [{ start: '09:00', end: '09:45' }]
    const { engine, advance } = setup(prefs)
    engine.command('start'); advance(44 * 60_000)
    expect(engine.snapshot.lastInPeriod).toBe(true)
    expect(engine.snapshot.preReminderVisible).toBe(false)
    advance(60_000)
    expect(engine.snapshot.pauseReasons).toEqual(['schedule'])
    expect(engine.snapshot.preparingBreak).toBe(false)
  })
  it('pauses for thirty minutes and resumes on its own without refilling the interval', () => {
    const { engine, advance } = setup()
    engine.command('start'); advance(60_000)
    const remaining = engine.snapshot.remainingSeconds
    engine.command('pause30')
    expect(Date.parse(engine.snapshot.pauseUntil!)).toBe(new Date(2026, 9, 12, 9, 31).getTime())
    advance(10 * 60_000)
    expect(engine.snapshot.remainingSeconds).toBe(remaining)
    expect(engine.snapshot.pauseReasons).toEqual(['manual'])
    advance(20 * 60_000)
    expect(engine.takePauseExpired()).toBe(true)
    expect(engine.snapshot.pauseReasons).toEqual([])
    expect(engine.snapshot.pauseUntil).toBe(null)
    advance(60_000)
    expect(engine.snapshot.remainingSeconds).toBe(remaining - 60)
  })
  it('keeps an indefinite pause and a pause that lasts until local midnight', () => {
    const { engine } = setup()
    engine.command('start'); engine.command('pause')
    expect(engine.snapshot.pauseUntil).toBe(null)
    engine.command('pauseUntilTomorrow')
    expect(Date.parse(engine.snapshot.pauseUntil!)).toBe(new Date(2026, 9, 13).getTime())
    engine.command('resume')
    expect(engine.snapshot.pauseReasons).toEqual([])
    expect(engine.getPreferences().pauseUntil).toBe(null)
  })
  it('drops a timed pause that expired while the app was closed', () => {
    const prefs = freshPreferences()
    prefs.started = true; prefs.manualPaused = true; prefs.pauseUntil = new Date(2026, 9, 12, 8).toISOString()
    const { engine } = setup(prefs)
    expect(engine.snapshot.pauseReasons).toEqual([])
    expect(engine.snapshot.pauseUntil).toBe(null)
  })
  it('snoozes an active break for five minutes', () => {
    const { engine } = setup()
    const events: BreakEvent[] = []; engine.onEvent(event => events.push(event))
    engine.command('startBreak'); engine.confirmBreak(engine.generation)
    engine.command('snooze')
    expect(engine.snapshot.phase).toBe('work')
    expect(engine.snapshot.remainingSeconds).toBe(300)
    expect(events.at(-1)?.outcome).toBe('skipped')
  })
})
