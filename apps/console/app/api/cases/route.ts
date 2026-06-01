// GET /api/cases — List cases
// Ops view: ?status=&limit=50&offset=0 (uses org auth)
// Runtime view: ?userId=xxx&orgId=xxx&chatId=xxx&limit=20

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'
import { getActiveOrgId } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const userId = searchParams.get('userId')

  // ── Runtime/user view: list cases for a specific user ──
  if (userId) {
    const orgId = searchParams.get('orgId') || 'default'
    const chatId = searchParams.get('chatId') || null
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 50)

    try {
      const cases = await prisma.case.findMany({
        where: {
          orgId,
          userId,
          ...(chatId ? { chatId } : {}),
        },
        orderBy: { updatedAt: 'desc' },
        take: limit,
        select: {
          id: true,
          type: true,
          status: true,
          goal: true,
          createdAt: true,
          updatedAt: true,
          memory: {
            select: {
              summary: true,
              skillsCalled: true,
            },
          },
          _count: { select: { messages: true } },
        },
      })

      const result = cases.map((c) => ({
        id: c.id,
        type: c.type,
        status: c.status,
        goal: c.goal,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        summary: c.memory?.summary?.slice(0, 200) || null,
        skillsCalled: c.memory?.skillsCalled ? JSON.parse(c.memory.skillsCalled) : [],
        messageCount: c._count.messages,
      }))

      return NextResponse.json({ cases: result })
    } catch (err) {
      console.error('[Cases API] Error:', err)
      return NextResponse.json({ cases: [], error: 'Failed to load cases' }, { status: 500 })
    }
  }

  // ── Ops view: list all cases for org ──
  const ORG_ID = await getActiveOrgId()
  const status = searchParams.get('status')
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)
  const offset = parseInt(searchParams.get('offset') || '0')

  try {
    const where: Record<string, unknown> = { orgId: ORG_ID }
    if (status) where.status = status
    const [cases, total] = await Promise.all([
      prisma.case.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          memory: true,
          humanTasks: { take: 5, orderBy: { createdAt: 'desc' } },
          _count: { select: { messages: true, traces: true } },
        },
      }),
      prisma.case.count({ where }),
    ])

    return NextResponse.json({ cases, total })
  } catch (err) {
    console.error('[API] Failed to list cases:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
