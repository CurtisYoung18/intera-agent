// GET /api/chats/[chatId]/memory — ChatMemory + UserProfile for this chat
// Migrated to defineRoute (G1 contract seam + G2 tenant scoping).

import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import { profileKey } from '@/lib/agent/identity'

export const GET = defineRoute<void, { chatId: string }>({
  method: 'GET',
  async handler({ params, repo }) {
    const chatCases = await repo.raw.case.findMany({
      where: { chatId: params.chatId },
      select: { id: true, userId: true },
    })
    const userId = chatCases[0]?.userId
    const caseIds = chatCases.map(c => c.id)

    const memories = await repo.raw.chatMemory.findMany({
      where: { caseId: { in: caseIds } },
      orderBy: { updatedAt: 'desc' },
    })

    const key = profileKey(userId ?? undefined, params.chatId)
    const profile = key
      ? await repo.raw.userProfile.findUnique({ where: { userId: key } }).catch(() => null)
      : null

    return apiOk({
      userId,
      memories: memories.map(m => ({
        caseId: m.caseId,
        summary: m.summary,
        confirmedFacts: (() => { try { return JSON.parse(m.confirmedFacts) } catch { return {} } })(),
        skillsCalled: (() => { try { return JSON.parse(m.skillsCalled) } catch { return [] } })(),
        dashboardVersion: m.dashboardVersion,
        updatedAt: m.updatedAt,
      })),
      profile,
    })
  },
})
