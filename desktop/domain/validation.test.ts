import { describe, expect, it } from 'vitest'
import { settingsSchema } from './validation'
import { DEFAULT_SETTINGS } from '../../shared/reminder'

describe('IPC settings boundary', () => {
  it('accepts custom work times but rejects malformed, overlapping, or unimplemented meeting settings', () => {
    expect(settingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true)
    for (const invalid of [null, {}, { ...DEFAULT_SETTINGS, sound: 'true' }, { ...DEFAULT_SETTINGS, workMinutes: 0 }, { ...DEFAULT_SETTINGS, meetingPause: true }, { ...DEFAULT_SETTINGS, schedule: { enabled: true, days: [1], ranges: [{ start: '09:00', end: '18:00' }, { start: '10:00', end: '11:00' }] } }]) expect(settingsSchema.safeParse(invalid).success).toBe(false)
  })
})
