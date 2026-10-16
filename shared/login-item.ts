/** Windows passes this argument when the login item starts the app. macOS reports wasOpenedAtLogin instead. */
export const hiddenLaunchArg = '--hidden'
export const loginItemsSettingsUrl = 'x-apple.systempreferences:com.apple.LoginItems-Settings.extension'

export interface LoginItemReading {
  openAtLogin?: boolean
  wasOpenedAtLogin?: boolean
  status?: 'not-registered' | 'enabled' | 'requires-approval' | 'not-found'
}

export type LoginItemStatus = NonNullable<LoginItemReading['status']> | 'unsupported' | 'unavailable'
export type InstallLocation = 'applications' | 'translocated' | 'volume' | 'other'

export interface LoginItemState {
  openAtLogin: boolean
  status: LoginItemStatus
  approvalNeeded: boolean
  message: string | null
}

const moveToApplications = '请先把 remind 移到“应用程序”文件夹。从磁盘映像或隔离副本打开时，开机自启动不会在下次登录生效。'
const needsApproval = 'macOS 需要在“系统设置 → 通用 → 登录项”里允许 remind。允许后，下次登录才会自动打开。'
const rejected = '系统没有打开登录时启动'

/** A missing choice means “on”, including installs that never touched the switch. */
export function desiredOpenAtLogin(chosen: boolean, stored: boolean) {
  return chosen ? stored : true
}

export function classifyInstallLocation(execPath: string, inApplicationsFolder: boolean): InstallLocation {
  if (execPath.includes('/AppTranslocation/')) return 'translocated'
  if (execPath.startsWith('/Volumes/')) return 'volume'
  if (inApplicationsFolder) return 'applications'
  return 'other'
}

/** SMAppService only keeps a login item whose bundle stays in /Applications. */
export function canRegisterLoginItem(location: InstallLocation | 'unsupported') {
  return location === 'applications' || location === 'unsupported'
}

export function loginItemRequest(openAtLogin: boolean, platform: 'darwin' | 'win32') {
  if (platform === 'darwin') return { openAtLogin, type: 'mainAppService' as const }
  return { openAtLogin, args: openAtLogin ? [hiddenLaunchArg] : [], enabled: openAtLogin }
}

export function loginItemQuery(platform: 'darwin' | 'win32') {
  if (platform === 'darwin') return { type: 'mainAppService' as const }
  return { args: [hiddenLaunchArg] }
}

export function presentLoginItem(reading: LoginItemReading, location: InstallLocation | 'unsupported', requested: boolean): LoginItemState {
  if (location === 'translocated' || location === 'volume' || location === 'other') {
    return { openAtLogin: false, status: reading.status ?? 'not-found', approvalNeeded: false, message: moveToApplications }
  }
  if (reading.status === 'requires-approval') {
    return { openAtLogin: true, status: reading.status, approvalNeeded: true, message: needsApproval }
  }
  if (reading.status === 'enabled') {
    return { openAtLogin: true, status: reading.status, approvalNeeded: false, message: null }
  }
  if (reading.status === 'not-registered' || reading.status === 'not-found') {
    return { openAtLogin: false, status: reading.status, approvalNeeded: false, message: requested ? rejected : null }
  }
  const openAtLogin = Boolean(reading.openAtLogin)
  return { openAtLogin, status: 'unsupported', approvalNeeded: false, message: requested && !openAtLogin ? rejected : null }
}

export function launchedHidden(argv: readonly string[], reading: LoginItemReading) {
  return argv.includes(hiddenLaunchArg) || Boolean(reading.wasOpenedAtLogin)
}
