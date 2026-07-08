import type { SSEEvent } from '@intera/shared/types'
import type { ChatMemoryManager } from './memory'
import { makeInternalRuntimeMessage } from './message-builder'
import { buildHookHitCounts } from './turn-preflight'
import type { HookEngine } from './hook-engine'
import type { HookContextBuilder } from './hook-context-builder'
import type { TraceWriter } from './trace'
import type { ToolRouter } from './tools'
import type { ToolExecutionResult } from './streaming-tool-executor'
import { unwrapToolExecutionPayload } from './streaming-tool-executor'
import { processPendingHookToolCalls as hookToolCalls, type ToolInterceptorContext } from './tool-interceptor'
import {
  shouldPersistToolResultToChatMemory,
  shouldRecordProcedureEvidence,
} from './runtime-managed-tools'
import { recordProcedureToolResult } from './session-store'
import { isKnowledgeToolDefinition, isKnowledgeToolName } from './knowledge-tooling'

export interface PostToolUsePhaseDeps {
  caseId: string
  chatMemory: ChatMemoryManager
  getHookEngine: () => HookEngine
  hookContextBuilder: HookContextBuilder
  traceWriter: TraceWriter
  getToolRouter: () => ToolRouter
  addMessage: (content: string) => void
  buildToolInterceptorContext: () => ToolInterceptorContext
  shouldDeferTerminalToolTrace?: (toolName: string) => boolean
}

export interface PostToolUsePhaseInput {
  toolResults: ToolExecutionResult[]
  toolBasedOnEpoch: Map<string, number>
  iterationBasedOnInputEpoch: number
  iterationCount: number
  nudgeCount: number
  sendEvent: (event: SSEEvent) => void
}

export class PostToolUsePhase {
  constructor(private readonly deps: PostToolUsePhaseDeps) {}

  async run(input: PostToolUsePhaseInput): Promise<{ nudgeCount: number }> {
    for (const result of input.toolResults) {
      await this.recordToolResult(result, input)
    }

    if (input.toolResults.length === 0) {
      return { nudgeCount: input.nudgeCount }
    }

    let nudgeCount = input.nudgeCount > 0 ? 0 : input.nudgeCount
    try {
      for (const result of input.toolResults) {
        const hookEngine = this.deps.getHookEngine()
        const payload = unwrapToolExecutionPayload(result.output)
        const postHookEval = await hookEngine.evaluate('PostToolUse', {
          ...this.deps.hookContextBuilder.build('PostToolUse', {
            toolName: result.name,
            toolInput: result.toolUse?.input,
            toolOutput: payload,
            toolError: (result.output as { error?: string })?.error,
          }),
        }, buildHookHitCounts(hookEngine, this.deps.chatMemory))

        for (const r of postHookEval.results) {
          if (r.action !== 'allow') {
            this.deps.chatMemory.recordHookHit(r.hookName)
            await this.deps.traceWriter.write(
              'loop_decision',
              `Hook ${r.action}: ${r.hookName}`,
              {
                checkpoint: 'PostToolUse',
                result: r.action,
                reason: r.reason,
                toolName: result.name,
                model: r.modelUsed,
              },
            )
          }
        }

        if (postHookEval.feedbackMessage) {
          this.deps.addMessage(postHookEval.feedbackMessage)
        }

        if (postHookEval.pendingToolCalls?.length) {
          await hookToolCalls(this.deps.buildToolInterceptorContext(), postHookEval, input.sendEvent)
        }

        if (!postHookEval.pendingToolCalls?.length && postHookEval.summary === 'escalate') {
          await hookToolCalls(this.deps.buildToolInterceptorContext(), postHookEval, input.sendEvent)
        }
      }
    } catch (hookErr) {
      console.error('[AgentLoop] PostToolUse Hook evaluation failed:', hookErr)
    }

    return { nudgeCount }
  }

  private async recordToolResult(
    result: ToolExecutionResult,
    input: PostToolUsePhaseInput,
  ): Promise<void> {
    const payload = unwrapToolExecutionPayload(result.output)
    if (shouldPersistToolResultToChatMemory(result.name)) {
      await this.deps.chatMemory.applyToolResult(result.name, payload)
    }

    const basedOnInputEpoch = result.toolUse?.id
      ? input.toolBasedOnEpoch.get(result.toolUse.id)
      : undefined
    const deferTerminalTrace = this.deps.shouldDeferTerminalToolTrace?.(result.name) === true
    const toolDefinition = this.deps.getToolRouter().getTool(result.name)
    const payloadRecord = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : null
    const knowledgeSourceId = typeof payloadRecord?.knowledgeSourceId === 'string'
      ? payloadRecord.knowledgeSourceId
      : toolDefinition?.knowledgeSourceId
    const knowledgeSourceName = typeof payloadRecord?.knowledgeSourceName === 'string'
      ? payloadRecord.knowledgeSourceName
      : toolDefinition?.knowledgeSourceName
    const knowledgeProvider = typeof payloadRecord?.knowledgeProvider === 'string'
      ? payloadRecord.knowledgeProvider
      : toolDefinition?.knowledgeProvider
    const isKnowledgeTool = isKnowledgeToolDefinition(toolDefinition) || isKnowledgeToolName(result.name) || !!knowledgeSourceId
    if (!deferTerminalTrace && shouldRecordProcedureEvidence(result.name)) {
      recordProcedureToolResult(this.deps.caseId, {
        toolName: result.name,
        toolUseId: result.toolUse?.id,
        basedOnInputEpoch: basedOnInputEpoch ?? input.iterationBasedOnInputEpoch,
        toolOutput: payload,
        toolError: (result.output as { error?: string })?.error,
        isKnowledgeTool,
      })
    }

    if (deferTerminalTrace) return

    await this.deps.traceWriter.write(
      'tool_result',
      `Tool: ${result.name}`,
      {
        toolName: result.name,
        output: payload,
        latencyMs: result.latencyMs,
        iteration: input.iterationCount,
        input: result.toolUse?.input,
        renderHints: result.renderHints,
        basedOnInputEpoch: basedOnInputEpoch ?? input.iterationBasedOnInputEpoch,
        isKnowledgeTool,
        knowledgeSourceId,
        knowledgeSourceName,
        knowledgeProvider,
      },
    )
  }
}

export function addHookFeedbackMessage(messages: { push: (message: ReturnType<typeof makeInternalRuntimeMessage>) => void }): (content: string) => void {
  return (content) => messages.push(makeInternalRuntimeMessage(content, 'hook_feedback'))
}
