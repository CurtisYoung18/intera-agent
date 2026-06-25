// Contracts for /api/chats — shared Zod schemas used by defineRoute (server)
// and apiClient (client) for typed, validated request/response envelopes.

import { z } from 'zod'

// ── Query params ────────────────────────────────────────────────────────────

export const ChatsListInput = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  agentId: z.string().optional(),
  agentConfigId: z.string().optional(),
  q: z.preprocess((value) => {
    if (typeof value !== 'string') return undefined
    const normalized = value.trim().replace(/\s+/g, ' ')
    return normalized.length > 0 ? normalized : undefined
  }, z.string().min(2).max(80).optional()),
})

export type ChatsListInput = z.infer<typeof ChatsListInput>

// ── Path params ─────────────────────────────────────────────────────────────

export const ChatByIdParams = z.object({
  chatId: z.string().min(1),
})

export type ChatByIdParams = z.infer<typeof ChatByIdParams>

// ── Response shapes ─────────────────────────────────────────────────────────

export const CaseSummaryInChatSchema = z.object({
  id: z.string(),
  runId: z.string().nullable().optional(),
  type: z.string(),
  status: z.string(),
  source: z.string(),
  goal: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  _count: z.object({ messages: z.number().int() }).optional(),
})
export type CaseSummaryInChat = z.infer<typeof CaseSummaryInChatSchema>

export const ChatHandoffTaskSchema = z.object({
  id: z.string(),
  caseId: z.string(),
  runId: z.string().nullable().optional(),
  procedureType: z.string().optional(),
  queue: z.string(),
  status: z.string(),
  question: z.string(),
  notes: z.string().nullable().optional(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable().optional(),
})
export type ChatHandoffTask = z.infer<typeof ChatHandoffTaskSchema>

export const ChatMatchedMessageSchema = z.object({
  messageId: z.string(),
  caseId: z.string(),
  runId: z.string().nullable().optional(),
  role: z.string(),
  createdAt: z.string(),
  snippet: z.string(),
  rank: z.number(),
})
export type ChatMatchedMessage = z.infer<typeof ChatMatchedMessageSchema>

export const ChatSessionSchema = z.object({
  chatId: z.string(),
  userId: z.string(),
  cases: z.array(CaseSummaryInChatSchema),
  messageCount: z.number().int(),
  lastActivity: z.string(),
  hasHumanTask: z.boolean(),
  handoffTasks: z.array(ChatHandoffTaskSchema).optional(),
  matchedMessages: z.array(ChatMatchedMessageSchema).optional(),
})
export type ChatSession = z.infer<typeof ChatSessionSchema>

// ── List response envelope ──────────────────────────────────────────────────

export const ChatsListQueryMetaSchema = z.object({
  normalizedQuery: z.string().nullable(),
  searchMode: z.enum(['none', 'fts', 'contains_fallback']),
})
export type ChatsListQueryMeta = z.infer<typeof ChatsListQueryMetaSchema>

export const ChatsListResponse = z.object({
  sessions: z.array(ChatSessionSchema),
  total: z.number().int(),
  query: ChatsListQueryMetaSchema.optional(),
})
export type ChatsListResponse = z.infer<typeof ChatsListResponse>

// ── Delete response ─────────────────────────────────────────────────────────

export const ChatDeleteResponse = z.object({
  ok: z.boolean(),
  deleted: z.number().int(),
})
export type ChatDeleteResponse = z.infer<typeof ChatDeleteResponse>
