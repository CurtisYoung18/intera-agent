// POST /api/chats/[chatId]/update-profile — Merge chat summaries into User Profile
// Migrated to defineRoute (G1 contract seam + G2 tenant scoping).

import { defineRoute, RouteError } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import { mergeProfile } from '@intera/shared/memory/mergeProfile'
import { recomputeProfileStats } from '@intera/shared/memory/recomputeStats'
import { profileKey } from '@/lib/agent/identity'
import { DEFAULT_MEMORY_STRATEGY } from '@intera/shared/defaults'

function parseMemoryStrategy(raw: unknown) {
  try {
    if (typeof raw === 'string') return JSON.parse(raw)
    if (raw && typeof raw === 'object') return raw
  } catch { /* ignore */ }
  return null
}

export const POST = defineRoute<void, { chatId: string }>({
  method: 'POST',
  requireRole: ['admin', 'owner'],
  async handler({ params, repo }) {
    const sampleCase = await repo.raw.case.findFirst({
      where: { chatId: params.chatId },
      select: { userId: true, orgId: true },
    })

    const key = profileKey(sampleCase?.userId, params.chatId)
    if (!key) throw new RouteError('validation', 'No stable user identity for this chat — cannot update User Profile.', undefined, 422)

    const caseIds = await repo.raw.case.findMany({
      where: { chatId: params.chatId },
      select: { id: true },
    })
    const memories = await repo.raw.chatMemory.findMany({
      where: { caseId: { in: caseIds.map(c => c.id) }, summary: { not: null } },
      select: { summary: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    })
    if (memories.length === 0) throw new RouteError('validation', 'No compacted chat summaries found. Run "Compact Chat" first.')

    const combinedSummary = memories.map(m => m.summary!).join('\n\n---\n\n')

    const orgId = sampleCase?.orgId ?? 'default'
    const agentCfg = await repo.raw.agentConfig.findFirst({ where: { orgId, isActive: true } }).catch(() => null)
    const strategy = parseMemoryStrategy(agentCfg?.memoryStrategy) ?? DEFAULT_MEMORY_STRATEGY
    const maxTokens = (strategy as Record<string, unknown>).chatMemoryMaxTokens as number ?? 4000

    const existing = await repo.raw.userProfile.findUnique({ where: { userId: key }, select: { profile: true } }).catch(() => null)
    const { profile: merged, sections } = mergeProfile(existing?.profile ?? '', combinedSummary, maxTokens)
    const stats = await recomputeProfileStats(repo.raw, key)

    await repo.raw.userProfile.upsert({
      where: { userId: key },
      create: { userId: key, profile: merged, sections, ...stats },
      update: { profile: merged, sections, ...stats },
    })

    return apiOk({ ok: true, profileKey: key, memoriesMerged: memories.length, profileLength: merged.length, updatedAt: new Date().toISOString() })
  },
})
