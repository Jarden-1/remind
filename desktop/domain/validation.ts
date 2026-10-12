import { z } from 'zod'
import { validateSettings } from '../../shared/schedule'

export const settingsSchema = z.object({
  workMinutes: z.number().int().min(1).max(240),
  breakMinutes: z.number().int().min(1).max(30),
  preReminder: z.boolean(), sound: z.boolean(), meetingPause: z.literal(false),
  theme: z.enum(['system', 'light', 'dark']),
  schedule: z.object({
    enabled: z.boolean(), days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    ranges: z.array(z.object({ start: z.string().max(5), end: z.string().max(5) })).min(1).max(12),
  }),
}).superRefine((value, context) => {
  const message = validateSettings(value)
  if (message) context.addIssue({ code: 'custom', message })
})

export const preferencesSchema = z.object({
  settings: settingsSchema,
  started: z.boolean(),
  manualPaused: z.boolean(),
  openAtLogin: z.boolean().default(false),
  pauseUntil: z.string().datetime({ offset: true }).nullable().default(null),
})
