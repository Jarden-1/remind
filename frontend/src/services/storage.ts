import { DEFAULT_SETTINGS, type ReminderSettings } from '../contracts/reminder'
import { validateSettings } from '../domain/schedule'

export interface SavedPreferences { settings: ReminderSettings; started: boolean; manualPaused: boolean }
export interface PreferenceStore { read(): SavedPreferences | null; write(value: SavedPreferences): void }
const KEY = 'remind.preview.v1'

export class BrowserPreferenceStore implements PreferenceStore {
  read(): SavedPreferences | null {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    // Validate at the persistence boundary; the UI never consumes arbitrary stored data.
    const value = JSON.parse(raw) as SavedPreferences
    const s = value.settings
    if (!s || typeof value.started !== 'boolean' || typeof value.manualPaused !== 'boolean' ||
      typeof s.sound !== 'boolean' || typeof s.preReminder !== 'boolean' || typeof s.meetingPause !== 'boolean' ||
      !s.schedule || typeof s.schedule.enabled !== 'boolean' || !Array.isArray(s.schedule.days) ||
      !Array.isArray(s.schedule.ranges) || validateSettings(s)) throw new Error('Invalid preferences')
    return { ...value, settings: structuredClone(s) }
  }
  write(value: SavedPreferences) { localStorage.setItem(KEY, JSON.stringify(value)) }
}

export function freshPreferences(): SavedPreferences {
  return { settings: structuredClone(DEFAULT_SETTINGS), started: false, manualPaused: false }
}
