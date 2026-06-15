// GET /api/users/[userId]/chats — User chat history
// Migrated to defineRoute (G1 contract seam + G2 tenant scoping).

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
    const cases = await repo.raw.case.findMany({
      where: caseWhereForProfileKey(decoded, repo.orgId),
      select: { chatId: true, userId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    const chatMap = new Map<string, { caseCount: number; lastActivity: string }>()
    for (const c of cases) {
      const existing = chatMap.get(c.chatId || c.userId)
      if (existing) {
        existing.caseCount++
      } else {
        chatMap.set(c.chatId || c.userId, { caseCount: 1, lastActivity: c.createdAt.toISOString() })
      }
    }

    const chats = Array.from(chatMap.entries()).map(([chatId, data]) => ({ chatId, ...data }))
    return apiOk({ chats })
  },
})
