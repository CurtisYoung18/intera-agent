// GET /api/chats/[chatId]/traces — Traces for a chat (by chatId + linked cases)
// Migrated to defineRoute (G1 contract seam + G2 tenant scoping).

import { z } from 'zod'
import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import { caseIdFilterForScope, resolveRequiredAgentCaseScope } from '../../_agent-scope'

const querySchema = z.object({
  limit: z.string().optional().default('200'),
  offset: z.string().optional().default('0'),
  actionType: z.string().optional(),
  agentId: z.string().optional(),
  agentConfigId: z.string().optional(),
})

export const GET = defineRoute<z.infer<typeof querySchema>, { chatId: string }>({
  method: 'GET',
  parseQuery: true,
  inputSchema: querySchema,
  async handler({ input, params, repo }) {
    const limit = Math.min(parseInt(input.limit), 500)
    const offset = parseInt(input.offset)
    const scope = await resolveRequiredAgentCaseScope(repo, input)

    const linkedCases = await repo.raw.case.findMany({
      where: { orgId: repo.orgId, chatId: params.chatId, ...caseIdFilterForScope(scope) },
      select: { id: true },
    })
    const caseIds = linkedCases.map(c => c.id)
    const traceTargets = caseIds.length > 0 ? [{ caseId: { in: caseIds } }] : []

    const where: Record<string, unknown> = {
      orgId: repo.orgId,
      OR: traceTargets.length > 0 ? traceTargets : [{ caseId: { in: [] } }],
    }
    if (input.actionType) where.actionType = input.actionType

    const [traces, total] = await Promise.all([
      repo.raw.actionTrace.findMany({ where, orderBy: { createdAt: 'asc' }, take: limit, skip: offset }),
      repo.raw.actionTrace.count({ where }),
    ])

    return apiOk({
      traces: traces.slice(0, limit).map(({ caseId: _caseId, ...trace }) => trace),
      total,
    })
  },
})
