// POST /api/chats/[chatId]/compact — Manually trigger chat memory compaction.
//
// Compact runs inline in the Console process — no separate chat-app proxy needed.
// The LLM provider keys are configured per-model via provider-config.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'
import { compactConversation } from '@/lib/agent/compact'
import { DEFAULT_MEMORY_STRATEGY } from '@intera/shared/defaults'

function parseMemoryStrategy(raw: unknown) {
  try {
    if (typeof raw === 'string') return JSON.parse(raw)
    if (raw && typeof raw === 'object') return raw
  } catch { /* ignore */ }
  return null
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> },
) {
  const { chatId } = await params

  try {
    const cases = await prisma.case.findMany({
      where: { chatId },
      select: { id: true, userId: true, orgId: true },
    })
    if (cases.length === 0) {
      return NextResponse.json({ error: 'No cases found for this chat' }, { status: 404 })
    }
    const caseIds = cases.map(c => c.id)

    const messages = await prisma.message.findMany({
      where: { caseId: { in: caseIds } },
      orderBy: { createdAt: 'asc' },
      take: 100,
    })
    if (messages.length === 0) {
      return NextResponse.json({ error: 'No messages to compact' }, { status: 400 })
    }

    const orgId = cases[0]?.orgId ?? 'default'
    const agentCfg = await prisma.agentConfig.findFirst({ where: { orgId, isActive: true } }).catch(() => null)
    const strategy = parseMemoryStrategy(agentCfg?.memoryStrategy) ?? DEFAULT_MEMORY_STRATEGY

    const apiMessages = messages
      .filter(m => typeof m.content === 'string' && m.content.trim().length > 0)
      .map(m => ({
        id: m.id,
        role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.content,
        createdAt: m.createdAt,
      }))

    const beforeTokens = apiMessages.reduce((sum, m) => sum + m.content.length, 0)

    const result = await compactConversation(apiMessages as never, strategy as never)

    if (!result.summary) {
      return NextResponse.json({
        error: result.error || 'Compaction produced no summary',
        compactModel: result.model,
        beforeTokens,
        afterTokens: 0,
      }, { status: 200 })
    }

    const summary = result.summary
    // Save the summary to ChatMemory.summary for each case in this chat.
    await Promise.allSettled(
      caseIds.map(caseId =>
        prisma.chatMemory.upsert({
          where: { caseId },
          create: {
            caseId, summary,
            confirmedFacts: '{}', missingFacts: '[]', skillsCalled: '[]',
            skillResults: '{}', keyEvents: '[]', humanTaskStatus: 'none',
          },
          update: { summary },
        }),
      ),
    )

    return NextResponse.json({
      summary,
      beforeTokens,
      afterTokens: summary.length,
      compactModel: result.model,
      compactedAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[api] POST chat compact:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 })
  }
}
