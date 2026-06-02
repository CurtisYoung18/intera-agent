// GET /api/chats/[chatId]/memory — ChatMemory + UserProfile for this chat

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'
import { profileKey } from '@/lib/agent/identity'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> },
) {
  const { chatId } = await params

  try {
    const chatCases = await prisma.case.findMany({
      where: { chatId },
      select: { id: true, userId: true },
    })
    const userId = chatCases[0]?.userId
    const caseIds = chatCases.map(c => c.id)

    const memories = await prisma.chatMemory.findMany({
      where: { caseId: { in: caseIds } },
      orderBy: { updatedAt: 'desc' },
    })

    // UserProfile is keyed by a stable profileKey (user:<id> / chat:<chatId>),
    // not the raw userId — match how the agent loop & compact write it (C2).
    const key = profileKey(userId ?? undefined, chatId)
    const profile = key
      ? await prisma.userProfile.findUnique({ where: { userId: key } }).catch(() => null)
      : null

    return NextResponse.json({
      userId,
      memories: memories.map(m => ({
        caseId: m.caseId,
        summary: m.summary,
        confirmedFacts: (() => { try { return JSON.parse(m.confirmedFacts) } catch { return {} } })(),
        skillsCalled: (() => { try { return JSON.parse(m.skillsCalled) } catch { return [] } })(),
        dashboardVersion: m.dashboardVersion,
        updatedAt: m.updatedAt,
      })),
      profile,
    })
  } catch (err) {
    console.error('[API] GET chat memory:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
