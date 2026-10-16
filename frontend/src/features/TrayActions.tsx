import type { ReminderClient, ReminderSnapshot } from '../contracts/reminder'

/** The hover card never activates the app or overlaps an open panel. */
export function TrayActions({ snapshot, client }: { snapshot: ReminderSnapshot; client: ReminderClient }) {
  const manual = snapshot.pauseReasons.includes('manual')
  const ready = snapshot.phase === 'ready'
  const toggle = ready ? client.start : manual ? client.resume : client.pause
  return <nav className="tray-actions" aria-label="remind 快捷操作"
    onMouseEnter={() => void window.remind?.tray?.('enter')}
    onMouseLeave={() => void window.remind?.tray?.('leave')}>
    <button onClick={() => void window.remind?.tray?.('open')}>打开看板</button>
    <button disabled={snapshot.phase === 'break' || snapshot.preparingBreak} onClick={() => void toggle()}>{ready ? '开始提醒' : manual ? '继续提醒' : '暂停提醒'}</button>
    <button onClick={() => void client.resetTimer()}>重置时间</button>
    <hr />
    <button onClick={() => void window.remind?.tray?.('quit')}>退出 remind</button>
  </nav>
}
