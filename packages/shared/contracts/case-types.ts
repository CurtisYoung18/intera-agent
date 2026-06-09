// Case Types domain contract — request/response zod schemas for /api/admin/case-types

import { z } from 'zod'
import { stableNameSchema } from './hooks'

// ── Procedure (single-agent ordered SOP — Procedure refactor, Phase 1, additive) ──
// Mirrors the plain TS `Procedure`/`ProcedureStep`/`ProcedureAction` in @intera/shared/types
// (types stays zod-free; the procedure-contract test guards that these two stay aligned).
export const PROCEDURE_ACTIONS = [
  'use',
  'read',
  'ask',
  'decide',
  'tag',
  'escalate',
  'finalize',
] as const
export const procedureActionSchema = z.enum(PROCEDURE_ACTIONS)

export const procedureStepSchema = z.object({
  id: z.string().min(1, 'step id is required'),
  action: procedureActionSchema,
  target: z.string().optional(),
  guidance: z.string().optional(),
  when: z.string().optional(),
  required: z.boolean().optional(),
})

export const procedureSchema = z.object({
  steps: z.array(procedureStepSchema),
})
export type ProcedureContract = z.infer<typeof procedureSchema>

/** Safe runtime parse of a `CaseType.procedure` JSON string → typed Procedure, or null. Never throws. */
export function parseProcedure(json: string | null | undefined): ProcedureContract | null {
  if (!json) return null
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return null
  }
  const r = procedureSchema.safeParse(raw)
  return r.success ? r.data : null
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
  procedure: z.string().nullable().optional(), // JSON: Procedure
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
  // Accept a JSON string or a typed Procedure.
  procedure: z.union([z.string(), procedureSchema]).nullable().optional(),
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
  procedure: z.union([z.string(), procedureSchema]).nullable().optional(),
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
  procedure: procedureSchema.optional(),
  maxAutoTurns: z.number().int().positive().default(10),
  legacy: z.record(z.unknown()).optional(),
})
export type TemplateCaseType = z.infer<typeof templateCaseTypeSchema>
