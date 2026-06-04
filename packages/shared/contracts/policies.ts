// Policies domain contract — request/response zod schemas for /api/admin/policies

import { z } from 'zod'

// ── Policy item ──
export const policyItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  hook: z.string(),
  rule: z.string(),
  enabled: z.boolean(),
  createdAt: z.date().or(z.string()).optional(),
  updatedAt: z.date().or(z.string()).optional(),
})

export type PolicyItem = z.infer<typeof policyItemSchema>

// ── GET /api/admin/policies response ──
export const policiesListResponseSchema = z.object({
  policies: z.array(policyItemSchema),
})
export type PoliciesListResponse = z.infer<typeof policiesListResponseSchema>

// ── POST /api/admin/policies request body ──
export const policyCreateRequestSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().nullable().optional(),
  hook: z.string().optional().default('preTool'),
  rule: z.union([z.string(), z.record(z.unknown())]).optional().default('{}'),
  enabled: z.boolean().optional().default(true),
})
export type PolicyCreateRequest = z.infer<typeof policyCreateRequestSchema>

// ── POST /api/admin/policies response ──
export const policyCreateResponseSchema = z.object({
  policy: policyItemSchema,
})
export type PolicyCreateResponse = z.infer<typeof policyCreateResponseSchema>

// ── GET /api/admin/policies/[name] response ──
export const policyGetResponseSchema = z.object({
  policy: policyItemSchema,
})
export type PolicyGetResponse = z.infer<typeof policyGetResponseSchema>

// ── PUT /api/admin/policies/[name] request body ──
export const policyUpdateRequestSchema = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  hook: z.string().optional(),
  rule: z.union([z.string(), z.record(z.unknown())]).optional(),
  enabled: z.boolean().optional(),
})
export type PolicyUpdateRequest = z.infer<typeof policyUpdateRequestSchema>

// ── PUT /api/admin/policies/[name] response ──
export const policyUpdateResponseSchema = z.object({
  policy: policyItemSchema,
})
export type PolicyUpdateResponse = z.infer<typeof policyUpdateResponseSchema>
