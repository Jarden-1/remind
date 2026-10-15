interface ControlEvent {
  button?: number
  detail: number
  preventDefault(): void
  stopPropagation(): void
}

/** Native drag regions may swallow mouseup/click. Mouse activates on down;
 * keyboard and accessibility clicks (detail 0) activate on click. Event detail
 * survives React rerenders and does not swallow the next keyboard activation. */
export function windowControlHandlers(action: () => void) {
  return {
    onMouseDown(event: ControlEvent) {
      if ((event.button ?? 0) !== 0) return
      event.preventDefault(); event.stopPropagation(); action()
    },
    onClick(event: ControlEvent) {
      if (event.detail !== 0) { event.preventDefault(); return }
      action()
    },
  }
}
