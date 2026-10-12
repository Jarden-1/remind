import type { ReminderClient, ReminderSettings, ReminderSnapshot } from '../contracts/reminder'
import type { DesktopBridge, DesktopState, ReminderCommand, UpdateSnapshot } from '../../../shared/desktop'

export interface UpdateClient {
  getUpdateSnapshot(): UpdateSnapshot
  subscribe(listener: () => void): () => void
  update(action: 'check' | 'download' | 'install' | 'releases'): Promise<void>
}
export class DesktopClient implements ReminderClient, UpdateClient {
  private listeners = new Set<() => void>()
  private current!: DesktopState
  private unsubscribe: () => void
  private constructor(private bridge: DesktopBridge) {
    this.unsubscribe = bridge.subscribe(state => this.receive(state))
  }
  static async connect(bridge: DesktopBridge) {
    const client = new DesktopClient(bridge)
    try { client.receive(await bridge.state()); return client }
    catch (error) { client.dispose(); throw error }
  }
  private receive(state: DesktopState) {
    this.current = {
      reminder: this.current && this.current.reminder.revision > state.reminder.revision ? this.current.reminder : state.reminder,
      update: this.current && this.current.update.revision > state.update.revision ? this.current.update : state.update,
    }
    for (const listener of this.listeners) listener()
  }
  getSnapshot = (): ReminderSnapshot => this.current.reminder
  getUpdateSnapshot = (): UpdateSnapshot => this.current.update
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private command(command: ReminderCommand) { return this.bridge.command(command) }
  start = () => this.command('start')
  pause = () => this.command('pause')
  resume = () => this.command('resume')
  startBreak = () => this.command('startBreak')
  endBreak = () => this.command('endBreak')
  dismissPreReminder = () => this.command('dismissPreReminder')
  updateSettings = (settings: ReminderSettings) => this.bridge.settings(settings)
  update = (action: 'check' | 'download' | 'install' | 'releases') => this.bridge.update(action)
  dispose() { this.unsubscribe(); this.listeners.clear() }
}
