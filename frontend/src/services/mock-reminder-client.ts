import { type ReminderClient, type ReminderSettings, type ReminderSnapshot, type PreviewControls } from '../contracts/reminder'
import { getScheduleState, validateSettings } from '../domain/schedule'
import { freshPreferences, type PreferenceStore, type SavedPreferences } from './storage'

interface Clock { now(): Date; monotonic(): number }
const browserClock: Clock = { now: () => new Date(), monotonic: () => performance.now() }

/** Local simulation, not a background or system meeting detector. */
export class MockReminderClient implements ReminderClient, PreviewControls {
  private prefs: SavedPreferences
  private listeners = new Set<() => void>()
  private remainingMs: number
  private breakTotalMs = 0
  private isBreak = false
  private meeting = false
  private outsideOverride: boolean | null = null
  private previouslyOutside = false
  private preSent = false
  private preVisible = false
  private preHideAt = 0
  private lastTick: number
  private storageError = false
  private snapshot!: ReminderSnapshot
  private interval?: ReturnType<typeof setInterval>

  constructor(private store: PreferenceStore, private clock: Clock = browserClock, autoTick = true) {
    try { this.prefs = store.read() ?? freshPreferences() }
    catch { this.prefs = freshPreferences(); this.storageError = true }
    this.remainingMs = this.prefs.settings.workMinutes * 60_000
    this.lastTick = clock.monotonic()
    this.previouslyOutside = !getScheduleState(this.prefs.settings, clock.now()).allowed
    this.publish()
    if (autoTick) this.interval = setInterval(() => this.tick(), 250)
  }
  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  dispose() { clearInterval(this.interval); this.listeners.clear() }
  private save() {
    try { this.store.write(this.prefs); this.storageError = false }
    catch { this.storageError = true }
  }
  private resetCycle() {
    this.isBreak = false; this.remainingMs = this.prefs.settings.workMinutes * 60_000
    this.preSent = false; this.preVisible = false; this.lastTick = this.clock.monotonic()
  }
  private reasons() {
    const reasons: ReminderSnapshot['pauseReasons'] = []
    if (this.prefs.manualPaused) reasons.push('manual')
    if (this.meeting) reasons.push('meeting')
    if (this.outsideOverride ?? !getScheduleState(this.prefs.settings, this.clock.now()).allowed) reasons.push('schedule')
    return reasons
  }
  private publish() {
    const schedule = getScheduleState(this.prefs.settings, this.clock.now())
    this.snapshot = {
      revision: (this.snapshot?.revision ?? 0) + 1,
      phase: this.isBreak ? 'break' : this.prefs.started ? 'work' : 'ready',
      settings: structuredClone(this.prefs.settings),
      remainingSeconds: Math.ceil(this.remainingMs / 1000),
      totalSeconds: this.isBreak ? this.breakTotalMs / 1000 : this.prefs.settings.workMinutes * 60,
      pauseReasons: this.reasons(), preReminderVisible: this.preVisible,
      lastInPeriod: !this.isBreak && this.outsideOverride === null && !!schedule.endAt && this.clock.now().getTime() + this.remainingMs >= schedule.endAt.getTime(),
      nextWorkAt: schedule.nextAt?.toISOString() ?? null, storageError: this.storageError,
    }
    this.listeners.forEach(listener => listener())
  }
  tick() {
    const now = this.clock.monotonic()
    let elapsed = Math.max(0, now - this.lastTick)
    this.lastTick = now
    const outside = this.reasons().includes('schedule')
    if (outside !== this.previouslyOutside) { this.resetCycle(); this.previouslyOutside = outside; elapsed = 0 }
    if (this.preVisible && now >= this.preHideAt) this.preVisible = false
    if (this.isBreak || (this.prefs.started && this.reasons().length === 0)) {
      // A newly opened schedule starts a full interval, without consuming the previous tick.
      this.remainingMs = Math.max(0, this.remainingMs - elapsed)
      if (this.remainingMs <= 0) {
        if (this.isBreak) this.resetCycle()
        else if (!this.snapshot.lastInPeriod) this.beginBreak()
      } else if (!this.isBreak && this.prefs.settings.preReminder && !this.preSent &&
        this.prefs.settings.workMinutes > 1 && this.remainingMs <= 60_000 && !this.snapshot.lastInPeriod) {
        this.preSent = true; this.preVisible = true; this.preHideAt = now + 12_000
      }
    }
    this.publish()
  }
  private beginBreak() {
    this.isBreak = true; this.preVisible = false
    this.breakTotalMs = this.prefs.settings.breakMinutes * 60_000
    this.remainingMs = this.breakTotalMs; this.lastTick = this.clock.monotonic()
  }
  start = async () => { this.prefs.started = true; this.prefs.manualPaused = false; this.resetCycle(); this.save(); this.publish() }
  pause = async () => {
    this.tick()
    if (this.isBreak) this.resetCycle()
    this.prefs.manualPaused = true; this.preVisible = false; this.save(); this.publish()
  }
  resume = async () => {
    this.lastTick = this.clock.monotonic(); this.prefs.manualPaused = false; this.prefs.started = true
    this.save(); this.publish()
  }
  startBreak = async () => {
    if (this.meeting) throw new Error('会议中已暂停提醒，请先结束会议预览。')
    this.beginBreak(); this.publish()
  }
  endBreak = async () => { if (this.isBreak) { this.resetCycle(); this.publish() } }
  dismissPreReminder = async () => { this.preVisible = false; this.publish() }
  resetTimer = async () => {
    this.tick()
    if (this.isBreak) this.resetCycle()
    this.prefs.started = true
    this.prefs.manualPaused = false
    this.preSent = false
    this.preVisible = false
    this.remainingMs = this.prefs.settings.workMinutes * 60_000
    this.lastTick = this.clock.monotonic()
    this.save()
    this.publish()
  }
  updateSettings = async (settings: ReminderSettings) => {
    const error = validateSettings(settings)
    if (error) throw new Error(error)
    const previous = this.prefs.settings
    const scheduleChanged = JSON.stringify(previous.schedule) !== JSON.stringify(settings.schedule)
    const reset = previous.workMinutes !== settings.workMinutes || scheduleChanged
    this.prefs.settings = structuredClone(settings)
    if (scheduleChanged) this.outsideOverride = null
    if (!settings.meetingPause && previous.meetingPause) { this.meeting = false; this.resetCycle() }
    if (reset && !this.isBreak) this.resetCycle()
    const outside = this.outsideOverride ?? !getScheduleState(settings, this.clock.now()).allowed
    if (outside && !this.previouslyOutside) this.resetCycle()
    this.previouslyOutside = outside
    if (!settings.preReminder) this.preVisible = false
    this.save(); this.publish()
    if (this.storageError) throw new Error('设置已应用，但浏览器无法保存；刷新后可能丢失。')
  }
  setMeeting(active: boolean) {
    this.meeting = active
    // A preview injects the confirmed signal, without claiming real OS detection.
    this.resetCycle(); this.publish()
  }
  setOutsideSchedule(active: boolean) {
    this.outsideOverride = active; this.previouslyOutside = active
    this.resetCycle(); this.publish()
  }
  advanceToPreReminder() {
    this.meeting = false; this.outsideOverride = false; this.previouslyOutside = false; this.prefs.manualPaused = false; this.prefs.started = true
    this.resetCycle(); this.remainingMs = 60_000; this.tick()
  }
  advanceToBreak() {
    this.meeting = false; this.outsideOverride = false; this.previouslyOutside = false; this.prefs.manualPaused = false; this.prefs.started = true
    this.resetCycle(); this.remainingMs = 5_000; this.preSent = true; this.publish()
  }
  reset() {
    this.prefs = freshPreferences(); this.meeting = false; this.outsideOverride = null; this.previouslyOutside = false
    this.resetCycle(); this.save(); this.publish()
  }
}
