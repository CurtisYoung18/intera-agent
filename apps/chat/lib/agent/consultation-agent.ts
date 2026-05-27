// Intera — ConsultationAgent
//
// A dedicated, lightweight agent for the /api/human-chat route.
// The human operator (a CS specialist) converses with the agent about an active case.
//
// Design principles:
//   • No stage enforcement, no ReAct nudge, no policy engine.
//   • Tool whitelist: only skills listed in AgentConfig.humanSkills + finalize_consultation.
//   • Uses consultationPrompt from AgentConfig (configured per-customer in Console → Agent → Human Ops).
//   • Streams text_delta events in real-time; returns ConsultationResult on exit.

import Anthropic from '@anthropic-ai/sdk'
import type { SSEEvent } from '@intera/shared/types'
import { prisma } from '@intera/shared/prisma'
import { withRetry, CannotRetryError, FallbackTriggeredError } from './api/with-retry'
import { SkillRouter } from './skills'
import { StreamingToolExecutor, unwrapToolExecutionPayload } from './streaming-tool-executor'
import { StreamingTextSanitizer } from './loop'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ConsultationAgentConfig {
  /** System prompt — from AgentConfig.consultationPrompt (Console: Agent → Human Ops). */
  systemPrompt: string
  /** Additional skills the operator may use (parsed from AgentConfig.humanSkills JSON).
   *  finalize_consultation is always included regardless of this list. */
  humanSkillNames: string[]
  model: string
  /** Max ReAct iterations before giving up (default 8). Consultation rarely needs many turns. */
  maxIterations?: number
  caseId: string
  customerId: string
}

export interface ConsultationResult {
  transition: 'next_turn' | 'consultation_complete'
  reason?: string
}

// ─── ConsultationAgent ───────────────────────────────────────────────────────

export class ConsultationAgent {
  private anthropicClient: Anthropic
  private skillRouter!: SkillRouter

  private constructor(private config: ConsultationAgentConfig) {
    this.anthropicClient = new Anthropic({
      apiKey: process.env.ANTHROPIC_AUTH_TOKEN,
      baseURL: process.env.ANTHROPIC_BASE_URL,
    })
  }

  /** Create and initialize — loads skills from DB. */
  static async create(config: ConsultationAgentConfig): Promise<ConsultationAgent> {
    const agent = new ConsultationAgent(config)
    agent.skillRouter = await SkillRouter.create(config.customerId)
    return agent
  }

  /** Filter all skills to the whitelist + always include finalize_consultation. */
  private getTools(): Anthropic.Messages.Tool[] {
    const allowed = new Set(['finalize_consultation', ...this.config.humanSkillNames])
    return this.skillRouter.getTools().filter((t) => allowed.has(t.name))
  }

  /**
   * Run the consultation loop.
   *
   * @param priorMessages  Prior conversation messages (operator↔agent exchanges) from humanTask.chatLog.
   * @param operatorMessage  The operator's latest message.
   * @param sendEvent  SSE sink — receives text_delta, tool_executing, skill_result, consultation_complete events.
   */
  async run(
    priorMessages: Array<{ role: 'user' | 'assistant'; content: string }>,
    operatorMessage: string,
    sendEvent: (event: SSEEvent) => void,
  ): Promise<ConsultationResult> {
    const maxIter = this.config.maxIterations ?? 8
    const tools = this.getTools()

    // Build message history: prior chat + operator's current message
    const messages: Anthropic.Messages.MessageParam[] = [
      ...priorMessages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user', content: operatorMessage },
    ]

    const sanitizer = new StreamingTextSanitizer()

    for (let iter = 0; iter < maxIter; iter++) {
      // ── Stream one LLM turn ──────────────────────────────────────────────
      let stream: ReturnType<typeof this.anthropicClient.messages.stream>
      try {
        stream = await withRetry(
          async (_client, ctx) => this.anthropicClient.messages.stream({
            model: ctx.model,
            max_tokens: 2048,
            system: this.config.systemPrompt,
            messages,
            tools,
          }),
          {
            querySource: 'consultation_loop',
            model: this.config.model,
          },
          () => this.anthropicClient,
        )
      } catch (err) {
        if (err instanceof CannotRetryError) {
          console.error('[ConsultationAgent] Stream creation failed:', err.errorClass)
          return { transition: 'consultation_complete' }
        }
        throw err
      }

      type StreamBlock = {
        index: number
        type: 'text' | 'tool_use'
        id: string
        name: string
        content: string
        completed: boolean
      }

      const blocks = new Map<number, StreamBlock>()
      let fullText = ''
      const toolExecutor = new StreamingToolExecutor(
        this.skillRouter.getToolDefinitions(),
        (toolUse, status, renderHints) => {
          sendEvent({
            type: status === 'executing' ? 'tool_executing' : 'skill_result',
            data: {
              name: toolUse.name,
              status,
              result: status !== 'executing' ? toolUse.result : undefined,
              renderHints,
            },
            timestamp: new Date().toISOString(),
          })
        },
      )

      try {
        for await (const event of stream) {
          switch (event.type) {
            case 'content_block_start': {
              const b = event.content_block
              if (b.type === 'tool_use') {
                const seedContent =
                  b.input && typeof b.input === 'object' && Object.keys(b.input as Record<string, unknown>).length > 0
                    ? JSON.stringify(b.input)
                    : ''
                blocks.set(event.index, {
                  index: event.index,
                  type: 'tool_use',
                  id: b.id,
                  name: b.name,
                  content: seedContent,
                  completed: false,
                })
              } else if (b.type === 'text') {
                blocks.set(event.index, { index: event.index, type: 'text', id: '', name: '', content: '', completed: false })
              }
              break
            }

            case 'content_block_delta': {
              const cb = blocks.get(event.index)
              if (!cb) break
              if (event.delta.type === 'text_delta') {
                cb.content += event.delta.text
                fullText += event.delta.text
                const chunk = sanitizer.feed(event.delta.text)
                if (chunk) sendEvent({ type: 'text_delta', data: chunk, timestamp: new Date().toISOString() })
              } else if (event.delta.type === 'input_json_delta') {
                cb.content += event.delta.partial_json
              }
              break
            }

            case 'content_block_stop': {
              const stoppedBlock = blocks.get(event.index)
              if (!stoppedBlock) break
              stoppedBlock.completed = true

              if (stoppedBlock.type === 'tool_use') {
                let input: Record<string, unknown> = {}
                try {
                  input = stoppedBlock.content ? (JSON.parse(stoppedBlock.content) as Record<string, unknown>) : {}
                } catch { /* malformed JSON — keep empty */ }

                toolExecutor.enqueue({
                  id: stoppedBlock.id,
                  name: stoppedBlock.name,
                  input,
                })
              }
              break
            }

            default:
              break
          }
        }
      } catch (err) {
        console.error('[ConsultationAgent] Stream error:', err)
        break
      }

      // Flush any remaining text held back by the sanitizer
      const tail = sanitizer.flush()
      if (tail) sendEvent({ type: 'text_delta', data: tail, timestamp: new Date().toISOString() })

      // ── Collect tool results ─────────────────────────────────────────────
      const toolResults = await toolExecutor.waitForAll()

      // Reconstruct assistant message content for history
      const assistantContent: Anthropic.Messages.ContentBlockParam[] = []
      if (fullText) {
        assistantContent.push({ type: 'text', text: fullText })
      }
      for (const tr of toolResults) {
        const raw = tr.toolUse as { id?: string; name?: string; input?: unknown } | undefined
        if (raw?.id && raw?.name) {
          assistantContent.push({
            type: 'tool_use',
            id: raw.id,
            name: raw.name,
            input: raw.input as Record<string, unknown>,
          })
        }
      }
      messages.push({ role: 'assistant', content: assistantContent as Anthropic.Messages.ContentBlock[] })

      // ── No tools called → legitimate end of turn ─────────────────────────
      if (toolResults.length === 0) {
        return { transition: 'next_turn' }
      }

      // ── Handle finalize_consultation ─────────────────────────────────────
      const finalizeCall = toolResults.find((r) => r.name === 'finalize_consultation')
      if (finalizeCall) {
        const input = (finalizeCall.toolUse?.input ?? {}) as Record<string, unknown>
        const payload = unwrapToolExecutionPayload(finalizeCall.output) as Record<string, unknown> | undefined
        const summary = String(input.summary ?? payload?.summary ?? 'Case reviewed by specialist.')
        const resolution = String(input.resolution ?? payload?.resolution ?? 'resolved')

        try {
          await prisma.case.update({
            where: { id: this.config.caseId },
            data: { status: 'investigating', blocker: null },
          })
          await prisma.humanTask.updateMany({
            where: { caseId: this.config.caseId, status: 'in_progress' },
            data: { status: 'resolved', verdict: resolution, notes: summary },
          })
        } catch (err) {
          console.error('[ConsultationAgent] Failed to finalize consultation in DB:', err)
        }

        sendEvent({
          type: 'consultation_complete',
          data: { summary, resolution },
          timestamp: new Date().toISOString(),
        })
        return { transition: 'consultation_complete', reason: 'operator_finalized' }
      }

      // ── Other whitelisted tools — push results and continue ───────────────
      const toolResultContent: Anthropic.Messages.ToolResultBlockParam[] = toolResults.map((r) => ({
        type: 'tool_result' as const,
        tool_use_id: (r.toolUse as { id?: string } | undefined)?.id ?? '',
        content: JSON.stringify(unwrapToolExecutionPayload(r.output)),
      }))
      messages.push({ role: 'user', content: toolResultContent })
      // → continue to next iteration
    }

    // Max iterations reached without finalize_consultation
    return { transition: 'next_turn', reason: 'max_iterations' }
  }
}
