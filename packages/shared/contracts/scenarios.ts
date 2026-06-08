// Scenario Lab shared contract — delivery validation definitions and receipts.

import { z } from 'zod'
import { hookCheckpointSchema, stableNameSchema, hookDecisionActionSchema } from './hooks'

export const SCENARIO_VALIDATION_STATES = [
  'Validated',
  'Changed since last validation',
  'Validation failed',
  'Not validated',
] as const
export const scenarioValidationStateSchema = z.enum(SCENARIO_VALIDATION_STATES)
export type ScenarioValidationState = z.infer<typeof scenarioValidationStateSchema>

export const scenarioTurnSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  contentBlocks: z.array(z.record(z.unknown())).optional(),
})
export type ScenarioTurn = z.infer<typeof scenarioTurnSchema>

export const scenarioExpectedToolCallSchema = z.object({
  name: stableNameSchema,
  minCalls: z.number().int().nonnegative().optional(),
  maxCalls: z.number().int().nonnegative().optional(),
})
export type ScenarioExpectedToolCall = z.infer<typeof scenarioExpectedToolCallSchema>

export const scenarioExpectedHookDecisionSchema = z.object({
  hookName: stableNameSchema,
  checkpoint: hookCheckpointSchema.optional(),
  decision: hookDecisionActionSchema.optional(),
})
export type ScenarioExpectedHookDecision = z.infer<typeof scenarioExpectedHookDecisionSchema>

export const scenarioExpectedOutcomeSchema = z.object({
  caseType: stableNameSchema.optional(),
  toolsCalled: z.array(stableNameSchema).optional(),
  toolCalls: z.array(scenarioExpectedToolCallSchema).optional(),
  hooks: z.array(scenarioExpectedHookDecisionSchema).optional(),
  humanTransfer: z.boolean().optional(),
  finalStatus: z.string().optional(),
  forbiddenPhrases: z.array(z.string()).optional(),
  requiredPhrases: z.array(z.string()).optional(),
}).default({})
export type ScenarioExpectedOutcome = z.infer<typeof scenarioExpectedOutcomeSchema>

export const templateScenarioSchema = z.object({
  name: stableNameSchema,
  displayName: z.string().optional(),
  description: z.string().optional(),
  locale: z.string().optional(),
  tags: z.array(z.string()).default([]),
  turns: z.array(scenarioTurnSchema).min(1),
  expected: scenarioExpectedOutcomeSchema,
  enabled: z.boolean().default(true),
})
export type TemplateScenario = z.infer<typeof templateScenarioSchema>

export const savedScenarioSchema = templateScenarioSchema.extend({
  id: z.string(),
  agentConfigId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastRunId: z.string().optional(),
  lastRunStatus: z.enum(['passed', 'failed', 'error']).optional(),
})
export type SavedScenario = z.infer<typeof savedScenarioSchema>

export const scenarioCreateRequestSchema = templateScenarioSchema
export type ScenarioCreateRequest = z.infer<typeof scenarioCreateRequestSchema>

export const scenarioUpdateRequestSchema = templateScenarioSchema.partial().extend({
  name: stableNameSchema.optional(),
  turns: z.array(scenarioTurnSchema).min(1).optional(),
  expected: scenarioExpectedOutcomeSchema.optional(),
})
export type ScenarioUpdateRequest = z.infer<typeof scenarioUpdateRequestSchema>

export const scenarioHookEvidenceSchema = z.object({
  hookName: stableNameSchema,
  checkpoint: hookCheckpointSchema,
  decision: hookDecisionActionSchema,
  reason: z.string().optional(),
})
export type ScenarioHookEvidence = z.infer<typeof scenarioHookEvidenceSchema>

export const scenarioHandoffEvidenceSchema = z.object({
  required: z.boolean().optional(),
  queue: z.string().optional(),
  reason: z.string().optional(),
  target: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
}).passthrough()
export type ScenarioHandoffEvidence = z.infer<typeof scenarioHandoffEvidenceSchema>

export const scenarioObservedEvidenceInputSchema = z.object({
  caseType: stableNameSchema.optional(),
  toolsCalled: z.array(stableNameSchema).optional(),
  hookDecisions: z.array(scenarioHookEvidenceSchema).optional(),
  knowledgeHits: z.array(z.record(z.unknown())).optional(),
  humanTransfer: z.boolean().optional(),
  handoff: z.array(scenarioHandoffEvidenceSchema).optional(),
  finalResponse: z.string().optional(),
  finalStatus: z.string().optional(),
  traceId: z.string().optional(),
})
export type ScenarioObservedEvidenceInput = z.infer<typeof scenarioObservedEvidenceInputSchema>

export const scenarioObservedEvidenceSchema = scenarioObservedEvidenceInputSchema.extend({
  toolsCalled: z.array(stableNameSchema).default([]),
  hookDecisions: z.array(scenarioHookEvidenceSchema).default([]),
  knowledgeHits: z.array(z.record(z.unknown())).default([]),
  humanTransfer: z.boolean().default(false),
  handoff: z.array(scenarioHandoffEvidenceSchema).default([]),
}).default({})
export type ScenarioObservedEvidence = z.infer<typeof scenarioObservedEvidenceSchema>

export const scenarioReceiptCheckSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  expected: z.unknown().optional(),
  actual: z.unknown().optional(),
  detail: z.string().optional(),
})
export type ScenarioReceiptCheck = z.infer<typeof scenarioReceiptCheckSchema>

export const scenarioReceiptSchema = z.object({
  scenarioName: stableNameSchema,
  runId: z.string(),
  status: z.enum(['passed', 'failed', 'error']),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  agentConfigId: z.string().optional(),
  version: z.number().optional(),
  summary: z.string().optional(),
  expected: scenarioExpectedOutcomeSchema.optional(),
  evidence: scenarioObservedEvidenceSchema,
  checks: z.array(scenarioReceiptCheckSchema).default([]),
  traceId: z.string().optional(),
})
export type ScenarioReceipt = z.infer<typeof scenarioReceiptSchema>

export const scenarioRunRequestSchema = z.object({
  observed: scenarioObservedEvidenceInputSchema.optional(),
})
export type ScenarioRunRequest = z.infer<typeof scenarioRunRequestSchema>

export const scenarioValidationSummarySchema = z.object({
  state: scenarioValidationStateSchema,
  changedAt: z.string().optional(),
  lastValidatedAt: z.string().optional(),
  lastReceiptId: z.string().optional(),
  lastReceiptStatus: z.enum(['passed', 'failed', 'error']).optional(),
  overrideRequired: z.boolean().default(false),
})
export type ScenarioValidationSummary = z.infer<typeof scenarioValidationSummarySchema>
