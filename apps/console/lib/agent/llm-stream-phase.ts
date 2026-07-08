import Anthropic from '@anthropic-ai/sdk'
import type { Tool as AnthropicTool } from '@anthropic-ai/sdk/resources/index.mjs'
import type {
  AgentConfigData,
  AssistantMessage,
  CaseStatus,
  Message,
  SSEEvent,
  ToolUse,
} from '@intera/shared/types'
import type { SynthesisReason } from '@intera/runtime-core/provider-tool-turn'
import { buildModelList } from './build-model-list'
import { CannotRetryError, FallbackTriggeredError, withRetry } from './api/with-retry'
import { classifyError } from './api/error-classifier'
import { reactiveCompact } from './compact'
import { writeDebugRequest, writeDebugResponse } from './debug-logger'
import { buildHookHitCounts } from './turn-preflight'
import { recordProcedureToolCall } from './session-store'
import type { ChatMemoryManager } from './memory'
import type { HookEngine } from './hook-engine'
import type { HookContextBuilder } from './hook-context-builder'
import type { Profiler } from './profiler'
import { consumeStream, type StreamContentBlock } from './stream-handler'
import { StreamingTextSanitizer } from './streaming-text-sanitizer'
import { StreamingToolExecutor, unwrapToolExecutionPayload } from './streaming-tool-executor'
import { processPendingHookToolCalls as hookToolCalls, type ToolInterceptorContext } from './tool-interceptor'
import type { TraceWriter } from './trace'
import type { ToolRouter } from './tools'
import { hasRecognizedTokenUsage, readInputTokens, readOutputTokens } from './usage-accounting'
import { isKnowledgeToolDefinition } from './knowledge-tooling'

export type LlmStreamTerminalResult = {
  messages: Message[]
  caseStatus: CaseStatus
  transition: 'connection_lost' | 'machine_error'
  currentStage?: string
  reason?: string
}

export type LlmStreamPhaseResult =
  | { kind: 'continue' }
  | { kind: 'terminal'; result: LlmStreamTerminalResult }
  | {
      kind: 'completed'
      assistantMessage: AssistantMessage | null
      assistantPushed: boolean
      fullText: string
      stopReason: string | null
      usage: Record<string, unknown> | null
      streamFatalError: string | null
      streamEndedAt: number
      blocks: Map<number, StreamContentBlock>
      toolExecutor: StreamingToolExecutor
      toolBasedOnEpoch: Map<string, number>
      flushVisibleText: () => void
      discardVisibleText: () => void
    }

export interface LlmStreamPhaseDeps {
  config: AgentConfigData
  configId: string
  caseId: string
  getAnthropicClient: () => Anthropic
  abortController: AbortController
  traceWriter: TraceWriter
  profiler: Profiler
  chatMemory: ChatMemoryManager
  getMessages: () => Message[]
  setMessages: (messages: Message[]) => void
  addMessage: (message: Message) => void
  getCurrentStage: () => string
  getHookEngine: () => HookEngine
  getToolRouter: () => ToolRouter
  hookContextBuilder: HookContextBuilder
  buildToolInterceptorContext: () => ToolInterceptorContext
  emitThinking?: boolean
  dryRun: boolean
}

export interface LlmStreamPhaseInput {
  stagePrompt: string
  stageTools: AnthropicTool[]
  apiMessages: unknown[]
  iterationCount: number
  iterationBasedOnInputEpoch: number
  missingReasons: Map<string, SynthesisReason>
  pendingHookFeedback: string[]
  debugLogsEnabled: boolean
  sendEvent: (event: SSEEvent) => void
}

export class LlmStreamPhase {
  constructor(private readonly deps: LlmStreamPhaseDeps) {}

  async run(input: LlmStreamPhaseInput): Promise<LlmStreamPhaseResult> {
    const toolBasedOnEpoch = new Map<string, number>()
    input.sendEvent({
      type: 'stream_request_start',
      data: null,
      timestamp: this.timestamp(),
    })

    const textSanitizer = new StreamingTextSanitizer()
    const toolExecutor = new StreamingToolExecutor(
      this.deps.getToolRouter().getToolDefinitions(),
      (toolUse, status, renderHints) => {
        const skillDef = this.deps.getToolRouter().getTool(toolUse.name)
        const payload = status !== 'executing' ? unwrapToolExecutionPayload(toolUse.result) : undefined
        const payloadRecord = payload && typeof payload === 'object' && !Array.isArray(payload)
          ? payload as Record<string, unknown>
          : null
        input.sendEvent({
          type: status === 'executing' ? 'tool_executing' : 'tool_result',
          data: {
            name: toolUse.name,
            status,
            result: status !== 'executing' ? toolUse.result : undefined,
            displayVerb: status === 'executing' ? skillDef?.displayVerb : undefined,
            renderHints: renderHints ?? skillDef?.renderHints,
            isKnowledgeTool: isKnowledgeToolDefinition(skillDef),
            knowledgeSourceId: typeof payloadRecord?.knowledgeSourceId === 'string'
              ? payloadRecord.knowledgeSourceId
              : skillDef?.knowledgeSourceId,
            knowledgeSourceName: typeof payloadRecord?.knowledgeSourceName === 'string'
              ? payloadRecord.knowledgeSourceName
              : skillDef?.knowledgeSourceName,
            knowledgeProvider: typeof payloadRecord?.knowledgeProvider === 'string'
              ? payloadRecord.knowledgeProvider
              : skillDef?.knowledgeProvider,
          },
          timestamp: this.timestamp(),
        })
      },
      this.deps.dryRun,
      this.deps.configId,
    )

    const blocks = new Map<number, StreamContentBlock>()
    let assistantPushed = false
    let streamEndedAt = Date.now()
    let streamFatalError: string | null = null
    const visibleTextBuffer: string[] = []
    const streamSendEvent = (event: SSEEvent) => {
      if (event.type === 'text_delta') {
        visibleTextBuffer.push(String(event.data ?? ''))
        return
      }
      input.sendEvent(event)
    }
    const flushVisibleText = () => {
      for (const chunk of visibleTextBuffer) {
        if (!chunk) continue
        input.sendEvent({
          type: 'text_delta',
          data: chunk,
          timestamp: this.timestamp(),
        })
      }
      visibleTextBuffer.length = 0
    }
    const discardVisibleText = () => {
      visibleTextBuffer.length = 0
    }

    let stream: ReturnType<Anthropic.Messages['stream']>
    try {
      stream = await withRetry(
        async (_client, ctx) => {
          return this.deps.getAnthropicClient().messages.stream({
            model: ctx.model,
            max_tokens: ctx.maxTokensOverride ?? (this.deps.config.maxOutputTokens ?? 4096),
            system: input.stagePrompt,
            messages: input.apiMessages as any,
            tools: input.stageTools as any,
            tool_choice: { type: 'auto' as const, disable_parallel_tool_use: false },
            ...(this.deps.config.extendedThinking &&
              (buildModelList().find((model) => model.id === ctx.model)?.supportsThinking ?? false) ? {
              thinking: { type: 'enabled' as const, budget_tokens: this.deps.config.thinkingBudget || 4096 },
            } : {}),
          }, { signal: this.deps.abortController.signal })
        },
        {
          querySource: 'main_loop',
          model: this.deps.config.model,
          fallbackModel: this.deps.config.fallbackModel,
          signal: this.deps.abortController.signal,
          onRetry: (info) => {
            input.sendEvent({
              type: 'retry_pending',
              data: { attempt: info.attempt, delayMs: info.delayMs, errorClass: info.errorClass, message: info.message },
              timestamp: this.timestamp(),
            })
          },
        },
        () => this.deps.getAnthropicClient(),
      )
    } catch (err) {
      if (err instanceof FallbackTriggeredError) {
        input.sendEvent({ type: 'error', data: `Model fallback exhausted: ${err.originalModel}`, timestamp: this.timestamp() })
        return {
          kind: 'terminal',
          result: {
            messages: this.deps.getMessages(),
            transition: 'machine_error',
            caseStatus: this.deps.getCurrentStage() as CaseStatus,
            reason: 'llm_fallback_exhausted',
          },
        }
      }
      if (err instanceof CannotRetryError && err.errorClass === 'context_overflow') {
        this.deps.setMessages(reactiveCompact(this.deps.getMessages()))
        await this.deps.traceWriter.write('loop_decision', 'Reactive compact on context overflow', { error: String(err) })
        return { kind: 'continue' }
      }
      if (err instanceof CannotRetryError && err.errorClass === 'aborted') {
        await this.deps.traceWriter.write('loop_decision', 'Stream aborted', { iteration: input.iterationCount })
        return {
          kind: 'terminal',
          result: {
            messages: this.deps.getMessages(),
            caseStatus: this.deps.getCurrentStage() as CaseStatus,
            transition: 'connection_lost',
            currentStage: this.deps.getCurrentStage(),
            reason: 'connection_lost',
          },
        }
      }
      const classified = err instanceof CannotRetryError ? err.errorClass : classifyError(err)
      const detail = (err as any)?.message || (err as any)?.error?.message || String(err)
      input.sendEvent({ type: 'error', data: `LLM API error (${classified}): ${detail}`, timestamp: this.timestamp() })
      return {
        kind: 'terminal',
        result: {
          messages: this.deps.getMessages(),
          transition: 'machine_error',
          caseStatus: this.deps.getCurrentStage() as CaseStatus,
          reason: `llm_error:${classified}`,
        },
      }
    }

    let debugSeq = -1
    if (input.debugLogsEnabled) {
      console.log(`[DebugMode] Writing request log for case ${this.deps.caseId} iteration ${input.iterationCount}`)
      debugSeq = writeDebugRequest(this.deps.caseId, input.iterationCount, this.deps.config.model, {
        system: input.stagePrompt,
        messages: input.apiMessages as any,
        tools: input.stageTools as any,
        max_tokens: this.deps.config.maxOutputTokens ?? 4096,
        temperature: this.deps.config.temperature,
      })
    }

    await this.deps.traceWriter.writeLlmRequestStart(
      this.deps.config.model,
      this.deps.getMessages().length,
      input.stagePrompt,
      input.apiMessages,
      input.stageTools,
      { type: 'auto' as const, disable_parallel_tool_use: false },
    )

    input.sendEvent({
      type: 'llm_request_start',
      data: {
        model: this.deps.config.model,
        systemPrompt: input.stagePrompt,
        messages: input.apiMessages,
        tools: input.stageTools,
        toolChoice: { type: 'auto' as const, disable_parallel_tool_use: false },
      },
      timestamp: this.timestamp(),
    })

    let assistantMessage: AssistantMessage | null = null
    let fullText = ''
    let stopReason: string | null = null
    let usage: Record<string, unknown> | null = null
    try {
      const streamResult = await consumeStream(stream, blocks, {
        sendEvent: streamSendEvent,
        sanitizeChunk: (text: string) => textSanitizer.feed(text),
        flushSanitizer: () => textSanitizer.flush(),
        recordFirstToken: () => this.deps.profiler.recordFirstToken(),
        emitThinking: this.deps.emitThinking ?? false,
        onToolUseCompleted: async (toolUse: ToolUse, am: AssistantMessage | null) => {
          toolBasedOnEpoch.set(toolUse.id, input.iterationBasedOnInputEpoch)
          recordProcedureToolCall(this.deps.caseId, {
            toolName: toolUse.name,
            toolUseId: toolUse.id,
            basedOnInputEpoch: input.iterationBasedOnInputEpoch,
            toolInput: toolUse.input,
          })

          const hookEngine = this.deps.getHookEngine()
          const preHookEval = await hookEngine.evaluate('PreToolUse', {
            ...this.deps.hookContextBuilder.build('PreToolUse', {
              toolName: toolUse.name,
              toolInput: toolUse.input,
            }),
          }, buildHookHitCounts(hookEngine, this.deps.chatMemory))

          if (preHookEval.summary === 'block') {
            const blockingHooks: string[] = []
            for (const result of preHookEval.results) {
              if (result.action !== 'allow') {
                this.deps.chatMemory.recordHookHit(result.hookName)
                if (result.action === 'block') blockingHooks.push(result.hookName)
              }
            }
            await this.deps.traceWriter.write(
              'loop_decision',
              `Hook blocked Tool: ${toolUse.name}`,
              preHookEval as unknown as Record<string, unknown>,
            )
            input.sendEvent({
              type: 'hook_blocked',
              data: { toolName: toolUse.name, hookNames: blockingHooks },
              timestamp: this.timestamp(),
            })
            input.missingReasons.set(toolUse.id, 'hook_blocked')
            if (preHookEval.feedbackMessage) {
              input.pendingHookFeedback.push(preHookEval.feedbackMessage)
            }
            if (!assistantPushed && am) {
              this.deps.addMessage(am)
              assistantPushed = true
            }
            return
          }

          if (preHookEval.pendingToolCalls?.length) {
            for (const result of preHookEval.results) {
              if (result.action !== 'allow') this.deps.chatMemory.recordHookHit(result.hookName)
            }
            await this.deps.traceWriter.write(
              'loop_decision',
              `Hook escalated Tool: ${toolUse.name}`,
              preHookEval as unknown as Record<string, unknown>,
            )
            input.sendEvent({
              type: 'hook_blocked',
              data: { toolName: toolUse.name, hookNames: preHookEval.results.filter((result) => result.action === 'escalate').map((result) => result.hookName) },
              timestamp: this.timestamp(),
            })
            input.missingReasons.set(toolUse.id, 'hook_escalated')
            if (preHookEval.feedbackMessage) {
              input.pendingHookFeedback.push(preHookEval.feedbackMessage)
            }
            if (!assistantPushed && am) {
              this.deps.addMessage(am)
              assistantPushed = true
            }
            await hookToolCalls(this.deps.buildToolInterceptorContext(), preHookEval, input.sendEvent)
            return
          }

          toolExecutor.enqueue(toolUse)
        },
      })

      assistantMessage = streamResult.assistantMessage
      fullText = streamResult.fullText
      stopReason = streamResult.stopReason
      usage = streamResult.usage

      if (stopReason) {
        await this.deps.traceWriter.write(
          'stream_event',
          `stop_reason: ${stopReason}`,
          { stopReason, iteration: input.iterationCount },
        )
      }
    } catch (streamErr) {
      const errStr = String(streamErr)
      console.error('[AgentLoop] Stream error:', streamErr)

      if (this.deps.abortController.signal.aborted) {
        await toolExecutor.waitForAll().catch(() => {})
        await this.deps.traceWriter.write('loop_decision', 'Stream aborted (connection lost)', {
          iteration: input.iterationCount,
        })
        return {
          kind: 'terminal',
          result: {
            messages: this.deps.getMessages(),
            caseStatus: this.deps.getCurrentStage() as CaseStatus,
            transition: 'connection_lost',
            currentStage: this.deps.getCurrentStage(),
            reason: 'connection_lost',
          },
        }
      }

      if (errStr.includes('413') || errStr.includes('context_length_exceeded')) {
        this.deps.setMessages(reactiveCompact(this.deps.getMessages()))
        await this.deps.traceWriter.write('loop_decision', 'Reactive compact on stream error', { error: errStr })
        return { kind: 'continue' }
      }

      streamFatalError = errStr
    }

    streamEndedAt = Date.now()

    if (usage && hasRecognizedTokenUsage(usage)) {
      const calledToolNames = [...blocks.values()].filter((block) => block.type === 'tool_use').map((block) => block.name)
      if (input.debugLogsEnabled) {
        writeDebugResponse(this.deps.caseId, input.iterationCount, this.deps.config.model, debugSeq, {
          stop_reason: stopReason,
          usage,
          text: fullText.slice(0, 100000),
        })
      }
      await this.deps.traceWriter.writeLlmResponse(stopReason, usage, input.iterationCount, fullText, calledToolNames, this.deps.config.model)
      input.sendEvent({
        type: 'llm_response',
        data: { stopReason, usage, iteration: input.iterationCount, model: this.deps.config.model, textPreview: fullText.slice(0, 3000) },
        timestamp: this.timestamp(),
      })
      this.deps.profiler.addTokens(readInputTokens(usage), readOutputTokens(usage))
    }

    return {
      kind: 'completed',
      assistantMessage,
      assistantPushed,
      fullText,
      stopReason,
      usage,
      streamFatalError,
      streamEndedAt,
      blocks,
      toolExecutor,
      toolBasedOnEpoch,
      flushVisibleText,
      discardVisibleText,
    }
  }

  private timestamp(): string {
    return new Date().toISOString()
  }
}
