// GET /api/cases — List cases (ops view, session-scoped to active org).
//
// Migrated to defineRoute + repoForOrg (Wave 1 G1/G2).
// The repo Proxy injects orgId into every query so routes never hand-write it.
// Runtime/user view (?userId=) is API-key-gated and handled in a separate
// route by the channels lane (Lane C).

import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import { CasesListInput, type CaseSummary } from '@intera/shared/contracts/cases'
import { resolveRequiredAgentCaseScope } from '../_agent-scope'

export const GET = defineRoute({
  method: 'GET',
  inputSchema: CasesListInput,
  parseQuery: true,
  handler: async ({ input, repo }) => {
    const { status, limit, offset } = input

    const where: Record<string, unknown> = {}
    if (status) where.status = status

    const scopedRuns = await resolveRequiredAgentCaseScope(repo, input)
    where.id = { in: scopedRuns.caseIds }

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
    const caseIds = new Set(cases.map((caseRow) => caseRow.id))
    const activeRuns = scopedRuns.runs.filter((run) => caseIds.has(run.caseId))
    const runByCase = new Map<string, string>()
    for (const run of activeRuns) {
      if (!runByCase.has(run.caseId)) runByCase.set(run.caseId, run.id)
    }
    const summaries: CaseSummary[] = cases.map((caseRow) => {
      const runId = runByCase.get(caseRow.id) ?? null
      return {
        id: runId ?? caseRow.id,
        runId,
        type: caseRow.type,
        status: caseRow.status,
        source: caseRow.source,
        goal: caseRow.goal,
        createdAt: caseRow.createdAt.toISOString(),
        updatedAt: caseRow.updatedAt.toISOString(),
        summary: caseRow.memory?.summary ?? null,
        toolsCalled: (() => {
          try { return JSON.parse(caseRow.memory?.toolsCalled ?? '[]') as unknown[] } catch { return [] }
        })(),
        messageCount: caseRow._count?.messages ?? 0,
      }
    })

    return apiOk({ cases: summaries, total })
  },
})
