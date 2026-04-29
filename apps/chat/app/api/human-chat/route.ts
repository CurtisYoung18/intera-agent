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

const DEFAULT_AGENT_CONFIG: AgentConfigData = {
  model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
  temperature: 0.5,
  thinkingBudget: 4096,
  maxIterations: 15,
  systemPrompt: CONSULTATION_SYSTEM_PROMPT,
  toolParallelism: true,
  isConcurrencySafe: true,
  memoryStrategy: {
    l1MaxMessages: 12,
    l2SummaryMaxTokens: 2000,
    l4MaxHistoricalCases: 5,
    keyEventExtractionPrompt: '',
    maxRecentTraces: 20,
    caseRetentionDays: 90,
    autocompactThresholdTokens: 13000,
    warningThresholdTokens: 20000,
    errorThresholdTokens: 20000,
    enableSnip: true,
    enableMicrocompact: true,
    enableContextCollapse: true,
    enableAutocompact: true,
  },
  policyHooks: {
    preTool: [],
    postTool: [],
    preFinalize: [],
  },
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

        const agentLoop = new AgentLoop({
          config: { ...DEFAULT_AGENT_CONFIG, systemPrompt },
          caseId: caseData.id,
          customerId: caseData.customerId,
          userId: caseData.userId,
          systemPrompt,
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
          },
          create: {
            caseId: caseData.id,
            confirmedFacts: JSON.stringify(mem.confirmedFacts),
            missingFacts: JSON.stringify(mem.missingFacts),
            skillsCalled: JSON.stringify(mem.skillsCalled),
            skillResults: JSON.stringify(mem.skillResults),
            keyEvents: JSON.stringify(mem.keyEvents),
            humanTaskStatus: 'in_progress',
          },
        })

        sendEvent({
          type: 'message_stop',
          data: { transition: result.transition, reason: result.reason },
          timestamp: new Date().toISOString(),
        })
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
