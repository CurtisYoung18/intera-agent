import { z } from 'zod'

export const AgentOpsMetricsWindowSchema = z.enum(['20m', '1h', '24h', '7d'])
export type AgentOpsMetricsWindow = z.infer<typeof AgentOpsMetricsWindowSchema>

export const AgentOpsMetricKeySchema = z.enum([
  'handoff_rate',
  'tool_error_rate',
  'knowledge_miss_rate',
  'token_summary',
  'latency',
  'cost',
])
export type AgentOpsMetricKey = z.infer<typeof AgentOpsMetricKeySchema>

export const DEFAULT_AGENTOPS_METRICS: AgentOpsMetricKey[] = [
  'handoff_rate',
  'tool_error_rate',
  'knowledge_miss_rate',
  'token_summary',
  'latency',
  'cost',
]

function isValidDateString(value: string): boolean {
  const date = new Date(value)
  return Number.isFinite(date.getTime())
}

function isValidTimeZone(value: string): boolean {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

function parseMetricsList(value: unknown): unknown {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') return value
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

function parseBooleanQuery(value: unknown): unknown {
  if (typeof value !== 'string') return value
  if (value.toLowerCase() === 'true') return true
  if (value.toLowerCase() === 'false') return false
  return value
}

const DateQueryStringSchema = z.string()
  .trim()
  .min(1)
  .refine(isValidDateString, 'Must be a valid date/time')

export const AgentOpsMetricsQuerySchema = z.object({
  window: AgentOpsMetricsWindowSchema.default('20m'),
  from: DateQueryStringSchema.optional(),
  to: DateQueryStringSchema.optional(),
  timezone: z.string()
    .trim()
    .min(1)
    .default('UTC')
    .refine(isValidTimeZone, 'Must be a valid IANA timezone'),
  metrics: z.preprocess(
    parseMetricsList,
    z.array(AgentOpsMetricKeySchema).min(1).default(DEFAULT_AGENTOPS_METRICS),
  ),
  includeSynthetic: z.preprocess(parseBooleanQuery, z.boolean().default(false)),
}).superRefine((value, ctx) => {
  if (!value.from || !value.to) return
  if (new Date(value.from).getTime() < new Date(value.to).getTime()) return
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['from'],
    message: 'from must be earlier than to',
  })
})
export type AgentOpsMetricsQuery = z.infer<typeof AgentOpsMetricsQuerySchema>

export const AgentOpsMetricsResolvedQuerySchema = z.object({
  window: AgentOpsMetricsWindowSchema,
  from: z.string(),
  to: z.string(),
  timezone: z.string(),
  metrics: z.array(AgentOpsMetricKeySchema).min(1),
  includeSynthetic: z.boolean(),
})
export type AgentOpsMetricsResolvedQuery = z.infer<typeof AgentOpsMetricsResolvedQuerySchema>

const WarningsSchema = z.array(z.string())

export const AgentOpsRateMetricSchema = z.object({
  available: z.boolean(),
  value: z.number().min(0).max(1).nullable(),
  numerator: z.number().int().nonnegative().nullable(),
  denominator: z.number().int().nonnegative(),
  denominatorKind: z.string(),
  unavailableReason: z.string().nullable(),
  warnings: WarningsSchema,
})
export type AgentOpsRateMetric = z.infer<typeof AgentOpsRateMetricSchema>

export const AgentOpsHandoffRateMetricSchema = AgentOpsRateMetricSchema.extend({
  activeHandoffConversations: z.number().int().nonnegative(),
  activeHandoffProcedureRuns: z.number().int().nonnegative(),
  activeHumanTasks: z.number().int().nonnegative(),
  resolvedHumanTasks: z.number().int().nonnegative(),
})
export type AgentOpsHandoffRateMetric = z.infer<typeof AgentOpsHandoffRateMetricSchema>

export const AgentOpsToolErrorRateMetricSchema = AgentOpsRateMetricSchema.extend({
  errorCount: z.number().int().nonnegative(),
  timeoutCount: z.number().int().nonnegative(),
  observedToolResults: z.number().int().nonnegative(),
})
export type AgentOpsToolErrorRateMetric = z.infer<typeof AgentOpsToolErrorRateMetricSchema>

export const AgentOpsKnowledgeMissRateMetricSchema = AgentOpsRateMetricSchema.extend({
  observedKnowledgeToolResults: z.number().int().nonnegative(),
  unknownKnowledgeResults: z.number().int().nonnegative(),
})
export type AgentOpsKnowledgeMissRateMetric = z.infer<typeof AgentOpsKnowledgeMissRateMetricSchema>

export const AgentOpsTokenSummaryMetricSchema = z.object({
  available: z.boolean(),
  totalTokens: z.number().int().nonnegative().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  cacheReadTokens: z.number().int().nonnegative().nullable(),
  cacheWriteTokens: z.number().int().nonnegative().nullable(),
  llmCalls: z.number().int().nonnegative(),
  denominatorKind: z.string(),
  unavailableReason: z.string().nullable(),
  warnings: WarningsSchema,
})
export type AgentOpsTokenSummaryMetric = z.infer<typeof AgentOpsTokenSummaryMetricSchema>

export const AgentOpsLatencyMetricSchema = z.object({
  available: z.boolean(),
  firstResponseMs: z.object({
    average: z.number().nonnegative().nullable(),
    p50: z.number().nonnegative().nullable(),
    sampleCount: z.number().int().nonnegative(),
  }),
  traceWallMs: z.object({
    average: z.number().nonnegative().nullable(),
    p50: z.number().nonnegative().nullable(),
    sampleCount: z.number().int().nonnegative(),
  }),
  traceLlmMs: z.object({
    average: z.number().nonnegative().nullable(),
    sampleCount: z.number().int().nonnegative(),
  }),
  traceToolMs: z.object({
    average: z.number().nonnegative().nullable(),
    sampleCount: z.number().int().nonnegative(),
  }),
  denominatorKind: z.string(),
  unavailableReason: z.string().nullable(),
  warnings: WarningsSchema,
})
export type AgentOpsLatencyMetric = z.infer<typeof AgentOpsLatencyMetricSchema>

export const AgentOpsCostMetricSchema = z.object({
  available: z.literal(false),
  amount: z.null(),
  currency: z.null(),
  unavailableReason: z.string(),
  warnings: WarningsSchema,
})
export type AgentOpsCostMetric = z.infer<typeof AgentOpsCostMetricSchema>

export const AgentOpsMetricsCoverageSchema = z.object({
  aggregateDefault: z.literal('agent_proven_only'),
  scopedCaseCount: z.number().int().nonnegative(),
  includedCaseCount: z.number().int().nonnegative(),
  scopedRunCount: z.number().int().nonnegative(),
  includedRunCount: z.number().int().nonnegative(),
  attributionModes: z.array(z.enum([
    'procedure_run',
    'livechat_metadata',
    'playground_prefix',
  ])),
  legacyOrUnattributedDirectAnswerRows: z.object({
    included: z.literal(false),
    count: z.null(),
    reason: z.string(),
  }),
  incompleteLegacyHumanTaskRows: z.object({
    count: z.number().int().nonnegative(),
    reason: z.string(),
  }),
  warnings: WarningsSchema,
})
export type AgentOpsMetricsCoverage = z.infer<typeof AgentOpsMetricsCoverageSchema>

export const AgentOpsMetricsResponseSchema = z.object({
  agentId: z.string(),
  generatedAt: z.string(),
  query: AgentOpsMetricsResolvedQuerySchema,
  scope: z.object({
    agentConfigId: z.string(),
    caseIds: z.array(z.string()),
    runIds: z.array(z.string()),
  }),
  metrics: z.object({
    handoffRate: AgentOpsHandoffRateMetricSchema,
    toolErrorRate: AgentOpsToolErrorRateMetricSchema,
    knowledgeMissRate: AgentOpsKnowledgeMissRateMetricSchema,
    tokenSummary: AgentOpsTokenSummaryMetricSchema,
    latency: AgentOpsLatencyMetricSchema,
    cost: AgentOpsCostMetricSchema,
  }),
  coverage: AgentOpsMetricsCoverageSchema,
})
export type AgentOpsMetricsResponse = z.infer<typeof AgentOpsMetricsResponseSchema>
