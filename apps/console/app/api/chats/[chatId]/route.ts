// DELETE /api/chats/[chatId] — Removes every case in a chat session.
// Migrated to defineRoute + repoForOrg (Wave 1 G1/G2/G3).

import { z } from 'zod'
import { defineRoute, NotFoundError } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import { resolveChatAlias } from '@/lib/operate/chat-alias'
import type { RepoForOrg } from '@/lib/db/repo-for-org'
import type { ChatSession } from '@intera/shared/contracts/chats'
import { caseIdFilterForScope, resolveAgentCaseScopeForChat, requireSelectedAgentFromInput, selectedAgentFromInput } from '../_agent-scope'

const querySchema = z.object({
  agentId: z.string().optional(),
  agentConfigId: z.string().optional(),
})

type ChatDetailResponse = {
  session: ChatSession & { externalChatId?: string }
  requestedChatId: string
  resolvedChatId: string
  externalChatId?: string
}

async function buildChatSession(repo: RepoForOrg, requestedChatId: string, agentConfigId: string): Promise<ChatDetailResponse> {
  const alias = await resolveChatAlias(repo, requestedChatId)
  const chatId = alias.resolvedChatId
  const scope = await resolveAgentCaseScopeForChat(repo, agentConfigId, chatId)

  const cases = await repo.case.findMany({
    where: { chatId, ...caseIdFilterForScope(scope) },
    orderBy: { updatedAt: 'desc' as const },
    include: {
      humanTasks: { select: { id: true }, take: 1 },
      _count: { select: { messages: true } },
    },
  })

  if (cases.length === 0) {
    throw new NotFoundError('Chat not found')
  }

  const caseIds = new Set(cases.map((c) => c.id))
  const activeRuns = scope.runs.filter((run) => caseIds.has(run.caseId))
  const runByCase = new Map<string, string>()
  for (const run of activeRuns) {
    if (!runByCase.has(run.caseId)) runByCase.set(run.caseId, run.id)
  }

  const session: ChatSession & { externalChatId?: string } = {
    chatId,
    userId: cases[0]?.userId ?? '',
    externalChatId: alias.externalChatId,
    cases: cases.map((c) => ({
      id: runByCase.get(c.id) ?? c.id,
      runId: runByCase.get(c.id) ?? null,
      type: c.type,
      status: c.status,
      source: c.source,
      goal: c.goal,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      _count: c._count as { messages: number },
    })),
    messageCount: cases.reduce((sum: number, c) => sum + c._count.messages, 0),
    lastActivity: cases.reduce(
      (latest: string, c) => (c.updatedAt.toISOString() > latest ? c.updatedAt.toISOString() : latest),
      cases[0]?.updatedAt.toISOString() ?? new Date(0).toISOString(),
    ),
    hasHumanTask: cases.some((c) => c.humanTasks.length > 0),
  }

  return {
    session,
    requestedChatId,
    resolvedChatId: chatId,
    externalChatId: alias.externalChatId,
  }
}

export const GET = defineRoute<z.infer<typeof querySchema>, { chatId: string }>({
  method: 'GET',
  inputSchema: querySchema,
  parseQuery: true,
  async handler({ input, params, repo }) {
    const requestedChatId = decodeURIComponent(params.chatId)
    return apiOk(await buildChatSession(repo, requestedChatId, requireSelectedAgentFromInput(input)))
  },
})

export const DELETE = defineRoute<z.infer<typeof querySchema>, { chatId: string }>({
  method: 'DELETE',
  inputSchema: querySchema,
  parseQuery: true,
  async handler({ input, params, repo, audit }) {
    const decoded = decodeURIComponent(params.chatId)
    const alias = await resolveChatAlias(repo, decoded)
    const chatId = alias.resolvedChatId
    const scope = await resolveAgentCaseScopeForChat(repo, requireSelectedAgentFromInput(input), chatId)

    const cases = await repo.case.findMany({
      where: { chatId, ...caseIdFilterForScope(scope) },
      select: { id: true },
    })

    const caseIds: string[] = cases.map((c: { id: string }) => c.id)

    if (caseIds.length === 0) {
      throw new NotFoundError('Chat not found')
    }

    // Clean up dependents via raw prisma (belt-and-suspenders with onDelete: Cascade)
    await repo.raw.humanTask.deleteMany({ where: { orgId: repo.orgId, chatId, caseId: { in: caseIds } } })
    await repo.raw.actionTrace.deleteMany({ where: { orgId: repo.orgId, chatId, caseId: { in: caseIds } } })
    await repo.raw.message.deleteMany({ where: { orgId: repo.orgId, chatId, caseId: { in: caseIds } } })
    await repo.raw.chatMemory.deleteMany({ where: { orgId: repo.orgId, chatId, caseId: { in: caseIds } } })
    await repo.case.deleteMany({ where: { id: { in: caseIds } } })

    await audit({
      action: 'chat.delete',
      target: `chat:${chatId}`,
      before: { caseIds, requestedChatId: decoded, resolvedChatId: chatId },
    })

    return apiOk({ ok: true, deleted: caseIds.length })
  },
})
