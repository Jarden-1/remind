import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasDeveloperIdSignature, macAppBundlePath } from './code-signature'

describe('mac update signature', () => {
  it('accepts only a Developer ID application signature', () => {
    expect(hasDeveloperIdSignature('Authority=Developer ID Application: Example (ABCDE12345)')).toBe(true)
    expect(hasDeveloperIdSignature('Signature=adhoc')).toBe(false)
    expect(hasDeveloperIdSignature('code object is not signed at all')).toBe(false)
  })

  it('resolves the .app bundle from the executable path', () => {
    expect(macAppBundlePath(join('/Applications/remind.app', 'Contents', 'MacOS', 'remind'))).toBe(join('/Applications/remind.app'))
  })
})