import { afterEach, expect, it, vi } from 'vitest'
import { TrayHover } from './tray-hover'
afterEach(() => vi.useRealTimers())
function setup(prepare = async () => {}) {
  vi.useFakeTimers()
  let blocked = false
  const port = { prepare, canShow: () => !blocked, show: vi.fn(), hide: vi.fn(), report: vi.fn() }
  return { hover: new TrayHover(port), port, block: () => { blocked = true } }
}
it('does not show a stale card after click cancels a slow load', async () => {
  let finish!: () => void
  const { hover, port } = setup(() => new Promise<void>(resolve => { finish = resolve }))
  hover.enter(); await vi.advanceTimersByTimeAsync(350)
  hover.cancel(); finish(); await Promise.resolve()
  expect(port.show).not.toHaveBeenCalled()
})
it('never overlaps a panel or break that opened while the card loaded', async () => {
  let finish!: () => void
  const { hover, port, block } = setup(() => new Promise<void>(resolve => { finish = resolve }))
  hover.enter(); await vi.advanceTimersByTimeAsync(350)
  block(); finish(); await Promise.resolve()
  expect(port.show).not.toHaveBeenCalled()
})
it('keeps the card open while moving from tray into its actions, then closes on exit', async () => {
  const { hover, port } = setup()
  hover.enter(); await vi.advanceTimersByTimeAsync(350)
  expect(port.show).toHaveBeenCalledOnce()
  hover.leave(); await vi.advanceTimersByTimeAsync(100); hover.enterCard()
  await vi.advanceTimersByTimeAsync(300)
  expect(port.hide).not.toHaveBeenCalled()
  hover.leave(); await vi.advanceTimersByTimeAsync(250)
  expect(port.hide).toHaveBeenCalledOnce()
})
