// POST /api/chats/[chatId]/compact — Manually trigger chat memory compaction

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'
import { compactConversation } from '@/../chat/lib/agent/compact'
import { DEFAULT_MEMORY_STRATEGY } from '@intera/shared/defaults'
import { mergeProfile } from '@intera/shared/memory/mergeProfile'
import { recomputeProfileStats } from '@intera/shared/memory/recomputeStats'
import { profileKey } from '@/../chat/lib/agent/identity'

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
    // The [chatId] param is either a real Case.chatId OR a standalone case.id
    // (chats are keyed by `chatId ?? id` in /api/chats). Resolve both, else
    // cases without a persisted chatId never match and compact finds nothing.
    const caseIds = await prisma.case.findMany({
      where: { OR: [{ chatId }, { id: chatId }] },
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

    // M2: load vendor-specific memoryStrategy
    const sampleCase = await prisma.case.findFirst({
      where: { OR: [{ chatId }, { id: chatId }] },
      select: { userId: true, vendorId: true },
    })
    const vendorId = sampleCase?.vendorId ?? 'default'
    const agentCfg = await prisma.agentConfig.findUnique({ where: { vendorId } }).catch(() => null)
    const strategy = parseMemoryStrategy(agentCfg?.memoryStrategy) ?? DEFAULT_MEMORY_STRATEGY

    const apiMessages = messages
      .filter(m => typeof m.content === 'string' && m.content.trim().length > 0)
      .map(m => ({
        role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.content,
      }))

    const result = await compactConversation(apiMessages as any, strategy)
    const summary = result.summary || 'Compaction produced no summary.'

    // H1 + C2: merge profile (not overwrite) with identity isolation
    const key = profileKey(sampleCase?.userId, chatId)
    if (key) {
      const existing = await prisma.userProfile.findUnique({ where: { userId: key }, select: { profile: true } }).catch(() => null)
      const maxTokens = strategy.chatMemoryMaxTokens ?? 4000
      const merged = mergeProfile(existing?.profile ?? '', summary, maxTokens)
      const stats = await recomputeProfileStats(prisma, key)
      await prisma.userProfile.upsert({
        where: { userId: key },
        create: { userId: key, profile: merged, ...stats },
        update: { profile: merged, ...stats },
      })
    }

    // M3: use char length for now (token estimation would need the model)
    const beforeTokens = apiMessages.reduce((sum, m) => sum + m.content.length, 0)
    const afterTokens = summary.length

    return NextResponse.json({
      summary,
      beforeChars: beforeTokens,
      afterChars: afterTokens,
      compactModel: result.model,
      compactedAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[API] POST chat compact:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
