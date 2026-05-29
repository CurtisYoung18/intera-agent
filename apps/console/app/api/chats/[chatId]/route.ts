// DELETE /api/chats/[chatId]
// Removes every case that belongs to this chat session, cascading through all
// dependent tables (messages, traces, memory, human tasks).
//
// Cases without an explicit chatId were stored with chatId = case.id as the
// session key; a client that passes that key will delete just the one case.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> },
) {
  const { chatId } = await params
  const decoded = decodeURIComponent(chatId)

  try {
    // Resolve all caseIds that belong to this chat session.
    // A chatId may equal a case's own id for standalone (pre-chatId) sessions.
    const cases = await prisma.case.findMany({
      where: { chatId: decoded },
      select: { id: true },
    })

    // Fallback: if no cases found by chatId field, try treating the chatId as
    // a single caseId (backward-compat with sessions created before chatId column).
    const caseIds =
      cases.length > 0
        ? cases.map((c) => c.id)
        : await prisma.case
            .findUnique({ where: { id: decoded }, select: { id: true } })
            .then((c) => (c ? [c.id] : []))

    if (caseIds.length === 0) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    // Delete in dependency order (no cascade configured in SQLite schema).
    await prisma.humanTask.deleteMany({ where: { caseId: { in: caseIds } } })
    await prisma.actionTrace.deleteMany({ where: { caseId: { in: caseIds } } })
    await prisma.message.deleteMany({ where: { caseId: { in: caseIds } } })
    await prisma.chatMemory.deleteMany({ where: { caseId: { in: caseIds } } })
    await prisma.case.deleteMany({ where: { id: { in: caseIds } } })

    return NextResponse.json({ ok: true, deleted: caseIds.length })
  } catch (err) {
    console.error('[API] Failed to delete chat:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
