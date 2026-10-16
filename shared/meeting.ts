export const meetingAppIds = ['tencent-meeting', 'feishu'] as const
export type MeetingAppId = typeof meetingAppIds[number]
export const meetingNames: Record<MeetingAppId, string> = { 'tencent-meeting': '腾讯会议', feishu: '飞书' }
export interface MeetingState {
  status: 'disabled' | 'checking' | 'inactive' | 'active' | 'unknown' | 'confirmation' | 'ignored' | 'unsupported'
  apps: MeetingAppId[]
  permission: 'granted' | 'required' | 'unsupported'
  message: string | null
}
export const disabledMeetingState = (): MeetingState => ({ status: 'disabled', apps: [], permission: 'granted', message: null })
