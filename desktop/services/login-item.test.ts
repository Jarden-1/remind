import { describe, expect, it } from 'vitest'
import { displayedOpenAtLogin, launchedHidden, loginItemRequest, loginToggleResult } from './login-item'

describe('login item', () => {
  it('defaults the request off and asks Windows to start hidden only when enabled', () => {
    expect(loginItemRequest(false)).toEqual({ openAtLogin: false, args: [], enabled: false })
    expect(loginItemRequest(true).args).toEqual(['--hidden'])
    expect(loginItemRequest(true).openAtLogin).toBe(true)
  })
  it('shows the real system state, including a macOS approval that is still pending', () => {
    expect(displayedOpenAtLogin({ openAtLogin: true, status: 'enabled' })).toBe(true)
    expect(displayedOpenAtLogin({ openAtLogin: true, status: 'requires-approval' })).toBe(false)
    expect(displayedOpenAtLogin({ openAtLogin: true })).toBe(true)
    expect(displayedOpenAtLogin({ openAtLogin: false })).toBe(false)
    expect(loginToggleResult(true, { status: 'requires-approval' }).message).toBeTruthy()
    expect(loginToggleResult(true, { openAtLogin: true }).message).toBeNull()
  })
  it('treats a login launch as hidden on both platforms', () => {
    expect(launchedHidden(['--hidden'], {})).toBe(true)
    expect(launchedHidden([], { wasOpenedAtLogin: true })).toBe(true)
    expect(launchedHidden(['.'], { wasOpenedAtLogin: false })).toBe(false)
  })
})