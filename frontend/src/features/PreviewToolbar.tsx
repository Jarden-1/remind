import { useState } from 'react'
import { CalendarOff, ChevronDown, FlaskConical, RotateCcw, Timer, Video, X } from 'lucide-react'
import type { PreviewControls, ReminderSnapshot } from '../contracts/reminder'

export function PreviewToolbar({ controls, snapshot }: { controls: PreviewControls; snapshot: ReminderSnapshot }) {
  const [open, setOpen] = useState(false)
  return <aside className="preview-tools" aria-label="前端预览工具">
    {open && <div className="preview-popover"><div className="preview-heading"><strong>体验不同状态</strong><button className="icon-button" aria-label="关闭预览工具" onClick={() => setOpen(false)}><X size={15} /></button></div><p>仅模拟状态，不读取电脑上的会议软件。</p><button onClick={() => controls.advanceToPreReminder()}><Timer size={15} />提前 1 分钟提醒</button><button onClick={() => { controls.advanceToBreak(); setOpen(false) }}><Timer size={15} />5 秒后进入休息</button><button aria-pressed={snapshot.pauseReasons.includes('meeting')} onClick={() => controls.setMeeting(!snapshot.pauseReasons.includes('meeting'))}><Video size={15} />{snapshot.pauseReasons.includes('meeting') ? '结束会议' : '模拟会议开始'}</button><button aria-pressed={snapshot.pauseReasons.includes('schedule')} onClick={() => controls.setOutsideSchedule(!snapshot.pauseReasons.includes('schedule'))}><CalendarOff size={15} />{snapshot.pauseReasons.includes('schedule') ? '返回工作时段' : '模拟非工作时段'}</button><button onClick={() => { controls.reset(); setOpen(false) }}><RotateCcw size={15} />恢复默认设置</button></div>}
    <button className="preview-trigger" aria-expanded={open} onClick={() => setOpen(value => !value)}><FlaskConical size={14} />前端预览<ChevronDown size={13} className={open ? 'flipped' : ''} /></button>
  </aside>
}
