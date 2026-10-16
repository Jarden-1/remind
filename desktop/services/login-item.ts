export {
  canRegisterLoginItem, classifyInstallLocation, desiredOpenAtLogin, hiddenLaunchArg, launchedHidden,
  loginItemQuery, loginItemRequest, loginItemsSettingsUrl, presentLoginItem,
} from '../../shared/login-item'
export type { InstallLocation, LoginItemReading, LoginItemState, LoginItemStatus } from '../../shared/login-item'

import type { InstallLocation, LoginItemReading, LoginItemState } from '../../shared/login-item'
import { canRegisterLoginItem, loginItemQuery, loginItemRequest, presentLoginItem } from '../../shared/login-item'

export interface LoginItemPort {
  read(query: ReturnType<typeof loginItemQuery>): LoginItemReading
  write(request: ReturnType<typeof loginItemRequest>): void
  location(): InstallLocation | 'unsupported'
  report(error: unknown): void
}

/** Login-item permissions and OS failures must never prevent the reminder from starting. */
export class LoginItems {
  snapshot: LoginItemState = { openAtLogin: false, status: 'unsupported', approvalNeeded: false, message: null }
  launchReading: LoginItemReading = {}
  constructor(private platform: 'darwin' | 'win32' | null, private packaged: boolean, private port: LoginItemPort) {}
  refresh(requested: boolean) {
    if (!this.platform || !this.packaged) {
      this.snapshot = { openAtLogin: false, status: 'unsupported', approvalNeeded: false, message: this.packaged ? '当前系统不支持开机自启动' : '开发预览不修改系统自启动设置' }
      return this.snapshot
    }
    try {
      this.launchReading = this.port.read(loginItemQuery(this.platform))
      this.snapshot = presentLoginItem(this.launchReading, this.port.location(), requested)
    } catch (error) { this.fail(error, '无法读取开机自启动状态，请重试') }
    return this.snapshot
  }
  apply(requested: boolean) {
    if (!this.platform || !this.packaged) return this.refresh(requested)
    try {
      if (canRegisterLoginItem(this.port.location())) this.port.write(loginItemRequest(requested, this.platform))
    } catch (error) {
      this.refresh(requested)
      this.fail(error, '无法更改开机自启动，请重试')
      return this.snapshot
    }
    return this.refresh(requested)
  }
  private fail(error: unknown, message: string) {
    this.port.report(error)
    this.snapshot = { ...this.snapshot, status: 'unavailable', approvalNeeded: false, message }
  }
}
