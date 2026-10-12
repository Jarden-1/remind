import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
vi.mock('electron', () => ({ default: { app: { getPath: () => tmpdir(), getVersion: () => '0.1.0' }, ipcMain: { on: vi.fn() } } }))
import { PreferencesStore, HistoryStore } from './preferences'
import { freshPreferences } from '../domain/reminder-engine'

const directories: string[] = []
function directory() { const dir = mkdtempSync(join(tmpdir(), 'remind-test-')); directories.push(dir); return dir }
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }) })
describe('native persistence', () => {
  it('saves settings and manual pause across restart without storing a ticking deadline', () => {
    const dir = directory(), store = new PreferencesStore(dir)
    const preferences = freshPreferences(); preferences.started = true; preferences.manualPaused = true; preferences.settings.breakMinutes = 7
    store.write(preferences)
    expect(new PreferencesStore(dir).initial).toEqual(preferences)
    expect(Object.keys(JSON.parse(readFileSync(join(dir, 'preferences.json'), 'utf8')))).toEqual(['schemaVersion', 'preferences'])
  })
  it('reads a file from before the login choice as on, until the user toggles it', () => {
    const dir = directory()
    const preferences = freshPreferences()
    delete (preferences as { openAtLogin?: boolean }).openAtLogin
    delete (preferences as { loginItemChosen?: boolean }).loginItemChosen
    delete (preferences as { pauseUntil?: string | null }).pauseUntil
    writeFileSync(join(dir, 'preferences.json'), JSON.stringify({ schemaVersion: 1, preferences }))
    const store = new PreferencesStore(dir)
    expect(store.recovered).toBe(false)
    expect(store.initial.openAtLogin).toBe(true)
    expect(store.initial.loginItemChosen).toBe(false)
    expect(store.initial.pauseUntil).toBe(null)
  })
  it('backs up corrupt and invalid settings, falling back to defaults', () => {
    for (const content of ['{broken', JSON.stringify({ schemaVersion: 1, preferences: {} })]) {
      const dir = directory(); writeFileSync(join(dir, 'preferences.json'), content)
      const store = new PreferencesStore(dir)
      expect(store.recovered).toBe(true); expect(store.initial).toEqual(freshPreferences())
      expect(readdirSync(dir).some(name => /\.(corrupt|invalid)-/.test(name))).toBe(true)
    }
  })
  it('does not overwrite preferences from a future schema', () => {
    const dir = directory(), file = join(dir, 'preferences.json')
    const content = JSON.stringify({ schemaVersion: 99, preferences: { future: true } }); writeFileSync(file, content)
    const store = new PreferencesStore(dir)
    expect(() => store.write(freshPreferences())).toThrow()
    expect(readFileSync(file, 'utf8')).toBe(content)
  })
  it('bounds history independently of preferences', () => {
    const dir = directory(), history = new HistoryStore(dir)
    for (let id = 0; id < 505; id++) history.append({ version: 1, type: 'break.ended', id: String(id), at: new Date().toISOString(), outcome: 'skipped' })
    const records = JSON.parse(readFileSync(join(dir, 'history.json'), 'utf8')).records
    expect(records).toHaveLength(500); expect(records[0].id).toBe('5')
    expect(readdirSync(dir)).not.toContain('preferences.json')
  }, 20_000)
})
