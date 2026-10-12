import type { UpdateSnapshot } from '../../shared/desktop'

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

/** No timers, no startup checks, and no automatic download or install paths. */
export class Updates {
  snapshot: UpdateSnapshot
  private listeners = new Set<() => void>()
  constructor(private port: UpdatePort, version: string, supported: boolean, private canInstall: () => boolean, unavailableMessage = '开发预览暂不支持更新') {
    this.snapshot = { revision: 0, currentVersion: version, status: supported ? 'idle' : 'unsupported', version: null, progress: 0, message: supported ? null : unavailableMessage }
    port.subscribe(event => {
      if (event.type === 'available') this.set({ status: 'available', version: event.version, progress: 0, message: null })
      if (event.type === 'current') this.set({ status: 'current', version: null, message: null })
      if (event.type === 'progress') this.set({ status: 'downloading', progress: Math.min(100, Math.max(0, event.percent)) })
      if (event.type === 'downloaded') this.set({ status: 'downloaded', version: event.version, progress: 100, message: null })
      if (event.type === 'error') this.fail(event.error)
    })
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
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
  async action(action: 'check' | 'download' | 'install') {
    if (this.snapshot.status === 'unsupported') return
    if (action === 'check') {
      if (['checking', 'downloading', 'downloaded', 'installing'].includes(this.snapshot.status)) return
      this.set({ status: 'checking', message: null })
      try { await this.port.check() } catch (error) { this.fail(error) }
    }
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
