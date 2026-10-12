import type { UpdateDelivery, UpdateSnapshot } from '../../shared/desktop'

export const updateCheckDelayMs = 15_000
export const updateCheckIntervalMs = 6 * 60 * 60 * 1000

export type UpdateEvent =
  | { type: 'available'; version: string }
  | { type: 'current' }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; error: unknown }
export interface UpdatePort {
  subscribe(listener: (event: UpdateEvent) => void): void
  check(): Promise<void>
  download(): Promise<void>
  install(): void
}
export interface UpdateTimers {
  setTimeout(callback: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
  setInterval(callback: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
}

const defaultTimers: UpdateTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: handle => clearInterval(handle as ReturnType<typeof setInterval>),
}

/** Checks for a published update on a schedule. Download and install stay user-initiated. */
export class Updates {
  snapshot: UpdateSnapshot
  private listeners = new Set<() => void>()
  private inFlight = false
  private outcome: 'manual' | 'silent' | null = null
  private announced: string | null = null
  private discovered: ((version: string) => void) | null = null
  private startupTimer: unknown
  private intervalTimer: unknown
  private timers: UpdateTimers = defaultTimers
  constructor(private port: UpdatePort, version: string, supported: boolean, private canInstall: () => boolean, unavailableMessage = '开发预览暂不支持更新', private delivery: UpdateDelivery = 'native') {
    this.snapshot = { revision: 0, currentVersion: version, status: supported ? 'idle' : 'unsupported', delivery, version: null, progress: 0, message: supported ? null : unavailableMessage }
    port.subscribe(event => this.receive(event))
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  onDiscovered(listener: (version: string) => void) { this.discovered = listener }
  /** First check after a short delay, then every six hours. Unsupported builds never contact the server. */
  arm(timers: UpdateTimers = defaultTimers, delayMs = updateCheckDelayMs, intervalMs = updateCheckIntervalMs) {
    if (this.snapshot.status === 'unsupported' || this.startupTimer || this.intervalTimer) return
    this.timers = timers
    this.startupTimer = timers.setTimeout(() => {
      this.startupTimer = undefined
      void this.runCheck(true)
      this.intervalTimer = timers.setInterval(() => { void this.runCheck(true) }, intervalMs)
    }, delayMs)
  }
  stop() {
    if (this.startupTimer) this.timers.clearTimeout(this.startupTimer)
    if (this.intervalTimer) this.timers.clearInterval(this.intervalTimer)
    this.startupTimer = undefined
    this.intervalTimer = undefined
  }
  private set(value: Partial<UpdateSnapshot>) { this.snapshot = { ...this.snapshot, ...value, revision: this.snapshot.revision + 1 }; for (const listener of this.listeners) listener() }
  private fail(error: unknown) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null
    // v6's empty Atom feed throws before its dedicated "no releases" error branch.
    const emptyFeed = code === 'ERR_XML_MISSED_ELEMENT' && error instanceof Error && error.message === 'No published versions on GitHub'
    const message = emptyFeed || ['ERR_UPDATER_NO_PUBLISHED_VERSIONS', 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND', 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND'].includes(String(code))
      ? '暂时没有可用的发布版本'
      : code === 'ENOENT' ? '更新配置缺失，请手动下载正式版' : '更新失败，请检查网络或稍后重试'
    this.set({ status: 'error', message })
  }
  private receive(event: UpdateEvent) {
    const mode = this.outcome
    if (event.type === 'error') {
      this.outcome = null
      if (mode === 'silent') return
      this.fail(event.error)
      return
    }
    if (event.type === 'progress') { this.set({ status: 'downloading', progress: Math.min(100, Math.max(0, event.percent)) }); return }
    if (event.type === 'downloaded') { this.outcome = null; this.set({ status: 'downloaded', version: event.version, progress: 100, message: null }); return }
    if (event.type === 'current') {
      this.outcome = null
      if (mode === 'silent' && this.snapshot.status !== 'checking' && this.snapshot.status !== 'available') return
      this.announced = null
      this.set({ status: mode === 'silent' && this.snapshot.status !== 'checking' ? 'idle' : 'current', version: null, message: null })
      return
    }
    this.outcome = null
    const announce = event.version !== this.announced
    this.set({ status: 'available', version: event.version, progress: 0, message: null })
    if (announce) { this.announced = event.version; this.discovered?.(event.version) }
  }
  private async runCheck(silent: boolean) {
    if (this.snapshot.status === 'unsupported' || this.inFlight) return
    if (['downloading', 'downloaded', 'installing'].includes(this.snapshot.status)) return
    this.inFlight = true
    this.outcome = silent ? 'silent' : 'manual'
    if (!silent) this.set({ status: 'checking', message: null })
    try { await this.port.check() }
    catch (error) {
      if (this.outcome === 'manual') this.fail(error)
    }
    finally { this.inFlight = false; this.outcome = null }
  }
  async action(action: 'check' | 'download' | 'install') {
    if (this.snapshot.status === 'unsupported') return
    if (action === 'check') return this.runCheck(false)
    if (this.delivery === 'browser') return
    if (action === 'download') {
      if (this.snapshot.status !== 'available') return
      this.set({ status: 'downloading', progress: 0, message: null })
      try { await this.port.download() } catch (error) { this.fail(error) }
    }
    if (action === 'install') {
      if (this.snapshot.status !== 'downloaded') return
      if (!this.canInstall()) { this.set({ message: '请结束休息后再安装' }); return }
      this.set({ status: 'installing', message: null })
      try { this.port.install() } catch { this.set({ status: 'downloaded', message: '安装失败，请重试或手动下载' }) }
    }
  }
}
