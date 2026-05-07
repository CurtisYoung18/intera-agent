// Intera Harness - Messages API Route
// POST /api/messages — Main entry point for user messages
// Supports resumeTrigger for human task resolution

import { NextRequest } from 'next/server'
import { AgentLoop } from '@/lib/agent/loop'
import { prisma } from '@intera/shared/prisma'
import type { SSEEvent, AgentConfigData } from '@intera/shared/types'

// Verify env vars at module load (logged once per cold start)
const AUTH_SET = !!process.env.ANTHROPIC_AUTH_TOKEN
const URL_SET = !!process.env.ANTHROPIC_BASE_URL
if (AUTH_SET && URL_SET) {
  console.log('[Intera] ✓ API credentials loaded from env')
} else {
  console.warn('[Intera] ⚠️  ANTHROPIC_AUTH_TOKEN or ANTHROPIC_BASE_URL missing in env')
}

import { DEFAULT_SYSTEM_PROMPT, DEFAULT_MEMORY_STRATEGY, DEFAULT_POLICY_HOOKS } from '@intera/shared/defaults'

// Default templates — overridable via AgentConfig in Console
const DEFAULT_RESUME_PROMPT = `[Human task resolved — operator closed the case]
IMPORTANT — Customer communication task:
1. Translate the operator's verdict and notes into plain, friendly language the customer can understand.
2. Send this message to the customer NOW in your response — do not ask further questions.
3. Format it as a helpful update, e.g.: "Hi! Our team has reviewed your case and [result]. Here's what this means for you: [explanation]."
4. After sending the update, if the case is resolved, call finalize_case. Otherwise continue assisting.`

const DEFAULT_FORM_TEMPLATE = 'Please continue processing based on this information.'

// Default fallback config. Production loads from AgentConfig table via Customer.
const DEFAULT_AGENT_CONFIG: AgentConfigData = {
  model: process.env.ANTHROPIC_MODEL || 'MiniMax-M2.70-highspeed',
  temperature: 0.5,
  thinkingBudget: 4096,
  maxIterations: 20,
  maxOutputTokens: 4096,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  toolParallelism: true,
  isConcurrencySafe: true,
  showThinking: false,
  memoryStrategy: { ...DEFAULT_MEMORY_STRATEGY },
  policyHooks: { ...DEFAULT_POLICY_HOOKS },
  resumePrompt: '',
  formResponseTemplate: '',
}

// Per-customer TTL cache for AgentConfig (30s). Invalidated on admin save.
import { getCachedConfig, setCachedConfig } from '@/lib/agent/config-cache'

async function loadAgentConfig(customerId: string): Promise<AgentConfigData> {
  const cached = getCachedConfig(customerId)
  if (cached) return cached

  try {
    const dbConfig = await prisma.agentConfig.findUnique({ where: { customerId } })
    if (dbConfig) {
      const config: AgentConfigData = {
        model: dbConfig.model,
        temperature: dbConfig.temperature,
        thinkingBudget: dbConfig.thinkingBudget,
        maxIterations: dbConfig.maxIterations,
        maxOutputTokens: (dbConfig as any).maxOutputTokens ?? 4096,
        systemPrompt: dbConfig.systemPrompt || DEFAULT_SYSTEM_PROMPT,
        toolParallelism: dbConfig.toolParallelism,
        isConcurrencySafe: dbConfig.isConcurrencySafe,
        showThinking: dbConfig.showThinking,
        memoryStrategy: (parseNonEmptyJson(dbConfig.memoryStrategy) as unknown as AgentConfigData['memoryStrategy']) || DEFAULT_AGENT_CONFIG.memoryStrategy,
        policyHooks: (parseNonEmptyJson(dbConfig.policyHooks) as unknown as AgentConfigData['policyHooks']) || DEFAULT_AGENT_CONFIG.policyHooks,
        resumePrompt: (dbConfig as any).resumePrompt || '',
        formResponseTemplate: (dbConfig as any).formResponseTemplate || '',
      }
      setCachedConfig(customerId, config)
      return config
    }
  } catch (err) {
    console.warn('[Intera] Failed to load agent config from DB, using default:', err)
  }

  return { ...DEFAULT_AGENT_CONFIG }
}

function parseJson(raw: string): unknown {
  try { return JSON.parse(raw) } catch { return null }
}

function parseNonEmptyJson(raw: string): Record<string, unknown> | null {
  const parsed = parseJson(raw)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length > 0) {
    return parsed as Record<string, unknown>
  }
  return null
}

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: SSEEvent) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        )
      }

      try {
        const body = await request.json()
        const { message, resumeTrigger, formResult, caseId, customerId, userId } = body

        let userMessage = message
        let resolvedCaseId = caseId || `case_${Date.now()}`
        let resolvedCustomerId = customerId || 'default'
        let resolvedUserId = userId || 'anonymous'

        // ── Form response: customer submitted form answers ──
        if (formResult && !message) {
          resolvedCaseId = formResult.caseId || resolvedCaseId
          const answers = formResult.answers || {}
          const answerText = Object.entries(answers as Record<string, string>)
            .map(([key, value]) => `${key}: ${value}`)
            .join('\n')
          const template = (await loadAgentConfig(resolvedCustomerId)).formResponseTemplate || DEFAULT_FORM_TEMPLATE
          userMessage = `[Form submitted]\n${answerText}\n\n${template}`
          console.log(`[Intera] Form submitted for case ${resolvedCaseId}`)
        }

        // ── Resume flow: human resolved a task, agent continues ──
        if (resumeTrigger && !message) {
          const task = await prisma.humanTask.findUnique({
            where: { id: resumeTrigger },
            include: { case: true },
          })

          if (task && task.status === 'resolved') {
            resolvedCaseId = task.caseId
            resolvedCustomerId = task.case.customerId
            resolvedUserId = task.case.userId

            const resumeTmpl = (await loadAgentConfig(resolvedCustomerId)).resumePrompt || DEFAULT_RESUME_PROMPT
            const parts = ['[Human task resolved — operator closed the case]']
            if (task.verdict) parts.push(`Operator verdict: ${task.verdict.replace(/_/g, ' ')}`)
            if (task.expectedEta) parts.push(`Expected resolution time: ${task.expectedEta}`)
            if (task.notes) parts.push(`Internal notes (do NOT share verbatim with customer): ${task.notes}`)
            parts.push(resumeTmpl)
            userMessage = parts.join('\n')

            console.log(`[Intera] Resuming case ${resolvedCaseId} after human resolution`)
          } else {
            sendEvent({
              type: 'error',
              data: 'Task not found or not resolved',
              timestamp: new Date().toISOString(),
            })
            controller.close()
            return
          }
        }

        if (!userMessage) {
          sendEvent({
            type: 'error',
            data: 'Message is required',
            timestamp: new Date().toISOString(),
          })
          controller.close()
          return
        }

        // ── Load case memory + schema from DB (CC-style session memory pattern) ──
        let systemPrompt = DEFAULT_SYSTEM_PROMPT
        let existingMemory: unknown = null
        try {
          const existingCase = await prisma.case.findUnique({
            where: { id: resolvedCaseId },
            include: { memory: true },
          })
          if (existingCase) {
            // Load case type schema if available
            try {
              const caseType = await prisma.caseType.findUnique({
                where: { customerId_type: { customerId: resolvedCustomerId, type: existingCase.type } },
              })
              if (caseType) {
                const stages = parseMemoryJson(caseType.stages) as string[]
                const requiredFacts = parseMemoryJson(caseType.requiredFacts) as string[]
                systemPrompt += `\n\n## Case Schema: ${caseType.displayName}\n- Goal: ${caseType.defaultGoal}\n- Stages: ${JSON.stringify(stages)}\n- Required facts: ${JSON.stringify(requiredFacts)}\n- Escalate when: ${caseType.escalateOn}`
              }
            } catch { /* schema not found */ }

            if (existingCase.memory) {
              existingMemory = existingCase.memory

              if (existingCase.memory.summary) {
                systemPrompt += `\n\n## Case Session Memory\n${existingCase.memory.summary}`
              }

              const facts = parseMemoryJson(existingCase.memory.confirmedFacts)
              const skills = parseMemoryJson(existingCase.memory.skillsCalled)
              const missing = parseMemoryJson(existingCase.memory.missingFacts)
              const skillsArr = Array.isArray(skills) ? skills : []
              if (Object.keys(facts as object).length > 0 || skillsArr.length > 0) {
                systemPrompt += `\n\n## Current Case State\n- Confirmed: ${JSON.stringify(facts)}\n- Skills used: ${JSON.stringify(skillsArr)}\n- Missing: ${JSON.stringify(missing)}`
              }
            }
          }
        } catch {
          // Case doesn't exist yet
        }

        const agentConfig = await loadAgentConfig(resolvedCustomerId)

        const agentLoop = await AgentLoop.create({
          config: agentConfig,
          caseId: resolvedCaseId,
          customerId: resolvedCustomerId,
          userId: resolvedUserId,
          systemPrompt,
        })

        // Restore memory from DB into the in-memory manager
        if (existingMemory) {
          agentLoop.loadMemory(existingMemory)
        }

        const result = await agentLoop.run(userMessage, sendEvent)

        // ── Persist case memory — only if real work was done (not casual chat) ──
        const mem = agentLoop.getMemorySummary()
        const hasRealWork = mem.skillsCalled.length > 0 ||
          Object.keys(mem.confirmedFacts).length > 0 ||
          result.transition !== 'next_turn'
        if (hasRealWork) {
          try {
            await prisma.case.upsert({
              where: { id: resolvedCaseId },
              update: { status: result.caseStatus },
              create: {
                id: resolvedCaseId,
                customerId: resolvedCustomerId,
                userId: resolvedUserId,
                type: 'general',
                status: result.caseStatus,
              },
            })
            await prisma.caseMemory.upsert({
              where: { caseId: resolvedCaseId },
              update: {
                confirmedFacts: JSON.stringify(mem.confirmedFacts),
                missingFacts: JSON.stringify(mem.missingFacts),
                skillsCalled: JSON.stringify(mem.skillsCalled),
                skillResults: JSON.stringify(mem.skillResults),
                keyEvents: JSON.stringify(mem.keyEvents),
                summary: mem.summary || undefined,
              },
              create: {
                caseId: resolvedCaseId,
                confirmedFacts: JSON.stringify(mem.confirmedFacts),
                missingFacts: JSON.stringify(mem.missingFacts),
                skillsCalled: JSON.stringify(mem.skillsCalled),
                skillResults: JSON.stringify(mem.skillResults),
                keyEvents: JSON.stringify(mem.keyEvents),
                humanTaskStatus: 'none',
                summary: mem.summary || undefined,
              },
            })
          } catch (err) {
            console.error('[Intera] Failed to persist case memory:', err)
          }
        }

        // ── Persist messages to DB (always, even for casual chat) ──
        try {
          const messagesToPersist = result.messages
            .filter((m) => m.content?.trim() || m.role === 'user')
            .map((m) => ({
              id: m.id,
              caseId: resolvedCaseId,
              role: m.role,
              content: m.content || '',
              isStreaming: false,
            }))

          if (messagesToPersist.length > 0) {
            // Use createMany with skipDuplicates to avoid re-persisting
            for (const msg of messagesToPersist) {
              await prisma.message.upsert({
                where: { id: msg.id },
                update: { content: msg.content, isStreaming: false },
                create: msg,
              })
            }
          }
        } catch (err) {
          console.error('[Intera] Failed to persist messages:', err)
        }

        sendEvent({
          type: 'message_stop',
          data: { transition: result.transition, reason: result.reason },
          timestamp: new Date().toISOString(),
        })
      } catch (error) {
        console.error('Agent loop error:', error)
        sendEvent({
          type: 'error',
          data: error instanceof Error ? error.message : 'Unknown error',
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

function parseMemoryJson(raw: string | undefined): unknown {
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}
