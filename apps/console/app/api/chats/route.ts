// GET /api/chats — List chat sessions grouped by chatId.
//
// Each "chat" is a conversation that may contain 1-N cases.
// Cases without a chatId are treated as standalone sessions.
//
// Migrated to defineRoute + repoForOrg (Wave 1 G1/G2).
// orgId is auto-injected by the repo Proxy.

import { defineRoute } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import { ChatsListInput, type ChatSession } from '@intera/shared/contracts/chats'

export const GET = defineRoute({
  method: 'GET',
  inputSchema: ChatsListInput,
  handler: async ({ input, repo }) => {
    const { limit, offset } = input

    // Fetch all cases for this org (repo injects orgId).
    const cases = await repo.case.findMany({
      orderBy: { updatedAt: 'desc' as const },
      include: {
        humanTasks: { select: { id: true }, take: 1 },
        _count: { select: { messages: true } },
      },
    })
    const activeRuns = await repo.raw.procedureRun.findMany({
      where: { orgId: repo.orgId, caseId: { in: cases.map((c) => c.id) } },
      orderBy: { updatedAt: 'desc' as const },
      select: { id: true, caseId: true },
    })
    const runByCase = new Map<string, string>()
    for (const run of activeRuns) {
      if (!runByCase.has(run.caseId)) runByCase.set(run.caseId, run.id)
    }

    // Group into sessions by chatId.
    const sessionMap = new Map<string, ChatSession>()

    for (const c of cases) {
      const key = c.chatId
      if (!sessionMap.has(key)) {
        sessionMap.set(key, {
          chatId: key,
          userId: c.userId,
          cases: [],
          messageCount: 0,
          lastActivity: c.updatedAt.toISOString(),
          hasHumanTask: false,
        })
      }
      const session = sessionMap.get(key)!
      const runId = runByCase.get(c.id) ?? null
      session.cases.push({
        id: runId ?? c.id,
        runId,
        type: c.type,
        status: c.status,
        source: c.source,
        goal: c.goal,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        _count: c._count as { messages: number },
      })
      session.messageCount += c._count.messages
      if (c.humanTasks.length > 0) session.hasHumanTask = true
      if (c.updatedAt.toISOString() > session.lastActivity) {
        session.lastActivity = c.updatedAt.toISOString()
      }
    }

    // Sort sessions by lastActivity descending, then paginate.
    const sorted = Array.from(sessionMap.values()).sort((a, b) =>
      b.lastActivity.localeCompare(a.lastActivity),
    )
    const total = sorted.length
    const page = sorted.slice(offset, offset + limit)

    return apiOk({ sessions: page, total })
  },
})
