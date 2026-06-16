// GET /api/cases/[id]/messages — Case conversation history
// Migrated to defineRoute (G1 contract seam + G2 tenant scoping).

import { z } from 'zod'
import { defineRoute, NotFoundError } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import { hydrateMessageFromDb, isCustomerVisibleMessage } from '@/lib/agent/provider-transcript'
import { assertCaseInAgentScope, requireSelectedAgentFromInput } from '@/app/api/_agent-scope'

const querySchema = z.object({
  limit: z.string().optional().default('100'),
  offset: z.string().optional().default('0'),
  agentId: z.string().optional(),
  agentConfigId: z.string().optional(),
})

export const GET = defineRoute<z.infer<typeof querySchema>, { id: string }>({
  method: 'GET',
  parseQuery: true,
  inputSchema: querySchema,
  async handler({ input, params, repo }) {
    const limit = Math.min(parseInt(input.limit), 500)
    const offset = parseInt(input.offset)
    await assertCaseInAgentScope(repo, params.id, requireSelectedAgentFromInput(input))

    const [caseData, messages] = await Promise.all([
      repo.case.findUnique({
        where: { id: params.id },
        select: { type: true, status: true, createdAt: true },
      }),
      repo.raw.message.findMany({
        where: { orgId: repo.orgId, caseId: params.id },
        orderBy: { createdAt: 'asc' },
      }),
    ])

    if (!caseData) throw new NotFoundError('ProcedureRun not found')

    const visibleMessages = messages
      .map((message) => hydrateMessageFromDb(message as any))
      .filter(isCustomerVisibleMessage)
    const pagedMessages = visibleMessages.slice(offset, offset + limit)

    return apiOk({
      caseType: caseData.type,
      status: caseData.status,
      createdAt: caseData.createdAt,
      messages: pagedMessages,
      total: visibleMessages.length,
    })
  },
})
