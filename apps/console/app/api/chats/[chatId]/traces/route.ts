// GET /api/chats/[chatId]/traces — Traces for a chat (across all cases)

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> },
) {
  const { chatId } = await params
  const { searchParams } = new URL(req.url)
  const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500)
  const offset = parseInt(searchParams.get('offset') || '0')
  const actionType = searchParams.get('actionType')

  try {
    const where: Record<string, unknown> = { chatId }
    if (actionType) where.actionType = actionType

    const [traces, total] = await Promise.all([
      prisma.actionTrace.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.actionTrace.count({ where }),
    ])

    return NextResponse.json({ traces, total })
  } catch (err) {
    console.error('[API] Failed to list chat traces:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
