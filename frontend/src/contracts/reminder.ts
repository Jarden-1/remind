/** UI contract only. A desktop IPC adapter can replace the preview client. */
export type Theme = 'system' | 'light' | 'dark'
export interface TimeRange { start: string; end: string }
export interface ReminderSettings {
  workMinutes: number
  breakMinutes: number
  preReminder: boolean
  sound: boolean
  meetingPause: boolean
  theme: Theme
  schedule: { enabled: boolean; days: number[]; ranges: TimeRange[] }
}
export type PauseReason = 'manual' | 'meeting' | 'schedule'
export interface ReminderSnapshot {
  revision: number
  phase: 'ready' | 'work' | 'break'
  settings: ReminderSettings
  remainingSeconds: number
  totalSeconds: number
  pauseReasons: PauseReason[]
  preReminderVisible: boolean
  lastInPeriod: boolean
  nextWorkAt: string | null
  storageError: boolean
}
export interface ReminderClient {
  getSnapshot(): ReminderSnapshot
  subscribe(listener: () => void): () => void
  start(): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  startBreak(): Promise<void>
  endBreak(): Promise<void>
  dismissPreReminder(): Promise<void>
  updateSettings(settings: ReminderSettings): Promise<void>
}
/** Preview controls deliberately stay outside the production UI contract. */
export interface PreviewControls {
  setMeeting(active: boolean): void
  setOutsideSchedule(active: boolean): void
  advanceToPreReminder(): void
  advanceToBreak(): void
  reset(): void
}
export const DEFAULT_SETTINGS: ReminderSettings = {
  workMinutes: 45, breakMinutes: 3, preReminder: true, sound: false,
  meetingPause: false, theme: 'system',
  schedule: { enabled: false, days: [1, 2, 3, 4, 5], ranges: [{ start: '09:00', end: '18:00' }] },
}
