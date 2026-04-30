// GET /api/cases/[id] — Case detail with memory, tasks, and message count

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  try {
    const c = await prisma.case.findUnique({
      where: { id },
      include: {
        memory: true,
        humanTasks: { orderBy: { createdAt: 'desc' } },
        _count: { select: { messages: true, traces: true } },
      },
    })

    if (!c) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    return NextResponse.json({ case: c })
  } catch (err) {
    console.error('[API] Failed to get case:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
