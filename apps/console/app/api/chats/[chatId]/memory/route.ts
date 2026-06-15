// GET /api/chats/[chatId]/memory — ChatMemory + UserProfile for this chat
// Migrated to defineRoute (G1 contract seam + G2 tenant scoping).

import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import { profileKey } from '@/lib/agent/identity'

export const GET = defineRoute<void, { chatId: string }>({
  method: 'GET',
  async handler({ params, repo }) {
    const chatCases = await repo.raw.case.findMany({
      where: { orgId: repo.orgId, chatId: params.chatId },
      select: { userId: true },
    })
    const userId = chatCases[0]?.userId

    const memories = await repo.raw.chatMemory.findMany({
      where: { orgId: repo.orgId, chatId: params.chatId },
      orderBy: { updatedAt: 'desc' },
    })

    const key = profileKey(userId ?? undefined, params.chatId)
    const profile = key
      ? await repo.raw.userProfile.findUnique({
          where: { orgId_userId: { orgId: repo.orgId, userId: key } },
        }).catch(() => null)
      : null

    return apiOk({
      userId,
      memories: memories.map(m => ({
        runId: m.runId,
        summary: m.summary,
        confirmedFacts: (() => { try { return JSON.parse(m.confirmedFacts) } catch { return {} } })(),
        toolsCalled: (() => { try { return JSON.parse(m.toolsCalled) } catch { return [] } })(),
        updatedAt: m.updatedAt,
      })),
      profile,
    })
  },
})
