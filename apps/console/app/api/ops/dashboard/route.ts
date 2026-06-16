// GET /api/ops/dashboard — Legacy ops dashboard metrics for the selected agent.
//
// Migrated to defineRoute + repoForOrg (Wave 1 G1/G2).
// All queries are org-scoped via the repo Proxy. Cross-model aggregate
// queries (Message, ActionTrace) resolve through org-scoped Case IDs
// rather than nested-relation orgId filters, keeping Proxy compatibility.

import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import { resolveRequiredAgentCaseScope } from '@/app/api/_agent-scope'
import { z } from 'zod'

const querySchema = z.object({
  agentId: z.string().optional(),
  agentConfigId: z.string().optional(),
})

export const GET = defineRoute<z.infer<typeof querySchema>>({
  method: 'GET',
  inputSchema: querySchema,
  parseQuery: true,
  handler: async ({ input, repo }) => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const scope = await resolveRequiredAgentCaseScope(repo, input)

    // Resolve case IDs for the selected agent.
    const allCaseIds = scope.caseIds
    const recentCaseIds = (
      await repo.case.findMany({
        where: { id: { in: allCaseIds }, createdAt: { gte: yesterday } },
        select: { id: true },
      })
    ).map((c) => c.id)

    const [
      activeCases,
      resolvedCases,
      hookHits,
      recentCases,
    ] = await Promise.all([
      repo.case
        .count({
          where: { id: { in: allCaseIds }, status: { notIn: ['resolved', 'escalated'] } },
        })
        .catch(() => 0),
      repo.case
        .findMany({
          where: {
            id: { in: allCaseIds },
            resolvedAt: { not: null },
            createdAt: { gte: yesterday },
          },
          select: { createdAt: true, resolvedAt: true },
        })
        .catch(() => []),
      allCaseIds.length > 0
        ? repo.raw.actionTrace
            .findMany({
              where: {
                caseId: { in: allCaseIds },
                actionType: 'hook_hit',
                createdAt: { gte: yesterday },
              },
              select: { title: true },
              take: 50,
            })
            .catch(() => [])
        : ([] as { title: string }[]),
      repo.case
        .findMany({
          where: { id: { in: allCaseIds } },
          orderBy: { createdAt: 'desc' as const },
          take: 10,
          select: { id: true, type: true, status: true, createdAt: true },
        })
        .catch(() => []),
    ])

    // 24h message count — resolve through org-scoped case IDs.
    const msgCount =
      recentCaseIds.length > 0
        ? await repo.raw.message
            .count({
              where: {
                caseId: { in: recentCaseIds },
                createdAt: { gte: yesterday },
              },
            })
            .catch(() => 0)
        : 0

    // Average resolution time (minutes).
    let avgResolutionMin: number | null = null
    const resolvedList = resolvedCases as { createdAt: Date; resolvedAt: Date | null }[]
    if (resolvedList.length > 0) {
      const totalMin = resolvedList.reduce((sum, c) => {
        if (!c.resolvedAt) return sum
        return (
          sum +
          (new Date(c.resolvedAt).getTime() - new Date(c.createdAt).getTime()) /
            60000
        )
      }, 0)
      avgResolutionMin = Math.round(totalMin / resolvedList.length)
    }

    // Hook hit counts.
    const hitMap = new Map<string, number>()
    for (const hit of hookHits as { title: string }[]) {
      hitMap.set(hit.title, (hitMap.get(hit.title) ?? 0) + 1)
    }
    const topHits = [...hitMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, hits]) => ({ name, hits }))

    return apiOk({
      overview: {
        messages24h: msgCount,
        activeCases: activeCases as number,
        avgResolutionMin,
      },
      guardrailHits: topHits,
      recentCases: (
        recentCases as Array<{
          id: string
          type: string
          status: string
          createdAt: Date
        }>
      ).map((c) => ({
        id: c.id,
        type: c.type,
        status: c.status,
        createdAt: c.createdAt.toISOString(),
      })),
    })
  },
})
