import { describe, expect, it, vi, afterEach } from 'vitest'
import { MeetingMonitor, type MeetingObservation } from './monitor'
import { MeetingService, parseObservation } from './service'
function sample(tencent: 'active' | 'inactive' | 'unknown', feishu: 'active' | 'inactive' | 'unknown' = 'inactive'): MeetingObservation {
  return { protocol: 1, permission: 'granted', apps: [{ id: 'tencent-meeting', status: tencent }, { id: 'feishu', status: feishu }] }
}
function setup() {
  const monitor = new MeetingMonitor(); monitor.configure(true)
  const run = (value: MeetingObservation, from: number, to: number) => { for (let time = from; time <= to; time += 2000) monitor.observe(value, time) }
  return { monitor, run }
}
describe('meeting confirmation', () => {
  it('requires a sustained call signal and dismisses entry-preview flicker', () => {
    const { monitor, run } = setup()
    run(sample('active'), 0, 4000); expect(monitor.state.apps).toEqual([])
    monitor.observe(sample('inactive'), 5000); monitor.observe(sample('active'), 6000)
    expect(monitor.state.apps).toEqual([])
    run(sample('active'), 8000, 12000); expect(monitor.state.apps).toEqual(['tencent-meeting'])
  })
  it('waits thirty seconds of valid absence before releasing a call', () => {
    const { monitor, run } = setup(); run(sample('active'), 0, 6000)
    run(sample('inactive'), 8000, 36000); expect(monitor.state.apps).toEqual(['tencent-meeting'])
    monitor.observe(sample('inactive'), 38000); expect(monitor.state.status).toBe('inactive')
  })
  it('keeps two apps independent and does not resume when only one ends', () => {
    const { monitor, run } = setup(); run(sample('active', 'active'), 0, 6000)
    run(sample('inactive', 'active'), 8000, 38000)
    expect(monitor.state.apps).toEqual(['feishu'])
    expect(monitor.allowOverlay).toBe(false)
  })
  it('does not treat a missing app result, permission loss or timeout as a call ending', () => {
    const { monitor, run } = setup(); run(sample('active'), 0, 6000)
    monitor.observe({ protocol: 1, permission: 'required', apps: [] }, 8000)
    expect(monitor.state.apps).toEqual(['tencent-meeting'])
    expect(monitor.state.permission).toBe('required'); expect(monitor.allowOverlay).toBe(false)
    monitor.observe({ protocol: 1, permission: 'required', apps: [] }, 128000)
    expect(monitor.state.status).toBe('confirmation')
  })
  it('does not auto-pause for uncertainty before a call but prevents automatic overlays', () => {
    const { monitor } = setup(); monitor.observe(sample('unknown'), 0)
    expect(monitor.state.apps).toEqual([]); expect(monitor.state.status).toBe('unknown'); expect(monitor.allowOverlay).toBe(false)
  })
  it('expires an ignore after a real end, allowing the next meeting to pause again', () => {
    const { monitor, run } = setup(); run(sample('active'), 0, 6000); monitor.ignore()
    run(sample('active'), 8000, 10000); expect(monitor.state.status).toBe('ignored')
    run(sample('inactive'), 12000, 42000); expect(monitor.state.status).toBe('inactive')
    run(sample('active'), 44000, 50000); expect(monitor.state.apps).toEqual(['tencent-meeting'])
  })
  it('does not confirm the start or end across a sleep or scheduling gap', () => {
    const { monitor, run } = setup(); monitor.observe(sample('active'), 0); monitor.observe(sample('active'), 60000)
    expect(monitor.state.apps).toEqual([])
    run(sample('active'), 62000, 66000); monitor.observe(sample('inactive'), 68000); monitor.observe(sample('inactive'), 120000)
    expect(monitor.state.apps).toEqual(['tencent-meeting'])
  })
  it('disabling clears only the meeting controller and ignores late samples', () => {
    const { monitor, run } = setup(); run(sample('active'), 0, 6000); monitor.configure(false)
    monitor.observe(sample('active'), 8000); expect(monitor.state.status).toBe('disabled'); expect(monitor.allowOverlay).toBe(true)
  })
})
afterEach(() => vi.useRealTimers())
describe('native probe boundary', () => {
  it('rejects malformed, duplicate or unsupported application records', () => {
    expect(parseObservation(JSON.stringify(sample('inactive'))).apps).toHaveLength(2)
    for (const value of ['{}', '{"protocol":1,"permission":"granted","apps":[{"id":"other","status":"active"}]}', JSON.stringify({ ...sample('active'), apps: [sample('active').apps[0], sample('active').apps[0]] })]) expect(() => parseObservation(value)).toThrow()
  })
  it('coalesces calls, ignores shutdown responses and stops polling', async () => {
    vi.useFakeTimers(); let resolve!: (value: MeetingObservation) => void
    const probe = vi.fn(() => new Promise<MeetingObservation>(done => { resolve = done })); const changed = vi.fn()
    const service = new MeetingService(probe, changed); service.configure(true)
    const pending = service.checkNow(); expect(probe).toHaveBeenCalledOnce(); service.stop(); changed.mockClear()
    resolve(sample('active')); await pending; await vi.advanceTimersByTimeAsync(10000)
    expect(changed).not.toHaveBeenCalled(); expect(probe).toHaveBeenCalledOnce()
  })
  it('reports native failures as unknown and does not poll while disabled or locked', async () => {
    vi.useFakeTimers(); const probe = vi.fn(async (): Promise<MeetingObservation> => { throw new Error('timeout') })
    const service = new MeetingService(probe, () => {}); await service.checkNow(); expect(probe).not.toHaveBeenCalled()
    service.configure(true); await service.checkNow(); expect(service.state.status).toBe('unknown')
    service.suspend(true); await vi.advanceTimersByTimeAsync(10000); expect(probe).toHaveBeenCalledOnce(); service.stop()
  })
})
