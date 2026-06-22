// LiveChat domain contract — request/response zod schemas for /api/livechat/*

import { z } from 'zod'

// ── LiveChat config item ──
export const livechatConfigSchema = z.object({
  orgId: z.string(),
  botAccessToken: z.string(),
  licenseId: z.string(),
  webhookSecret: z.string(),
  showSkillStatus: z.boolean(),
  enabled: z.boolean(),
  region: z.string().optional(),
  authType: z.string().optional(),
  accountId: z.string().optional(),
  agentAccountId: z.string().optional(),
  transferGroupId: z.number().optional(),
  transferMessage: z.string().optional(),
  playerIdGuideImageUrl: z.string().optional(),
})

export type LiveChatConfigItem = z.infer<typeof livechatConfigSchema>

// ── GET /api/livechat/config response ──
// Returned config has masked secrets (botAccessToken/webhookSecret).
export const livechatConfigResponseSchema = z.object({
  config: livechatConfigSchema.extend({
    botAccessToken: z.string(),
    webhookSecret: z.string(),
  }),
})
export type LiveChatConfigResponse = z.infer<typeof livechatConfigResponseSchema>

// ── PUT /api/livechat/config request body ──
// orgId is resolved from the session, not from the body.
export const livechatConfigUpdateRequestSchema = z.object({
  botAccessToken: z.string(),
  licenseId: z.string(),
  webhookSecret: z.string().optional().default(''),
  region: z.string().optional(),
  authType: z.string().optional(),
  accountId: z.string().optional(),
  agentAccountId: z.string().optional(),
  showSkillStatus: z.boolean(),
  enabled: z.boolean(),
  transferGroupId: z.number().optional(),
  transferMessage: z.string().optional(),
  playerIdGuideImageUrl: z.string().optional(),
})
export type LiveChatConfigUpdateRequest = z.infer<typeof livechatConfigUpdateRequestSchema>

// ── PUT /api/livechat/config response ──
export const livechatConfigUpdateResponseSchema = z.object({
  ok: z.boolean(),
})
export type LiveChatConfigUpdateResponse = z.infer<typeof livechatConfigUpdateResponseSchema>

// ── LiveChat group item ──
export const livechatGroupSchema = z.object({
  id: z.number(),
  name: z.string(),
  agents_count: z.number(),
})

export type LiveChatGroup = z.infer<typeof livechatGroupSchema>

// ── GET /api/livechat/groups response ──
export const livechatGroupsResponseSchema = z.object({
  groups: z.array(livechatGroupSchema),
})
export type LiveChatGroupsResponse = z.infer<typeof livechatGroupsResponseSchema>

// ── LiveChat groups error response (when API call fails) ──
export const livechatGroupsErrorSchema = z.object({
  groups: z.array(livechatGroupSchema).default([]),
  error: z.string().optional(),
  code: z.string().optional(),
})
export type LiveChatGroupsError = z.infer<typeof livechatGroupsErrorSchema>
