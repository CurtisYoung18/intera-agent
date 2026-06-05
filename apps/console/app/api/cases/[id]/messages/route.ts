// GET /api/cases/[id]/messages — Case conversation history
// Migrated to defineRoute (G1 contract seam + G2 tenant scoping).

import { z } from 'zod'
import { defineRoute, NotFoundError } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'

const querySchema = z.object({
  limit: z.string().optional().default('100'),
  offset: z.string().optional().default('0'),
})

export const GET = defineRoute<z.infer<typeof querySchema>, { id: string }>({
  method: 'GET',
  parseQuery: true,
  inputSchema: querySchema,
  async handler({ input, params, repo }) {
    const limit = Math.min(parseInt(input.limit), 500)
    const offset = parseInt(input.offset)

    const [caseData, messages, total] = await Promise.all([
      repo.case.findUnique({
        where: { id: params.id },
        select: { type: true, status: true, createdAt: true },
      }),
      repo.raw.message.findMany({
        where: { caseId: params.id },
        orderBy: { createdAt: 'asc' },
        take: limit,
        skip: offset,
      }),
      repo.raw.message.count({ where: { caseId: params.id } }),
    ])

    if (!caseData) throw new NotFoundError('Case not found')

    return apiOk({ caseType: caseData.type, status: caseData.status, createdAt: caseData.createdAt, messages, total })
  },
})
