import { defineRoute } from '@/lib/api/define-route'
import { summarizeHandoffMetrics } from '@/lib/operate/handoff-metrics'
import { apiOk } from '@intera/shared/contracts/envelope'

export const GET = defineRoute({
  method: 'GET',
  handler: async ({ repo }) => {
    const cases = await repo.case.findMany({
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
