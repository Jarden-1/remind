import { describe, expect, it, vi } from 'vitest'
import { Updates, updateCheckDelayMs, updateCheckIntervalMs, type UpdateEvent, type UpdatePort, type UpdateTimers } from './updates'

function setup(supported = true, delivery: 'native' | 'browser' = 'native') {
  let listener!: (event: UpdateEvent) => void
  const port: UpdatePort = { subscribe: fn => { listener = fn }, check: vi.fn(async () => {}), download: vi.fn(async () => {}), install: vi.fn() }
  let canInstall = true
  const updates = new Updates(port, '0.1.0', supported, () => canInstall, undefined, delivery)
  return { updates, port, emit: (event: UpdateEvent) => listener(event), block: () => { canInstall = false } }
}
function clock() {
  let now = 0
  let nextId = 1
  const timers = new Map<number, { at: number; every?: number; fn: () => void }>()
  const api: UpdateTimers = {
    setTimeout(fn, ms) { const id = nextId++; timers.set(id, { at: now + ms, fn }); return id },
    clearTimeout(handle) { timers.delete(handle as number) },
    setInterval(fn, ms) { const id = nextId++; timers.set(id, { at: now + ms, every: ms, fn }); return id },
    clearInterval(handle) { timers.delete(handle as number) },
  }
  return { api, async advance(ms: number) {
    const target = now + ms
    for (;;) {
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)
      if (!due.length) break
      const [id, timer] = due[0]
      now = timer.at
      if (timer.every) timer.at += timer.every
      else timers.delete(id)
      timer.fn()
      await Promise.resolve()
    }
    now = target
  } }
}
describe('user controlled updates', () => {
  it('enables native installation after deferred signature verification without resetting discovery', async () => {
    const { updates, port, emit } = setup(true, 'browser')
    emit({ type: 'available', version: '0.2.0' })
    await updates.action('download'); expect(port.download).not.toHaveBeenCalled()
    updates.setDelivery('native')
    expect(updates.snapshot.version).toBe('0.2.0')
    expect(updates.snapshot.status).toBe('available')
    await updates.action('download'); expect(port.download).toHaveBeenCalledOnce()
  })
  it('does not download or install unless the user asks, including right after startup', async () => {
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
  it('checks once after startup and then on the six hour interval, without downloading', async () => {
    const { updates, port, emit } = setup()
    const time = clock()
    const found: string[] = []
    updates.onDiscovered(version => found.push(version))
    updates.arm(time.api)
    await time.advance(updateCheckDelayMs - 1)
    expect(port.check).not.toHaveBeenCalled()
    await time.advance(1)
    expect(port.check).toHaveBeenCalledOnce()
    emit({ type: 'available', version: '0.2.0' })
    expect(found).toEqual(['0.2.0'])
    expect(port.download).not.toHaveBeenCalled()
    await time.advance(updateCheckIntervalMs)
    expect(port.check).toHaveBeenCalledTimes(2)
    emit({ type: 'available', version: '0.2.0' })
    expect(found).toEqual(['0.2.0'])
  })
  it('stays idle when a background check finds the current version', async () => {
    const { updates, port, emit } = setup()
    const time = clock()
    vi.mocked(port.check).mockImplementationOnce(async () => { emit({ type: 'current' }) })
    updates.arm(time.api)
    await time.advance(updateCheckDelayMs)
    expect(updates.snapshot.status).toBe('idle')
    expect(updates.snapshot.message).toBeNull()
  })
  it('keeps a failed background check quiet and still allows a later manual check', async () => {
    const { updates, port, emit } = setup()
    const time = clock()
    vi.mocked(port.check).mockRejectedValueOnce(new Error('network unavailable'))
    updates.arm(time.api)
    await time.advance(updateCheckDelayMs)
    expect(updates.snapshot.status).toBe('idle')
    expect(updates.snapshot.message).toBeNull()
    await updates.action('check'); emit({ type: 'current' })
    expect(updates.snapshot.status).toBe('current')
  })
  it('ignores a background feed error and does not call the app up to date', async () => {
    const { updates, port, emit } = setup()
    const time = clock()
    const failure = Object.assign(new Error('No published versions on GitHub'), { code: 'ERR_XML_MISSED_ELEMENT' })
    vi.mocked(port.check).mockImplementationOnce(async () => { emit({ type: 'error', error: failure }); throw failure })
    updates.arm(time.api)
    await time.advance(updateCheckDelayMs)
    expect(updates.snapshot.status).toBe('idle')
    expect(updates.snapshot.message).toBeNull()
  })
  it('opens no in-app download or install path for an unsigned Mac build', async () => {
    const { updates, port, emit } = setup(true, 'browser')
    emit({ type: 'available', version: '0.2.0' })
    expect(updates.snapshot.delivery).toBe('browser')
    await updates.action('download'); await updates.action('install')
    expect(port.download).not.toHaveBeenCalled()
    expect(port.install).not.toHaveBeenCalled()
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
  it('reports a failed manual check as failure, never as up to date, and allows retry', async () => {
    const { updates, port, emit } = setup()
    vi.mocked(port.check).mockRejectedValueOnce(new Error('network unavailable'))
    await updates.action('check'); expect(updates.snapshot.status).toBe('error')
    await updates.action('check'); emit({ type: 'current' })
    expect(updates.snapshot.status).toBe('current')
  })
  it('does not contact an update server in a development build', async () => {
    const { updates, port } = setup(false)
    const time = clock()
    updates.arm(time.api)
    await time.advance(updateCheckDelayMs + updateCheckIntervalMs)
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
describe('update races and shutdown', () => {
  it('does not publish a download rejection after shutdown', async () => {
    const { updates, port, emit } = setup()
    let reject!: (error: Error) => void
    vi.mocked(port.download).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
    emit({ type: 'available', version: '0.2.0' })
    const download = updates.action('download')
    const changed = vi.fn(); updates.subscribe(changed)
    updates.stop(); reject(new Error('cancelled while quitting'))
    await download
    expect(changed).not.toHaveBeenCalled()
    expect(updates.snapshot.status).toBe('downloading')
  })
  it('joins a background check when the user clicks check and displays its failure', async () => {
    const { updates, port, emit } = setup(); const time = clock()
    let reject!: (error: Error) => void
    vi.mocked(port.check).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
    updates.arm(time.api); await time.advance(updateCheckDelayMs)
    const manual = updates.action('check')
    expect(updates.snapshot.status).toBe('checking')
    const error = new Error('offline'); emit({ type: 'error', error }); reject(error)
    await manual
    expect(port.check).toHaveBeenCalledOnce()
    expect(updates.snapshot.status).toBe('error')
  })
  it('does not let late feed results reset an active download', async () => {
    const { updates, emit } = setup()
    emit({ type: 'available', version: '0.2.0' }); await updates.action('download')
    emit({ type: 'current' }); emit({ type: 'available', version: '0.3.0' })
    expect(updates.snapshot.status).toBe('downloading')
    expect(updates.snapshot.version).toBe('0.2.0')
    emit({ type: 'progress', percent: NaN }); expect(updates.snapshot.progress).toBe(0)
  })
  it('retains a verified download if native installation reports an asynchronous failure', async () => {
    const { updates, emit } = setup()
    emit({ type: 'downloaded', version: '0.2.0' }); await updates.action('install')
    emit({ type: 'error', error: new Error('installer unavailable') })
    expect(updates.snapshot.status).toBe('downloaded')
    expect(updates.snapshot.message).toContain('安装失败')
  })
  it('ignores in-flight responses after shutdown without notifying or scheduling more checks', async () => {
    const { updates, port, emit } = setup(); const time = clock(); const discovered = vi.fn()
    updates.onDiscovered(discovered); updates.arm(time.api)
    await time.advance(updateCheckDelayMs); updates.stop()
    emit({ type: 'available', version: '0.2.0' }); await time.advance(updateCheckIntervalMs)
    expect(discovered).not.toHaveBeenCalled()
    expect(port.check).toHaveBeenCalledOnce()
    expect(updates.snapshot.status).toBe('idle')
  })
})
