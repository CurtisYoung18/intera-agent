// GET /api/users — List user/profile keys for the selected agent.
//
// UserProfile.userId stores a profileKey ("user:<id>" or "chat:<id>").
// Profiles, counts, and recency are selected-agent scoped.
//
// Migrated to defineRoute + repoForOrg (Wave 1 G1/G2).
// Scoped to the active org via the repo Proxy.

import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import { profileKey } from '@/lib/agent/identity'
import { caseIdFilterForScope, resolveRequiredAgentCaseScope } from '../_agent-scope'
import { z } from 'zod'

const querySchema = z.object({
  agentId: z.string().optional(),
  agentConfigId: z.string().optional(),
})

export const GET = defineRoute<z.infer<typeof querySchema>>({
  method: 'GET',
  inputSchema: querySchema,
  parseQuery: true,
  handler: async ({ input, repo }) => {
    const scope = await resolveRequiredAgentCaseScope(repo, input)
    const cases = await repo.case.findMany({
      where: caseIdFilterForScope(scope),
      orderBy: { updatedAt: 'desc' as const },
      take: 500,
      select: {
        userId: true,
        chatId: true,
        type: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    const grouped = new Map<string, {
      key: string
      chatIds: Set<string>
      totalCases: number
      resolvedCases: number
      escalatedCases: number
      lastCaseType: string | null
      firstSeenAt: Date | null
      lastSeenAt: Date | null
    }>()

    for (const c of cases) {
      const key = profileKey(c.userId, c.chatId)
      if (!key) continue
      const current = grouped.get(key) ?? {
        key,
        chatIds: new Set<string>(),
        totalCases: 0,
        resolvedCases: 0,
        escalatedCases: 0,
        lastCaseType: null,
        firstSeenAt: null,
        lastSeenAt: null,
      }
      current.chatIds.add(c.chatId)
      current.totalCases += 1
      if (c.status === 'resolved' || c.status === 'completed') current.resolvedCases += 1
      if (c.status === 'escalated' || c.status === 'waiting_human') current.escalatedCases += 1
      if (!current.lastSeenAt || c.updatedAt > current.lastSeenAt) {
        current.lastSeenAt = c.updatedAt
        current.lastCaseType = c.type
      }
      if (!current.firstSeenAt || c.createdAt < current.firstSeenAt) current.firstSeenAt = c.createdAt
      grouped.set(key, current)
    }

    const keys = Array.from(grouped.keys())
    const profiles = keys.length > 0
      ? await repo.raw.userProfile.findMany({
        where: { orgId: repo.orgId, agentConfigId: scope.agentConfigId, userId: { in: keys } },
        select: { userId: true, profile: true, updatedAt: true },
      })
      : []
    const profileByKey = new Map(profiles.map((profile) => [profile.userId, profile]))

    const users = Array.from(grouped.values())
      .sort((a, b) => (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0))
      .slice(0, 200)
      .map((entry) => {
        const key = entry.key
        const p = profileByKey.get(key)
        const kind = key.startsWith('user:')
          ? 'member'
          : key.startsWith('chat:')
            ? 'anonymous'
            : 'unknown'
        const label = key.replace(/^(user:|chat:)/, '')
        return {
          userId: key,
          label,
          kind,
          totalChats: entry.chatIds.size,
          totalCases: entry.totalCases,
          resolvedCases: entry.resolvedCases,
          escalatedCases: entry.escalatedCases,
          lastCaseType: entry.lastCaseType,
          hasProfile: !!p?.profile && p.profile.trim().length > 0,
          lastSeenAt: entry.lastSeenAt?.toISOString() ?? p?.updatedAt.toISOString() ?? new Date(0).toISOString(),
          profileScope: p ? 'agent_profile' : null,
        }
      })

    return apiOk({ users, total: users.length })
  },
})
