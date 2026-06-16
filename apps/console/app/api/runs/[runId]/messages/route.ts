// GET /api/runs/[runId]/messages — ProcedureRun conversation history.

import { z } from 'zod'
import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import { hydrateMessageFromDb, isCustomerVisibleMessage } from '@/lib/agent/provider-transcript'
import { resolveProcedureRun } from '../../_lib'
import { requireSelectedAgentFromInput } from '@/app/api/_agent-scope'

const querySchema = z.object({
  limit: z.string().optional().default('100'),
  offset: z.string().optional().default('0'),
  agentId: z.string().optional(),
  agentConfigId: z.string().optional(),
})

export const GET = defineRoute<z.infer<typeof querySchema>, { runId: string }>({
  method: 'GET',
  parseQuery: true,
  inputSchema: querySchema,
  async handler({ input, params, repo }) {
    const limit = Math.min(parseInt(input.limit), 500)
    const offset = parseInt(input.offset)
    const { run, caseData } = await resolveProcedureRun(repo, params.runId, requireSelectedAgentFromInput(input))

    const messages = await repo.raw.message.findMany({
      where: {
        orgId: repo.orgId,
        OR: [{ runId: run.id }, { caseId: run.caseId }],
      },
      orderBy: { createdAt: 'asc' },
    })

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
