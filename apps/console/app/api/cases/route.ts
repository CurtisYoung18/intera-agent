// GET /api/cases — List all cases (Console)
// Query: ?status=&limit=50&offset=0

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)
  const offset = parseInt(searchParams.get('offset') || '0')

  try {
    const where = status ? { status } : {}
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
