import { describe, expect, it, vi } from 'vitest'
import { DesktopClient } from './desktop-client'
import type { DesktopBridge, DesktopState } from '../../../shared/desktop'
import { DEFAULT_SETTINGS } from '../contracts/reminder'

function state(revision: number): DesktopState {
  return {
    revision,
    reminder: { revision, phase: 'work', settings: DEFAULT_SETTINGS, remainingSeconds: 2700 - revision, totalSeconds: 2700, pauseReasons: [], pauseUntil: null, preReminderVisible: false, lastInPeriod: false, nextWorkAt: null, storageError: false },
    update: { revision, status: 'idle', delivery: 'native', currentVersion: '0.1.0', version: null, progress: 0, message: null },
    launchAtLogin: revision > 1,
    loginItem: { openAtLogin: revision > 1, status: 'enabled', approvalNeeded: false, message: null },
  }
}
describe('desktop bridge bootstrap', () => {
  it('does not overwrite a newer pushed state with a delayed initial snapshot', async () => {
    let receive!: (state: DesktopState) => void
    let initial!: (state: DesktopState) => void
    const unsubscribe = vi.fn()
    const bridge: DesktopBridge = {
      state: () => new Promise(resolve => { initial = resolve }),
      subscribe: listener => { receive = listener; return unsubscribe },
      command: vi.fn(async () => {}), settings: vi.fn(async () => {}), update: vi.fn(async () => {}), panel: vi.fn(async () => {}), ready: vi.fn(async () => {}),
      minimize: vi.fn(async () => {}), quit: vi.fn(async () => {}), setLaunchAtLogin: vi.fn(async () => ({ openAtLogin: true, message: null, approvalNeeded: false })),
      refreshLaunchAtLogin: vi.fn(async () => {}), openLoginItemsSettings: vi.fn(async () => {}),
    }
    const pending = DesktopClient.connect(bridge)
    const fresh = state(3); fresh.reminder.revision = 1; fresh.update.revision = 1
    receive(fresh); initial(state(1))
    const client = await pending
    expect(client.getSnapshot().revision).toBe(1)
    expect(client.getUpdateSnapshot().revision).toBe(1)
    expect(client.getLaunchAtLogin()).toBe(true)
    await client.pause(); expect(bridge.command).toHaveBeenCalledWith('pause')
    await client.minimize(); expect(bridge.minimize).toHaveBeenCalledOnce()
    await client.update('download'); expect(bridge.update).toHaveBeenCalledWith('download')
    client.dispose(); expect(unsubscribe).toHaveBeenCalledOnce()
  })
  it('leaves the approval hint in settings instead of raising a toast', async () => {
    const bridge: DesktopBridge = {
      state: async () => state(1),
      subscribe: () => () => {},
      command: vi.fn(async () => {}), settings: vi.fn(async () => {}), update: vi.fn(async () => {}), panel: vi.fn(async () => {}), ready: vi.fn(async () => {}),
      minimize: vi.fn(async () => {}), quit: vi.fn(async () => {}),
      setLaunchAtLogin: vi.fn(async () => ({ openAtLogin: true, message: 'macOS 需要允许登录项', approvalNeeded: true })),
      refreshLaunchAtLogin: vi.fn(async () => {}), openLoginItemsSettings: vi.fn(async () => {}),
    }
    const client = await DesktopClient.connect(bridge)
    expect(await client.setLaunchAtLogin(true)).toBeNull()
    await client.openLoginItemsSettings()
    expect(bridge.openLoginItemsSettings).toHaveBeenCalledOnce()
  })
})
