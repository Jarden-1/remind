import { useEffect, useSyncExternalStore } from 'react'
import type { ReminderClient } from '../contracts/reminder'
import { Toggle } from '../components/Toggle'
import { errorMessage } from '../lib/errors'

export function MeetingSettings({ client, enabled, onChange, notify }: { client: ReminderClient; enabled: boolean; onChange: (value: boolean) => void; notify: (value: string) => void }) {
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot)
  const state = snapshot.meeting
  useEffect(() => {
    if (!enabled || !client.refreshMeeting) return
    const refresh = () => { void client.refreshMeeting!().catch(error => notify(errorMessage(error))) }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [client, enabled])
  return <div className="meeting-setting">
    <Toggle label="会议自动暂停" description="实验性 · 腾讯会议、飞书" checked={enabled} disabled={state?.status === 'unsupported'} onChange={onChange} />
    {enabled && <div className="meeting-details">
      <p className="helper">{!snapshot.settings.meetingPause ? '保存后生效' : state?.message ?? (client.refreshMeeting ? '仅读取会议控件，不录音' : '浏览器仅支持模拟会议')}</p>
      {state?.permission === 'required' && client.openMeetingPermissions && <button className="text-button" onClick={() => void client.openMeetingPermissions!().catch(error => notify(errorMessage(error)))}>打开辅助功能设置</button>}
      {snapshot.settings.meetingPause && client.refreshMeeting && <button className="text-button" onClick={() => void client.refreshMeeting!().catch(error => notify(errorMessage(error)))}>重新检测</button>}
    </div>}
  </div>
}
