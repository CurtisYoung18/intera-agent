// GET /api/cases/[id]/traces — Case trace timeline
// Query: ?limit=100&offset=0&actionType=skill_called

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const { searchParams } = new URL(req.url)
  const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500)
  const offset = parseInt(searchParams.get('offset') || '0')
  const actionType = searchParams.get('actionType')

  try {
    const where: Record<string, unknown> = { caseId: id }
    if (actionType) where.actionType = actionType

    const [traces, total] = await Promise.all([
      prisma.actionTrace.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        take: limit,
        skip: offset,
      }),
      prisma.actionTrace.count({ where }),
    ])

    return NextResponse.json({ traces, total })
  } catch (err) {
    console.error('[API] Failed to get traces:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
