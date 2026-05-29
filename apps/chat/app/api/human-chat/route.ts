// Intera Harness — Human-Agent Chat API
// POST /api/human-chat — Human operator converses with the dedicated ConsultationAgent.
// ConsultationAgent is a separate, lightweight agent:
//   • Uses consultationPrompt from AgentConfig (Console → Agent → Human Ops).
//   • Only exposes finalize_consultation + humanSkills whitelist — no investigation tools.
//   • No ReAct nudge, no stage enforcement, no policy engine.

import { NextRequest } from 'next/server'
import { ConsultationAgent } from '@/lib/agent/consultation-agent'
import { prisma } from '@intera/shared/prisma'
import type { SSEEvent } from '@intera/shared/types'
import { DEFAULT_CONSULTATION_PROMPT } from '@intera/shared/defaults'

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : []
  } catch { return [] }
}

interface HumanChatConfig {
  model: string
  systemPrompt: string
  humanSkillNames: string[]
  maxIterations: number
}

const DEFAULT_CONFIG: HumanChatConfig = {
  model: 'claude-sonnet-4-5',
  systemPrompt: DEFAULT_CONSULTATION_PROMPT,
  humanSkillNames: [],
  maxIterations: 8,
}

async function loadHumanChatConfig(vendorId: string): Promise<HumanChatConfig> {
  try {
    const dbConfig = await prisma.agentConfig.findUnique({ where: { vendorId } })
    if (dbConfig) {
      const consultationPrompt = (dbConfig as Record<string, unknown>).consultationPrompt as string | null
      const humanSkillsRaw = (dbConfig as Record<string, unknown>).humanSkills as string | null
      return {
        model: dbConfig.model || DEFAULT_CONFIG.model,
        systemPrompt: consultationPrompt?.trim() || DEFAULT_CONFIG.systemPrompt,
        humanSkillNames: parseJsonArray(humanSkillsRaw),
        maxIterations: DEFAULT_CONFIG.maxIterations,
      }
    }
  } catch (err) {
    console.warn('[HumanChat] Failed to load agent config from DB, using defaults:', err)
  }
  return { ...DEFAULT_CONFIG }
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

        // Build system prompt: base consultation prompt + injected case context
        const agentCfg = await loadHumanChatConfig(caseData.vendorId)
        let systemPrompt = agentCfg.systemPrompt
        if (memory) {
          systemPrompt +=
            `\n\n## Current Case Context` +
            `\n- Case ID: ${caseData.id}` +
            `\n- Type: ${caseData.type}` +
            `\n- Status: ${caseData.status}` +
            `\n- Goal: ${caseData.goal || 'N/A'}` +
            `\n- Blocker: ${caseData.blocker || 'N/A'}` +
            `\n- Confirmed facts: ${memory.confirmedFacts}` +
            `\n- Skills called: ${memory.skillsCalled}` +
            `\n- Skill results: ${memory.skillResults}` +
            `\n- Key events: ${memory.keyEvents}` +
            `\n- Original escalation question: ${task.question}`
        }

        // Reconstruct prior chat turns from the task's chatLog (operator↔agent history)
        type ChatEntry = { role: 'operator' | 'agent'; content: string; timestamp: string }
        const priorMessages: Array<{ role: 'user' | 'assistant'; content: string }> = []
        try {
          const entries: ChatEntry[] = task.chatLog ? JSON.parse(task.chatLog) : []
          for (const entry of entries) {
            priorMessages.push({
              role: entry.role === 'operator' ? 'user' : 'assistant',
              content: entry.content,
            })
          }
        } catch { /* malformed chatLog — start fresh */ }

        // Create the ConsultationAgent — separate from the main investigation AgentLoop
        const consultAgent = await ConsultationAgent.create({
          systemPrompt,
          humanSkillNames: agentCfg.humanSkillNames,
          model: agentCfg.model,
          maxIterations: agentCfg.maxIterations,
          caseId: caseData.id,
          vendorId: caseData.vendorId,
        })

        // Capture agent response text for chatLog persistence
        let agentResponseText = ''
        const originalSendEvent = sendEvent
        const capturingSendEvent = (event: SSEEvent) => {
          if (event.type === 'text_delta') agentResponseText += event.data as string
          originalSendEvent(event)
        }

        const result = await consultAgent.run(priorMessages, message, capturingSendEvent)

        // ConsultationAgent handles its own DB writes (finalize_consultation → case/humanTask update).
        // No separate memory persist needed — consultation doesn't modify investigation memory.
        // We only update the chatLog below.
        {
          // Placeholder upsert to satisfy callers that still read chatMemory after consultation.
          // Uses the existing memory snapshot if present — no overwrite.
          const existingMem = await prisma.chatMemory.findUnique({ where: { caseId: caseData.id } })
          if (!existingMem && memory) {
            await prisma.chatMemory.create({
              data: {
                caseId: caseData.id,
                confirmedFacts: memory.confirmedFacts || '{}',
                missingFacts: memory.missingFacts || '[]',
                skillsCalled: memory.skillsCalled || '[]',
                skillResults: memory.skillResults || '{}',
                keyEvents: memory.keyEvents || '[]',
                humanTaskStatus: 'in_progress',
              },
            }).catch(() => { /* race condition — ignore */ })
          }
        }

        // Append this exchange to the task's chatLog for persistence
        if (agentResponseText) {
          try {
            const freshTask = await prisma.humanTask.findUnique({
              where: { id: taskId },
              select: { chatLog: true },
            })
            const existing: unknown[] = freshTask?.chatLog ? JSON.parse(freshTask.chatLog) : []
            const now = new Date().toISOString()
            existing.push({ role: 'operator', content: message, timestamp: now })
            existing.push({ role: 'agent', content: agentResponseText, timestamp: now })
            await prisma.humanTask.update({
              where: { id: taskId },
              data: { chatLog: JSON.stringify(existing) },
            })
          } catch (e) {
            console.warn('[HumanChat] Failed to persist chatLog:', e)
          }
        }

        sendEvent({
          type: 'message_stop',
          data: { transition: result.transition, reason: result.reason },
          timestamp: new Date().toISOString(),
        })

        // After consultation completes, trigger a customer-facing agent update
        if (result.transition === 'consultation_complete') {
          // Read the actual consultation findings from the resolved task
          let consultationNotes = ''
          let consultationVerdict = ''
          try {
            const resolvedTask = await prisma.humanTask.findUnique({
              where: { id: taskId },
              select: { notes: true, verdict: true },
            })
            consultationNotes = resolvedTask?.notes || ''
            consultationVerdict = resolvedTask?.verdict || ''
          } catch (e) {
            console.warn('[HumanChat] Failed to read resolved task notes:', e)
          }

          const customerMessage = [
            '[System] The human specialist has completed their review of this case.',
            consultationVerdict ? `Specialist decision: ${consultationVerdict.replace(/_/g, ' ')}.` : '',
            consultationNotes ? `Specialist findings (relay to customer): ${consultationNotes}` : '',
            'Please relay these findings to the customer NOW in a friendly, non-technical tone. Do NOT ask further questions. If the case is resolved, call finalize_case.',
          ].filter(Boolean).join('\n')

          const maxRetries = 3
          let delay = 500
          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
              const selfUrl = `http://127.0.0.1:${process.env.PORT || '8080'}`
              const res = await fetch(
                `${selfUrl}/api/messages`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    message: customerMessage,
                    caseId: caseData.id,
                    vendorId: caseData.vendorId,
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

              // Fallback: if all retries fail, persist the resolution directly to DB
              // so the customer sees it when they refresh or the stream reconnects.
              if (attempt === maxRetries) {
                try {
                  await prisma.message.create({
                    data: {
                      id: `notify_${taskId}_${Date.now()}`,
                      caseId: caseData.id,
                      role: 'assistant',
                      content: consultationVerdict
                        ? `[Resolution] ${consultationVerdict.replace(/_/g, ' ')}. ${consultationNotes || ''}`
                        : (consultationNotes || 'Your case has been reviewed by our specialist. We will update you shortly.'),
                      isStreaming: false,
                    },
                  })
                  console.log(`[HumanChat] Persisted resolution fallback to messages for case ${caseData.id}`)
                } catch (dbErr) {
                  console.error('[HumanChat] Failed to persist fallback resolution:', dbErr)
                }
              }
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
