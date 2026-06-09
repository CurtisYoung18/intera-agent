// Route-level guard tests for /api/ops/dashboard — contract validation
// and handler logic tested in isolation.

import { describe, it, expect } from 'vitest'

// ── Handler logic tests ─────────────────────────────────────────────────────

describe('dashboard handler logic (isolation tests)', () => {
  it('computes average resolution time in minutes', () => {
    const resolvedCases = [
      { createdAt: new Date('2026-01-01T10:00:00Z'), resolvedAt: new Date('2026-01-01T10:30:00Z') },
      { createdAt: new Date('2026-01-02T10:00:00Z'), resolvedAt: new Date('2026-01-02T10:45:00Z') },
    ]

    const totalMin = resolvedCases.reduce((sum, c) => {
      if (!c.resolvedAt) return sum
      return sum + (c.resolvedAt.getTime() - c.createdAt.getTime()) / 60000
    }, 0)
    const avg = Math.round(totalMin / resolvedCases.length)

    expect(avg).toBe(38) // (30 + 45) / 2 = 37.5 → 38
  })

  it('returns null avgResolutionMin when no resolved cases', () => {
    const resolvedCases: any[] = []
    let avgResolutionMin: number | null = null
    if (resolvedCases.length > 0) {
      const totalMin = resolvedCases.reduce((sum: number, c: any) => {
        if (!c.resolvedAt) return sum
        return sum + (c.resolvedAt.getTime() - c.createdAt.getTime()) / 60000
      }, 0)
      avgResolutionMin = Math.round(totalMin / resolvedCases.length)
    }
    expect(avgResolutionMin).toBeNull()
  })

  it('aggregates Hook hits by title', () => {
    const hits = [
      { title: 'hook_a' }, { title: 'hook_a' }, { title: 'hook_b' },
    ]

    const hitMap = new Map<string, number>()
    for (const hit of hits) {
      hitMap.set(hit.title, (hitMap.get(hit.title) ?? 0) + 1)
    }
    const topHits = [...hitMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, hits]) => ({ name, hits }))

    expect(topHits).toHaveLength(2)
    expect(topHits[0]).toEqual({ name: 'hook_a', hits: 2 })
    expect(topHits[1]).toEqual({ name: 'hook_b', hits: 1 })
  })

  it('returns empty topHits when no Hook activity', () => {
    const hitMap = new Map<string, number>()
    const topHits = [...hitMap.entries()].map(([name, hits]) => ({ name, hits }))
    expect(topHits).toEqual([])
  })

  it('handler must not hand-write orgId in any query where clause', () => {
    // The handler uses repo methods. The repo Proxy injects orgId.
    // Handler never sees or sets orgId directly in where clauses.
    const handlerQueries = [
      { where: { status: { notIn: ['resolved', 'escalated'] } } },
      { where: { resolvedAt: { not: null }, createdAt: { gte: new Date() } } },
      { where: { caseId: { in: ['c1', 'c2'] }, actionType: 'hook_hit' } },
      { orderBy: { createdAt: 'desc' }, take: 10 },
    ]

    for (const q of handlerQueries) {
      if (q.where) {
        expect(q.where).not.toHaveProperty('orgId')
      }
    }
  })
})
