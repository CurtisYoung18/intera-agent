import { NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'
import { getActiveCustomerId } from '@/lib/auth'

export async function GET() {
  try {
    const customerId = await getActiveCustomerId()

    const traces = await prisma.actionTrace.findMany({
      where: {
        case: { customerId },
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
        if (name) {
          counts.set(name, (counts.get(name) || 0) + 1)
        }
      } catch { /* skip malformed payloads */ }
    }

    const stats = Array.from(counts.entries())
      .map(([name, hits]) => ({ name, hits }))
      .sort((a, b) => b.hits - a.hits)

    return NextResponse.json({ stats })
  } catch (err) {
    console.error('[policy-stats] Failed:', err)
    return NextResponse.json({ stats: [] })
  }
}
