// GET /api/chats/[chatId]/traces — Traces for a chat (by chatId + linked cases)

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> },
) {
  const { chatId } = await params
  const { searchParams } = new URL(req.url)
  const limit = Math.min(parseInt(searchParams.get('limit') || '200'), 500)
  const actionType = searchParams.get('actionType')

  try {
    // Find case IDs linked to this chat for traces that don't yet have chatId set
    const linkedCases = await prisma.case.findMany({
      where: { chatId },
      select: { id: true },
    })
    const caseIds = linkedCases.map((c) => c.id)

    const where: Record<string, unknown> = {
      OR: [
        { chatId },
        ...(caseIds.length > 0 ? [{ caseId: { in: caseIds } }] : []),
      ],
    }
    if (actionType) where.actionType = actionType

    const [traces, total] = await Promise.all([
      prisma.actionTrace.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: parseInt(searchParams.get('offset') || '0'),
      }),
      prisma.actionTrace.count({ where }),
    ])

    return NextResponse.json({ traces: traces.slice(0, limit), total })
  } catch (err) {
    console.error('[API] Failed to list chat traces:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
