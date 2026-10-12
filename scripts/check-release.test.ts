import { describe, expect, it } from 'vitest'
import { assertReleaseReady } from './check-release.mjs'

const version = '0.1.0'
describe('release credential check', () => {
  it('allows an unsigned release when no signing secrets are configured', () => {
    expect(assertReleaseReady({ refName: 'v0.1.0', version, platform: 'mac', env: {} })).toEqual({ signed: false })
    expect(assertReleaseReady({ refName: 'v0.1.0', version, platform: 'win', env: {} })).toEqual({ signed: false })
  })

  it('rejects a tag that does not match package.json', () => {
    expect(() => assertReleaseReady({ refName: 'v0.2.0', version, platform: 'win', env: {} })).toThrow(/v0\.1\.0/)
  })

  it('signs when the platform credentials are complete and rejects a partial set', () => {
    const mac = { CSC_LINK: 'cert', CSC_KEY_PASSWORD: 'secret', APPLE_ID: 'id', APPLE_APP_SPECIFIC_PASSWORD: 'app', APPLE_TEAM_ID: 'team' }
    expect(assertReleaseReady({ refName: 'v0.1.0', version, platform: 'mac', env: mac })).toEqual({ signed: true })
    expect(() => assertReleaseReady({ refName: 'v0.1.0', version, platform: 'mac', env: { CSC_LINK: 'cert' } })).toThrow(/Incomplete release credentials/)
    expect(assertReleaseReady({ refName: 'v0.1.0', version, platform: 'win', env: { CSC_LINK: 'cert', CSC_KEY_PASSWORD: 'secret' } })).toEqual({ signed: true })
  })
})
