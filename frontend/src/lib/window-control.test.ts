import { describe, expect, it, vi } from 'vitest'
import { windowControlHandlers } from './window-control'

function event(button = 0, detail = 1) {
  return { button, detail, preventDefault: vi.fn(), stopPropagation: vi.fn() }
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
    windowControlHandlers(action).onClick(event(0, 0))
    expect(action).toHaveBeenCalledOnce()
  })
  it('ignores a non-primary button', () => {
    const action = vi.fn()
    windowControlHandlers(action).onMouseDown(event(2))
    expect(action).not.toHaveBeenCalled()
  })
})

 it('allows keyboard activation after macOS swallowed a mouse click', () => {
   const action = vi.fn(); const handlers = windowControlHandlers(action)
   handlers.onMouseDown(event()); handlers.onClick(event(0, 0))
   expect(action).toHaveBeenCalledTimes(2)
 })
 it('does not double activate when a timer update rerenders between mouse down and click', () => {
   const action = vi.fn()
   windowControlHandlers(action).onMouseDown(event())
   windowControlHandlers(action).onClick(event())
   expect(action).toHaveBeenCalledOnce()
 })
