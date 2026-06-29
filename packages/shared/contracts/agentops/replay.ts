import { z } from 'zod'
import {
  hookCheckpointSchema,
  hookDecisionActionSchema,
  stableNameSchema,
} from '../hooks'
import {
  scenarioObservedEvidenceInputSchema,
  templateScenarioSchema,
} from '../scenarios'

export const AgentOpsReplayModeSchema = z.literal('local_dry_run')
export type AgentOpsReplayMode = z.infer<typeof AgentOpsReplayModeSchema>

export const AgentOpsReplayStatusSchema = z.enum(['pass', 'fail', 'blocked'])
export type AgentOpsReplayStatus = z.infer<typeof AgentOpsReplayStatusSchema>

const DISALLOWED_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])
const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/

function isValidAssertionPath(value: string): boolean {
  const segments = value.split('.')
  return segments.length > 0 &&
    segments.length <= 16 &&
    segments.every((segment) => (
      segment.length > 0 &&
      PATH_SEGMENT_PATTERN.test(segment) &&
      !DISALLOWED_PATH_SEGMENTS.has(segment)
    ))
}

export const AgentOpsReplayAssertionPathSchema = z.string()
  .trim()
  .min(1, 'path is required')
  .max(160, 'path is too long')
  .refine(isValidAssertionPath, 'Use a safe dot-separated input path such as account.id')
export type AgentOpsReplayAssertionPath = z.infer<typeof AgentOpsReplayAssertionPathSchema>

export const AgentOpsReplaySourceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('scenario'),
    name: stableNameSchema,
  }),
  z.object({
    type: z.literal('observed'),
    scenario: templateScenarioSchema,
  }),
])
export type AgentOpsReplaySource = z.infer<typeof AgentOpsReplaySourceSchema>

const AgentOpsReplayAssertionBaseSchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
})

export const AgentOpsReplayToolInputEqualsAssertionSchema = AgentOpsReplayAssertionBaseSchema.extend({
  type: z.literal('tool_input_equals'),
  toolName: stableNameSchema,
  path: AgentOpsReplayAssertionPathSchema,
  expected: z.unknown(),
  callIndex: z.number().int().nonnegative().default(0),
})
export type AgentOpsReplayToolInputEqualsAssertion = z.infer<typeof AgentOpsReplayToolInputEqualsAssertionSchema>

export const AgentOpsReplayHookOutcomeAssertionSchema = AgentOpsReplayAssertionBaseSchema.extend({
  type: z.literal('hook_outcome'),
  hookName: stableNameSchema,
  checkpoint: hookCheckpointSchema.optional(),
  toolName: stableNameSchema.optional(),
  decision: hookDecisionActionSchema,
})
export type AgentOpsReplayHookOutcomeAssertion = z.infer<typeof AgentOpsReplayHookOutcomeAssertionSchema>

export const AgentOpsReplayAssertionSchema = z.discriminatedUnion('type', [
  AgentOpsReplayToolInputEqualsAssertionSchema,
  AgentOpsReplayHookOutcomeAssertionSchema,
])
export type AgentOpsReplayAssertion = z.infer<typeof AgentOpsReplayAssertionSchema>

export const AgentOpsReplayRequestSchema = z.object({
  mode: AgentOpsReplayModeSchema,
  draftAgentConfigId: z.string().trim().min(1, 'draftAgentConfigId is required'),
  source: AgentOpsReplaySourceSchema,
  observed: scenarioObservedEvidenceInputSchema.optional(),
  assertions: z.array(AgentOpsReplayAssertionSchema).min(1, 'At least one assertion is required'),
}).superRefine((value, ctx) => {
  if (value.source.type !== 'observed' || value.observed) return
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['observed'],
    message: 'observed evidence is required when source.type is observed',
  })
})
export type AgentOpsReplayRequest = z.infer<typeof AgentOpsReplayRequestSchema>

export const AgentOpsReplayAssertionResultSchema = z.object({
  id: z.string().optional(),
  type: z.enum(['tool_input_equals', 'hook_outcome']),
  status: AgentOpsReplayStatusSchema,
  passed: z.boolean(),
  message: z.string(),
  expected: z.unknown().optional(),
  actual: z.unknown().optional(),
  evidenceRef: z.string().optional(),
})
export type AgentOpsReplayAssertionResult = z.infer<typeof AgentOpsReplayAssertionResultSchema>

export const AgentOpsReplayScenarioReceiptSummarySchema = z.object({
  scenarioName: stableNameSchema,
  runId: z.string(),
  status: AgentOpsReplayStatusSchema,
  executionMode: z.literal('fixture'),
  toolExecutionMode: z.literal('mocked'),
  summary: z.string().optional(),
  checkCount: z.number().int().nonnegative(),
  failureCount: z.number().int().nonnegative(),
  validationStateChanged: z.literal(false),
})
export type AgentOpsReplayScenarioReceiptSummary = z.infer<typeof AgentOpsReplayScenarioReceiptSummarySchema>

export const AgentOpsReplayReceiptSchema = z.object({
  schemaVersion: z.literal('agentops.replay-receipt.v1'),
  receiptId: z.string(),
  generatedAt: z.string(),
  status: AgentOpsReplayStatusSchema,
  mode: AgentOpsReplayModeSchema,
  agentId: z.string(),
  draftAgentConfigId: z.string(),
  source: z.object({
    type: z.enum(['scenario', 'observed']),
    scenarioName: stableNameSchema,
  }),
  toolSafety: z.object({
    externalToolCalls: z.boolean(),
    runtimeToolExecution: z.literal(false),
    providerCalls: z.literal(false),
    sideEffects: z.literal(false),
    productionRuntimeReplay: z.literal(false),
    scenarioReceiptsAppended: z.literal(false),
    scenarioValidationMarkedValidated: z.literal(false),
    reason: z.string().optional(),
  }),
  assertions: z.array(AgentOpsReplayAssertionResultSchema),
  scenarioReceipt: AgentOpsReplayScenarioReceiptSummarySchema.nullable(),
  warnings: z.array(z.string()).default([]),
})
export type AgentOpsReplayReceipt = z.infer<typeof AgentOpsReplayReceiptSchema>
