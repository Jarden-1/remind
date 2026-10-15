import { execFile } from 'node:child_process'
import { z } from 'zod'
import { meetingAppIds, type MeetingState } from '../../../shared/meeting'
import { MeetingMonitor, type MeetingObservation } from './monitor'

const observationSchema = z.object({
  protocol: z.literal(1), permission: z.enum(['granted', 'required', 'unsupported']),
  apps: z.array(z.object({ id: z.enum(meetingAppIds), status: z.enum(['active', 'inactive', 'unknown']), version: z.string().max(64).optional() })).max(2),
}).refine(value => new Set(value.apps.map(app => app.id)).size === value.apps.length)
export function parseObservation(value: string): MeetingObservation { return observationSchema.parse(JSON.parse(value)) }
export function nativeMeetingProbe(executable: string): Promise<MeetingObservation> {
  return new Promise((resolve, reject) => execFile(executable, [], { timeout: 3000, maxBuffer: 16 * 1024, windowsHide: true, encoding: 'utf8' }, (error, stdout) => {
    if (error) { reject(new Error('meeting_probe_failed')); return }
    try { resolve(parseObservation(stdout)) } catch { reject(new Error('meeting_probe_protocol')) }
  }))
}
export class MeetingService {
  private monitor = new MeetingMonitor()
  private enabled = false
  private suspended = false
  private stopped = false
  private epoch = 0
  private pending: Promise<void> | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private lastState = ''
  constructor(private probe: () => Promise<MeetingObservation>, private changed: (state: MeetingState) => void, private now = () => performance.now()) {}
  get state() { return this.monitor.state }
  get allowOverlay() { return this.monitor.allowOverlay }
  configure(enabled: boolean) {
    if (this.stopped || enabled === this.enabled) return
    this.enabled = enabled; this.epoch++; clearTimeout(this.timer); this.monitor.configure(enabled); this.publish()
    if (enabled && !this.suspended) void this.checkNow()
  }
  suspend(value: boolean) {
    if (this.suspended === value) return
    this.suspended = value; this.epoch++; clearTimeout(this.timer)
    this.monitor.resetConfirmation()
    if (!value && this.enabled) void this.checkNow()
  }
  ignore() { if (this.enabled) { this.monitor.ignore(); this.publish() } }
  stop() { this.stopped = true; this.epoch++; clearTimeout(this.timer) }
  private publish() {
    const key = JSON.stringify(this.state)
    if (key !== this.lastState) { this.lastState = key; this.changed(this.state) }
  }
  async checkNow(): Promise<void> {
    if (this.stopped || !this.enabled || this.suspended) return
    if (this.pending) return this.pending
    clearTimeout(this.timer)
    const epoch = this.epoch
    this.pending = (async () => {
      let observation: MeetingObservation
      try { observation = await this.probe() }
      catch { observation = { protocol: 1, permission: this.state.permission, apps: [] } }
      if (epoch !== this.epoch || this.stopped) return
      this.monitor.observe(observation, this.now()); this.publish()
    })()
    try { await this.pending } finally {
      this.pending = null
      if (this.enabled && !this.stopped && !this.suspended) this.timer = setTimeout(() => void this.checkNow(), 2000)
    }
  }
}
