// Intera Harness - Messages API Route
// POST /api/messages — Main entry point for user messages
// Supports resumeTrigger for human task resolution

import { NextRequest } from 'next/server'
import { AgentLoop } from '@/lib/agent/loop'
import { prisma } from '@intera/shared/prisma'
import type { SSEEvent, AgentConfigData } from '@intera/shared/types'

const DEFAULT_SYSTEM_PROMPT = `You are an expert customer service agent for a gaming platform.
Your goal is to help customers resolve their issues completely.

# Using your tools

You have access to a set of tools. This is CRITICAL to assisting the user effectively:

- To collect information from the customer, use request_user_input. NEVER ask for multiple
  details in plain text — use this tool. It will show a form to the customer.
- To check order status, use query_order_status with the transaction ID.
- To check if a payment channel has delays, use query_payment_channel_status.
- To search for platform announcements or delay notices, use search_delay_notice.
- To extract text from uploaded screenshots, use ocr_receipt.
- To look up the customer's past cases, use read_case_history.
- To search the knowledge base, use kb_hybrid_retrieve.
- To escalate to a human operator, use create_human_task. This pauses the case until
  the human responds.
- To close a resolved case, use finalize_case with a conclusion and evidence basis.

Do NOT try to do these things through text alone. Use the dedicated tool for each task.

Key principles:
1. Acknowledge the customer's concern briefly (1-2 sentences max)
2. If you are missing information, call request_user_input IMMEDIATELY — do not list questions in text
3. Verify facts with tools before making conclusions
4. If there is a conflict or you are unsure, create a human task
5. Always cite evidence (tool results) when giving conclusions
6. Only finalize a case when you have sufficient evidence

When a customer reports an issue:
1. First acknowledge their concern briefly (1-2 sentences)
2. If you need information (order ID, amount, payment method, receipt, etc.), IMMEDIATELY call request_user_input with a form title, a brief description, and the required fields. Do NOT ask for this information in text — use the tool.
3. After receiving the form response, use query_order_status to check the order
4. Use query_payment_channel_status to check if there are delays
5. If there is a conflict (customer says not received but system shows success), create a human task
6. Only finalize the case when you have sufficient evidence
`

// Verify env vars at module load (logged once per cold start)
const AUTH_SET = !!process.env.ANTHROPIC_AUTH_TOKEN
const URL_SET = !!process.env.ANTHROPIC_BASE_URL
if (AUTH_SET && URL_SET) {
  console.log('[Intera] ✓ API credentials loaded from env')
} else {
  console.warn('[Intera] ⚠️  ANTHROPIC_AUTH_TOKEN or ANTHROPIC_BASE_URL missing in env')
}

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
          userMessage = `[Form submitted]\n${answerText}\n\nPlease continue processing based on this information.`
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

            // Build a synthetic message from human's resolution
            const parts = ['[Human task resolved]']
            if (task.verdict) parts.push(`Verdict: ${task.verdict.replace(/_/g, ' ')}`)
            if (task.expectedEta) parts.push(`ETA: ${task.expectedEta}`)
            if (task.notes) parts.push(`Notes: ${task.notes}`)
            parts.push('Please continue assisting the customer based on this information.')
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

        // ── Load case memory from DB if case exists ──
        let systemPrompt = DEFAULT_SYSTEM_PROMPT
        try {
          const existingCase = await prisma.case.findUnique({
            where: { id: resolvedCaseId },
            include: { memory: true },
          })
          if (existingCase?.memory) {
            const facts = parseMemoryJson(existingCase.memory.confirmedFacts)
            const skills = parseMemoryJson(existingCase.memory.skillsCalled)
            const missing = parseMemoryJson(existingCase.memory.missingFacts)
            const skillsArr = Array.isArray(skills) ? skills : []
            if (Object.keys(facts as object).length > 0 || skillsArr.length > 0) {
              systemPrompt += `\n\nPrevious case context (from DB):\n- Confirmed facts: ${JSON.stringify(facts)}\n- Skills already called: ${JSON.stringify(skillsArr)}\n- Still missing: ${JSON.stringify(missing)}`
            }
          }
        } catch {
          // Case doesn't exist yet, use defaults
        }

        const agentLoop = new AgentLoop({
          config: DEFAULT_AGENT_CONFIG,
          caseId: resolvedCaseId,
          customerId: resolvedCustomerId,
          userId: resolvedUserId,
          systemPrompt,
        })

        const result = await agentLoop.run(userMessage, sendEvent)

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

function parseMemoryJson(raw: string | undefined): unknown {
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}
