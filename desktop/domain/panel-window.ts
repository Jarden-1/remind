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
export function panelBounds(area: PanelArea, anchor: { x: number; y: number }, platform: string, settingsOpen: boolean): PanelArea {
  const gap = 8
  const width = Math.max(1, Math.min(368, area.width - gap * 2))
  const height = Math.max(1, Math.min(settingsOpen ? 740 : 440, area.height - gap * 2))
  return {
    width, height,
    x: Math.round(Math.max(area.x + gap, Math.min(anchor.x - width / 2, area.x + area.width - width - gap))),
    y: Math.round(platform === 'darwin' ? area.y + gap : area.y + area.height - height - gap),
  }
}
