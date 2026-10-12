import type { ReminderSettings, ReminderSnapshot } from './reminder'

export interface Preferences { settings: ReminderSettings; started: boolean; manualPaused: boolean }
export const commands = ['start', 'pause', 'resume', 'startBreak', 'endBreak', 'dismissPreReminder'] as const
export type ReminderCommand = typeof commands[number]
export type DesktopView = 'panel' | 'break' | 'notice'
export interface UpdateSnapshot {
  revision: number
  currentVersion: string
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'current' | 'error' | 'unsupported'
  version: string | null
  progress: number
  message: string | null
}
export interface DesktopState { reminder: ReminderSnapshot; update: UpdateSnapshot }
export interface DesktopBridge {
  state(): Promise<DesktopState>
  subscribe(listener: (state: DesktopState) => void): () => void
  command(command: ReminderCommand): Promise<void>
  settings(settings: ReminderSettings): Promise<void>
  update(action: 'check' | 'download' | 'install' | 'releases'): Promise<void>
  panel(settingsOpen: boolean): Promise<void>
  ready(): Promise<void>
}

declare global { interface Window { remind?: DesktopBridge } }
