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
})
