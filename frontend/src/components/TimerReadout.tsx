import { formatTime } from '../lib/format'

export function TimerReadout({ remaining, total, paused }: { remaining: number; total: number; paused: boolean }) {
  const [minutes, seconds] = formatTime(remaining).split(':')
  const elapsed = Math.max(0, Math.min(1, 1 - remaining / total))
  return <div className={`timer-readout ${paused ? 'is-paused' : ''}`}>
    <div className="time-digits" aria-label={`剩余 ${Math.floor(remaining / 60)} 分 ${remaining % 60} 秒`}>
      <span>{minutes}</span><span className="time-colon" aria-hidden="true">:</span><span>{seconds}</span>
    </div>
    <div className="time-rail" role="progressbar" aria-label="本轮专注进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(elapsed * 100)}>
      <div className="focus-rail" aria-hidden="true">{Array.from({ length: 36 }, (_, index) => <span key={index} className={index / 36 < elapsed ? 'elapsed' : ''} />)}</div>
      <div className="rest-rail" aria-hidden="true"><span /><span /><span /></div>
    </div>
  </div>
}
