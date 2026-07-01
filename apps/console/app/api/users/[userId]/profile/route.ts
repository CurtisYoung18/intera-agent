// GET/PUT/DELETE /api/users/[userId]/profile — User profile CRUD
// Migrated to defineRoute (G1 contract seam + G2 tenant scoping).

import { z } from 'zod'
import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import { mergeProfile } from '@intera/shared/memory/mergeProfile'
import { deleteUserProfile, getUserProfileStorageScope, readUserProfile, upsertUserProfile } from '@/lib/db/user-profiles'
import { caseIdFilterForScope, resolveRequiredAgentCaseScope } from '@/app/api/_agent-scope'

function caseWhereForProfileKey(profileKey: string, orgId: string): Record<string, unknown> {
  if (profileKey.startsWith('chat:')) return { orgId, chatId: profileKey.slice(5) }
  if (profileKey.startsWith('user:')) return { orgId, userId: profileKey.slice(5) }
  return { orgId, userId: profileKey }
}

function sectionsForEditedProfile(profile: string): string {
  if (!profile.trim()) return '{}'
  return mergeProfile('', profile, 4000).sections
}

const querySchema = z.object({
  agentId: z.string().optional(),
  agentConfigId: z.string().optional(),
})

export const GET = defineRoute<z.infer<typeof querySchema>, { userId: string }>({
  method: 'GET',
  inputSchema: querySchema,
  parseQuery: true,
  async handler({ input, params, repo }) {
    const decoded = decodeURIComponent(params.userId)
    const scope = await resolveRequiredAgentCaseScope(repo, input)
    const caseWhere = { ...caseWhereForProfileKey(decoded, repo.orgId), ...caseIdFilterForScope(scope) }
    const profileScope = await getUserProfileStorageScope(repo.raw as any).catch(() => 'legacy_org_profile' as const)

    const [cases, profile, chats] = await Promise.all([
      repo.raw.case.findMany({
        where: caseWhere,
        select: { status: true, type: true, updatedAt: true, createdAt: true },
        orderBy: { updatedAt: 'desc' },
      }),
      readUserProfile(repo.raw as any, {
        orgId: repo.orgId,
        userId: decoded,
        agentConfigId: scope.agentConfigId,
      }),
      repo.raw.case.findMany({
        where: caseWhere,
        select: { chatId: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    ])

    const totalCases = cases.length
    const resolvedCases = cases.filter(c => c.status === 'resolved').length
    const escalatedCases = cases.filter(c => c.status === 'escalated' || c.status === 'waiting_human').length
    const lastCase = cases[0]
    const firstSeenAt = cases.length > 0
      ? cases.reduce((earliest, c) => c.createdAt < earliest ? c.createdAt : earliest, cases[0].createdAt)
      : null
    const lastSeenAt = lastCase?.updatedAt?.toISOString() ?? lastCase?.createdAt?.toISOString() ?? null

    const chatIds = new Set(chats.map(c => c.chatId).filter(Boolean) as string[])

    return apiOk({
      profile: {
        userId: decoded,
        profile: profile?.profile ?? '',
        totalChats: chatIds.size,
        totalCases,
        resolvedCases,
        escalatedCases,
        lastCaseType: lastCase?.type ?? null,
        firstSeenAt: firstSeenAt?.toISOString() ?? null,
        lastSeenAt,
        updatedAt: profile?.updatedAt?.toISOString() ?? new Date().toISOString(),
        profileScope: profile ? profileScope : null,
      },
    })
  },
})

const putSchema = z.object({
  profile: z.string().optional().default(''),
  agentId: z.string().optional(),
  agentConfigId: z.string().optional(),
})

export const PUT = defineRoute<z.infer<typeof putSchema>, { userId: string }>({
  method: 'PUT',
  inputSchema: putSchema,
  requireRole: ['admin', 'owner'],
  async handler({ input, params, repo }) {
    const scope = await resolveRequiredAgentCaseScope(repo, input)
    const decoded = decodeURIComponent(params.userId)
    const profile = await upsertUserProfile(repo.raw as any, {
      orgId: repo.orgId,
      userId: decoded,
      agentConfigId: scope.agentConfigId,
      patch: { profile: input.profile, sections: sectionsForEditedProfile(input.profile) },
    })
    const profileScope = await getUserProfileStorageScope(repo.raw as any).catch(() => 'legacy_org_profile' as const)
    return apiOk({ profile, profileScope })
  },
})

export const DELETE = defineRoute<z.infer<typeof querySchema>, { userId: string }>({
  method: 'DELETE',
  requireRole: ['admin', 'owner'],
  inputSchema: querySchema,
  parseQuery: true,
  async handler({ input, params, repo }) {
    const decoded = decodeURIComponent(params.userId)
    const scope = await resolveRequiredAgentCaseScope(repo, input)
    const caseWhere = { ...caseWhereForProfileKey(decoded, repo.orgId), ...caseIdFilterForScope(scope) }
    const cases = await repo.raw.case.findMany({ where: caseWhere, select: { id: true, chatId: true } })
    const caseIds = cases.map(c => c.id)
    const chatIds = Array.from(new Set(cases.map(c => c.chatId).filter(Boolean) as string[]))
    const profileScope = await getUserProfileStorageScope(repo.raw as any).catch(() => 'legacy_org_profile' as const)

    const [deletedProfiles, , , deletedChatSessions] = await Promise.all([
      deleteUserProfile(repo.raw as any, {
        orgId: repo.orgId,
        userId: decoded,
        agentConfigId: scope.agentConfigId,
      }),
      repo.raw.case.deleteMany({ where: caseWhere }),
      caseIds.length > 0 ? repo.raw.externalConversation.deleteMany({ where: { orgId: repo.orgId, internalCaseId: { in: caseIds } } }) : Promise.resolve(),
      chatIds.length > 0
        ? repo.raw.chatSession.deleteMany({ where: { orgId: repo.orgId, chatId: { in: chatIds } } })
        : Promise.resolve({ count: 0 }),
    ])

    return apiOk({
      ok: true,
      deleted: decoded,
      deletedCases: caseIds.length,
      deletedChatSessions: deletedChatSessions?.count ?? 0,
      profileDeleted: deletedProfiles > 0,
      deletedProfiles,
      profileScope,
    })
  },
})
