// Agent Configs domain contract — request/response zod schemas for /api/admin/agent-configs

import { z } from 'zod'

// ── Agent config card (returned in list responses) ──
export const agentConfigCardSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.number(),
  isActive: z.boolean(),
  parentId: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  createdAt: z.date().or(z.string()),
  updatedAt: z.date().or(z.string()),
})

export type AgentConfigCard = z.infer<typeof agentConfigCardSchema>

// ── GET /api/admin/agent-configs response ──
export const agentConfigsListResponseSchema = z.object({
  configs: z.array(agentConfigCardSchema),
})
export type AgentConfigsListResponse = z.infer<typeof agentConfigsListResponseSchema>

// ── POST /api/admin/agent-configs request body ──
export const agentConfigCreateRequestSchema = z.object({
  name: z.string().optional().default('Default'),
  templateId: z.string().optional(),
})
export type AgentConfigCreateRequest = z.infer<typeof agentConfigCreateRequestSchema>

// ── POST /api/admin/agent-configs response (create or fork) ──
export const agentConfigCreateResponseSchema = z.object({
  config: agentConfigCardSchema,
})
export type AgentConfigCreateResponse = z.infer<typeof agentConfigCreateResponseSchema>

// ── PUT /api/admin/agent-configs/[id] request body ──
export const agentConfigRenameRequestSchema = z.object({
  name: z.string().min(1, 'Name is required'),
})
export type AgentConfigRenameRequest = z.infer<typeof agentConfigRenameRequestSchema>

// ── PUT /api/admin/agent-configs/[id] response ──
export const agentConfigRenameResponseSchema = z.object({
  config: agentConfigCardSchema,
})
export type AgentConfigRenameResponse = z.infer<typeof agentConfigRenameResponseSchema>

// ── POST /api/admin/agent-configs/[id]/fork response ──
export const agentConfigForkResponseSchema = z.object({
  config: agentConfigCardSchema,
})
export type AgentConfigForkResponse = z.infer<typeof agentConfigForkResponseSchema>

// ── PUT /api/admin/agent-configs/[id]/activate response ──
export const agentConfigActivateResponseSchema = z.object({
  config: z.object({
    id: z.string(),
    name: z.string(),
    version: z.number(),
    isActive: z.boolean(),
  }),
})
export type AgentConfigActivateResponse = z.infer<typeof agentConfigActivateResponseSchema>

// ── DELETE /api/admin/agent-configs/[id] response ──
export const agentConfigDeleteResponseSchema = z.object({
  ok: z.boolean(),
})
export type AgentConfigDeleteResponse = z.infer<typeof agentConfigDeleteResponseSchema>
