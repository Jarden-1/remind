export function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}
export function clockTime(date: Date) {
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}
export function nextWorkLabel(value: string | null) {
  if (!value) return '进入工作时段后自动开始'
  const date = new Date(value)
  const today = new Date()
  const day = date.toDateString() === today.toDateString() ? '今天' : date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
  return `${day} ${clockTime(date)} 开始下一轮`
}
