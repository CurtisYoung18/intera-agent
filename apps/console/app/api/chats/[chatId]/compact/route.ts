// POST /api/chats/[chatId]/compact — Manually trigger chat memory compaction

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'
import { compactConversation } from '@/../chat/lib/agent/compact'
import { DEFAULT_MEMORY_STRATEGY } from '@intera/shared/defaults'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> },
) {
  const { chatId } = await params

  try {
    // Load all messages for this chat
    const caseIds = await prisma.case.findMany({
      where: { chatId },
      select: { id: true },
    })
    const messages = await prisma.message.findMany({
      where: { caseId: { in: caseIds.map(c => c.id) } },
      orderBy: { createdAt: 'asc' },
      take: 100,
    })

    if (messages.length === 0) {
      return NextResponse.json({ error: 'No messages to compact' }, { status: 400 })
    }

    const apiMessages = messages
      .filter(m => typeof m.content === 'string' && m.content.trim().length > 0)
      .map(m => ({
        role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.content,
      }))

    const beforeTokens = apiMessages.reduce((sum, m) => sum + m.content.length, 0)

    const result = await compactConversation(
      apiMessages as any,
      DEFAULT_MEMORY_STRATEGY as any,
    )

    const summary = result.summary || 'Compaction produced no summary.'

    // Find userId from this chat's cases
    const sampleCase = await prisma.case.findFirst({
      where: { chatId },
      select: { userId: true },
    })
    const userId = sampleCase?.userId

    // Upsert UserProfile
    if (userId) {
      await prisma.userProfile.upsert({
        where: { userId },
        create: {
          userId,
          profile: `## Chat Memory (compacted ${new Date().toISOString()})\n\n${summary}`,
          totalCases: caseIds.length,
          lastSeenAt: new Date(),
        },
        update: {
          profile: summary,
          totalCases: caseIds.length,
          lastSeenAt: new Date(),
        },
      })
    }

    const afterTokens = summary.length

    return NextResponse.json({
      summary,
      beforeTokens,
      afterTokens,
      compactModel: result.model,
      compactedAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[API] POST chat compact:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
