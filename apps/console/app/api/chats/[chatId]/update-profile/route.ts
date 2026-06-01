// POST /api/chats/[chatId]/update-profile
// Merges this chat's compact summaries into the User Profile (cross-chat accumulation).
// Separate from "Compact Chat" so operators can control when profile knowledge is updated.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@intera/shared/prisma'
import { mergeProfile } from '@intera/shared/memory/mergeProfile'
import { recomputeProfileStats } from '@intera/shared/memory/recomputeStats'
import { profileKey } from '@/../chat/lib/agent/identity'
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
    const sampleCase = await prisma.case.findFirst({
      where: { chatId },
      select: { userId: true, orgId: true },
    })

    const key = profileKey(sampleCase?.userId, chatId)
    if (!key) {
      return NextResponse.json({ error: 'No stable user identity for this chat — cannot update User Profile.' }, { status: 422 })
    }

    // Collect summaries from all ChatMemory records in this chat
    const caseIds = await prisma.case.findMany({
      where: { chatId },
      select: { id: true },
    })
    const memories = await prisma.chatMemory.findMany({
      where: { caseId: { in: caseIds.map(c => c.id) }, summary: { not: null } },
      select: { summary: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    })

    if (memories.length === 0) {
      return NextResponse.json({ error: 'No compacted chat summaries found. Run "Compact Chat" first.' }, { status: 400 })
    }

    const combinedSummary = memories
      .map(m => m.summary!)
      .join('\n\n---\n\n')

    const orgId = sampleCase?.orgId ?? 'default'
    const agentCfg = await prisma.agentConfig.findUnique({ where: { orgId } }).catch(() => null)
    const strategy = parseMemoryStrategy(agentCfg?.memoryStrategy) ?? DEFAULT_MEMORY_STRATEGY
    const maxTokens = (strategy as Record<string, unknown>).chatMemoryMaxTokens as number ?? 4000

    const existing = await prisma.userProfile.findUnique({ where: { userId: key }, select: { profile: true } }).catch(() => null)
    const merged = mergeProfile(existing?.profile ?? '', combinedSummary, maxTokens)
    const stats = await recomputeProfileStats(prisma, key)

    await prisma.userProfile.upsert({
      where: { userId: key },
      create: { userId: key, profile: merged, ...stats },
      update: { profile: merged, ...stats },
    })

    return NextResponse.json({
      ok: true,
      profileKey: key,
      memoriesMerged: memories.length,
      profileLength: merged.length,
      updatedAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[API] POST update-profile:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
