import { describe, expect, it } from 'vitest'
import {
  canRegisterLoginItem, classifyInstallLocation, desiredOpenAtLogin, launchedHidden,
  loginItemQuery, loginItemRequest, loginItemsSettingsUrl, presentLoginItem,
} from './login-item'

describe('login item', () => {
  it('uses SMAppService on macOS and a hidden argument only on Windows', () => {
    expect(loginItemRequest(true, 'darwin')).toEqual({ openAtLogin: true, type: 'mainAppService' })
    expect(loginItemRequest(false, 'darwin')).toEqual({ openAtLogin: false, type: 'mainAppService' })
    expect(loginItemQuery('darwin')).toEqual({ type: 'mainAppService' })
    expect(loginItemRequest(true, 'win32')).toEqual({ openAtLogin: true, args: ['--hidden'], enabled: true })
    expect(loginItemRequest(false, 'win32')).toEqual({ openAtLogin: false, args: [], enabled: false })
    expect(loginItemQuery('win32')).toEqual({ args: ['--hidden'] })
    expect(loginItemsSettingsUrl).toBe('x-apple.systempreferences:com.apple.LoginItems-Settings.extension')
  })
  it('turns login on when the choice was never saved, and keeps an explicit choice', () => {
    expect(desiredOpenAtLogin(false, false)).toBe(true)
    expect(desiredOpenAtLogin(false, true)).toBe(true)
    expect(desiredOpenAtLogin(true, false)).toBe(false)
    expect(desiredOpenAtLogin(true, true)).toBe(true)
  })
  it('refuses to treat a disk image or translocated copy as an install location', () => {
    expect(classifyInstallLocation('/Applications/remind.app/Contents/MacOS/remind', true)).toBe('applications')
    expect(classifyInstallLocation('/private/var/folders/x/AppTranslocation/y/d/remind.app/Contents/MacOS/remind', false)).toBe('translocated')
    expect(classifyInstallLocation('/Volumes/remind/remind.app/Contents/MacOS/remind', false)).toBe('volume')
    expect(classifyInstallLocation('/Users/me/Downloads/remind.app/Contents/MacOS/remind', false)).toBe('other')
    expect(canRegisterLoginItem('applications')).toBe(true)
    expect(canRegisterLoginItem('translocated')).toBe(false)
    expect(canRegisterLoginItem('unsupported')).toBe(true)
  })
  it('reads approval, enabled, and missing registrations from the system status', () => {
    expect(presentLoginItem({ status: 'enabled', openAtLogin: true }, 'applications', true)).toMatchObject({ openAtLogin: true, approvalNeeded: false, message: null })
    const pending = presentLoginItem({ status: 'requires-approval', openAtLogin: true }, 'applications', true)
    expect(pending.approvalNeeded).toBe(true)
    expect(pending.openAtLogin).toBe(true)
    expect(pending.message).toContain('登录项')
    expect(presentLoginItem({ status: 'not-registered' }, 'applications', true).openAtLogin).toBe(false)
    expect(presentLoginItem({ status: 'not-found' }, 'applications', false).message).toBeNull()
    expect(presentLoginItem({ openAtLogin: true }, 'unsupported', true)).toMatchObject({ openAtLogin: true, status: 'unsupported' })
    expect(presentLoginItem({ status: 'enabled' }, 'translocated', true).message).toContain('应用程序')
    expect(presentLoginItem({ status: 'enabled' }, 'volume', true).openAtLogin).toBe(false)
  })
  it('treats a login launch as hidden on both platforms', () => {
    expect(launchedHidden(['--hidden'], {})).toBe(true)
    expect(launchedHidden([], { wasOpenedAtLogin: true })).toBe(true)
    expect(launchedHidden(['.'], { wasOpenedAtLogin: false })).toBe(false)
  })
})
import { vi } from 'vitest'
import { LoginItems, type LoginItemPort } from './login-item'

describe('login-item failure isolation', () => {
  function port(): LoginItemPort { return { read: vi.fn(() => ({ status: 'enabled' as const, wasOpenedAtLogin: true })), write: vi.fn(), location: () => 'applications', report: vi.fn() } }
  it('continues startup when the OS denies registration', () => {
    const os = port(); vi.mocked(os.write).mockImplementation(() => { throw new Error('denied') })
    const items = new LoginItems('darwin', true, os)
    expect(() => items.apply(true)).not.toThrow()
    expect(items.snapshot.status).toBe('unavailable')
    expect(items.snapshot.message).toContain('请重试')
    expect(items.launchReading.wasOpenedAtLogin).toBe(true)
  })
  it('does not register a development Electron executable as a Windows login item', () => {
    const os = port(); new LoginItems('win32', false, os).apply(true)
    expect(os.write).not.toHaveBeenCalled()
    expect(os.read).not.toHaveBeenCalled()
  })
  it('recovers actual state after a transient read failure', () => {
    const os = port(); vi.mocked(os.read).mockImplementationOnce(() => { throw new Error('unavailable') })
    const items = new LoginItems('darwin', true, os)
    expect(items.refresh(true).status).toBe('unavailable')
    expect(items.refresh(true).status).toBe('enabled')
  })
})
