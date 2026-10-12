import Store from 'electron-store'
import { copyFileSync, existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type { Preferences } from '../../shared/desktop'
import { preferencesSchema } from '../domain/validation'
import { freshPreferences } from '../domain/reminder-engine'
import type { BreakEvent } from '../domain/reminder-engine'

const schemaVersion = 1
export class PreferencesStore {
  private store: Store<{ schemaVersion: number; preferences: Preferences }>
  readonly initial: Preferences
  readonly recovered: boolean
  private readOnly = false
  constructor(directory: string) {
    const file = join(directory, 'preferences.json')
    let recovered = false
    try { this.store = new Store({ cwd: directory, name: 'preferences' }) }
    catch {
      // Keep the damaged file so recovery never silently destroys user data.
      if (existsSync(file)) renameSync(file, `${file}.corrupt-${Date.now()}`)
      this.store = new Store({ cwd: directory, name: 'preferences' }); recovered = true
    }
    const envelope = this.store.store
    if (envelope.schemaVersion > schemaVersion) { this.readOnly = true; recovered = true; this.initial = freshPreferences() }
    else if (Object.keys(envelope).length) {
      const parsed = preferencesSchema.safeParse(envelope.preferences)
      if (envelope.schemaVersion !== schemaVersion || !parsed.success) {
        copyFileSync(file, `${file}.invalid-${Date.now()}`); recovered = true
        this.initial = freshPreferences()
      } else this.initial = parsed.data
    } else this.initial = freshPreferences()
    this.recovered = recovered
  }
  write(preferences: Preferences) {
    if (this.readOnly) throw new Error('设置来自更新版本，请使用新版软件')
    const validated = preferencesSchema.parse(preferences)
    this.store.store = { schemaVersion, preferences: validated }
  }
}

export class HistoryStore {
  private store: Store<{ records: BreakEvent[] }>
  constructor(directory: string) { this.store = new Store<{ records: BreakEvent[] }>({ cwd: directory, name: 'history', defaults: { records: [] }, clearInvalidConfig: true }) }
  append(event: BreakEvent) {
    const cutoff = Date.now() - 90 * 86_400_000
    this.store.set('records', [...this.store.get('records'), event].filter(record => Date.parse(record.at) > cutoff).slice(-500))
  }
}
