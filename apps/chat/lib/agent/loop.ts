// Intera Harness - Agent Loop (核心引擎)
// Based on Claude Code's query.ts + StreamingToolExecutor pattern
//
// Streaming tool execution: tools begin executing as soon as their
// input_json is complete (content_block_stop), while text/thinking
// continues streaming to the frontend. This is the key difference
// from naive "wait for full response then execute" approaches.
//
// [MOCK] In-memory state. Production path:
//   - Load persisted Case state from DB via Prisma
//   - Persist messages, traces, memory on every mutation

import Anthropic from '@anthropic-ai/sdk'
import type { Message, AssistantMessage, ToolUse, SSEEvent } from '@intera/shared/types'
import { prisma } from '@intera/shared/prisma'
import { StreamingToolExecutor } from './streaming-tool-executor'
import type { ToolExecutionResult } from './streaming-tool-executor'
import { CaseMemoryManager } from './memory'
import { PolicyEngine } from './policy'
import { SkillRouter } from './skills'
import { TraceWriter } from './trace'
import type { AgentConfigData, CaseStatus } from '@intera/shared/types'

const MAX_OUTPUT_TOKENS = 4096

// ---------------------------------------------------------------------------
// Content block tracking during streaming
// ---------------------------------------------------------------------------

interface StreamContentBlock {
  index: number
  type: 'text' | 'tool_use' | 'thinking'
  id: string
  name: string
  content: string
  completed: boolean
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AgentLoopDeps {
  config: AgentConfigData
  caseId: string
  customerId: string
  userId: string
  systemPrompt: string
}

export interface LoopResult {
  messages: Message[]
  caseStatus: CaseStatus
  transition: 'next_turn' | 'resolved' | 'waiting_human' | 'waiting_form' | 'error' | 'consultation_complete'
  reason?: string
}

// ---------------------------------------------------------------------------
// AgentLoop
// ---------------------------------------------------------------------------

export class AgentLoop {
  private messages: Message[] = []
  private caseMemory: CaseMemoryManager
  private policyEngine: PolicyEngine
  private skillRouter: SkillRouter
  private traceWriter: TraceWriter
  private iterationCount = 0
  private abortController: AbortController

  constructor(private deps: AgentLoopDeps) {
    this.caseMemory = new CaseMemoryManager(deps.caseId)
    this.policyEngine = new PolicyEngine(deps.customerId)
    this.skillRouter = new SkillRouter(deps.customerId)
    this.traceWriter = new TraceWriter(deps.caseId)
    this.abortController = new AbortController()
  }

  // -----------------------------------------------------------------------
  // Main entry point
  // -----------------------------------------------------------------------

  async run(
    userMessage: string,
    sendEvent: (event: SSEEvent) => void,
  ): Promise<LoopResult> {
    // 1. Record user message
    const userMsg = this.makeUserMessage(userMessage)
    this.messages.push(userMsg)
    await this.traceWriter.write('user_message', 'User sent message', userMessage)

    // 2. Ingest facts into Case Memory
    await this.caseMemory.ingestUserMessageFacts(userMessage)
    sendEvent({
      type: 'memory_update',
      data: this.caseMemory.getSummary(),
      timestamp: new Date().toISOString(),
    })

    // 3. ReAct loop
    let stopReason: string | null = null
    let usage: { input_tokens?: number; output_tokens?: number } | null = null

    while (this.iterationCount < this.deps.config.maxIterations) {
      this.iterationCount++

      // Context compaction (simplified)
      const compactResult = await this.checkAndCompact()
      if (compactResult.shouldCompact) {
        sendEvent({
          type: 'withheld',
          data: 'Compacting context...',
          timestamp: new Date().toISOString(),
        })
      }

      sendEvent({
        type: 'stream_request_start',
        data: null,
        timestamp: new Date().toISOString(),
      })

      // ── StreamingToolExecutor is created BEFORE the stream so tools
      //    can be enqueued incrementally as each tool_use block completes.
      const toolExecutor = new StreamingToolExecutor(
        this.skillRouter.getToolDefinitions(),
        (toolUse, status) => {
          sendEvent({
            type: status === 'executing' ? 'tool_executing' : 'skill_result',
            data: { name: toolUse.name, status },
            timestamp: new Date().toISOString(),
          })
        },
      )

      // ── Stream API call ──────────────────────────────────────────
      const client = new Anthropic({
        apiKey: process.env.ANTHROPIC_AUTH_TOKEN,
        baseURL: process.env.ANTHROPIC_BASE_URL,
      })
      const stream = client.messages.stream({
        model: this.deps.config.model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: this.deps.systemPrompt,
        messages: this.buildApiMessages(),
        tools: this.skillRouter.getTools(),
      })

      const blocks = new Map<number, StreamContentBlock>()
      let assistantMessage: AssistantMessage | null = null
      let fullText = ''
      // Reset per-iteration
      stopReason = null
      usage = null

      for await (const event of stream) {
        switch (event.type) {
          // ── message start ──────────────────────────────────────
          case 'message_start':
            assistantMessage = {
              id: event.message.id,
              role: 'assistant',
              content: '',
              createdAt: new Date(),
              isStreaming: true,
            }
            break

          // ── content block start ────────────────────────────────
          case 'content_block_start': {
            const b = event.content_block
            if (b.type === 'tool_use') {
              blocks.set(event.index, {
                index: event.index,
                type: 'tool_use',
                id: b.id,
                name: b.name,
                content: '',
                completed: false,
              })
            } else if (b.type === 'text') {
              blocks.set(event.index, {
                index: event.index,
                type: 'text',
                id: '',
                name: '',
                content: '',
                completed: false,
              })
            } else if (b.type === 'thinking') {
              blocks.set(event.index, {
                index: event.index,
                type: 'thinking',
                id: '',
                name: '',
                content: '',
                completed: false,
              })
            }
            break
          }

          // ── content block delta ────────────────────────────────
          case 'content_block_delta': {
            const d = event.delta
            const cb = blocks.get(event.index)
            if (!cb) break

            if (d.type === 'text_delta') {
              cb.content += d.text
              fullText += d.text
              sendEvent({
                type: 'text_delta',
                data: d.text,
                timestamp: new Date().toISOString(),
              })
            } else if (d.type === 'input_json_delta') {
              cb.content += d.partial_json
            } else if (d.type === 'thinking_delta') {
              cb.content += d.thinking
              sendEvent({
                type: 'thinking_delta',
                data: d.thinking,
                timestamp: new Date().toISOString(),
              })
            }
            break
          }

          // ── content block stop ─────────────────────────────
          // This is the critical moment: a tool_use block just
          // finished streaming its input JSON. Parse it and
          // enqueue for immediate execution.
          case 'content_block_stop': {
            const stoppedBlock = blocks.get(event.index)
            if (!stoppedBlock) break
            stoppedBlock.completed = true

            if (stoppedBlock.type === 'tool_use') {
              let input: Record<string, unknown> = {}
              try {
                input = JSON.parse(stoppedBlock.content || '{}')
              } catch {
                // Malformed JSON — tool will run with empty input
              }

              const toolUse: ToolUse = {
                id: stoppedBlock.id,
                name: stoppedBlock.name,
                input,
              }

              // PreTool policy check
              const policyResult = await this.policyEngine.check('preTool', {
                skillName: toolUse.name,
                skillInput: toolUse.input,
                confirmedFacts: this.caseMemory.getConfirmedFacts(),
              })

              if (policyResult.result === 'blocked') {
                await this.traceWriter.write(
                  'policy_hit',
                  `Blocked: ${toolUse.name}`,
                  JSON.stringify(policyResult),
                )
                sendEvent({
                  type: 'error',
                  data: `Tool blocked by policy: ${toolUse.name}`,
                  timestamp: new Date().toISOString(),
                })
                continue
              }

              // ★ Enqueue — starts executing immediately.
              // text/thinking blocks that follow will stream to the
              // frontend concurrently while this tool runs.
              toolExecutor.enqueue(toolUse)
            }
            break
          }

          // ── message delta (usage + stop_reason) ──────────────
          case 'message_delta': {
            const msgDelta = event as { type: 'message_delta'; delta: { stop_reason?: string | null; usage?: { input_tokens?: number; output_tokens?: number } }; usage?: unknown }
            const delta = msgDelta.delta
            if (delta?.stop_reason != null) {
              stopReason = delta.stop_reason
              await this.traceWriter.write(
                'stream_event',
                `stop_reason: ${stopReason}`,
                JSON.stringify({ stopReason, iteration: this.iterationCount }),
              )
            }
            if (msgDelta.usage) {
              usage = msgDelta.usage as { input_tokens?: number; output_tokens?: number }
            }
            break
          }

          // ── message stop ──────────────────────────────────────
          case 'message_stop':
            break
        }
      }

      // Stream complete — finalize the assistant message
      if (!assistantMessage) {
        throw new Error('No assistant message received')
      }
      assistantMessage.content = fullText
      assistantMessage.isStreaming = false

      // ── Wait for all tools to finish ─────────────────────────
      const toolResults = await toolExecutor.waitForAll()

      if (toolResults.length === 0) {
        // Plain text response — no tools used → exit loop (model wants user input)
        await this.traceWriter.write('loop_decision', 'Exit: no tools called', JSON.stringify({
          stopReason, iteration: this.iterationCount, textLength: fullText.length,
        }))
        this.messages.push(assistantMessage)
        sendEvent({
          type: 'message_stop',
          data: { reason: 'no_tools', stopReason, usage } as any,
          timestamp: new Date().toISOString(),
        })
        return {
          messages: this.messages,
          caseStatus: 'investigating',
          transition: 'next_turn',
        }
      }

      // ── PostTool policy checks ───────────────────────────────
      for (const result of toolResults) {
        const policyResult = await this.policyEngine.check('postTool', {
          skillName: result.name,
          skillOutput: result.output,
          confirmedFacts: this.caseMemory.getConfirmedFacts(),
        })

        if (policyResult.result === 'escalated') {
          await this.traceWriter.write(
            'policy_hit',
            `Escalated: ${result.name}`,
            JSON.stringify(policyResult),
          )
        }
      }

      // ── Apply tool results to Case Memory ────────────────────
      for (const result of toolResults) {
        await this.caseMemory.applySkillResult(result.name, result.output)
        await this.traceWriter.write(
          'skill_result',
          `Skill: ${result.name}`,
          JSON.stringify(result.output),
        )
      }

      // ── Add to message history ───────────────────────────────
      this.messages.push(assistantMessage)
      this.addToolResultMessages(toolResults)

      // ── Terminal tool: request_user_input (form) ─────────
      const formResult = toolResults.find(
        (r) => r.name === 'request_user_input',
      )
      if (formResult) {
        await this.traceWriter.write('loop_decision', 'Exit: form requested', JSON.stringify({
          stopReason, toolCount: toolResults.length, iteration: this.iterationCount,
        }))
        const toolInput = formResult.toolUse?.input || {}
        const title = String(toolInput.title || 'Information Needed')
        const description = String(toolInput.description || '')
        const fields = (toolInput.fields as Array<Record<string, unknown>>) || []

        sendEvent({
          type: 'form_request',
          data: {
            skillCallId: formResult.toolUse?.id || crypto.randomUUID(),
            title,
            description,
            fields,
          },
          timestamp: new Date().toISOString(),
        })

        return {
          messages: this.messages,
          caseStatus: 'collecting',
          transition: 'waiting_form',
        }
      }

      // ── Terminal tool: create_human_task ─────────────────────
      const humanTaskResult = toolResults.find(
        (r) => r.name === 'create_human_task',
      )
      if (humanTaskResult) {
        const toolInput = humanTaskResult.toolUse?.input || {}
        const queue = String(toolInput.queue || 'general')
        const question = String(toolInput.question || 'Human task requested')

        try {
          // Ensure customer exists
          await prisma.customer.upsert({
            where: { id: this.deps.customerId },
            update: {},
            create: { id: this.deps.customerId, name: this.deps.customerId },
          })

          // Ensure case exists
          await prisma.case.upsert({
            where: { id: this.deps.caseId },
            update: { status: 'waiting_human', blocker: `Waiting for ${queue}` },
            create: {
              id: this.deps.caseId,
              customerId: this.deps.customerId,
              userId: this.deps.userId,
              type: 'general',
              status: 'waiting_human',
              blocker: `Waiting for ${queue}`,
            },
          })

          // Persist case memory
          const mem = this.caseMemory.getSummary()
          await prisma.caseMemory.upsert({
            where: { caseId: this.deps.caseId },
            update: {
              confirmedFacts: JSON.stringify(mem.confirmedFacts),
              missingFacts: JSON.stringify(mem.missingFacts),
              skillsCalled: JSON.stringify(mem.skillsCalled),
              skillResults: JSON.stringify(mem.skillResults),
              keyEvents: JSON.stringify(mem.keyEvents),
              humanTaskStatus: 'pending',
            },
            create: {
              caseId: this.deps.caseId,
              confirmedFacts: JSON.stringify(mem.confirmedFacts),
              missingFacts: JSON.stringify(mem.missingFacts),
              skillsCalled: JSON.stringify(mem.skillsCalled),
              skillResults: JSON.stringify(mem.skillResults),
              keyEvents: JSON.stringify(mem.keyEvents),
              humanTaskStatus: 'pending',
            },
          })

          // Create human task
          const task = await prisma.humanTask.create({
            data: {
              caseId: this.deps.caseId,
              queue,
              question,
              status: 'pending',
            },
          })

          // Write trace
          await prisma.actionTrace.create({
            data: {
              caseId: this.deps.caseId,
              actionType: 'human_task_created',
              title: `Human task created: ${queue}`,
              payload: JSON.stringify({ taskId: task.id, queue, question }),
            },
          })

          sendEvent({
            type: 'human_task_created',
            data: { taskId: task.id, queue, status: 'pending' },
            timestamp: new Date().toISOString(),
          })
        } catch (err) {
          console.error('[AgentLoop] Failed to persist human task:', err)
        }

        // Continue loop — agent can generate follow-up text for customer
        continue
      }

      // ── Terminal tool: finalize_case ─────────────────────────
      const finalizeResult = toolResults.find(
        (r) => r.name === 'finalize_case',
      )
      if (finalizeResult) {
        const policyResult = await this.policyEngine.check('preFinalize', {
          skillName: 'finalize_case',
          skillOutput: finalizeResult.output,
          confirmedFacts: this.caseMemory.getConfirmedFacts(),
        })

        if (policyResult.result === 'blocked') {
          await this.traceWriter.write(
            'policy_hit',
            'Finalize blocked',
            JSON.stringify(policyResult),
          )
          sendEvent({
            type: 'error',
            data: 'Finalize blocked by policy',
            timestamp: new Date().toISOString(),
          })
          continue // Keep looping
        }

        await this.traceWriter.write('final_resolution', 'Case resolved')

        // Persist to DB
        try {
          await prisma.case.update({
            where: { id: this.deps.caseId },
            data: { status: 'resolved', resolvedAt: new Date(), blocker: null },
          })
          await prisma.actionTrace.create({
            data: {
              caseId: this.deps.caseId,
              actionType: 'final_resolution',
              title: 'Case resolved',
              payload: JSON.stringify(finalizeResult.output),
            },
          })
        } catch (err) {
          console.error('[AgentLoop] Failed to persist case resolution:', err)
        }

        sendEvent({
          type: 'finalized',
          data: finalizeResult.output,
          timestamp: new Date().toISOString(),
        })
        return {
          messages: this.messages,
          caseStatus: 'resolved',
          transition: 'resolved',
        }
      }

      // ── Terminal tool: finalize_consultation (human chat) ────
      const consultResult = toolResults.find(
        (r) => r.name === 'finalize_consultation',
      )
      if (consultResult) {
        const output = consultResult.output as Record<string, unknown> | undefined
        const summary = String(output?.summary || 'Your case has been reviewed by our specialist.')
        const resolution = String(output?.resolution || 'resolved')

        await this.traceWriter.write('final_resolution', `Consultation complete: ${resolution}`, JSON.stringify(output))

        try {
          await prisma.case.update({
            where: { id: this.deps.caseId },
            data: { status: 'investigating', blocker: null },
          })
          await prisma.humanTask.updateMany({
            where: { caseId: this.deps.caseId, status: 'in_progress' },
            data: { status: 'resolved', verdict: resolution, notes: summary },
          })
        } catch (err) {
          console.error('[AgentLoop] Failed to finalize consultation:', err)
        }

        sendEvent({
          type: 'consultation_complete',
          data: { summary, resolution },
          timestamp: new Date().toISOString(),
        })
        return {
          messages: this.messages,
          caseStatus: 'investigating',
          transition: 'consultation_complete',
        }
      }

      // ── Tools executed, no terminal action — continue loop ──
      sendEvent({
        type: 'message_stop',
        data: { reason: 'next_turn' },
        timestamp: new Date().toISOString(),
      })
    }

    // Max iterations reached
    await this.traceWriter.write('loop_decision', 'Exit: max iterations', JSON.stringify({
      stopReason, iteration: this.iterationCount, messageCount: this.messages.length,
    }))
    sendEvent({
      type: 'error',
      data: 'Max iterations reached',
      timestamp: new Date().toISOString(),
    })
    return {
      messages: this.messages,
      caseStatus: 'escalated',
      transition: 'error',
      reason: 'max_iterations',
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private buildApiMessages() {
    const recentMessages = this.messages.slice(
      -this.deps.config.memoryStrategy.l1MaxMessages * 2,
    )
    return recentMessages as any
  }

  private makeUserMessage(content: string): Message {
    return {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      createdAt: new Date(),
    }
  }

  private addToolResultMessages(results: ToolExecutionResult[]) {
    for (const result of results) {
      this.messages.push({
        id: crypto.randomUUID(),
        role: 'assistant' as const,
        content: `Tool ${result.name} result: ${JSON.stringify(result.output)}`,
        createdAt: new Date(),
      })
    }
  }

  private async checkAndCompact(): Promise<{
    shouldCompact: boolean
    reason?: string
  }> {
    // CC-style multi-tiered compaction assessment
    const estimatedTokens = this.caseMemory.estimateTokens() +
      this.messages.reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length / 3 : 50), 0)

    const assessment = this.caseMemory.assessCompaction(estimatedTokens, this.messages.length)

    if (assessment.isBlocking) {
      if (this.caseMemory.isCompactCircuitBroken()) {
        return { shouldCompact: false, reason: 'circuit_breaker' }
      }
      try {
        this.caseMemory.recordCompaction()
        this.caseMemory.resetCompactFailures()
        return { shouldCompact: true, reason: 'blocking' }
      } catch {
        this.caseMemory.recordCompactionFailure()
        return { shouldCompact: false, reason: 'failed' }
      }
    }

    if (assessment.shouldCompact) {
      this.caseMemory.recordCompaction()
      return { shouldCompact: true, reason: 'auto' }
    }

    if (assessment.isWarning) {
      console.warn(`[AgentLoop] Context: ${assessment.percentLeft.toFixed(0)}% remaining`)
    }

    return { shouldCompact: false }
  }

  abort() {
    this.abortController.abort()
  }

  getMemorySummary() {
    return this.caseMemory.getSummary()
  }

  loadMemory(data: Parameters<CaseMemoryManager['loadFromDb']>[0]) {
    this.caseMemory.loadFromDb(data)
  }
}
