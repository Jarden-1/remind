import { describe, expect, it, vi } from 'vitest'
import { Updates, type UpdateEvent, type UpdatePort } from './updates'

function setup(supported = true) {
  let listener!: (event: UpdateEvent) => void
  const port: UpdatePort = { subscribe: fn => { listener = fn }, check: vi.fn(async () => {}), download: vi.fn(async () => {}), install: vi.fn() }
  let canInstall = true
  const updates = new Updates(port, '0.1.0', supported, () => canInstall)
  return { updates, port, emit: (event: UpdateEvent) => listener(event), block: () => { canInstall = false } }
}
describe('user controlled updates', () => {
  it('never checks on startup, downloads on availability, or installs on download completion', async () => {
    const { updates, port, emit } = setup()
    expect(port.check).not.toHaveBeenCalled()
    await updates.action('check'); expect(port.check).toHaveBeenCalledOnce()
    emit({ type: 'available', version: '0.2.0' })
    expect(port.download).not.toHaveBeenCalled()
    await updates.action('download'); expect(port.download).toHaveBeenCalledOnce()
    emit({ type: 'progress', percent: 42.6 }); expect(updates.snapshot.progress).toBe(42.6)
    emit({ type: 'downloaded', version: '0.2.0' })
    expect(port.install).not.toHaveBeenCalled()
    await updates.action('install'); await updates.action('install'); expect(port.install).toHaveBeenCalledOnce()
  })
  it('ignores duplicate checks/downloads and rejects install without a verified downloaded update', async () => {
    const { updates, port, emit } = setup()
    await updates.action('install'); expect(port.install).not.toHaveBeenCalled()
    await Promise.all([updates.action('check'), updates.action('check')]); expect(port.check).toHaveBeenCalledOnce()
    emit({ type: 'available', version: '0.2.0' })
    await Promise.all([updates.action('download'), updates.action('download')]); expect(port.download).toHaveBeenCalledOnce()
  })
  it('retains a downloaded update while a rest or system pause blocks installation', async () => {
    const { updates, port, emit, block } = setup()
    emit({ type: 'downloaded', version: '0.2.0' }); block(); await updates.action('install')
    expect(port.install).not.toHaveBeenCalled()
    expect(updates.snapshot.status).toBe('downloaded')
    expect(updates.snapshot.message).toBeTruthy()
  })
  it('reports a failed check as failure, never as up to date, and allows retry', async () => {
    const { updates, port, emit } = setup()
    vi.mocked(port.check).mockRejectedValueOnce(new Error('network unavailable'))
    await updates.action('check'); expect(updates.snapshot.status).toBe('error')
    await updates.action('check'); emit({ type: 'current' })
    expect(updates.snapshot.status).toBe('current')
  })
  it('does not contact an update server in a development build', async () => {
    const { updates, port } = setup(false)
    await updates.action('check'); await updates.action('download'); await updates.action('install')
    expect(updates.snapshot.status).toBe('unsupported')
    expect(port.check).not.toHaveBeenCalled(); expect(port.download).not.toHaveBeenCalled(); expect(port.install).not.toHaveBeenCalled()
  })
  it('distinguishes a missing published release from an up-to-date application', async () => {
    const { updates, emit } = setup()
    for (const error of [Object.assign(new Error('No releases'), { code: 'ERR_UPDATER_NO_PUBLISHED_VERSIONS' }), Object.assign(new Error('No published versions on GitHub'), { code: 'ERR_XML_MISSED_ELEMENT' })]) {
      emit({ type: 'error', error })
      expect(updates.snapshot.status).toBe('error')
      expect(updates.snapshot.message).toBe('暂时没有可用的发布版本')
    }
  })
})
