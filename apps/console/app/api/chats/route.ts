// GET /api/chats — List chat sessions grouped by chatId
// Each "chat" is a conversation that may contain 1-N cases.
// Cases without a chatId are treated as standalone sessions.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'
import { getActiveOrgId } from '@/lib/auth'

export interface ChatSession {
  chatId: string
  userId: string
  cases: {
    id: string
    type: string
    status: string
    goal: string | null
    createdAt: string
    updatedAt: string
    _count?: { messages: number }
  }[]
  messageCount: number
  lastActivity: string
  hasHumanTask: boolean
}

export async function GET(req: NextRequest) {
  const ORG_ID = await getActiveOrgId()
  const { searchParams } = new URL(req.url)
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)
  const offset = parseInt(searchParams.get('offset') || '0')

  try {
    // Fetch all cases for this customer (ordered newest first)
    const cases = await prisma.case.findMany({
      where: { orgId: ORG_ID },
      orderBy: { updatedAt: 'desc' },
      include: {
        humanTasks: { select: { id: true }, take: 1 },
        _count: { select: { messages: true } },
      },
    })

    // Group into sessions by chatId.
    const sessionMap = new Map<string, ChatSession>()

    for (const c of cases) {
      const key = c.chatId
      if (!sessionMap.has(key)) {
        sessionMap.set(key, {
          chatId: key,
          userId: c.userId,
          cases: [],
          messageCount: 0,
          lastActivity: c.updatedAt.toISOString(),
          hasHumanTask: false,
        })
      }
      const session = sessionMap.get(key)!
      session.cases.push({
        id: c.id,
        type: c.type,
        status: c.status,
        goal: c.goal,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        _count: c._count,
      })
      session.messageCount += c._count.messages
      if (c.humanTasks.length > 0) session.hasHumanTask = true
      // Keep lastActivity as the most recent update across all cases in the session
      if (c.updatedAt.toISOString() > session.lastActivity) {
        session.lastActivity = c.updatedAt.toISOString()
      }
    }

    // Sort sessions by lastActivity descending and apply pagination
    const sorted = Array.from(sessionMap.values()).sort((a, b) =>
      b.lastActivity.localeCompare(a.lastActivity),
    )
    const total = sorted.length
    const page = sorted.slice(offset, offset + limit)

    return NextResponse.json({ sessions: page, total })
  } catch (err) {
    console.error('[API] Failed to list chats:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
