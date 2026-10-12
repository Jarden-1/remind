import { DEFAULT_SETTINGS, type PauseReason, type ReminderSettings, type ReminderSnapshot } from '../../shared/reminder'
import type { Preferences, ReminderCommand } from '../../shared/desktop'
import { getScheduleState } from '../../shared/schedule'

export interface Clock { monotonic(): number; now(): Date }
export type BreakEvent = { version: 1; type: 'break.started' | 'break.ended'; id: string; at: string; outcome?: 'completed' | 'skipped' | 'interrupted' | 'display_failed' }
export const freshPreferences = (): Preferences => ({ settings: structuredClone(DEFAULT_SETTINGS), started: false, manualPaused: false, openAtLogin: false, pauseUntil: null })

/** The main process is the sole clock. Renderers only send intent and display snapshots. */
export class ReminderEngine {
  private preferences: Preferences
  private listeners = new Set<() => void>()
  private events = new Set<(event: BreakEvent) => void>()
  private system = new Set<PauseReason>()
  private remainingMs: number
  private breakTotalMs = 0
  private breaking = false
  private preparing = false
  private scheduleAllowed: boolean
  private lastMono: number
  private lastWall: number
  private preSent = false
  private preVisible = false
  private preUntil = 0
  private revision = 0
  private storageError = false
  private displayError = false
  private manualBreakOutside = false
  private sessionId = globalThis.crypto.randomUUID()
  private pauseExpired = false
  generation = 0
  snapshot!: ReminderSnapshot

  constructor(private clock: Clock, preferences = freshPreferences()) {
    this.preferences = structuredClone(preferences)
    this.preferences.pauseUntil ??= null
    if (this.preferences.manualPaused && this.preferences.pauseUntil && Date.parse(this.preferences.pauseUntil) <= clock.now().getTime()) {
      this.preferences.manualPaused = false
      this.preferences.pauseUntil = null
    }
    this.remainingMs = this.workMs
    this.lastMono = clock.monotonic()
    this.lastWall = clock.now().getTime()
    this.scheduleAllowed = getScheduleState(this.settings, clock.now()).allowed
    this.publish()
  }
  private get settings() { return this.preferences.settings }
  private get workMs() { return this.settings.workMinutes * 60_000 }
  getPreferences() { return structuredClone(this.preferences) }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  onEvent(listener: (event: BreakEvent) => void) { this.events.add(listener); return () => { this.events.delete(listener) } }
  private emit(event: BreakEvent) { for (const listener of this.events) listener(event) }
  private reasons(): PauseReason[] {
    return [...(this.preferences.manualPaused ? ['manual' as const] : []), ...this.system, ...(!this.scheduleAllowed ? ['schedule' as const] : [])]
  }
  private reset() { this.remainingMs = this.workMs; this.preSent = false; this.preVisible = false }
  private interrupt(outcome: 'completed' | 'skipped' | 'interrupted' | 'display_failed') {
    const active = this.breaking || this.preparing
    this.breaking = false; this.preparing = false; this.manualBreakOutside = false
    if (active) this.emit({ version: 1, type: 'break.ended', id: `${this.sessionId}:${this.generation}`, at: this.clock.now().toISOString(), outcome })
    this.generation++; this.reset()
  }
  private publish() {
    const schedule = getScheduleState(this.settings, this.clock.now())
    this.snapshot = {
      revision: ++this.revision, phase: this.breaking ? 'break' : this.preferences.started ? 'work' : 'ready',
      settings: structuredClone(this.settings), remainingSeconds: Math.ceil(this.remainingMs / 1000),
      totalSeconds: (this.breaking ? this.breakTotalMs : this.workMs) / 1000,
      pauseReasons: this.reasons(), pauseUntil: this.preferences.manualPaused ? this.preferences.pauseUntil : null, preReminderVisible: this.preVisible,
      lastInPeriod: Boolean(schedule.endAt && this.clock.now().getTime() + this.remainingMs >= schedule.endAt.getTime()),
      nextWorkAt: schedule.nextAt?.toISOString() ?? null,
      storageError: this.storageError, displayError: this.displayError, preparingBreak: this.preparing,
    }
    for (const listener of this.listeners) listener()
  }
  private markTime() { this.lastMono = this.clock.monotonic(); this.lastWall = this.clock.now().getTime() }
  /** True once, after a timed pause reaches its deadline, so the host can persist the resume. */
  takePauseExpired() { const expired = this.pauseExpired; this.pauseExpired = false; return expired }
  private clearManualPause() { this.preferences.manualPaused = false; this.preferences.pauseUntil = null }
  private expirePause() {
    const until = this.preferences.pauseUntil
    if (!this.preferences.manualPaused || !until || this.clock.now().getTime() < Date.parse(until)) return false
    this.clearManualPause(); this.markTime(); this.pauseExpired = true; return true
  }
  private beginManualPause(until: string | null) {
    this.preVisible = false
    if (this.preparing || this.breaking) this.interrupt('interrupted')
    this.preferences.manualPaused = true
    this.preferences.pauseUntil = until
  }
  tick() {
    const mono = this.clock.monotonic(), wall = this.clock.now().getTime()
    const elapsed = Math.max(0, mono - this.lastMono)
    const discontinuity = elapsed > 15_000 || Math.abs(wall - this.lastWall - elapsed) > 5000
    this.lastMono = mono; this.lastWall = wall
    if (this.expirePause()) { this.publish(); return }
    const allowed = getScheduleState(this.settings, this.clock.now()).allowed
    if (allowed !== this.scheduleAllowed) {
      this.scheduleAllowed = allowed
      this.interrupt('interrupted')
      this.publish(); return
    }
    // Sleep, throttling, or a wall clock jump must not cause a surprise full-screen break.
    // A manual pause already freezes the countdown, so a sleep during that pause must not refill it.
    if (discontinuity && !this.preferences.manualPaused) { this.interrupt('interrupted'); this.publish(); return }
    if (this.preVisible && mono >= this.preUntil) this.preVisible = false
    if (this.breaking) {
      this.remainingMs = Math.max(0, this.remainingMs - elapsed)
      if (this.remainingMs === 0) this.interrupt('completed')
    } else if (this.preferences.started && !this.reasons().length && !this.preparing) {
      this.remainingMs = Math.max(0, this.remainingMs - elapsed)
      const scheduleEnd = getScheduleState(this.settings, this.clock.now()).endAt
      const lastInPeriod = Boolean(scheduleEnd && wall + this.remainingMs >= scheduleEnd.getTime())
      if (!lastInPeriod && !this.preSent && this.settings.preReminder && this.settings.workMinutes > 1 && this.remainingMs <= 60_000 && this.remainingMs > 0) {
        this.preSent = true; this.preVisible = true; this.preUntil = mono + 12_000
      }
      if (!lastInPeriod && this.remainingMs === 0) this.requestBreak(false)
    }
    this.publish()
  }
  command(command: ReminderCommand) {
    this.tick()
    if (command === 'start' && !this.preferences.started && !this.breaking && !this.preparing) { this.preferences.started = true; this.clearManualPause(); this.reset() }
    if (command === 'resetTimer') {
      if (this.preparing || this.breaking) this.interrupt('interrupted')
      this.preferences.started = true
      this.clearManualPause()
      this.preVisible = false
      this.reset()
    }
    if (command === 'pause') this.beginManualPause(null)
    if (command === 'pause30') this.beginManualPause(new Date(this.clock.now().getTime() + 30 * 60_000).toISOString())
    if (command === 'pause60') this.beginManualPause(new Date(this.clock.now().getTime() + 60 * 60_000).toISOString())
    if (command === 'pauseUntilTomorrow') {
      const next = new Date(this.clock.now().getTime())
      next.setHours(24, 0, 0, 0)
      this.beginManualPause(next.toISOString())
    }
    if (command === 'resume') { this.preferences.started = true; this.clearManualPause() }
    if (command === 'startBreak') this.requestBreak(true)
    if (command === 'endBreak') { if (this.breaking || this.preparing) this.interrupt('skipped') }
    if (command === 'snooze' && (this.breaking || this.preparing)) {
      this.interrupt('skipped')
      this.preferences.started = true
      this.clearManualPause()
      this.remainingMs = 5 * 60_000
      this.preSent = false
      this.preVisible = false
    }
    if (command === 'dismissPreReminder') this.preVisible = false
    this.markTime(); this.publish()
  }
  private requestBreak(manual: boolean) {
    if (this.breaking || this.preparing || this.system.size || (!manual && this.reasons().length)) return
    this.generation++; this.preparing = true; this.preVisible = false; this.displayError = false
    this.manualBreakOutside = manual && !this.scheduleAllowed
  }
  /** Only native window readiness can begin the break; renderer commands cannot. */
  confirmBreak(generation: number) {
    if (generation !== this.generation || !this.preparing || this.system.size || (!this.manualBreakOutside && !this.scheduleAllowed)) return false
    this.breaking = true; this.preparing = false
    this.breakTotalMs = this.settings.breakMinutes * 60_000; this.remainingMs = this.breakTotalMs
    this.markTime()
    this.emit({ version: 1, type: 'break.started', id: `${this.sessionId}:${generation}`, at: this.clock.now().toISOString() })
    this.publish(); return true
  }
  failBreak(generation: number) {
    if (generation !== this.generation) return
    this.interrupt('display_failed'); this.displayError = true; this.publish()
  }
  setSystemPause(reason: 'locked' | 'suspended' | 'updating', active: boolean) {
    if (this.system.has(reason) === active) return
    if (active) this.system.add(reason); else this.system.delete(reason)
    this.interrupt('interrupted'); this.markTime(); this.publish()
  }
  updateSettings(settings: ReminderSettings) {
    this.tick()
    const reset = settings.workMinutes !== this.settings.workMinutes || JSON.stringify(settings.schedule) !== JSON.stringify(this.settings.schedule)
    this.preferences.settings = structuredClone(settings)
    const allowed = getScheduleState(settings, this.clock.now()).allowed
    if (allowed !== this.scheduleAllowed) { this.scheduleAllowed = allowed; this.interrupt('interrupted') }
    else if (reset && !this.breaking) { this.interrupt('interrupted') }
    if (!settings.preReminder) this.preVisible = false
    this.markTime(); this.publish()
  }
  setStorageError(value: boolean) { this.storageError = value; this.publish() }
  setOpenAtLogin(openAtLogin: boolean) { this.preferences.openAtLogin = openAtLogin }
}
