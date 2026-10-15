// @vitest-environment jsdom
import { act, useSyncExternalStore } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Panel } from './Panel'
import { Settings } from './Settings'
import { App } from '../App'
import { MockReminderClient } from '../services/mock-reminder-client'
import { freshPreferences } from '../services/storage'

let root: Root
let host: HTMLDivElement
let client: MockReminderClient
const notify = vi.fn()
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  client = new MockReminderClient({ read: () => freshPreferences(), write() {} }, undefined, false)
  notify.mockClear()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); client.dispose(); vi.unstubAllGlobals() })
function Harness() {
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot)
  return <Panel snapshot={snapshot} client={client} notify={notify} onSettings={() => {}} />
}
async function click(element: Element) { await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })) }) }
function button(label: string) {
  const found = [...document.querySelectorAll('button')].find(button => button.getAttribute('aria-label')?.startsWith(label) || button.textContent?.trim() === label)
  if (!found) throw new Error(`Missing button ${label}`)
  return found
}
async function key(element: Element, value: string) { await act(async () => { element.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })) }) }

describe('actual React controls', () => {
  it('opens an unclipped menu, navigates options and returns focus on Escape', async () => {
    await act(async () => root.render(<Harness />))
    const trigger = button('提醒间隔')
    await click(trigger)
    expect(document.querySelector('[role="menu"]')?.parentElement).toBe(document.body)
    expect(document.activeElement?.textContent).toBe('45 分钟')
    await key(document.activeElement!, 'ArrowDown')
    expect(document.activeElement?.textContent).toBe('60 分钟')
    await key(document.activeElement!, 'Escape')
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
  it('does not steal Space from a focused button to pause the timer', async () => {
    await client.start(); const pause = vi.spyOn(client, 'pause'), reset = vi.spyOn(client, 'resetTimer')
    await act(async () => root.render(<Harness />))
    const trigger = button('重置计时'); trigger.focus(); await key(trigger, ' '); await click(trigger)
    expect(reset).toHaveBeenCalledOnce(); expect(pause).not.toHaveBeenCalled()
  })
  it('keeps the current edit and reports a failed interval save', async () => {
    vi.spyOn(client, 'updateSettings').mockRejectedValue(new Error('磁盘已满'))
    await act(async () => root.render(<Harness />))
    await click(button('剩余'))
    await key(document.querySelector('input')!, 'Enter')
    expect(document.querySelector('.interval-editor')).not.toBeNull()
    expect(notify).toHaveBeenCalledWith('磁盘已满')
  })
  it('locks the settings draft while saving and restores it after failure', async () => {
    let reject!: (error: Error) => void
    vi.spyOn(client, 'updateSettings').mockImplementation(() => new Promise((_resolve, fail) => { reject = fail }))
    const close = vi.fn()
    await act(async () => root.render(<Settings settings={client.getSnapshot().settings} client={client} onClose={close} notify={notify} playSound={() => {}} />))
    await click(button('保存设置'))
    expect(document.querySelector('fieldset')?.disabled).toBe(true)
    expect(button('取消').disabled).toBe(true)
    await act(async () => reject(new Error('保存失败')))
    expect(document.querySelector('fieldset')?.disabled).toBe(false)
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('保存失败')
    expect(close).not.toHaveBeenCalled()
  })
  it('shows failures inside a desktop break instead of an unhandled rejection', async () => {
    await client.startBreak(); vi.spyOn(client, 'snooze').mockRejectedValue(new Error('后台暂不可用'))
    await act(async () => root.render(<App client={client} desktopView="break" />))
    await click(button('延后 5 分钟'))
    expect(document.querySelector('.toast')?.textContent).toBe('后台暂不可用')
    expect(document.querySelector('.break-screen')).not.toBeNull()
  })
  it('keeps meeting detection in the draft until the user saves', async () => {
    const close = vi.fn()
    await act(async () => root.render(<Settings settings={client.getSnapshot().settings} client={client} onClose={close} notify={notify} playSound={() => {}} />))
    const row = [...document.querySelectorAll('label')].find(label => label.textContent?.includes('会议自动暂停'))!
    await click(row.querySelector('input')!)
    expect(client.getSnapshot().settings.meetingPause).toBe(false)
    await click(button('保存设置'))
    expect(client.getSnapshot().settings.meetingPause).toBe(true); expect(close).toHaveBeenCalledOnce()
  })
  it('keeps permission failures visible and allows retry without losing the meeting setting', async () => {
    client.getSnapshot().settings.meetingPause = true
    client.getSnapshot().meeting = { status: 'unknown', apps: [], permission: 'required', message: '需要辅助功能权限' }
    const open = vi.fn(async () => { throw new Error('无法打开系统设置') })
    Object.assign(client, { openMeetingPermissions: open })
    await act(async () => root.render(<Settings settings={client.getSnapshot().settings} client={client} onClose={() => {}} notify={notify} playSound={() => {}} />))
    await click(button('打开辅助功能设置')); await click(button('打开辅助功能设置'))
    expect(open).toHaveBeenCalledTimes(2); expect(notify).toHaveBeenCalledWith('无法打开系统设置')
    expect(document.querySelector('.meeting-setting input')?.getAttribute('role')).toBe('switch')
  })
  it('offers permission setup before ignore and rechecks on return without assuming permission was granted', async () => {
    client.getSnapshot().settings.meetingPause = true
    client.getSnapshot().meeting = { status: 'unknown', apps: [], permission: 'required', message: '需要辅助功能权限' }
    const open = vi.fn(async () => {})
    const refresh = vi.fn(async () => { await client.updateSettings({ ...client.getSnapshot().settings }) })
    Object.assign(client, { openMeetingPermissions: open, refreshMeeting: refresh })
    await act(async () => root.render(<Harness />))
    const actions = [...document.querySelectorAll('.pause-context button')].map(button => button.textContent)
    expect(actions).toEqual(['去开启', '本次忽略'])
    await click(button('去开启'))
    expect(open).toHaveBeenCalledOnce()
    expect(document.querySelector('.meeting-permission')).not.toBeNull()
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(refresh).toHaveBeenCalledOnce()
    expect(document.querySelector('.meeting-permission')).toBeNull()
    expect(client.getSnapshot().settings.meetingPause).toBe(true)
  })
  it('reports a failed permission settings action from the panel and keeps it retryable', async () => {
    client.getSnapshot().settings.meetingPause = true
    client.getSnapshot().meeting = { status: 'unknown', apps: [], permission: 'required', message: '需要辅助功能权限' }
    const open = vi.fn(async () => { throw new Error('无法打开系统设置') })
    Object.assign(client, { openMeetingPermissions: open })
    await act(async () => root.render(<Harness />))
    await click(button('去开启')); await click(button('去开启'))
    expect(open).toHaveBeenCalledTimes(2); expect(notify).toHaveBeenCalledWith('无法打开系统设置')
  })
})

it('removes an open portal menu when a break starts', async () => {
  await act(async () => root.render(<App client={client} />))
  await click(button('提醒间隔'))
  expect(document.querySelector('[role="menu"]')).not.toBeNull()
  await act(async () => client.startBreak())
  expect(document.querySelector('[role="menu"]')).toBeNull()
  expect(document.querySelector('.break-screen')).not.toBeNull()
})

it('paints the requested rest duration before the native break is confirmed', async () => {
  client.getSnapshot().settings.breakMinutes = 5
  client.getSnapshot().plannedBreakSeconds = 180
  await act(async () => root.render(<App client={client} desktopView="break" />))
  expect(document.querySelector('.break-time')?.textContent).toBe('03:00')
})
