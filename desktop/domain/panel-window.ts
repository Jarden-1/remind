/**
 * Frameless always-on-top panels with a hidden Dock (macOS) or no taskbar button
 * do not leave the screen when minimized. macOS can also report isMinimized()
 * while the window is still visible, so hide whenever it is not a Windows minimize.
 */
export function shouldHidePanel(platform: string, visible: boolean) {
  if (platform === 'win32') return visible
  return true
}
