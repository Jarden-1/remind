/** Windows passes this argument when the login item starts the app. macOS reports wasOpenedAtLogin instead. */
export const hiddenLaunchArg = '--hidden'

export interface LoginItemReading {
  openAtLogin?: boolean
  wasOpenedAtLogin?: boolean
  status?: 'not-registered' | 'enabled' | 'requires-approval' | 'not-found'
}

export function loginItemRequest(openAtLogin: boolean) {
  return { openAtLogin, args: openAtLogin ? [hiddenLaunchArg] : [], enabled: openAtLogin }
}

export function loginItemQuery() {
  return { args: [hiddenLaunchArg] }
}

/** Show the operating system's result. A pending macOS approval is not "on". */
export function displayedOpenAtLogin(reading: LoginItemReading) {
  if (reading.status === 'enabled') return true
  if (reading.status === 'requires-approval' || reading.status === 'not-registered' || reading.status === 'not-found') return false
  return Boolean(reading.openAtLogin)
}

export function loginToggleResult(requested: boolean, reading: LoginItemReading) {
  const openAtLogin = displayedOpenAtLogin(reading)
  const message = requested && !openAtLogin
    ? reading.status === 'requires-approval' ? '系统尚未允许登录时打开，请在系统设置中确认' : '系统没有打开登录时启动'
    : null
  return { openAtLogin, message }
}

export function launchedHidden(argv: readonly string[], reading: LoginItemReading) {
  return argv.includes(hiddenLaunchArg) || Boolean(reading.wasOpenedAtLogin)
}
