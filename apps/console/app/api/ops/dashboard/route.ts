import { NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'
import { getActiveOrgId } from '@/lib/auth'

export async function GET() {
  try {
    const ORG_ID = await getActiveOrgId()
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)

    const [
      msgCount,
      activeCases,
      resolvedCases,
      guardrailHits,
      channelHealth,
      recentCases,
    ] = await Promise.all([
      prisma.message.count({
        where: { case: { orgId: ORG_ID }, createdAt: { gte: yesterday } },
      }).catch(() => 0),
      prisma.case.count({
        where: { orgId: ORG_ID, status: { notIn: ['resolved', 'escalated'] } },
      }).catch(() => 0),
      prisma.case.findMany({
        where: { orgId: ORG_ID, resolvedAt: { not: null }, createdAt: { gte: yesterday } },
        select: { createdAt: true, resolvedAt: true },
      }).catch(() => []),
      prisma.actionTrace.findMany({
        where: { case: { orgId: ORG_ID }, actionType: 'policy_hit', createdAt: { gte: yesterday } },
        select: { title: true },
        take: 50,
      }).catch(() => []),
      prisma.channelHealth.findMany({
        where: { orgId: ORG_ID },
      }).catch(() => []),
      prisma.case.findMany({
        where: { orgId: ORG_ID },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, type: true, status: true, createdAt: true },
      }).catch(() => []),
    ])

    // Average resolution time
    let avgResolutionMin: number | null = null
    if (resolvedCases.length > 0) {
      const totalMin = resolvedCases.reduce((sum, c) => {
        if (!c.resolvedAt) return sum
        return sum + (new Date(c.resolvedAt).getTime() - new Date(c.createdAt).getTime()) / 60000
      }, 0)
      avgResolutionMin = Math.round(totalMin / resolvedCases.length)
    }

    // Guardrail hit counts
    const hitMap = new Map<string, number>()
    for (const hit of guardrailHits) {
      hitMap.set(hit.title, (hitMap.get(hit.title) ?? 0) + 1)
    }
    const topHits = [...hitMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, hits]) => ({ name, hits }))

    return NextResponse.json({
      overview: {
        messages24h: msgCount,
        activeCases,
        avgResolutionMin,
      },
      guardrailHits: topHits,
      channelHealth: channelHealth.map(ch => ({
        channel: ch.channel,
        status: ch.status,
        lastChecked: ch.lastChecked.toISOString(),
        lastError: ch.lastError,
      })),
      recentCases: recentCases.map(c => ({
        id: c.id,
        type: c.type,
        status: c.status,
        createdAt: c.createdAt.toISOString(),
      })),
    })
  } catch (err) {
    console.error('[Dashboard] Error:', err)
    return NextResponse.json({
      overview: { messages24h: 0, activeCases: 0, avgResolutionMin: null },
      guardrailHits: [],
      channelHealth: [],
      recentCases: [],
    })
  }
}
