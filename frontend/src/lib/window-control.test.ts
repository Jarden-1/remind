import { describe, expect, it, vi } from 'vitest'
import { windowControlHandlers } from './window-control'

function event(button = 0) {
  return { button, preventDefault: vi.fn(), stopPropagation: vi.fn() }
}

describe('window controls inside a drag region', () => {
  it('runs on mousedown and ignores the click that follows', () => {
    const action = vi.fn()
    const handlers = windowControlHandlers(action)
    const down = event()
    handlers.onMouseDown(down)
    handlers.onClick(event())
    expect(action).toHaveBeenCalledOnce()
    expect(down.preventDefault).toHaveBeenCalledOnce()
  })
  it('still runs for a keyboard click', () => {
    const action = vi.fn()
    windowControlHandlers(action).onClick(event())
    expect(action).toHaveBeenCalledOnce()
  })
  it('ignores a non-primary button', () => {
    const action = vi.fn()
    windowControlHandlers(action).onMouseDown(event(2))
    expect(action).not.toHaveBeenCalled()
  })
})
