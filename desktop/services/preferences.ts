import Store from 'electron-store'
import { copyFileSync, existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type { Preferences } from '../../shared/desktop'
import { preferencesSchema } from '../domain/validation'
import { freshPreferences } from '../domain/reminder-engine'
import type { StoredBreakEvent } from '../../shared/break-events'
import { z } from 'zod'

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

const eventBase = z.object({
  type: z.enum(['break.started', 'break.ended']), id: z.string().min(1), at: z.string().datetime({ offset: true }),
})
const historyEvent = z.union([
  eventBase.extend({ version: z.literal(1), outcome: z.enum(['completed', 'skipped', 'interrupted', 'display_failed']).optional() }),
  eventBase.extend({
    version: z.literal(2), outcome: z.enum(['completed', 'skipped', 'snoozed', 'interrupted', 'display_failed']).optional(),
    plannedSeconds: z.number().positive().max(1800), actualSeconds: z.number().nonnegative(),
  }).refine(event => event.actualSeconds <= event.plannedSeconds && (event.type !== 'break.ended' || event.outcome !== undefined)),
])

export class HistoryStore {
  private store: Store<{ records: StoredBreakEvent[] }>
  private readOnly = false
  constructor(directory: string) {
    const file = join(directory, 'history.json')
    try { this.store = new Store({ cwd: directory, name: 'history' }) }
    catch {
      if (existsSync(file)) renameSync(file, `${file}.corrupt-${Date.now()}`)
      this.store = new Store({ cwd: directory, name: 'history' })
    }
    const records: unknown = this.store.get('records')
    if (records === undefined && !Object.keys(this.store.store).length) { this.store.set('records', []); return }
    // Do not erase records written by a newer application if the user downgrades.
    if (Array.isArray(records) && records.some(event => event && typeof event === 'object' && Number(event.version) > 2)) { this.readOnly = true; return }
    const valid = Array.isArray(records) ? records.filter(event => historyEvent.safeParse(event).success) : []
    if (!Array.isArray(records) || valid.length !== records.length) {
      if (existsSync(file)) copyFileSync(file, `${file}.invalid-${Date.now()}`)
      this.store.set('records', valid)
    }
  }
  append(event: StoredBreakEvent) {
    if (this.readOnly) throw new Error('休息记录来自更新版本，当前版本不覆盖它')
    const validated = historyEvent.parse(event)
    const records = this.store.get('records')
    if (records.some(record => record.id === validated.id && record.type === validated.type)) return
    const cutoff = Date.now() - 90 * 86_400_000
    this.store.set('records', [...records, validated].filter(record => Date.parse(record.at) > cutoff).slice(-500))
  }
}
