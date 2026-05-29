// GET /api/users/[userId]/chats

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params
  try {
    const cases = await prisma.case.findMany({
      where: { userId },
      select: { chatId: true, userId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    const chatMap = new Map<string, { caseCount: number; lastActivity: string }>()
    for (const c of cases) {
      const existing = chatMap.get(c.chatId || c.userId)
      if (existing) {
        existing.caseCount++
      } else {
        chatMap.set(c.chatId || c.userId, { caseCount: 1, lastActivity: c.createdAt.toISOString() })
      }
    }

    const chats = Array.from(chatMap.entries()).map(([chatId, data]) => ({
      chatId,
      ...data,
    }))

    return NextResponse.json({ chats })
  } catch (err) {
    console.error('[API] GET user chats:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
