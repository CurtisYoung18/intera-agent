// POST /api/coordinate — Multi-case coordinator: reads latest CaseMemory per caseId, streams one synthesis.

import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createAgentClient } from '@/lib/agent/api/provider-config'
import { prisma } from '@intera/shared/prisma'
import { resolveOrgFromApiKey, isTrustedInternalCall } from '@/lib/api-auth'
import type { SSEEvent, AgentConfigData } from '@intera/shared/types'
import {
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_MEMORY_STRATEGY,
  DEFAULT_POLICY_HOOKS,
} from '@intera/shared/defaults'
import { getCachedConfig, setCachedConfig } from '@/lib/agent/config-cache'

const DEFAULT_AGENT_CONFIG: AgentConfigData = {
  model: 'MiniMax-M2.7-highspeed',
  temperature: 0.5,
  thinkingBudget: 4096,
  maxIterations: 20,
  maxOutputTokens: 4096,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  showThinking: false,
  memoryStrategy: { ...DEFAULT_MEMORY_STRATEGY },
  policyHooks: { ...DEFAULT_POLICY_HOOKS },
  resumePrompt: '',
  formResponseTemplate: '',
  prefixContinuationEnabled: false,
}

async function loadAgentConfig(orgId: string): Promise<AgentConfigData> {
  const cached = getCachedConfig(orgId)
  if (cached) return cached

  try {
    const dbConfig = await prisma.agentConfig.findFirst({ where: { orgId }, orderBy: { createdAt: 'asc' } })
    if (dbConfig) {
      const config: AgentConfigData = {
        model: dbConfig.model,
        temperature: dbConfig.temperature,
        thinkingBudget: dbConfig.thinkingBudget,
        maxIterations: dbConfig.maxIterations,
        maxOutputTokens: (dbConfig as unknown as { maxOutputTokens?: number }).maxOutputTokens ?? 4096,
        systemPrompt: dbConfig.systemPrompt || DEFAULT_SYSTEM_PROMPT,
        showThinking: dbConfig.showThinking,
        memoryStrategy:
          (typeof dbConfig.memoryStrategy === 'string' && dbConfig.memoryStrategy
            ? JSON.parse(dbConfig.memoryStrategy)
            : DEFAULT_AGENT_CONFIG.memoryStrategy) || DEFAULT_AGENT_CONFIG.memoryStrategy,
        policyHooks:
          (typeof dbConfig.policyHooks === 'string' && dbConfig.policyHooks
            ? JSON.parse(dbConfig.policyHooks)
            : DEFAULT_AGENT_CONFIG.policyHooks) || DEFAULT_AGENT_CONFIG.policyHooks,
        resumePrompt: String((dbConfig as Record<string, unknown>).resumePrompt || ''),
        formResponseTemplate: String((dbConfig as Record<string, unknown>).formResponseTemplate || ''),
      }
      setCachedConfig(orgId, config)
      return config
    }
  } catch {
    /* fallback */
  }
  return { ...DEFAULT_AGENT_CONFIG }
}

function parseJson(raw: string | null | undefined): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  // ── Auth gate ──
  const authOrgId = await resolveOrgFromApiKey(request)
  const isInternal = !authOrgId && isTrustedInternalCall(request)
  if (!authOrgId && !isInternal) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: SSEEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }

      try {
        const body = await request.json()
        const bodyOrgId = String(body.orgId || '')

        if (authOrgId && bodyOrgId && bodyOrgId !== authOrgId) {
          sendEvent({
            type: 'error',
            data: 'orgId mismatch',
            timestamp: new Date().toISOString(),
          })
          controller.close()
          return
        }

        const orgId = authOrgId || bodyOrgId || 'default'
        const userUtterance = String(body.userUtterance || '').slice(0, 8000)
        const preferZh = Boolean(body.preferZh)
        const rawIds: unknown[] = Array.isArray(body.caseIds) ? body.caseIds : []
        const caseIds: string[] = [
          ...new Set(rawIds.map((id) => String(id)).filter((s) => s.length > 0)),
        ].slice(0, 12)

        if (caseIds.length === 0) {
          sendEvent({
            type: 'error',
            data: 'caseIds required',
            timestamp: new Date().toISOString(),
          })
          controller.close()
          return
        }

        const rows = await prisma.case.findMany({
          where: { orgId, id: { in: caseIds } },
          include: { memory: true },
        })

        if (rows.length === 0) {
          sendEvent({
            type: 'error',
            data: 'No matching cases for this tenant',
            timestamp: new Date().toISOString(),
          })
          controller.close()
          return
        }

        const order = new Map(caseIds.map((id, i) => [id, i]))
        rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))

        const dossiers = rows.map((row) => {
          const mem = row.memory
          const facts = parseJson(mem?.confirmedFacts ?? null)
          const skills = parseJson(mem?.skillsCalled ?? null)
          const missing = parseJson(mem?.missingFacts ?? null)
          const events = parseJson(mem?.keyEvents ?? null)
          const skillResults = parseJson(mem?.skillResults ?? null)
          const skillsArr = Array.isArray(skills) ? skills : []
          const eventsArr = Array.isArray(events) ? events : []
          const tail = eventsArr.slice(-6)
          const srSnippet =
            skillResults && typeof skillResults === 'object'
              ? JSON.stringify(skillResults).slice(0, 4500)
              : '{}'

          return {
            id: row.id,
            type: row.type,
            status: row.status,
            displayLine: `- Case ${row.id} (${row.type}) · status ${row.status}`,
            summary: mem?.summary ? String(mem.summary).slice(0, 4000) : '(no compaction summary yet)',
            confirmedFacts: facts && typeof facts === 'object' ? JSON.stringify(facts).slice(0, 6000) : '{}',
            skillsCalled: JSON.stringify(skillsArr),
            skillResultsSnippet: srSnippet,
            missingFacts: JSON.stringify(Array.isArray(missing) ? missing : []),
            recentKeyEvents: tail.length
              ? tail.map((e: { at?: string; text?: string }) => `${e.at}: ${e.text}`).join('\n')
              : '(none)',
          }
        })

        const dossierBlock = dossiers
          .map(
            (d) =>
              `${d.displayLine}\nSummary:\n${d.summary}\nConfirmed facts (JSON): ${d.confirmedFacts}\nSkills called: ${d.skillsCalled}\nSkill results (JSON snippet): ${d.skillResultsSnippet}\nMissing: ${d.missingFacts}\nRecent events:\n${d.recentKeyEvents}\n`,
          )
          .join('\n---\n')

        const sysEn = `You are Intera's coordinator agent. The customer opened multiple investigations from one message. You must read ONLY the dossiers below (already merged server-side from live case memory). Write ONE reply for the customer:
- Brief headline opening (warm, concise).
- For each case: 2–4 sentences on current understanding and what's happening next (no internal jargon).
- If something is blocked or uncertain, say what you still need from them.
- Prefer bullets when it improves clarity.
- Max ~450 words unless critical detail demands more.
- Never invent facts not grounded in dossiers; if data is thin, acknowledge it honestly.
`

        const sysZh = `你是 Intera 的协调助手。顾客在同一段话里并行开启了多个工单调查。你只能依据下方已从服务端实时读取的案件记忆摘要作答，写给顾客一封合并回复：
- 简短开场安抚；
- 每个工单分段说明当前进展与下一步（避免内部术语）；
- 若有卡点或缺信息，明确告知还需顾客补充什么；
- 条理可用条目；
- 约 450 字以内为宜（除非关键细节必须更长）；
- 严禁捏造 dossier 中不存在的事实；信息不足时要坦诚说明。
`

        const userBlockEn = `Original customer message (context):\n"""${userUtterance || '(not provided)'}"""\n\n--- CASE DOSSIERS ---\n${dossierBlock}`
        const userBlockZh = `顾客原话（上下文）：\n"""${userUtterance || '（未提供）'}"""\n\n--- 各案摘要 ---\n${dossierBlock}`

        const agentConfig = await loadAgentConfig(orgId)

        const client = createAgentClient(agentConfig.model)

        sendEvent({
          type: 'stream_request_start',
          data: null,
          timestamp: new Date().toISOString(),
        })

        const apiStream = client.messages.stream({
          model: agentConfig.model,
          max_tokens: agentConfig.maxOutputTokens ?? 2048,
          temperature: Math.min(agentConfig.temperature, 0.6),
          system: preferZh ? sysZh : sysEn,
          messages: [
            {
              role: 'user',
              content: preferZh ? userBlockZh : userBlockEn,
            },
          ],
        })

        for await (const ev of apiStream) {
          if (ev.type === 'content_block_delta') {
            const d = ev.delta as { type?: string; text?: string }
            if (d?.type === 'text_delta' && d.text) {
              sendEvent({
                type: 'text_delta',
                data: d.text,
                timestamp: new Date().toISOString(),
              })
            }
          }
        }

        sendEvent({
          type: 'message_stop',
          data: { transition: 'coordinator_complete', reason: 'coordinate' },
          timestamp: new Date().toISOString(),
        })
      } catch (err) {
        console.error('[coordinate]', err)
        sendEvent({
          type: 'error',
          data: err instanceof Error ? err.message : 'Coordinator failed',
          timestamp: new Date().toISOString(),
        })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
