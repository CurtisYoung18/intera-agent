// GET /api/chats/[chatId]/memory — ChatMemory + UserProfile for this chat
// Migrated to defineRoute (G1 contract seam + G2 tenant scoping).

import { z } from 'zod'
import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import { profileKey } from '@/lib/agent/identity'
import { caseIdFilterForScope, childCaseIdFilterForScope, resolveRequiredAgentCaseScope } from '../../_agent-scope'

const querySchema = z.object({
  agentId: z.string().optional(),
  agentConfigId: z.string().optional(),
})

export const GET = defineRoute<z.infer<typeof querySchema>, { chatId: string }>({
  method: 'GET',
  inputSchema: querySchema,
  parseQuery: true,
  async handler({ input, params, repo }) {
    const scope = await resolveRequiredAgentCaseScope(repo, input)
    const chatCases = await repo.raw.case.findMany({
      where: { orgId: repo.orgId, chatId: params.chatId, ...caseIdFilterForScope(scope) },
      select: { userId: true },
    })
    const userId = chatCases[0]?.userId

    const memories = await repo.raw.chatMemory.findMany({
      where: { orgId: repo.orgId, chatId: params.chatId, ...childCaseIdFilterForScope(scope) },
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
        keyEvents: (() => { try { return JSON.parse(m.keyEvents) } catch { return [] } })(),
        toolsCalled: (() => { try { return JSON.parse(m.toolsCalled) } catch { return [] } })(),
        missingFacts: (() => { try { return JSON.parse(m.missingFacts) } catch { return [] } })(),
        updatedAt: m.updatedAt,
      })),
      profile,
      profileScope: profile ? 'legacy_org_profile' : null,
    })
  },
})
