// GET /api/cases — List cases (ops view, session-scoped to active org).
//
// Migrated to defineRoute + repoForOrg (Wave 1 G1/G2).
// The repo Proxy injects orgId into every query so routes never hand-write it.
// Runtime/user view (?userId=) is API-key-gated and handled in a separate
// route by the channels lane (Lane C).

import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import { CasesListInput, type CaseSummary } from '@intera/shared/contracts/cases'

export const GET = defineRoute({
  method: 'GET',
  inputSchema: CasesListInput,
  handler: async ({ input, repo }) => {
    const { status, limit, offset } = input

    const where: Record<string, unknown> = {}
    if (status) where.status = status

    const [cases, total] = await Promise.all([
      repo.case.findMany({
        where,
        orderBy: { updatedAt: 'desc' as const },
        take: limit,
        skip: offset,
        include: {
          memory: true,
          humanTasks: { take: 5, orderBy: { createdAt: 'desc' as const } },
          _count: { select: { messages: true, traces: true } },
        },
      }),
      repo.case.count({ where }),
    ])

    return apiOk({ cases, total })
  },
})
