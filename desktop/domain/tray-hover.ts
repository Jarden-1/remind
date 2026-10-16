/** Delayed hover is cancellable even while the renderer is still loading. */
export class TrayHover {
  private generation = 0
  private enterTimer: ReturnType<typeof setTimeout> | undefined
  private leaveTimer: ReturnType<typeof setTimeout> | undefined
  constructor(private port: { prepare(): Promise<void>; canShow(): boolean; show(): void; hide(): void; report(error: unknown): void }) {}
  enter() {
    this.clearTimers()
    const generation = ++this.generation
    if (!this.port.canShow()) return
    this.enterTimer = setTimeout(() => {
      void this.port.prepare().then(() => {
        if (generation === this.generation && this.port.canShow()) this.port.show()
      }).catch(error => this.port.report(error))
    }, 350)
  }
  enterCard() { clearTimeout(this.leaveTimer) }
  leave() {
    this.generation++
    clearTimeout(this.enterTimer); clearTimeout(this.leaveTimer)
    this.leaveTimer = setTimeout(() => this.cancel(), 250)
  }
  cancel() { this.generation++; this.clearTimers(); this.port.hide() }
  private clearTimers() { clearTimeout(this.enterTimer); clearTimeout(this.leaveTimer) }
}
