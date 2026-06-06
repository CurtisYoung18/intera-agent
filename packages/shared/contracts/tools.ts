// Skills domain contract — request/response zod schemas for /api/admin/skills

import { z } from 'zod'

// ── Skill item (returned in list + single responses) ──
export const skillItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  mode: z.string(),
  endpoint: z.string().nullable().optional(),
  httpMethod: z.string().nullable().optional(),
  timeoutMs: z.number().nullable().optional(),
  inputSchema: z.string().nullable().optional(),
  outputSchema: z.string().nullable().optional(),
  headers: z.string().nullable().optional(),
  mockFixture: z.string().nullable().optional(),
  renderHints: z.string().nullable().optional(),
  guardPhase: z.string().nullable().optional(),
  toolCategory: z.string().nullable().optional(),
  displayVerb: z.string().nullable().optional(),
  isConcurrencySafe: z.boolean(),
  enabled: z.boolean(),
  isSystem: z.boolean().optional(),
  isChannel: z.boolean().optional(),
  isSpecial: z.boolean().optional(),
})

export type SkillItem = z.infer<typeof skillItemSchema>

// ── GET /api/admin/tools response ──
export const skillsListResponseSchema = z.object({
  tools: z.array(skillItemSchema),
})
export type SkillsListResponse = z.infer<typeof skillsListResponseSchema>

// ── POST /api/admin/skills request body ──
export const skillCreateRequestSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional().default(''),
  inputSchema: z.union([z.string(), z.record(z.unknown())]).optional().default('{}'),
  outputSchema: z.union([z.string(), z.record(z.unknown())]).optional().default('{}'),
  mode: z.string().optional().default('mock'),
  endpoint: z.string().nullable().optional(),
  httpMethod: z.string().optional().default('POST'),
  headers: z.union([z.string(), z.record(z.unknown())]).nullable().optional(),
  timeoutMs: z.number().optional().default(8000),
  mockFixture: z.union([z.string(), z.record(z.unknown())]).nullable().optional(),
  guardPhase: z.string().optional().default('post'),
  displayVerb: z.union([z.string(), z.record(z.unknown())]).nullable().optional(),
  renderHints: z.union([z.string(), z.record(z.unknown())]).nullable().optional(),
  isConcurrencySafe: z.boolean().optional().default(true),
  enabled: z.boolean().optional().default(true),
  toolCategory: z.string().nullable().optional(),
})
export type SkillCreateRequest = z.infer<typeof skillCreateRequestSchema>

// ── POST /api/admin/skills response ──
export const skillCreateResponseSchema = z.object({
  skill: skillItemSchema,
})
export type SkillCreateResponse = z.infer<typeof skillCreateResponseSchema>

// ── GET /api/admin/skills/[name] response ──
export const skillGetResponseSchema = z.object({
  skill: skillItemSchema,
})
export type SkillGetResponse = z.infer<typeof skillGetResponseSchema>

// ── PUT /api/admin/skills/[name] request body ──
export const skillUpdateRequestSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  inputSchema: z.union([z.string(), z.record(z.unknown())]).optional(),
  outputSchema: z.union([z.string(), z.record(z.unknown())]).optional(),
  mode: z.string().optional(),
  endpoint: z.string().nullable().optional(),
  httpMethod: z.string().optional(),
  headers: z.union([z.string(), z.record(z.unknown())]).nullable().optional(),
  timeoutMs: z.number().optional(),
  mockFixture: z.union([z.string(), z.record(z.unknown())]).nullable().optional(),
  guardPhase: z.string().optional(),
  displayVerb: z.union([z.string(), z.record(z.unknown())]).nullable().optional(),
  renderHints: z.union([z.string(), z.record(z.unknown())]).nullable().optional(),
  isConcurrencySafe: z.boolean().optional(),
  enabled: z.boolean().optional(),
  toolCategory: z.string().nullable().optional(),
})
export type SkillUpdateRequest = z.infer<typeof skillUpdateRequestSchema>

// ── PUT /api/admin/skills/[name] response ──
export const skillUpdateResponseSchema = z.object({
  skill: skillItemSchema,
})
export type SkillUpdateResponse = z.infer<typeof skillUpdateResponseSchema>
