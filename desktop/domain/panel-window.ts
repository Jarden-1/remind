/**
 * Frameless always-on-top panels with a hidden Dock (macOS) or no taskbar button
 * do not leave the screen when minimized. macOS can also report isMinimized()
 * while the window is still visible, so hide whenever it is not a Windows minimize.
 */
export function shouldHidePanel(platform: string, visible: boolean) {
  if (platform === 'win32') return visible
  return true
}


export interface PanelArea { x: number; y: number; width: number; height: number }
/** A tray click has its own toggle handler; native controls inside the panel can also take focus. */
export function shouldDismissPanelOnBlur(point: { x: number; y: number }, panel: PanelArea, tray: PanelArea | undefined, settingsOpen: boolean) {
  const inside = (area: PanelArea) => point.x >= area.x && point.x < area.x + area.width && point.y >= area.y && point.y < area.y + area.height
  return !settingsOpen && !inside(panel) && (!tray || !inside(tray))
}
export const DEFAULT_PANEL_HEIGHT = 378
export function panelBounds(area: PanelArea, anchor: { x: number; y: number }, platform: string, settingsOpen: boolean, contentHeight = DEFAULT_PANEL_HEIGHT): PanelArea {
  const gap = 8
  const width = Math.max(1, Math.min(368, area.width - gap * 2))
  const height = Math.max(1, Math.min(settingsOpen ? 740 : contentHeight, area.height - gap * 2))
  return {
    width, height,
    x: Math.round(Math.max(area.x + gap, Math.min(anchor.x - width / 2, area.x + area.width - width - gap))),
    y: Math.round(platform === 'darwin' ? area.y + gap : area.y + area.height - height - gap),
  }
}

/** Content changes resize a visible panel without showing it or taking focus. */
export function fitPanelHeight(bounds: PanelArea, area: PanelArea, contentHeight: number, platform: string): PanelArea {
  const height = Math.max(1, Math.min(contentHeight, area.height - 16))
  const preferredY = platform === 'win32' ? bounds.y + bounds.height - height : bounds.y
  return { ...bounds, height, y: Math.round(Math.max(area.y + 8, Math.min(preferredY, area.y + area.height - height - 8))) }
}
