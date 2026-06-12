import { z } from 'zod'

export const HandoffMetricsSchema = z.object({
  totalConversations: z.number().int().nonnegative(),
  totalProcedureRuns: z.number().int().nonnegative(),
  totalMessages: z.number().int().nonnegative(),
  escalatedConversations: z.number().int().nonnegative(),
  escalatedProcedureRuns: z.number().int().nonnegative(),
  escalationRate: z.number().min(0).max(1),
  activeHandoffConversations: z.number().int().nonnegative(),
  activeHandoffProcedureRuns: z.number().int().nonnegative(),
  activeHumanTasks: z.number().int().nonnegative(),
  resolvedHumanTasks: z.number().int().nonnegative(),
  handoffProcedureTypes: z.number().int().nonnegative(),
  latestActivityAt: z.string().nullable(),
  generatedAt: z.string(),
})
export type HandoffMetrics = z.infer<typeof HandoffMetricsSchema>

export const HandoffMetricsResponse = z.object({
  metrics: HandoffMetricsSchema,
})
export type HandoffMetricsResponse = z.infer<typeof HandoffMetricsResponse>
