// GET/PUT/DELETE /api/users/[userId]/profile — User profile CRUD
// Migrated to defineRoute (G1 contract seam + G2 tenant scoping).

import { z } from 'zod'
import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'

function caseWhereForProfileKey(profileKey: string, orgId: string): Record<string, unknown> {
  if (profileKey.startsWith('chat:')) return { orgId, chatId: profileKey.slice(5) }
  if (profileKey.startsWith('user:')) return { orgId, userId: profileKey.slice(5) }
  return { orgId, userId: profileKey }
}

export const GET = defineRoute<void, { userId: string }>({
  method: 'GET',
  async handler({ params, repo }) {
    const decoded = decodeURIComponent(params.userId)
    const caseWhere = caseWhereForProfileKey(decoded, repo.orgId)

    const [cases, profile, chats] = await Promise.all([
      repo.raw.case.findMany({
        where: caseWhere,
        select: { status: true, type: true, updatedAt: true, createdAt: true },
        orderBy: { updatedAt: 'desc' },
      }),
      repo.raw.userProfile.findUnique({ where: { orgId_userId: { orgId: repo.orgId, userId: decoded } } }),
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
      },
    })
  },
})

const putSchema = z.object({ profile: z.string().optional().default('') })

export const PUT = defineRoute<z.infer<typeof putSchema>, { userId: string }>({
  method: 'PUT',
  inputSchema: putSchema,
  requireRole: ['admin', 'owner'],
  async handler({ input, params, repo }) {
    const decoded = decodeURIComponent(params.userId)
    const profile = await repo.raw.userProfile.upsert({
      where: { orgId_userId: { orgId: repo.orgId, userId: decoded } },
      create: { userId: decoded, orgId: repo.orgId, profile: input.profile },
      update: { profile: input.profile },
    })
    return apiOk({ profile })
  },
})

export const DELETE = defineRoute<void, { userId: string }>({
  method: 'DELETE',
  requireRole: ['admin', 'owner'],
  async handler({ params, repo }) {
    const decoded = decodeURIComponent(params.userId)
    const caseWhere = caseWhereForProfileKey(decoded, repo.orgId)
    const caseIds = (await repo.raw.case.findMany({ where: caseWhere, select: { id: true } })).map(c => c.id)

    await Promise.all([
      repo.raw.case.deleteMany({ where: caseWhere }),
      caseIds.length > 0 ? repo.raw.externalConversation.deleteMany({ where: { orgId: repo.orgId, internalCaseId: { in: caseIds } } }) : Promise.resolve(),
      repo.raw.userProfile.deleteMany({ where: { orgId: repo.orgId, userId: decoded } }),
    ])

    return apiOk({ ok: true, deleted: decoded })
  },
})
