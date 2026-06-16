// GET /api/chats/[chatId]/messages — customer-visible chat transcript by chatId.

import { z } from 'zod'
import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import { hydrateMessageFromDb, isCustomerVisibleMessage } from '@/lib/agent/provider-transcript'
import { childCaseIdFilterForScope, caseIdFilterForScope, resolveAgentCaseScope, selectedAgentFromInput } from '../../_agent-scope'

const querySchema = z.object({
  limit: z.string().optional().default('200'),
  offset: z.string().optional().default('0'),
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
    const scope = await resolveAgentCaseScope(repo, selectedAgentFromInput(input))

    const cases = await repo.raw.case.findMany({
      where: { orgId: repo.orgId, chatId: params.chatId, ...caseIdFilterForScope(scope) },
      select: { id: true, type: true, status: true },
    })
    const caseById = new Map(cases.map((caseRow) => [caseRow.id, caseRow]))

    const messages = await repo.raw.message.findMany({
      where: { orgId: repo.orgId, chatId: params.chatId, ...childCaseIdFilterForScope(scope) },
      orderBy: { createdAt: 'asc' },
      take: 500,
    })

    const visibleMessages = messages
      .map((message) => {
        const hydrated = hydrateMessageFromDb(message as any)
        return {
          ...hydrated,
          runId: message.runId,
          procedureType: caseById.get(message.caseId)?.type,
          procedureStatus: caseById.get(message.caseId)?.status,
        }
      })
      .filter(isCustomerVisibleMessage)
    const pagedMessages = visibleMessages.slice(offset, offset + limit)

    return apiOk({ messages: pagedMessages, total: visibleMessages.length })
  },
})
