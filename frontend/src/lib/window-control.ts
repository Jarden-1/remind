interface ControlEvent {
  button?: number
  preventDefault(): void
  stopPropagation(): void
}

/**
 * Frameless macOS drag regions deliver mousedown (so :active sticks) and then
 * swallow mouseup, so click never runs. Act on mousedown and ignore the click
 * that follows. Keyboard activation has no mousedown, so click still runs.
 */
export function windowControlHandlers(action: () => void) {
  let fromMouse = false
  return {
    onMouseDown(event: ControlEvent) {
      if ((event.button ?? 0) !== 0) return
      event.preventDefault()
      event.stopPropagation()
      fromMouse = true
      action()
    },
    onClick(event: ControlEvent) {
      if (fromMouse) {
        fromMouse = false
        event.preventDefault()
        return
      }
      action()
    },
  }
}
