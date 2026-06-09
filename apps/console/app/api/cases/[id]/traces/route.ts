// GET /api/cases/[id]/traces — ProcedureRun trace timeline
// Migrated to defineRoute (G1 contract seam + G2 tenant scoping).

import { z } from 'zod'
import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'

const querySchema = z.object({
  limit: z.string().optional().default('100'),
  offset: z.string().optional().default('0'),
  actionType: z.string().optional(),
})

export const GET = defineRoute<z.infer<typeof querySchema>, { id: string }>({
  method: 'GET',
  parseQuery: true,
  inputSchema: querySchema,
  async handler({ input, params, repo }) {
    const limit = Math.min(parseInt(input.limit), 500)
    const offset = parseInt(input.offset)

    const where: Record<string, unknown> = { caseId: params.id }
    if (input.actionType) where.actionType = input.actionType

    const [traces, total] = await Promise.all([
      repo.raw.actionTrace.findMany({ where, orderBy: { createdAt: 'asc' }, take: limit, skip: offset }),
      repo.raw.actionTrace.count({ where }),
    ])

    return apiOk({ traces, total })
  },
})
