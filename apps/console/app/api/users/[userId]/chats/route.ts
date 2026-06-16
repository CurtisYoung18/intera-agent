// GET /api/users/[userId]/chats — User chat history
// Migrated to defineRoute (G1 contract seam + G2 tenant scoping).

import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import { caseIdFilterForScope, resolveRequiredAgentCaseScope } from '@/app/api/_agent-scope'
import { z } from 'zod'

const querySchema = z.object({
  agentId: z.string().optional(),
  agentConfigId: z.string().optional(),
})

function caseWhereForProfileKey(profileKey: string, orgId: string): Record<string, unknown> {
  if (profileKey.startsWith('chat:')) return { orgId, chatId: profileKey.slice(5) }
  if (profileKey.startsWith('user:')) return { orgId, userId: profileKey.slice(5) }
  return { orgId, userId: profileKey }
}

export const GET = defineRoute<z.infer<typeof querySchema>, { userId: string }>({
  method: 'GET',
  inputSchema: querySchema,
  parseQuery: true,
  async handler({ input, params, repo }) {
    const decoded = decodeURIComponent(params.userId)
    const scope = await resolveRequiredAgentCaseScope(repo, input)
    const cases = await repo.raw.case.findMany({
      where: { ...caseWhereForProfileKey(decoded, repo.orgId), ...caseIdFilterForScope(scope) },
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
