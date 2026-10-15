/** Additive history migration: v1 records remain readable; new events are v2. */
export type BreakOutcome = 'completed' | 'skipped' | 'snoozed' | 'interrupted' | 'display_failed'
export interface BreakEvent {
  version: 2
  type: 'break.started' | 'break.ended'
  id: string
  at: string
  outcome?: BreakOutcome
  plannedSeconds: number
  /** Observed display time only; lock/sleep/long scheduling gaps never count as rest. */
  actualSeconds: number
}
export interface LegacyBreakEvent {
  version: 1
  type: BreakEvent['type']
  id: string
  at: string
  outcome?: Exclude<BreakOutcome, 'snoozed'>
}
export type StoredBreakEvent = BreakEvent | LegacyBreakEvent
