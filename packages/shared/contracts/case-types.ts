// Case Types domain contract — request/response zod schemas for /api/admin/case-types

import { z } from 'zod'

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

// Platform-owned guardrail names that can be activated by case types even when
// no editable Policy row exists. Runtime code provides safe fallback hooks.
export const SAFETY_FLOOR_GUARDRAIL_NAMES = [
  'no_high_risk_account_change',
] as const

export const BUILT_IN_GUARDRAIL_NAMES = [
  ...SAFETY_FLOOR_GUARDRAIL_NAMES,
  'human_review_before_finalize',
] as const

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

/** Safe runtime parse of a `CaseType.guardrails` JSON string[] → names, or [] on garbage. Never throws. */
export function parseGuardrails(json: string | null | undefined): string[] {
  if (!json) return []
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return []
  }
  const r = z.array(z.string()).safeParse(raw)
  return r.success ? r.data : []
}

/**
 * Orphan check for case-type guardrail activation (D5): returns the referenced
 * guardrail names that are NOT in the agent's policy set. Used by the case-types
 * API to reject/surface dangling references when a guardrail is renamed/deleted.
 */
export function findOrphanGuardrails(
  guardrailNames: string[],
  existingPolicyNames: string[],
): string[] {
  const known = new Set(existingPolicyNames)
  return guardrailNames.filter((n) => !known.has(n))
}

// ── Case type item ──
export const caseTypeItemSchema = z.object({
  id: z.string(),
  type: z.string(),
  displayName: z.string(),
  description: z.string().nullable().optional(),
  icon: z.string(),
  requiredFacts: z.string(),
  stages: z.string(),
  stageConfigs: z.string().nullable().optional(),
  orchestratorConfig: z.string().nullable().optional(),
  defaultGoal: z.string(),
  escalateOn: z.string(),
  autoCloseConditions: z.string().nullable().optional(),
  enabled: z.boolean(),
  requireHumanReview: z.boolean().optional(),
  executionMode: z.string().optional(),
  sop: z.string().nullable().optional(),
  sopMaxAutoTurns: z.number().optional(),
  // ── Procedure refactor (additive) ──
  procedure: z.string().nullable().optional(), // JSON: Procedure
  guardrails: z.string().optional(), // JSON: string[] — activated guardrail names
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
  type: z.string().min(1, 'Type is required'),
  displayName: z.string().optional(),
  description: z.string().nullable().optional(),
  icon: z.string().optional().default('\u{1F4CB}'),
  requiredFacts: z.union([z.string(), z.array(z.string())]).optional().default('[]'),
  stages: z.union([z.string(), z.array(z.string())]).optional().default('["created","investigating","resolved"]'),
  stageConfigs: z.union([z.string(), z.record(z.unknown())]).nullable().optional(),
  orchestratorConfig: z.union([z.string(), z.record(z.unknown())]).nullable().optional(),
  defaultGoal: z.string().optional().default(''),
  escalateOn: z.union([z.string(), z.array(z.string())]).optional().default('[]'),
  autoCloseConditions: z.union([z.string(), z.array(z.string())]).nullable().optional(),
  enabled: z.boolean().optional().default(true),
  requireHumanReview: z.boolean().optional().default(false),
  executionMode: z.string().optional().default('stage'),
  sop: z.string().nullable().optional(),
  sopMaxAutoTurns: z.number().optional().default(10),
  // ── Procedure refactor (additive) ── accept a JSON string or a typed Procedure / name list.
  procedure: z.union([z.string(), procedureSchema]).nullable().optional(),
  guardrails: z.union([z.string(), z.array(z.string())]).optional().default('[]'),
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
  type: z.string().optional(),
  displayName: z.string().optional(),
  description: z.string().nullable().optional(),
  icon: z.string().optional(),
  requiredFacts: z.union([z.string(), z.array(z.string())]).optional(),
  stages: z.union([z.string(), z.array(z.string())]).optional(),
  stageConfigs: z.union([z.string(), z.record(z.unknown())]).nullable().optional(),
  orchestratorConfig: z.union([z.string(), z.record(z.unknown())]).nullable().optional(),
  defaultGoal: z.string().optional(),
  escalateOn: z.union([z.string(), z.array(z.string())]).optional(),
  autoCloseConditions: z.union([z.string(), z.array(z.string())]).nullable().optional(),
  enabled: z.boolean().optional(),
  requireHumanReview: z.boolean().optional(),
  executionMode: z.string().optional(),
  sop: z.string().nullable().optional(),
  sopMaxAutoTurns: z.number().optional(),
  // ── Procedure refactor (additive) ──
  procedure: z.union([z.string(), procedureSchema]).nullable().optional(),
  guardrails: z.union([z.string(), z.array(z.string())]).optional(),
  maxAutoTurns: z.number().optional(),
})
export type CaseTypeUpdateRequest = z.infer<typeof caseTypeUpdateRequestSchema>

// ── PUT /api/admin/case-types/[name] response ──
export const caseTypeUpdateResponseSchema = z.object({
  caseType: caseTypeItemSchema,
})
export type CaseTypeUpdateResponse = z.infer<typeof caseTypeUpdateResponseSchema>
