// API Keys domain contract — request/response zod schemas for /api/admin/api-keys

import { z } from 'zod'

// ── API key row (returned in list + create responses) ──
export const apiKeyRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  agentConfigId: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  createdAt: z.string(),
})

export type ApiKeyRow = z.infer<typeof apiKeyRowSchema>

// ── GET /api/admin/api-keys response ──
export const apiKeysListResponseSchema = z.object({
  keys: z.array(apiKeyRowSchema),
})
export type ApiKeysListResponse = z.infer<typeof apiKeysListResponseSchema>

// ── POST /api/admin/api-keys request body ──
export const apiKeyCreateRequestSchema = z.object({
  name: z.string().optional().default('default'),
  agentConfigId: z.string().nullable().optional(),
})
export type ApiKeyCreateRequest = z.infer<typeof apiKeyCreateRequestSchema>

// ── POST /api/admin/api-keys response ──
export const apiKeyCreateResponseSchema = z.object({
  key: apiKeyRowSchema,
  plaintext: z.string(),
})
export type ApiKeyCreateResponse = z.infer<typeof apiKeyCreateResponseSchema>

// ── DELETE /api/admin/api-keys/[id] response ──
export const apiKeyRevokeResponseSchema = z.object({
  ok: z.boolean(),
})
export type ApiKeyRevokeResponse = z.infer<typeof apiKeyRevokeResponseSchema>
