import { describe, expect, it } from 'vitest'
import { shouldHidePanel } from './panel-window'

describe('panel conceal', () => {
  it('hides a macOS panel even when minimize reports success', () => {
    expect(shouldHidePanel('darwin', true)).toBe(true)
    expect(shouldHidePanel('darwin', false)).toBe(true)
  })
  it('hides a Windows panel only when minimize left it visible', () => {
    expect(shouldHidePanel('win32', true)).toBe(true)
    expect(shouldHidePanel('win32', false)).toBe(false)
  })
})
