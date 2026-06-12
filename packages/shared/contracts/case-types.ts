// Case Types domain contract — request/response zod schemas for /api/admin/case-types

import { z } from 'zod'
import { stableNameSchema } from './hooks'
import {
  PROCEDURE_ACTIONS,
  PROCEDURE_CONDITION_KINDS,
  PROCEDURE_RUNTIME_SIGNALS,
  PROCEDURE_V2_ACTION_KINDS,
  buildProcedureActionSummary,
  buildProcedureConditionLabel,
  isProcedureV2Definition,
  normalizeProcedureDefinition,
  parseProcedure,
  parseProcedureDefinition,
  procedureActionSchema,
  procedureConditionKindSchema,
  procedureConditionSchema,
  procedureDefinitionSchema,
  procedureRuntimeSignalSchema,
  procedureSchema,
  procedureSimulationInputSchema,
  procedureSimulationReceiptSchema,
  procedureStepSchema,
  procedureV2ActionKindSchema,
  procedureV2ActionSchema,
  procedureV2BranchSchema,
  procedureV2Schema,
  procedureV2StepSchema,
  simulateProcedureDefinition,
  type ProcedureConditionContract,
  type ProcedureContract,
  type ProcedureDefinitionContract,
  type ProcedureRuntimeSignalContract,
  type ProcedureSimulationInputContract,
  type ProcedureSimulationReceiptContract,
  type ProcedureV2ActionContract,
  type ProcedureV2ActionKindContract,
  type ProcedureV2BranchContract,
  type ProcedureV2Contract,
  type ProcedureV2StepContract,
} from './procedures'

export {
  PROCEDURE_ACTIONS,
  PROCEDURE_CONDITION_KINDS,
  PROCEDURE_RUNTIME_SIGNALS,
  PROCEDURE_V2_ACTION_KINDS,
  buildProcedureActionSummary,
  buildProcedureConditionLabel,
  isProcedureV2Definition,
  normalizeProcedureDefinition,
  parseProcedure,
  parseProcedureDefinition,
  procedureActionSchema,
  procedureConditionKindSchema,
  procedureConditionSchema,
  procedureDefinitionSchema,
  procedureRuntimeSignalSchema,
  procedureSchema,
  procedureSimulationInputSchema,
  procedureSimulationReceiptSchema,
  procedureStepSchema,
  procedureV2ActionKindSchema,
  procedureV2ActionSchema,
  procedureV2BranchSchema,
  procedureV2Schema,
  procedureV2StepSchema,
  simulateProcedureDefinition,
}

export type {
  ProcedureConditionContract,
  ProcedureContract,
  ProcedureDefinitionContract,
  ProcedureRuntimeSignalContract,
  ProcedureSimulationInputContract,
  ProcedureSimulationReceiptContract,
  ProcedureV2ActionContract,
  ProcedureV2ActionKindContract,
  ProcedureV2BranchContract,
  ProcedureV2Contract,
  ProcedureV2StepContract,
}

// ── Case type item ──
export const caseTypeItemSchema = z.object({
  id: z.string(),
  type: stableNameSchema,
  displayName: z.string(),
  description: z.string().nullable().optional(),
  icon: z.string(),
  requiredFacts: z.string(),
  defaultGoal: z.string(),
  escalateOn: z.string(),
  autoCloseConditions: z.string().nullable().optional(),
  enabled: z.boolean(),
  procedure: z.string().nullable().optional(),
  maxAutoTurns: z.number().optional(),
  createdAt: z.date().or(z.string()).optional(),
  updatedAt: z.date().or(z.string()).optional(),
})

export type CaseTypeItem = z.infer<typeof caseTypeItemSchema>

// ── GET /api/admin/case-types response ──
export const caseTypesListResponseSchema = z.object({
  types: z.array(caseTypeItemSchema),
})
export type CaseTypesListResponse = z.infer<typeof caseTypesListResponseSchema>

// ── POST /api/admin/case-types request body ──
export const caseTypeCreateRequestSchema = z.object({
  type: stableNameSchema,
  displayName: z.string().optional(),
  description: z.string().nullable().optional(),
  icon: z.string().optional().default('\u{1F4CB}'),
  requiredFacts: z.union([z.string(), z.array(z.string())]).optional().default('[]'),
  defaultGoal: z.string().optional().default(''),
  escalateOn: z.union([z.string(), z.array(z.string())]).optional().default('[]'),
  autoCloseConditions: z.union([z.string(), z.array(z.string())]).nullable().optional(),
  enabled: z.boolean().optional().default(true),
  procedure: z.union([z.string(), procedureDefinitionSchema]).nullable().optional(),
  maxAutoTurns: z.number().optional().default(10),
})
export type CaseTypeCreateRequest = z.infer<typeof caseTypeCreateRequestSchema>

// ── POST /api/admin/case-types response ──
export const caseTypeCreateResponseSchema = z.object({
  caseType: caseTypeItemSchema,
})
export type CaseTypeCreateResponse = z.infer<typeof caseTypeCreateResponseSchema>

// ── GET /api/admin/case-types/[name] response ──
export const caseTypeGetResponseSchema = z.object({
  caseType: caseTypeItemSchema,
})
export type CaseTypeGetResponse = z.infer<typeof caseTypeGetResponseSchema>

// ── PUT /api/admin/case-types/[name] request body ──
export const caseTypeUpdateRequestSchema = z.object({
  type: stableNameSchema.optional(),
  displayName: z.string().optional(),
  description: z.string().nullable().optional(),
  icon: z.string().optional(),
  requiredFacts: z.union([z.string(), z.array(z.string())]).optional(),
  defaultGoal: z.string().optional(),
  escalateOn: z.union([z.string(), z.array(z.string())]).optional(),
  autoCloseConditions: z.union([z.string(), z.array(z.string())]).nullable().optional(),
  enabled: z.boolean().optional(),
  procedure: z.union([z.string(), procedureDefinitionSchema]).nullable().optional(),
  maxAutoTurns: z.number().optional(),
})
export type CaseTypeUpdateRequest = z.infer<typeof caseTypeUpdateRequestSchema>

// ── PUT /api/admin/case-types/[name] response ──
export const caseTypeUpdateResponseSchema = z.object({
  caseType: caseTypeItemSchema,
})
export type CaseTypeUpdateResponse = z.infer<typeof caseTypeUpdateResponseSchema>

// ── .intera-agent.json CaseType section ──
export const templateCaseTypeSchema = z.object({
  type: stableNameSchema,
  displayName: z.string(),
  description: z.string().optional(),
  icon: z.string().optional(),
  requiredFacts: z.array(z.string()).default([]),
  defaultGoal: z.string().default(''),
  escalateOn: z.array(z.string()).default([]),
  autoCloseConditions: z.record(z.unknown()).optional(),
  enabled: z.boolean().default(true),
  procedure: procedureDefinitionSchema.optional(),
  maxAutoTurns: z.number().int().positive().default(10),
  legacy: z.record(z.unknown()).optional(),
})
export type TemplateCaseType = z.infer<typeof templateCaseTypeSchema>
