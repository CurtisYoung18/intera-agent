import { z } from 'zod'
import {
  scenarioObservedEvidenceSchema,
  scenarioTurnSchema,
} from '../scenarios'

export const AgentOpsSimulationModeSchema = z.literal('local_runtime')
export type AgentOpsSimulationMode = z.infer<typeof AgentOpsSimulationModeSchema>

export const AgentOpsSimulationToolPolicySchema = z.literal('mocked')
export type AgentOpsSimulationToolPolicy = z.infer<typeof AgentOpsSimulationToolPolicySchema>

export const AgentOpsSimulationStatusSchema = z.enum(['pass', 'fail', 'blocked'])
export type AgentOpsSimulationStatus = z.infer<typeof AgentOpsSimulationStatusSchema>

export const AgentOpsSimulationSourceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('turn_script'),
    name: z.string().trim().min(1).max(120).optional(),
    turns: z.array(scenarioTurnSchema.extend({
      role: z.literal('user'),
    })).min(1).max(20),
  }).strict(),
  z.object({
    type: z.literal('scenario'),
    name: z.string().trim().min(1).max(120),
  }).strict(),
])
export type AgentOpsSimulationSource = z.infer<typeof AgentOpsSimulationSourceSchema>

export const AgentOpsSimulationRequestSchema = z.object({
  mode: AgentOpsSimulationModeSchema,
  toolPolicy: AgentOpsSimulationToolPolicySchema.default('mocked'),
  draftAgentConfigId: z.string().trim().min(1).max(160).optional(),
  source: AgentOpsSimulationSourceSchema,
  options: z.object({
    emitThinking: z.boolean().default(false),
  }).strict().default({}),
}).strict()
export type AgentOpsSimulationRequest = z.infer<typeof AgentOpsSimulationRequestSchema>

export const AgentOpsSimulationTurnReceiptSchema = z.object({
  index: z.number().int().nonnegative(),
  userInput: z.string(),
  assistantResponse: z.string(),
  caseType: z.string().optional(),
  blocked: z.boolean(),
  transition: z.string().optional(),
  traceId: z.string().optional(),
  totalMs: z.number().int().nonnegative().optional(),
  eventCounts: z.record(z.number().int().nonnegative()),
  toolCalls: z.array(z.object({
    name: z.string(),
    executionMode: z.string().optional(),
  }).strict()).default([]),
  toolResults: z.array(z.object({
    name: z.string(),
    executionMode: z.string().optional(),
    errored: z.boolean(),
  }).strict()).default([]),
  warnings: z.array(z.string()).default([]),
}).strict()
export type AgentOpsSimulationTurnReceipt = z.infer<typeof AgentOpsSimulationTurnReceiptSchema>

export const AgentOpsSimulationReceiptSchema = z.object({
  schemaVersion: z.literal('agentops.simulation-receipt.v1'),
  simulationId: z.string(),
  generatedAt: z.string(),
  status: AgentOpsSimulationStatusSchema,
  mode: AgentOpsSimulationModeSchema,
  toolPolicy: AgentOpsSimulationToolPolicySchema,
  agentId: z.string(),
  draftAgentConfigId: z.string(),
  source: z.object({
    type: z.enum(['turn_script', 'scenario']),
    name: z.string(),
  }).strict(),
  safety: z.object({
    providerCalls: z.literal(true),
    externalToolCalls: z.literal(false),
    runtimeToolExecution: z.literal(false),
    businessSideEffects: z.literal(false),
    localPersistenceWrites: z.literal(true),
    productionRuntimeSimulation: z.literal(false),
    scenarioReceiptsAppended: z.literal(false),
    scenarioValidationMarkedValidated: z.literal(false),
    reason: z.string(),
  }).strict(),
  session: z.object({
    chatId: z.string().optional(),
    caseId: z.string().optional(),
    userId: z.string(),
    turnCount: z.number().int().nonnegative(),
  }).strict(),
  turns: z.array(AgentOpsSimulationTurnReceiptSchema),
  finalEvidence: scenarioObservedEvidenceSchema,
  warnings: z.array(z.string()).default([]),
}).strict()
export type AgentOpsSimulationReceipt = z.infer<typeof AgentOpsSimulationReceiptSchema>
