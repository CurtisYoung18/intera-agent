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

export const SCENARIO_EXECUTION_MODES = ['fixture', 'agentRuntime'] as const
export const scenarioExecutionModeSchema = z.enum(SCENARIO_EXECUTION_MODES)
export type ScenarioExecutionMode = z.infer<typeof scenarioExecutionModeSchema>

export const SCENARIO_TOOL_EXECUTION_MODES = ['mocked', 'runtime'] as const
export const scenarioToolExecutionModeSchema = z.enum(SCENARIO_TOOL_EXECUTION_MODES)
export type ScenarioToolExecutionMode = z.infer<typeof scenarioToolExecutionModeSchema>

export const SCENARIO_RECEIPT_STATUSES = ['pass', 'fail', 'blocked'] as const
export const scenarioReceiptStatusSchema = z.preprocess((value) => {
  if (value === 'passed') return 'pass'
  if (value === 'failed') return 'fail'
  if (value === 'error') return 'blocked'
  return value
}, z.enum(SCENARIO_RECEIPT_STATUSES))
export type ScenarioReceiptStatus = z.infer<typeof scenarioReceiptStatusSchema>

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
  procedureStatus: z.string().optional(),
  procedureOutcome: z.string().optional(),
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
  lastRunStatus: scenarioReceiptStatusSchema.optional(),
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
  toolName: stableNameSchema.optional(),
  model: z.string().optional(),
  at: z.string().optional(),
})
export type ScenarioHookEvidence = z.infer<typeof scenarioHookEvidenceSchema>

export const scenarioToolCallEvidenceSchema = z.object({
  name: stableNameSchema,
  input: z.unknown().optional(),
  toolUseId: z.string().optional(),
  executionMode: scenarioToolExecutionModeSchema.optional(),
  at: z.string().optional(),
}).passthrough()
export type ScenarioToolCallEvidence = z.infer<typeof scenarioToolCallEvidenceSchema>

export const scenarioToolResultEvidenceSchema = z.object({
  name: stableNameSchema,
  output: z.unknown().optional(),
  error: z.string().optional(),
  toolUseId: z.string().optional(),
  executionMode: scenarioToolExecutionModeSchema.optional(),
  basedOnInputEpoch: z.number().optional(),
  evidenceState: z.enum(['canonical', 'stale']).optional(),
  at: z.string().optional(),
}).passthrough()
export type ScenarioToolResultEvidence = z.infer<typeof scenarioToolResultEvidenceSchema>

export const scenarioHandoffEvidenceSchema = z.object({
  required: z.boolean().optional(),
  queue: z.string().optional(),
  reason: z.string().optional(),
  target: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
}).passthrough()
export type ScenarioHandoffEvidence = z.infer<typeof scenarioHandoffEvidenceSchema>

export const scenarioProcedureInputEvidenceSchema = z.object({
  eventId: z.string(),
  inputEpoch: z.number().int().nonnegative(),
  source: z.string(),
  origin: z.string(),
  createdAt: z.string(),
  content: z.string().optional(),
  formAnswers: z.record(z.string()).optional(),
  summary: z.string().optional(),
}).passthrough()
export type ScenarioProcedureInputEvidence = z.infer<typeof scenarioProcedureInputEvidenceSchema>

export const scenarioProcedureBranchEvidenceSchema = z.object({
  stepId: z.string(),
  branchId: z.string(),
  kind: z.string(),
  label: z.string().optional(),
  conditionLabel: z.string().optional(),
  status: z.string(),
  reason: z.string().optional(),
}).passthrough()
export type ScenarioProcedureBranchEvidence = z.infer<typeof scenarioProcedureBranchEvidenceSchema>

export const scenarioProcedureEvaluationEvidenceSchema = z.object({
  id: z.string(),
  branchId: z.string(),
  conditionId: z.string(),
  label: z.string(),
  decision: z.string(),
  reason: z.string(),
  basedOnInputEpoch: z.number().int().nonnegative(),
  model: z.string().optional(),
  createdAt: z.string(),
  metadata: z.record(z.unknown()).optional(),
}).passthrough()
export type ScenarioProcedureEvaluationEvidence = z.infer<typeof scenarioProcedureEvaluationEvidenceSchema>

export const scenarioProcedureRuntimeSnapshotSchema = z.object({
  runId: z.string(),
  procedureId: stableNameSchema,
  displayName: z.string(),
  status: z.string(),
  outcome: z.string().optional(),
  reason: z.string().optional(),
  version: z.string().optional(),
  updatedAt: z.string().optional(),
  currentStepId: z.string().nullable().optional(),
  blockers: z.array(z.string()).default([]),
  inputs: z.array(scenarioProcedureInputEvidenceSchema).default([]),
  branches: z.array(scenarioProcedureBranchEvidenceSchema).default([]),
  evaluations: z.array(scenarioProcedureEvaluationEvidenceSchema).default([]),
  evidence: z.array(z.record(z.unknown())).default([]),
}).passthrough()
export type ScenarioProcedureRuntimeSnapshot = z.infer<typeof scenarioProcedureRuntimeSnapshotSchema>

export const scenarioObservedEvidenceInputSchema = z.object({
  caseType: stableNameSchema.optional(),
  toolsCalled: z.array(stableNameSchema).optional(),
  toolCalls: z.array(scenarioToolCallEvidenceSchema).optional(),
  toolResults: z.array(scenarioToolResultEvidenceSchema).optional(),
  hookDecisions: z.array(scenarioHookEvidenceSchema).optional(),
  knowledgeHits: z.array(z.record(z.unknown())).optional(),
  humanTransfer: z.boolean().optional(),
  handoff: z.array(scenarioHandoffEvidenceSchema).optional(),
  finalResponse: z.string().optional(),
  finalStatus: z.string().optional(),
  procedureStatus: z.string().optional(),
  procedureOutcome: z.string().optional(),
  traceId: z.string().optional(),
  runtime: z.object({
    sessionId: z.string().optional(),
    chatId: z.string().optional(),
    caseId: z.string().optional(),
    transition: z.string().optional(),
    blockedReason: z.string().optional(),
    staleEvidence: z.array(z.record(z.unknown())).default([]),
    reconcileEvidence: z.array(z.record(z.unknown())).default([]),
    procedureRuns: z.array(scenarioProcedureRuntimeSnapshotSchema).default([]),
    eventsObserved: z.number().int().nonnegative().optional(),
    transcriptHealth: z.object({
      providerTranscriptPersisted: z.boolean().default(false),
      toolPairsChecked: z.number().int().nonnegative().default(0),
      toolPairsRepaired: z.number().int().nonnegative().default(0),
      orphanToolResultsDropped: z.number().int().nonnegative().default(0),
      legacyRowsSkipped: z.number().int().nonnegative().default(0),
      compactPairsSummarized: z.number().int().nonnegative().default(0),
    }).partial().optional(),
  }).partial().optional(),
})
export type ScenarioObservedEvidenceInput = z.infer<typeof scenarioObservedEvidenceInputSchema>

export const scenarioObservedEvidenceSchema = scenarioObservedEvidenceInputSchema.extend({
  toolsCalled: z.array(stableNameSchema).default([]),
  toolCalls: z.array(scenarioToolCallEvidenceSchema).default([]),
  toolResults: z.array(scenarioToolResultEvidenceSchema).default([]),
  hookDecisions: z.array(scenarioHookEvidenceSchema).default([]),
  knowledgeHits: z.array(z.record(z.unknown())).default([]),
  humanTransfer: z.boolean().default(false),
  handoff: z.array(scenarioHandoffEvidenceSchema).default([]),
}).default({})
export type ScenarioObservedEvidence = z.infer<typeof scenarioObservedEvidenceSchema>

export const scenarioReceiptCheckSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  code: z.string().optional(),
  expected: z.unknown().optional(),
  actual: z.unknown().optional(),
  detail: z.string().optional(),
})
export type ScenarioReceiptCheck = z.infer<typeof scenarioReceiptCheckSchema>

export const scenarioReceiptFailureReasonSchema = z.object({
  code: z.string(),
  message: z.string(),
  checkName: z.string().optional(),
  expected: z.unknown().optional(),
  actual: z.unknown().optional(),
})
export type ScenarioReceiptFailureReason = z.infer<typeof scenarioReceiptFailureReasonSchema>

export const scenarioReceiptSchema = z.object({
  scenarioName: stableNameSchema,
  runId: z.string(),
  status: scenarioReceiptStatusSchema,
  executionMode: scenarioExecutionModeSchema.default('fixture'),
  toolExecutionMode: scenarioToolExecutionModeSchema.default('mocked'),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  agentConfigId: z.string().optional(),
  version: z.number().optional(),
  scenarioVersion: z.string().optional(),
  summary: z.string().optional(),
  expected: scenarioExpectedOutcomeSchema.optional(),
  evidence: scenarioObservedEvidenceSchema,
  checks: z.array(scenarioReceiptCheckSchema).default([]),
  failureReasons: z.array(scenarioReceiptFailureReasonSchema).default([]),
  traceId: z.string().optional(),
})
export type ScenarioReceipt = z.infer<typeof scenarioReceiptSchema>

export const scenarioRunRequestSchema = z.object({
  executionMode: scenarioExecutionModeSchema.optional().default('fixture'),
  observed: scenarioObservedEvidenceInputSchema.optional(),
})
export type ScenarioRunRequest = z.infer<typeof scenarioRunRequestSchema>

export const scenarioValidationSummarySchema = z.object({
  state: scenarioValidationStateSchema,
  changedAt: z.string().optional(),
  lastValidatedAt: z.string().optional(),
  lastReceiptId: z.string().optional(),
  lastReceiptStatus: scenarioReceiptStatusSchema.optional(),
  lastReceiptExecutionMode: scenarioExecutionModeSchema.optional(),
  runtimeValidated: z.boolean().default(false),
  runtimeValidatedAt: z.string().optional(),
  lastRuntimeReceiptId: z.string().optional(),
  overrideRequired: z.boolean().default(false),
})
export type ScenarioValidationSummary = z.infer<typeof scenarioValidationSummarySchema>
