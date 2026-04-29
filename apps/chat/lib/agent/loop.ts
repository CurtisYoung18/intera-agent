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
  transition: 'next_turn' | 'resolved' | 'waiting_human' | 'error'
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

          // ── message delta (usage) ─────────────────────────────
          case 'message_delta':
            // Token usage tracking would go here
            break

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
        // Plain text response — no tools used
        this.messages.push(assistantMessage)
        sendEvent({
          type: 'message_stop',
          data: { reason: 'no_tools' },
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

      // ── Terminal tool: create_human_task ─────────────────────
      const humanTaskResult = toolResults.find(
        (r) => r.name === 'create_human_task',
      )
      if (humanTaskResult) {
        await this.traceWriter.write(
          'human_task_created',
          'Human task created',
        )
        sendEvent({
          type: 'human_task_created',
          data: humanTaskResult.output,
          timestamp: new Date().toISOString(),
        })
        return {
          messages: this.messages,
          caseStatus: 'waiting_human',
          transition: 'waiting_human',
        }
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

      // ── Tools executed, no terminal action — continue loop ──
      sendEvent({
        type: 'message_stop',
        data: { reason: 'next_turn' },
        timestamp: new Date().toISOString(),
      })
    }

    // Max iterations reached
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
    // [MOCK] Production checks actual token count and invokes
    // autocompact / snip / microcompact as needed.
    return { shouldCompact: false }
  }

  abort() {
    this.abortController.abort()
  }
}
