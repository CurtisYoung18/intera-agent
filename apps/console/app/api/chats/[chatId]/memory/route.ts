// GET /api/chats/[chatId]/memory — ChatMemory + UserProfile for this chat

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> },
) {
  const { chatId } = await params

  try {
    // Find the userId for this chat from cases
    const sampleCase = await prisma.case.findFirst({
      where: { chatId },
      select: { userId: true },
    })
    const userId = sampleCase?.userId

    // Get ChatMemory for cases in this chat
    const caseIds = await prisma.case.findMany({
      where: { chatId },
      select: { id: true },
    })
    const memories = await prisma.chatMemory.findMany({
      where: { caseId: { in: caseIds.map(c => c.id) } },
      orderBy: { updatedAt: 'desc' },
    })

    // Get UserProfile
    const profile = userId
      ? await prisma.userProfile.findUnique({ where: { userId } }).catch(() => null)
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
