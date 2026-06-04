// GET /api/users — List users with accumulated UserProfile records.
//
// UserProfile.userId stores a profileKey ("user:<id>" or "chat:<id>"); we
// strip the prefix for display.
//
// Migrated to defineRoute + repoForOrg (Wave 1 G1/G2).
// Scoped to the active org via the repo Proxy.

import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'

export const GET = defineRoute({
  method: 'GET',
  handler: async ({ repo }) => {
    const profiles = await repo.userProfile.findMany({
      orderBy: { updatedAt: 'desc' as const },
      take: 200,
    })

    const users = profiles.map((p) => {
      const key = p.userId
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
        totalChats: p.totalChats,
        totalCases: p.totalCases,
        resolvedCases: p.resolvedCases,
        escalatedCases: p.escalatedCases,
        lastCaseType: p.lastCaseType,
        hasProfile: !!p.profile && p.profile.trim().length > 0,
        lastSeenAt: p.lastSeenAt?.toISOString() ?? p.updatedAt.toISOString(),
      }
    })

    return apiOk({ users, total: users.length })
  },
})
