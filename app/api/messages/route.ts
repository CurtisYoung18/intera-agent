// Intera Harness - Messages API Route
// POST /api/messages — Main entry point for user messages
//
// [MOCK] Uses hardcoded default config and in-memory state.
// Production path:
//   - Read Customer / AgentConfig / Skills / Policies from DB via Prisma
//   - Resolve caseId from request or create new Case row
//   - Persist all messages, traces, and memory mutations to DB

import { NextRequest } from 'next/server'
import { AgentLoop } from '@/lib/agent/loop'
import type { SSEEvent, AgentConfigData } from '@/types'

const DEFAULT_SYSTEM_PROMPT = `You are an expert customer service agent for a gaming platform.
Your goal is to help customers resolve their issues completely.

Key principles:
1. Always ask for the minimum necessary information to proceed
2. Use tools to verify facts before making conclusions
3. If you cannot resolve an issue, create a human task
4. Be empathetic and professional
5. Always cite evidence when making conclusions

When a customer reports an issue:
1. First acknowledge their concern
2. Ask for the minimum required information (transaction ID, amount, etc.)
3. Use query_order_status to check the order
4. Use query_payment_channel_status to check if there are delays
5. If there is a conflict (customer says not received but system shows success), create a human task
6. Only finalize the case when you have sufficient evidence
`

// [MOCK] Default config. Production loads from AgentConfig table via Customer.
const DEFAULT_AGENT_CONFIG: AgentConfigData = {
  model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
  temperature: 0.5,
  thinkingBudget: 4096,
  maxIterations: 20,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  toolParallelism: true,
  isConcurrencySafe: true,
  memoryStrategy: {
    l1MaxMessages: 12,
    l2SummaryMaxTokens: 2000,
    l4MaxHistoricalCases: 5,
    keyEventExtractionPrompt: 'Extract key events from the conversation',
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
    preTool: ['no_high_risk_account_change'],
    postTool: ['conflict_requires_human'],
    preFinalize: [
      'evidence_required_before_resolution',
      'no_compensation_promise',
      'must_cite_basis',
    ],
  },
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
        const { message, caseId, customerId, userId } = body

        if (!message) {
          sendEvent({
            type: 'error',
            data: 'Message is required',
            timestamp: new Date().toISOString(),
          })
          controller.close()
          return
        }

        // [MOCK] Uses default config. Production loads from DB:
        //   const customer = await prisma.customer.findUnique({ where: { id: customerId } })
        //   const agentConfig = await prisma.agentConfig.findUnique({ where: { customerId } })
        //   const config = parseAgentConfig(agentConfig)

        const agentLoop = new AgentLoop({
          config: DEFAULT_AGENT_CONFIG,
          caseId: caseId || `case_${Date.now()}`,
          customerId: customerId || 'default',
          userId: userId || 'anonymous',
          systemPrompt: DEFAULT_SYSTEM_PROMPT,
        })

        const result = await agentLoop.run(message, sendEvent)

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
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
