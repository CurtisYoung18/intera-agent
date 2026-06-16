import { z } from 'zod'
import { defineRoute } from '@/lib/api/define-route'
import { assertAgentInOrg } from '@/lib/api/assert-agent-in-org'
import { summarizeHandoffMetrics } from '@/lib/operate/handoff-metrics'
import { apiOk } from '@intera/shared/contracts/envelope'

const querySchema = z.object({
  agentId: z.string().optional(),
  agentConfigId: z.string().optional(),
})

export const GET = defineRoute<z.infer<typeof querySchema>>({
  method: 'GET',
  inputSchema: querySchema,
  parseQuery: true,
  handler: async ({ input, repo }) => {
    const agentConfigId = input.agentConfigId ?? input.agentId
    const where: Record<string, unknown> = {}

    if (agentConfigId) {
      await assertAgentInOrg(repo, agentConfigId)
      const runs = await repo.raw.procedureRun.findMany({
        where: { orgId: repo.orgId, agentConfigId },
        select: { caseId: true },
      })
      where.id = { in: [...new Set(runs.map((run) => run.caseId))] }
    }

    const cases = await repo.case.findMany({
      where,
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
