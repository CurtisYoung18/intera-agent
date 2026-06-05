// GET /api/admin/policies/stats — Policy usage statistics (7-day window)
// Migrated to defineRoute (G1 contract seam + G2 tenant scoping).

import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'

export const GET = defineRoute({
  method: 'GET',
  async handler({ repo }) {
    const traces = await repo.raw.actionTrace.findMany({
      where: {
        case: { orgId: repo.orgId },
        actionType: 'policy_hit',
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
      select: { payload: true },
    })

    const counts = new Map<string, number>()
    for (const t of traces) {
      try {
        const data = t.payload ? JSON.parse(t.payload) : null
        const name = data?.policyName
        if (name) counts.set(name, (counts.get(name) || 0) + 1)
      } catch { /* skip malformed payloads */ }
    }

    const stats = Array.from(counts.entries())
      .map(([name, hits]) => ({ name, hits }))
      .sort((a, b) => b.hits - a.hits)

    return apiOk({ stats })
  },
})
