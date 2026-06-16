// POST /api/chats/[chatId]/update-profile — Merge chat summaries into User Profile
// Migrated to defineRoute (G1 contract seam + G2 tenant scoping).

import { z } from 'zod'
import { defineRoute, RouteError } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import { mergeProfile } from '@intera/shared/memory/mergeProfile'
import { recomputeProfileStats } from '@intera/shared/memory/recomputeStats'
import { profileKey } from '@/lib/agent/identity'
import { DEFAULT_MEMORY_STRATEGY } from '@intera/shared/defaults'
import { caseIdFilterForScope, childCaseIdFilterForScope, resolveRequiredAgentCaseScope, requireSelectedAgentFromInput } from '../../_agent-scope'

function parseMemoryStrategy(raw: unknown) {
  try {
    if (typeof raw === 'string') return JSON.parse(raw)
    if (raw && typeof raw === 'object') return raw
  } catch { /* ignore */ }
  return null
}

const querySchema = z.object({
  agentId: z.string().optional(),
  agentConfigId: z.string().optional(),
})

export const POST = defineRoute<z.infer<typeof querySchema>, { chatId: string }>({
  method: 'POST',
  requireRole: ['admin', 'owner'],
  inputSchema: querySchema,
  parseQuery: true,
  async handler({ input, params, repo }) {
    const agentConfigId = requireSelectedAgentFromInput(input)
    const scope = await resolveRequiredAgentCaseScope(repo, input)
    const sampleCase = await repo.raw.case.findFirst({
      where: { orgId: repo.orgId, chatId: params.chatId, ...caseIdFilterForScope(scope) },
      select: { userId: true, orgId: true },
    })

    const key = profileKey(sampleCase?.userId, params.chatId)
    if (!key) throw new RouteError('validation', 'No stable user identity for this chat — cannot update User Profile.', undefined, 422)

    const memories = await repo.raw.chatMemory.findMany({
      where: { orgId: repo.orgId, chatId: params.chatId, ...childCaseIdFilterForScope(scope), summary: { not: null } },
      select: { summary: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    })
    if (memories.length === 0) throw new RouteError('validation', 'No compacted chat summaries found. Run "Compact Chat" first.')

    const combinedSummary = memories.map(m => m.summary!).join('\n\n---\n\n')

    const orgId = sampleCase?.orgId ?? 'default'
    const agentCfg = await repo.raw.agentConfig.findUnique({ where: { id: agentConfigId } }).catch(() => null)
    const strategy = parseMemoryStrategy(agentCfg?.memoryStrategy) ?? DEFAULT_MEMORY_STRATEGY
    const maxTokens = (strategy as Record<string, unknown>).chatMemoryMaxTokens as number ?? 4000

    const existing = await repo.raw.userProfile.findUnique({
      where: { orgId_userId: { orgId: repo.orgId, userId: key } },
      select: { profile: true },
    }).catch(() => null)
    const { profile: merged, sections } = mergeProfile(existing?.profile ?? '', combinedSummary, maxTokens)
    const stats = await recomputeProfileStats(repo.raw, key, repo.orgId)

    await repo.raw.userProfile.upsert({
      where: { orgId_userId: { orgId: repo.orgId, userId: key } },
      create: { userId: key, orgId: repo.orgId, profile: merged, sections, ...stats },
      update: { profile: merged, sections, ...stats },
    })

    return apiOk({ ok: true, profileKey: key, memoriesMerged: memories.length, profileLength: merged.length, updatedAt: new Date().toISOString() })
  },
})
