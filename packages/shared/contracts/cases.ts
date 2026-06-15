// Contracts for /api/cases — shared Zod schemas used by defineRoute (server)
// and apiClient (client) for typed, validated request/response envelopes.
//
// Per the Wave 1 spec, every API route validates input via defineRoute's
// inputSchema and returns a uniform ApiOk<T> | ApiErr envelope.

import { z } from 'zod'

// ── Query params ────────────────────────────────────────────────────────────

export const CasesListInput = z.object({
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export type CasesListInput = z.infer<typeof CasesListInput>

// ── Path params ─────────────────────────────────────────────────────────────

export const CaseByIdParams = z.object({
  id: z.string().min(1),
})

export type CaseByIdParams = z.infer<typeof CaseByIdParams>

// ── Response shapes ─────────────────────────────────────────────────────────

export const CaseSummarySchema = z.object({
  id: z.string(),
  type: z.string(),
  status: z.string(),
  source: z.string().optional(),
  goal: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  summary: z.string().nullable().optional(),
  toolsCalled: z.array(z.unknown()).optional(),
  messageCount: z.number().int().optional(),
})
export type CaseSummary = z.infer<typeof CaseSummarySchema>

export const CaseDetailSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  userId: z.string(),
  chatId: z.string(),
  type: z.string(),
  status: z.string(),
  source: z.string().optional(),
  goal: z.string().nullable(),
  blocker: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  resolvedAt: z.string().nullable(),
  memory: z
    .object({
      missingFacts: z.string(),
      toolsCalled: z.string(),
      toolResults: z.string(),
      keyEvents: z.string(),
      summary: z.string().nullable(),
      todos: z.string().nullable(),
    })
    .nullable(),
  humanTasks: z.array(z.unknown()).optional(),
  _count: z
    .object({
      messages: z.number().int(),
      traces: z.number().int(),
    })
    .optional(),
})
export type CaseDetail = z.infer<typeof CaseDetailSchema>

// ── List response envelope ──────────────────────────────────────────────────

export const CasesListResponse = z.object({
  cases: z.array(CaseSummarySchema),
  total: z.number().int(),
})
export type CasesListResponse = z.infer<typeof CasesListResponse>

export const CaseDetailResponse = z.object({
  case: CaseDetailSchema,
})
export type CaseDetailResponse = z.infer<typeof CaseDetailResponse>

export const CaseDeleteResponse = z.object({
  ok: z.boolean(),
})
export type CaseDeleteResponse = z.infer<typeof CaseDeleteResponse>
