import type { PauseReason, ReminderSnapshot } from '../../shared/reminder'

const reasonLabel: Record<PauseReason, string> = {
  manual: '已暂停',
  meeting: '会议中',
  schedule: '非工作时段',
  locked: '已锁屏',
  suspended: '系统休眠',
  updating: '正在更新',
}

function formatClock(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds))
  return `${Math.floor(safe / 60).toString().padStart(2, '0')}:${(safe % 60).toString().padStart(2, '0')}`
}

/** Short menu-bar title plus a tooltip that stays useful where setTitle is unavailable. */
export function trayPresentation(snapshot: ReminderSnapshot): { title: string; tooltip: string } {
  const time = formatClock(snapshot.remainingSeconds)
  const reasons = snapshot.pauseReasons
  if (snapshot.preparingBreak) return { title: '准备', tooltip: 'remind · 准备休息' }
  if (snapshot.phase === 'break') return { title: `休息 ${time}`, tooltip: `remind · 休息中 · 剩余 ${time}` }
  if (snapshot.phase === 'ready') return { title: '未开始', tooltip: 'remind · 未开始' }

  const labels = reasons.map(reason => reasonLabel[reason])
  const described = labels.join(' · ')
  const system = reasons.some(reason => reason === 'locked' || reason === 'suspended' || reason === 'updating')
  if (system) return { title: '暂停', tooltip: `remind · ${described}` }
  if (reasons.includes('meeting')) return { title: '会议', tooltip: `remind · ${described}` }
  if (reasons.includes('manual')) return { title: `暂停 ${time}`, tooltip: `remind · ${described} · 剩余 ${time}` }
  if (reasons.includes('schedule')) return { title: '时段外', tooltip: `remind · ${described}` }
  if (snapshot.lastInPeriod) return { title: '等待', tooltip: 'remind · 等待下一时段' }
  return { title: time, tooltip: `remind · 距离休息 ${time}` }
}
