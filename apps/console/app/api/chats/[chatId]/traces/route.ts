// GET /api/chats/[chatId]/traces — Traces for a chat (by chatId + linked cases)
// Migrated to defineRoute (G1 contract seam + G2 tenant scoping).

import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import { summarizeLlmRequestPayloadForTrace } from '@/lib/operate/runtime-truth'
import { caseIdFilterForScope, resolveRequiredAgentCaseScopeForChat } from '../../_agent-scope'

const querySchema = z.object({
  limit: z.string().optional().default('200'),
  offset: z.string().optional().default('0'),
  actionType: z.string().optional(),
  payloadMode: z.enum(['full', 'summary']).optional().default('full'),
  agentId: z.string().optional(),
  agentConfigId: z.string().optional(),
})

interface ActionTraceListRow {
  id: string
  orgId: string
  chatId: string | null
  runId: string | null
  caseId: string
  actionType: string
  title: string
  detail: string | null
  payload: string | null
  createdAt: Date
}

function omitCaseId(trace: ActionTraceListRow) {
  const { caseId: _caseId, ...rest } = trace
  return rest
}

function parsePayload(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function sanitizeTracePayload(trace: ActionTraceListRow): ActionTraceListRow {
  if (trace.actionType !== 'llm_request_start') return trace
  const summary = summarizeLlmRequestPayloadForTrace(parsePayload(trace.payload))
  return {
    ...trace,
    payload: summary ? JSON.stringify(summary) : null,
  }
}

export const GET = defineRoute<z.infer<typeof querySchema>, { chatId: string }>({
  method: 'GET',
  parseQuery: true,
  inputSchema: querySchema,
  async handler({ input, params, repo }) {
    const parsedLimit = Number.parseInt(input.limit, 10)
    const parsedOffset = Number.parseInt(input.offset, 10)
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 500) : 200
    const offset = Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0
    const scope = await resolveRequiredAgentCaseScopeForChat(repo, input, params.chatId)

    const linkedCases = await repo.raw.case.findMany({
      where: { orgId: repo.orgId, chatId: params.chatId, ...caseIdFilterForScope(scope) },
      select: { id: true },
    })
    const caseIds = linkedCases.map(c => c.id)
    if (caseIds.length === 0) {
      return apiOk({ traces: [], total: 0 })
    }

    const where: Record<string, unknown> = {
      orgId: repo.orgId,
      caseId: { in: caseIds },
    }
    if (input.actionType) where.actionType = input.actionType

    const actionTypeFilter = input.actionType
      ? Prisma.sql`AND "actionType" = ${input.actionType}`
      : Prisma.empty

    const [traces, total] = await Promise.all([
      repo.raw.$queryRaw<ActionTraceListRow[]>(Prisma.sql`
        SELECT
          id,
          org_id AS "orgId",
          "chatId",
          run_id AS "runId",
          "caseId",
          "actionType",
          title,
          detail,
          payload,
          "createdAt"
        FROM action_traces
        WHERE org_id = ${repo.orgId}
          AND "caseId" IN (${Prisma.join(caseIds)})
          ${actionTypeFilter}
        ORDER BY "createdAt" ASC
        LIMIT ${limit}
        OFFSET ${offset}
      `),
      repo.raw.actionTrace.count({ where }),
    ])

    return apiOk({
      traces: traces.slice(0, limit).map(sanitizeTracePayload).map(omitCaseId),
      total,
    })
  },
})
