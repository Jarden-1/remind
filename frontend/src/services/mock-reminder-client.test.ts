import { describe, expect, it } from 'vitest'
import { MockReminderClient } from './mock-reminder-client'
import { freshPreferences, type PreferenceStore, type SavedPreferences } from './storage'

function setup(startAt = new Date(2026, 9, 12, 10, 0)) {
  let elapsed = 0
  let saved: SavedPreferences | null = null
  const store: PreferenceStore = { read: () => saved, write: value => { saved = structuredClone(value) } }
  const clock = { now: () => new Date(startAt.getTime() + elapsed), monotonic: () => elapsed }
  const client = new MockReminderClient(store, clock, false)
  return { client, store, clock, advance: (ms: number) => { elapsed += ms; client.tick() } }
}

describe('preview reminder state', () => {
  it('resets a paused countdown to the full interval and keeps counting', async () => {
    const { client, advance } = setup()
    await client.start(); advance(5 * 60_000); await client.pause()
    await client.resetTimer(); advance(60_000)
    expect(client.getSnapshot().pauseReasons).toEqual([])
    expect(client.getSnapshot().remainingSeconds).toBe(44 * 60)
  })
  it('freezes manual pause and continues the remaining interval', async () => {
    const { client, advance } = setup()
    await client.start(); advance(5 * 60_000)
    await client.pause(); advance(10 * 60_000)
    expect(client.getSnapshot().remainingSeconds).toBe(40 * 60)
    await client.resume(); advance(60_000)
    expect(client.getSnapshot().remainingSeconds).toBe(39 * 60)
  })
  it('meeting reset keeps a simultaneous manual pause', async () => {
    const { client, advance } = setup()
    await client.start(); advance(5 * 60_000); await client.pause()
    client.setMeeting(true); advance(60_000); client.setMeeting(false)
    expect(client.getSnapshot().pauseReasons).toEqual(['manual'])
    await client.resume()
    expect(client.getSnapshot().remainingSeconds).toBe(45 * 60)
  })
  it('warns once per cycle, then starts and automatically ends a three minute break', async () => {
    const { client, advance } = setup()
    await client.start(); advance(44 * 60_000)
    expect(client.getSnapshot().preReminderVisible).toBe(true)
    await client.pause(); await client.resume(); advance(1000)
    expect(client.getSnapshot().preReminderVisible).toBe(false)
    advance(59_000)
    expect(client.getSnapshot().phase).toBe('break')
    expect(client.getSnapshot().remainingSeconds).toBe(180)
    advance(180_000)
    expect(client.getSnapshot().phase).toBe('work')
    expect(client.getSnapshot().remainingSeconds).toBe(45 * 60)
  })
  it('does not warn at the start of a one minute interval', async () => {
    const { client, advance } = setup()
    await client.updateSettings({ ...client.getSnapshot().settings, workMinutes: 1 })
    await client.start(); advance(1000)
    expect(client.getSnapshot().preReminderVisible).toBe(false)
    advance(59_000)
    expect(client.getSnapshot().phase).toBe('break')
  })
  it('keeps manual pause after a voluntary break, and preserves active break duration', async () => {
    const { client } = setup()
    await client.start(); await client.pause(); await client.startBreak()
    await client.updateSettings({ ...client.getSnapshot().settings, breakMinutes: 5 })
    expect(client.getSnapshot().remainingSeconds).toBe(180)
    await client.endBreak()
    expect(client.getSnapshot().pauseReasons).toContain('manual')
    await client.startBreak()
    expect(client.getSnapshot().remainingSeconds).toBe(300)
  })
  it('suppresses reminders at the exact end of a work period and starts next period in full', async () => {
    const { client, advance } = setup(new Date(2026, 9, 12, 11, 15))
    const settings = client.getSnapshot().settings
    settings.schedule = { enabled: true, days: [1], ranges: [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '18:00' }] }
    await client.updateSettings(settings); await client.start()
    expect(client.getSnapshot().lastInPeriod).toBe(true)
    advance(44 * 60_000)
    expect(client.getSnapshot().preReminderVisible).toBe(false)
    advance(60_000)
    expect(client.getSnapshot().phase).toBe('work')
    expect(client.getSnapshot().pauseReasons).toContain('schedule')
    advance(60 * 60_000)
    expect(client.getSnapshot().pauseReasons).toEqual([])
    expect(client.getSnapshot().remainingSeconds).toBe(45 * 60)
  })
  it('reloads preferences without restoring an expired countdown or break', async () => {
    const { client, store, clock, advance } = setup()
    await client.start(); advance(5 * 60_000); await client.pause()
    const reloaded = new MockReminderClient(store, clock, false)
    expect(reloaded.getSnapshot().pauseReasons).toContain('manual')
    expect(reloaded.getSnapshot().remainingSeconds).toBe(45 * 60)
    expect(reloaded.getSnapshot().phase).toBe('work')
  })
  it('exposes storage failures rather than claiming a successful save', async () => {
    const client = new MockReminderClient({ read: () => freshPreferences(), write: () => { throw new Error('disk full') } }, undefined, false)
    await expect(client.updateSettings(client.getSnapshot().settings)).rejects.toThrow('无法保存')
    expect(client.getSnapshot().storageError).toBe(true)
  })
  it('changing the sound preference preserves automatic pause reasons', async () => {
    const { client } = setup()
    await client.start()
    client.setOutsideSchedule(true)
    client.setMeeting(true)
    await client.updateSettings({ ...client.getSnapshot().settings, sound: true })
    expect(client.getSnapshot().pauseReasons).toEqual(['meeting', 'schedule'])
  })
})

it('shows a full snooze cycle independent of the configured interval', async () => {
  const { client } = setup()
  await client.updateSettings({ ...client.getSnapshot().settings, workMinutes: 1 })
  await client.startBreak(); await client.snooze()
  expect(client.getSnapshot().remainingSeconds).toBe(300)
  expect(client.getSnapshot().totalSeconds).toBe(300)
})
