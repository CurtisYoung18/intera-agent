// Tools domain contract — request/response zod schemas for /api/admin/tools

import { z } from 'zod'

// ── Tool item (returned in list + single responses) ──
export const toolItemSchema = z.object({
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

export type ToolItem = z.infer<typeof toolItemSchema>

// ── GET /api/admin/tools response ──
export const toolsListResponseSchema = z.object({
  tools: z.array(toolItemSchema),
})
export type ToolsListResponse = z.infer<typeof toolsListResponseSchema>

// ── POST /api/admin/tools request body ──
export const toolCreateRequestSchema = z.object({
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
export type ToolCreateRequest = z.infer<typeof toolCreateRequestSchema>

// ── POST /api/admin/tools response ──
export const toolCreateResponseSchema = z.object({
  tool: toolItemSchema,
})
export type ToolCreateResponse = z.infer<typeof toolCreateResponseSchema>

// ── GET /api/admin/tools/[name] response ──
export const toolGetResponseSchema = z.object({
  tool: toolItemSchema,
})
export type ToolGetResponse = z.infer<typeof toolGetResponseSchema>

// ── PUT /api/admin/tools/[name] request body ──
export const toolUpdateRequestSchema = z.object({
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
export type ToolUpdateRequest = z.infer<typeof toolUpdateRequestSchema>

// ── PUT /api/admin/tools/[name] response ──
export const toolUpdateResponseSchema = z.object({
  tool: toolItemSchema,
})
export type ToolUpdateResponse = z.infer<typeof toolUpdateResponseSchema>
