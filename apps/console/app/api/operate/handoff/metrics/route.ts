import { z } from 'zod'
import { defineRoute } from '@/lib/api/define-route'
import { summarizeHandoffMetrics } from '@/lib/operate/handoff-metrics'
import { apiOk } from '@intera/shared/contracts/envelope'
import { resolveRequiredAgentCaseScope } from '@/app/api/_agent-scope'

const querySchema = z.object({
  agentId: z.string().optional(),
  agentConfigId: z.string().optional(),
})

export const GET = defineRoute<z.infer<typeof querySchema>>({
  method: 'GET',
  inputSchema: querySchema,
  parseQuery: true,
  handler: async ({ input, repo }) => {
    const scope = await resolveRequiredAgentCaseScope(repo, input)

    const cases = await repo.case.findMany({
      where: { id: { in: scope.caseIds } },
      orderBy: { updatedAt: 'desc' as const },
      select: {
        id: true,
        chatId: true,
        type: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        humanTasks: {
          select: {
            status: true,
            createdAt: true,
            resolvedAt: true,
          },
        },
        _count: { select: { messages: true } },
      },
    })

    return apiOk({ metrics: summarizeHandoffMetrics(cases) })
  },
})
