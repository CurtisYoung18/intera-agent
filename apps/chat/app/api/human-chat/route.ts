// Intera Harness — Human-Agent Chat API
// POST /api/human-chat — Human operator converses with agent about a case
// The agent runs in "consultation mode" with a specialist system prompt.

import { NextRequest } from 'next/server'
import { AgentLoop } from '@/lib/agent/loop'
import { prisma } from '@intera/shared/prisma'
import type { SSEEvent, AgentConfigData } from '@intera/shared/types'

const CONSULTATION_SYSTEM_PROMPT = `You are Intera, the AI agent owning this customer case. You are consulting a human operator. Respond in the SAME LANGUAGE as the customer's case context.

# Your Role

You are the CASE OWNER. Tell the operator:
1. What you've found and what needs confirmation
2. Ask specific, actionable questions
3. Execute tools if needed
4. When done, call finalize_consultation

# How to Consult

1. Start with a summary of findings + what you need
2. Ask 1-2 specific questions
3. Call finalize_consultation when you have confirmation

# Tools

- query_order_status(txnId) / query_payment_channel_status(txnId) / search_delay_notice(channel)
- finalize_consultation(summary, resolution) — END consultation
  - summary: customer-facing message about what was resolved
  - resolution: confirmed_delayed / refund_approved / needs_more_info / resolved / false_alarm
`

import { DEFAULT_MEMORY_STRATEGY } from '@intera/shared/defaults'

const DEFAULT_HUMAN_CHAT_CONFIG: AgentConfigData = {
  model: 'MiniMax-M2.7-highspeed',
  temperature: 0.5,
  thinkingBudget: 4096,
  maxIterations: 15,
  systemPrompt: CONSULTATION_SYSTEM_PROMPT,
  toolParallelism: true,
  isConcurrencySafe: true,
  showThinking: false,
  memoryStrategy: { ...DEFAULT_MEMORY_STRATEGY, keyEventExtractionPrompt: '', enableAutocompact: false },
  policyHooks: { preTool: [], postTool: [], preFinalize: [] },
}

function parseJson(raw: string): unknown {
  try { return JSON.parse(raw) } catch { return null }
}

// Load AgentConfig from DB, fallback to default. Override systemPrompt for consultation.
async function loadHumanChatConfig(customerId: string): Promise<AgentConfigData> {
  try {
    const dbConfig = await prisma.agentConfig.findUnique({ where: { customerId } })
    if (dbConfig) {
      return {
        model: dbConfig.model,
        temperature: dbConfig.temperature,
        thinkingBudget: dbConfig.thinkingBudget,
        maxIterations: DEFAULT_HUMAN_CHAT_CONFIG.maxIterations, // Always 15 for consultation
        systemPrompt: CONSULTATION_SYSTEM_PROMPT, // Always consultation prompt
        toolParallelism: dbConfig.toolParallelism,
        isConcurrencySafe: dbConfig.isConcurrencySafe,
        showThinking: (dbConfig as any).showThinking ?? false,
        memoryStrategy: {
          ...((parseJson(dbConfig.memoryStrategy) as AgentConfigData['memoryStrategy']) || DEFAULT_HUMAN_CHAT_CONFIG.memoryStrategy),
          // Consultation mode: keep tool results fresh for context continuity.
          // 5-minute minimum age before microcompact clears anything — matches prompt cache TTL.
          microcompactMinAgeMs: 300000,
        },
        policyHooks: DEFAULT_HUMAN_CHAT_CONFIG.policyHooks, // No policy checks needed for consultation
      }
    }
  } catch (err) {
    console.warn('[HumanChat] Failed to load agent config from DB, using default:', err)
  }
  return { ...DEFAULT_HUMAN_CHAT_CONFIG }
}

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: SSEEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }

      try {
        const body = await request.json()
        const { taskId, message } = body

        if (!taskId || !message) {
          sendEvent({ type: 'error', data: 'taskId and message are required', timestamp: new Date().toISOString() })
          controller.close()
          return
        }

        // Load the human task with case + memory
        const task = await prisma.humanTask.findUnique({
          where: { id: taskId },
          include: { case: { include: { memory: true } } },
        })

        if (!task || task.status === 'resolved') {
          sendEvent({ type: 'error', data: 'Task not found or already resolved', timestamp: new Date().toISOString() })
          controller.close()
          return
        }

        // Mark task as in_progress
        await prisma.humanTask.update({ where: { id: taskId }, data: { status: 'in_progress' } })

        const caseData = task.case
        const memory = caseData.memory

        // Build system prompt with case context
        let systemPrompt = CONSULTATION_SYSTEM_PROMPT
        if (memory) {
          systemPrompt += `\n\n## Current Case Context\n- Case ID: ${caseData.id}\n- Type: ${caseData.type}\n- Status: ${caseData.status}\n- Goal: ${caseData.goal || 'N/A'}\n- Blocker: ${caseData.blocker || 'N/A'}\n- Confirmed facts: ${memory.confirmedFacts}\n- Skills called: ${memory.skillsCalled}\n- Skill results: ${memory.skillResults}\n- Key events: ${memory.keyEvents}\n- Original escalation question: ${task.question}`
        }

        // Load case schema for stage-aware execution
        let caseSchema = null
        try {
          const caseType = await prisma.caseType.findUnique({
            where: { customerId_type: { customerId: caseData.customerId, type: caseData.type } },
          })
          if (caseType) {
            const parseJson = (raw: string | null | undefined) => { try { return raw ? JSON.parse(raw) : null } catch { return null } }
            caseSchema = {
              type: caseType.type,
              displayName: caseType.displayName,
              description: caseType.description || undefined,
              icon: caseType.icon,
              requiredFacts: (parseJson(caseType.requiredFacts) as string[]) || [],
              stages: (parseJson(caseType.stages) as string[]) || [],
              stageConfigs: (parseJson(caseType.stageConfigs) as any) || undefined,
              defaultGoal: caseType.defaultGoal,
              escalateOn: (parseJson(caseType.escalateOn) as string[]) || [],
              autoCloseConditions: (parseJson(caseType.autoCloseConditions) as any) || undefined,
              orchestrator: (parseJson(caseType.orchestratorConfig) as any) || undefined,
            }
          }
        } catch { /* schema not found */ }

        const baseConfig = await loadHumanChatConfig(caseData.customerId)

        const agentLoop = await AgentLoop.create({
          config: { ...baseConfig, systemPrompt },
          caseId: caseData.id,
          customerId: caseData.customerId,
          userId: caseData.userId,
          systemPrompt,
          caseSchema,
        })

        // Restore memory
        if (memory) {
          agentLoop.loadMemory(memory)
        }

        const result = await agentLoop.run(message, sendEvent)

        // Persist updated memory
        const mem = agentLoop.getMemorySummary()
        await prisma.caseMemory.upsert({
          where: { caseId: caseData.id },
          update: {
            confirmedFacts: JSON.stringify(mem.confirmedFacts),
            missingFacts: JSON.stringify(mem.missingFacts),
            skillsCalled: JSON.stringify(mem.skillsCalled),
            skillResults: JSON.stringify(mem.skillResults),
            keyEvents: JSON.stringify(mem.keyEvents),
            summary: mem.summary || undefined,
          },
          create: {
            caseId: caseData.id,
            confirmedFacts: JSON.stringify(mem.confirmedFacts),
            missingFacts: JSON.stringify(mem.missingFacts),
            skillsCalled: JSON.stringify(mem.skillsCalled),
            skillResults: JSON.stringify(mem.skillResults),
            keyEvents: JSON.stringify(mem.keyEvents),
            humanTaskStatus: 'in_progress',
            summary: mem.summary || undefined,
          },
        })

        sendEvent({
          type: 'message_stop',
          data: { transition: result.transition, reason: result.reason },
          timestamp: new Date().toISOString(),
        })

        // After consultation completes, trigger a customer-facing agent update
        // so the chat app shows the resolution without the customer needing to send a message.
        if (result.transition === 'consultation_complete') {
          const customerMessage = '[System] The human specialist has completed their review of this case. Please send the customer a friendly update summarizing what was resolved and what happens next. Be warm and helpful — do NOT use technical/internal language. If applicable, call finalize_case to close the case.'
          const maxRetries = 3
          let delay = 500
          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
              const res = await fetch(
                `${process.env.NEXT_PUBLIC_CHAT_API_URL || 'http://localhost:3000'}/api/messages`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    message: customerMessage,
                    caseId: caseData.id,
                    customerId: caseData.customerId,
                    userId: caseData.userId,
                  }),
                },
              )
              if (!res.ok) throw new Error(`HTTP ${res.status}`)
              break
            } catch (err) {
              console.error(`[HumanChat] Notify customer agent attempt ${attempt}/${maxRetries} failed:`, err)
              if (attempt < maxRetries) await new Promise((r) => setTimeout(r, delay))
              delay *= 2
            }
          }
        }
      } catch (error) {
        console.error('[HumanChat] Error:', error)
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
      'Access-Control-Allow-Origin': '*',
    },
  })
}
