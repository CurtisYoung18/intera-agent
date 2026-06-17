// POST /api/chats/[chatId]/compact — Manually trigger chat memory compaction
// Migrated to defineRoute (G1 contract seam + G2 tenant scoping).

import { z } from 'zod'
import { defineRoute, RouteError } from '@/lib/api/define-route'
import { apiOk } from '@intera/shared/contracts/envelope'
import { compactConversation } from '@/lib/agent/compact'
import { DEFAULT_MEMORY_STRATEGY } from '@intera/shared/defaults'
import { caseIdFilterForScope, childCaseIdFilterForScope, resolveRequiredAgentCaseScope, requireSelectedAgentFromInput } from '../../_agent-scope'

function parseMemoryStrategy(raw: unknown) {
  try {
    if (typeof raw === 'string') return JSON.parse(raw)
    if (raw && typeof raw === 'object') return raw
  } catch { /* ignore */ }
  return null
}

const querySchema = z.object({
  agentId: z.string().optional(),
  agentConfigId: z.string().optional(),
})

export const POST = defineRoute<z.infer<typeof querySchema>, { chatId: string }>({
  method: 'POST',
  requireRole: ['admin', 'owner'],
  inputSchema: querySchema,
  parseQuery: true,
  async handler({ input, params, repo }) {
    const agentConfigId = requireSelectedAgentFromInput(input)
    const scope = await resolveRequiredAgentCaseScope(repo, input)
    const cases = await repo.raw.case.findMany({
      where: { orgId: repo.orgId, chatId: params.chatId, ...caseIdFilterForScope(scope) },
      select: { id: true, userId: true, orgId: true },
    })
    if (cases.length === 0) throw new RouteError('not_found', 'No cases found for this chat')

    const caseIds = cases.map(c => c.id)

    const messages = await repo.raw.message.findMany({
      where: { orgId: repo.orgId, chatId: params.chatId, ...childCaseIdFilterForScope(scope) },
      orderBy: { createdAt: 'asc' },
      take: 100,
    })
    if (messages.length === 0) throw new RouteError('validation', 'No messages to compact')

    const orgId = cases[0]?.orgId ?? 'default'
    const agentCfg = agentConfigId
      ? await repo.raw.agentConfig.findUnique({ where: { id: agentConfigId } }).catch(() => null)
      : await repo.raw.agentConfig.findFirst({ where: { orgId, isActive: true } }).catch(() => null)
    const strategy = parseMemoryStrategy(agentCfg?.memoryStrategy) ?? DEFAULT_MEMORY_STRATEGY

    const apiMessages = messages
      .filter(m => typeof m.content === 'string' && m.content.trim().length > 0)
      .map(m => ({
        id: m.id,
        role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.content,
        createdAt: m.createdAt,
      }))

    const beforeChars = apiMessages.reduce((sum, m) => sum + m.content.length, 0)
    const result = await compactConversation(apiMessages as never, strategy as never)

    if (!result.summary) {
      return apiOk({ error: result.error || 'Compaction produced no summary', compactModel: result.model, beforeChars, afterChars: 0 })
    }

    const summary = result.summary
    const activeRuns = await repo.raw.procedureRun.findMany({
      where: {
        orgId: repo.orgId,
        chatId: params.chatId,
        caseId: { in: caseIds },
        agentConfigId,
        status: { in: ['active', 'paused'] },
      },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, caseId: true },
    })
    const runByCase = new Map<string, string>()
    for (const run of activeRuns) {
      if (!runByCase.has(run.caseId)) runByCase.set(run.caseId, run.id)
    }
    await Promise.allSettled(
      caseIds.map(caseId =>
        repo.raw.chatMemory.upsert({
          where: { caseId },
          create: {
            caseId,
            orgId: repo.orgId,
            chatId: params.chatId,
            runId: runByCase.get(caseId) ?? null,
            summary,
            contextMap: '{}',
            missingFacts: '[]',
            toolsCalled: '[]',
            toolResults: '{}',
            keyEvents: '[]',
            humanTaskStatus: 'none',
          },
          update: { orgId: repo.orgId, chatId: params.chatId, runId: runByCase.get(caseId) ?? null, summary },
        }),
      ),
    )

    return apiOk({ summary, beforeChars, afterChars: summary.length, compactModel: result.model, compactedAt: new Date().toISOString() })
  },
})
