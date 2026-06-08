// Scenario Lab shared contract — delivery validation definitions and receipts.

import { z } from 'zod'
import { stableNameSchema, hookDecisionActionSchema } from './hooks'

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

export const scenarioExpectedOutcomeSchema = z.object({
  caseType: stableNameSchema.optional(),
  toolsCalled: z.array(stableNameSchema).optional(),
  hooks: z.array(z.object({
    hookName: stableNameSchema,
    checkpoint: z.enum(['PreToolUse', 'PostToolUse', 'Stop']).optional(),
    decision: hookDecisionActionSchema.optional(),
  })).optional(),
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

export const scenarioReceiptSchema = z.object({
  scenarioName: stableNameSchema,
  runId: z.string(),
  status: z.enum(['passed', 'failed', 'error']),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  agentConfigId: z.string().optional(),
  version: z.number().optional(),
  summary: z.string().optional(),
  evidence: z.object({
    toolsCalled: z.array(stableNameSchema).default([]),
    hookDecisions: z.array(z.object({
      hookName: stableNameSchema,
      checkpoint: z.enum(['PreToolUse', 'PostToolUse', 'Stop']),
      decision: hookDecisionActionSchema,
      reason: z.string().optional(),
    })).default([]),
    knowledgeHits: z.array(z.record(z.unknown())).default([]),
    humanTransfer: z.boolean().default(false),
    finalResponse: z.string().optional(),
  }),
  traceId: z.string().optional(),
})
export type ScenarioReceipt = z.infer<typeof scenarioReceiptSchema>
