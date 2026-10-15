import { disabledMeetingState, meetingAppIds, type MeetingAppId, type MeetingState } from '../../../shared/meeting'
export interface MeetingObservation {
  protocol: 1
  permission: 'granted' | 'required' | 'unsupported'
  apps: Array<{ id: MeetingAppId; status: 'active' | 'inactive' | 'unknown'; version?: string }>
}
const startDelay = 5_000, endDelay = 30_000, failureDelay = 120_000
/** App sessions are independent: another app, a missing sample or mute cannot end a confirmed call. */
export class MeetingMonitor {
  state: MeetingState = disabledMeetingState()
  private active = new Set<MeetingAppId>()
  private ignored = new Set<MeetingAppId>()
  private candidates = new Map<MeetingAppId, { status: 'active' | 'inactive'; since: number }>()
  private failedSince = new Map<MeetingAppId, number>()
  private enabled = false
  private ignoreUnknown = false
  private lastObserved: number | null = null
  resetConfirmation() { this.candidates.clear(); this.lastObserved = null }
  configure(enabled: boolean) {
    if (enabled === this.enabled) return
    this.enabled = enabled; this.active.clear(); this.ignored.clear(); this.candidates.clear(); this.failedSince.clear(); this.ignoreUnknown = false
    this.lastObserved = null
    this.state = enabled ? { ...disabledMeetingState(), status: 'checking' } : disabledMeetingState()
  }
  ignore() {
    for (const id of this.active) this.ignored.add(id)
    for (const [id, value] of this.candidates) if (value.status === 'active') this.ignored.add(id)
    this.ignoreUnknown = this.state.status === 'unknown' || this.state.status === 'confirmation'
    this.state = { ...this.state, status: 'ignored', apps: [], message: '本次由你手动控制提醒' }
  }
  observe(observation: MeetingObservation, now: number) {
    if (!this.enabled) return
    if (this.lastObserved !== null && now - this.lastObserved > 10_000) this.candidates.clear()
    this.lastObserved = now
    let unknown = false, confirming = false, candidate = false
    for (const id of meetingAppIds) {
      const item = observation.apps.find(app => app.id === id)
      const status = item?.status ?? 'unknown'
      if (status === 'unknown') {
        this.candidates.delete(id); unknown = true
        if (!this.failedSince.has(id)) this.failedSince.set(id, now)
        if (this.active.has(id) && now - this.failedSince.get(id)! >= failureDelay) confirming = true
        continue
      }
      this.failedSince.delete(id)
      if (status === 'active') {
        if (this.ignoreUnknown) this.ignored.add(id)
        if (this.active.has(id)) { this.candidates.delete(id); continue }
        const previous = this.candidates.get(id)
        if (previous?.status !== status) this.candidates.set(id, { status, since: now })
        if (now - this.candidates.get(id)!.since >= startDelay) { this.active.add(id); this.candidates.delete(id) }
        else candidate = true
      } else {
        if (!this.active.has(id) && !this.ignored.has(id)) { this.candidates.delete(id); continue }
        const previous = this.candidates.get(id)
        if (previous?.status !== status) this.candidates.set(id, { status, since: now })
        if (now - this.candidates.get(id)!.since >= endDelay) { this.active.delete(id); this.ignored.delete(id); this.candidates.delete(id) }
      }
    }
    if (!unknown && !this.active.size && !candidate) this.ignoreUnknown = false
    const apps = [...this.active].filter(id => !this.ignored.has(id))
    const status: MeetingState['status'] = apps.length ? (confirming ? 'confirmation' : unknown ? 'unknown' : 'active')
      : this.ignored.size || this.ignoreUnknown ? 'ignored' : observation.permission === 'unsupported' ? 'unsupported' : unknown ? 'unknown' : candidate ? 'checking' : 'inactive'
    const message = status === 'confirmation' ? '会议状态待确认，提醒仍暂停' : status === 'unknown' ? (observation.permission === 'required' ? '需要辅助功能权限' : '会议识别暂不可用') : status === 'ignored' ? '本次由你手动控制提醒' : status === 'unsupported' ? '当前平台不支持会议识别' : null
    this.state = { status, apps, permission: observation.permission, message }
  }
  get allowOverlay() { return ['disabled', 'inactive', 'ignored'].includes(this.state.status) }
}
