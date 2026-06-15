import { z } from 'zod'
import { defineRoute } from '@/lib/api/define-route'
import { summarizeProcedureMetrics } from '@/lib/operate/procedure-metrics'
import { apiOk } from '@intera/shared/contracts/envelope'

const querySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})

export const GET = defineRoute<z.infer<typeof querySchema>>({
  method: 'GET',
  inputSchema: querySchema,
  parseQuery: true,
  handler: async ({ input, repo }) => {
    const updatedAt = input.from || input.to
      ? {
        ...(input.from ? { gte: new Date(input.from) } : {}),
        ...(input.to ? { lte: new Date(input.to) } : {}),
      }
      : undefined

    const runs = await repo.procedureRun.findMany({
      where: updatedAt ? { updatedAt } : undefined,
      orderBy: { updatedAt: 'desc' as const },
      select: {
        id: true,
        caseId: true,
        chatId: true,
        procedureId: true,
        status: true,
        outcome: true,
        inputEpoch: true,
        currentStepId: true,
        state: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    return apiOk({ metrics: summarizeProcedureMetrics(runs) })
  },
})
