import type { ReminderSettings, ReminderSnapshot } from './reminder'
import type { LoginItemState } from './login-item'

export interface Preferences { settings: ReminderSettings; started: boolean; manualPaused: boolean; openAtLogin: boolean; loginItemChosen: boolean; pauseUntil: string | null }
export const commands = ['start', 'pause', 'pause30', 'pause60', 'pauseUntilTomorrow', 'resume', 'resetTimer', 'startBreak', 'endBreak', 'snooze', 'dismissPreReminder'] as const
export type ReminderCommand = typeof commands[number]
export type DesktopView = 'panel' | 'break' | 'notice'
export type UpdateDelivery = 'native' | 'browser'
export interface UpdateSnapshot {
  revision: number
  currentVersion: string
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'current' | 'error' | 'unsupported'
  /** native: download and install in the app. browser: unsigned Mac builds open the release page instead. */
  delivery: UpdateDelivery
  version: string | null
  progress: number
  message: string | null
}
export interface DesktopState { reminder: ReminderSnapshot; update: UpdateSnapshot; launchAtLogin: boolean; loginItem: LoginItemState }
export interface LaunchAtLoginResult { openAtLogin: boolean; message: string | null; approvalNeeded: boolean }
export interface DesktopBridge {
  state(): Promise<DesktopState>
  subscribe(listener: (state: DesktopState) => void): () => void
  command(command: ReminderCommand): Promise<void>
  settings(settings: ReminderSettings): Promise<void>
  update(action: 'check' | 'download' | 'install' | 'releases'): Promise<void>
  panel(settingsOpen: boolean): Promise<void>
  ready(): Promise<void>
  minimize(): Promise<void>
  quit(): Promise<void>
  setLaunchAtLogin(enabled: boolean): Promise<LaunchAtLoginResult>
  refreshLaunchAtLogin(): Promise<void>
  openLoginItemsSettings(): Promise<void>
}

declare global { interface Window { remind?: DesktopBridge } }
