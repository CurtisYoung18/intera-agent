import { z } from 'zod'

export const forensicAttributionStatusSchema = z.enum([
  'procedure_run',
  'livechat_metadata',
  'playground_prefix',
  'legacy_or_unattributed',
  'unknown',
])
export type ForensicAttributionStatus = z.infer<typeof forensicAttributionStatusSchema>

export const forensicAttributionConfidenceSchema = z.enum(['high', 'medium', 'low', 'unknown'])
export type ForensicAttributionConfidence = z.infer<typeof forensicAttributionConfidenceSchema>

export const forensicAttributionSchema = z.object({
  status: forensicAttributionStatusSchema,
  confidence: forensicAttributionConfidenceSchema,
  reason: z.string().optional(),
})
export type ForensicAttribution = z.infer<typeof forensicAttributionSchema>

export const forensicPackQuerySchema = z.object({
  translate: z.string().trim().min(1).max(16).optional(),
})
export type ForensicPackQuery = z.infer<typeof forensicPackQuerySchema>

export const forensicTranscriptMessageSchema = z.object({
  index: z.number().int().nonnegative(),
  role: z.string(),
  content: z.string(),
  createdAt: z.string(),
  caseId: z.string(),
  runId: z.string().nullable(),
  procedureType: z.string().nullable(),
  procedureStatus: z.string().nullable(),
  attribution: forensicAttributionSchema,
})
export type ForensicTranscriptMessage = z.infer<typeof forensicTranscriptMessageSchema>

export const forensicCaseSummarySchema = z.object({
  caseId: z.string(),
  userId: z.string(),
  type: z.string(),
  status: z.string(),
  source: z.string(),
  goal: z.string().nullable(),
  blocker: z.string().nullable(),
  runtimeInputEpoch: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
  resolvedAt: z.string().nullable(),
  attribution: forensicAttributionSchema,
})
export type ForensicCaseSummary = z.infer<typeof forensicCaseSummarySchema>

export const forensicProcedureRunStepSchema = z.object({
  id: z.string(),
  status: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
})
export type ForensicProcedureRunStep = z.infer<typeof forensicProcedureRunStepSchema>

export const forensicProcedureTimelineEventSchema = z.object({
  at: z.string().nullable(),
  origin: z.string().nullable(),
  source: z.string().nullable(),
  summary: z.string(),
  basedOnInputEpoch: z.number().int().nullable(),
  isMeta: z.boolean().nullable(),
})
export type ForensicProcedureTimelineEvent = z.infer<typeof forensicProcedureTimelineEventSchema>

export const forensicProcedureRunSummarySchema = z.object({
  runId: z.string(),
  caseId: z.string(),
  procedureId: z.string(),
  status: z.string(),
  inputEpoch: z.number().int().nonnegative(),
  currentStepId: z.string().nullable(),
  outcome: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  steps: z.array(forensicProcedureRunStepSchema),
  blockers: z.array(z.string()),
  timeline: z.array(forensicProcedureTimelineEventSchema),
  attribution: forensicAttributionSchema,
})
export type ForensicProcedureRunSummary = z.infer<typeof forensicProcedureRunSummarySchema>

export const forensicDocumentSummarySchema = z.object({
  title: z.string().nullable(),
  score: z.number().nullable(),
  contentPreview: z.string().nullable(),
})
export type ForensicDocumentSummary = z.infer<typeof forensicDocumentSummarySchema>

export const forensicToolSummarySchema = z.object({
  name: z.string(),
  calls: z.number().int().nonnegative(),
  results: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  inputKeys: z.array(z.string()),
  outputSummary: z.string().nullable(),
  mode: z.string().nullable(),
  category: z.string().nullable(),
  lastAt: z.string().nullable(),
  attribution: forensicAttributionSchema,
})
export type ForensicToolSummary = z.infer<typeof forensicToolSummarySchema>

export const forensicKnowledgeSummarySchema = z.object({
  toolName: z.string(),
  sourceName: z.string().nullable(),
  query: z.string().nullable(),
  hitCount: z.number().int().nonnegative().nullable(),
  miss: z.boolean().nullable(),
  documents: z.array(forensicDocumentSummarySchema),
  lastAt: z.string().nullable(),
  attribution: forensicAttributionSchema,
})
export type ForensicKnowledgeSummary = z.infer<typeof forensicKnowledgeSummarySchema>

export const forensicHookSummarySchema = z.object({
  hookName: z.string().nullable(),
  checkpoint: z.string().nullable(),
  action: z.string().nullable(),
  status: z.string().nullable(),
  reason: z.string().nullable(),
  at: z.string(),
  attribution: forensicAttributionSchema,
})
export type ForensicHookSummary = z.infer<typeof forensicHookSummarySchema>

export const forensicHumanTaskSummarySchema = z.object({
  queue: z.string(),
  status: z.string(),
  question: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
  attribution: forensicAttributionSchema,
})
export type ForensicHumanTaskSummary = z.infer<typeof forensicHumanTaskSummarySchema>

export const forensicTimelineEvidenceSchema = z.object({
  kind: z.enum([
    'tool',
    'knowledge',
    'hook',
    'human_task',
    'model',
    'procedure',
    'customer',
    'channel',
    'runtime',
  ]),
  actionType: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  status: z.string().nullable(),
  at: z.string(),
  attribution: forensicAttributionSchema,
})
export type ForensicTimelineEvidence = z.infer<typeof forensicTimelineEvidenceSchema>

export const forensicUsageSummarySchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
})
export type ForensicUsageSummary = z.infer<typeof forensicUsageSummarySchema>

export const forensicLatencySummarySchema = z.object({
  firstResponseMs: z.number().int().nonnegative().nullable(),
  totalTraceSpanMs: z.number().int().nonnegative().nullable(),
  llmWallMs: z.number().int().nonnegative().nullable(),
  toolsWallMs: z.number().int().nonnegative().nullable(),
  iterationWallMs: z.number().int().nonnegative().nullable(),
  toolLatencyMs: z.number().int().nonnegative().nullable(),
})
export type ForensicLatencySummary = z.infer<typeof forensicLatencySummarySchema>

export const forensicMetricsSummarySchema = z.object({
  models: z.array(z.string()),
  providers: z.array(z.string()),
  usage: forensicUsageSummarySchema,
  latency: forensicLatencySummarySchema,
  cost: z.null(),
})
export type ForensicMetricsSummary = z.infer<typeof forensicMetricsSummarySchema>

export const forensicOmissionSchema = z.object({
  field: z.string(),
  reason: z.string(),
})
export type ForensicOmission = z.infer<typeof forensicOmissionSchema>

export const forensicPackSchema = z.object({
  schemaVersion: z.literal('agentops.forensic-pack.v1'),
  generatedAt: z.string(),
  agentId: z.string(),
  chatId: z.string(),
  links: z.object({
    operator: z.string(),
    api: z.string(),
  }),
  attribution: forensicAttributionSchema,
  transcript: z.object({
    translatedTranscript: z.null(),
    messages: z.array(forensicTranscriptMessageSchema),
    totalVisibleMessages: z.number().int().nonnegative(),
    omittedInternalMessages: z.number().int().nonnegative(),
  }),
  cases: z.array(forensicCaseSummarySchema),
  procedureRuns: z.array(forensicProcedureRunSummarySchema),
  evidence: z.object({
    tools: z.array(forensicToolSummarySchema),
    knowledge: z.array(forensicKnowledgeSummarySchema),
    hooks: z.array(forensicHookSummarySchema),
    humanTasks: z.array(forensicHumanTaskSummarySchema),
    timeline: z.array(forensicTimelineEvidenceSchema),
  }),
  metrics: forensicMetricsSummarySchema,
  configRefs: z.object({
    agentConfig: z.object({
      id: z.string(),
      name: z.string(),
      version: z.number().int(),
      isActive: z.boolean(),
      model: z.string(),
    }).nullable(),
    procedureIds: z.array(z.string()),
    toolNames: z.array(z.string()),
    hookNames: z.array(z.string()),
    knowledgeSourceNames: z.array(z.string()),
  }),
  warnings: z.array(z.string()),
  omissions: z.array(forensicOmissionSchema),
})
export type ForensicPack = z.infer<typeof forensicPackSchema>
