// Generic ReAct loop — extracted from AgentLoop.runReActLoop().
// Used by SubAgent for multi-turn tool-using investigation.
// Stateless: all dependencies passed as parameters.

import Anthropic from '@anthropic-ai/sdk'
import type { Tool } from '@anthropic-ai/sdk/resources'
import type { Message, ToolUse, SSEEvent, AgentContext, ToolResult, ToolDefinition } from '@intera/shared/types'
import { StreamingToolExecutor, unwrapToolExecutionPayload } from './streaming-tool-executor'
import { withRetry, CannotRetryError, FallbackTriggeredError } from './api/with-retry'
import type { ExecutionStrategy } from './strategies/types'
import type { LoopResult } from './loop'

/** Build Anthropic tool definitions from skill definitions. */
export function buildAnthropicTools(skillDefinitions: ToolDefinition[]): Tool[] {
  return skillDefinitions
    .filter((s) => s.enabled)
    .map((s) => ({
      name: s.name,
      description: s.description,
      input_schema: s.inputSchema as Tool['input_schema'],
    }))
}

/**
 * Run a generic ReAct loop with tool execution and policy evaluation.
 * Called by SubAgent.run() — stateless, all context passed as params.
 */
export async function runReActLoop(
  client: Anthropic,
  model: string,
  fallbackModel: string | undefined,
  systemPrompt: string,
  skillDefinitions: ToolDefinition[],
  ctx: AgentContext,
  policy: ExecutionStrategy,
  sendEvent: (event: SSEEvent) => void,
  taskPrompt: string,
  abortController?: AbortController,
): Promise<LoopResult> {
  const ac = abortController ?? new AbortController()
  let totalTokens = 0

  const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [
    { role: 'user', content: taskPrompt },
  ]

  for (let iter = 0; iter < ctx.maxIterations; iter++) {
    if (ac.signal.aborted) break

    const stagePrompt = policy.buildPrompt(systemPrompt)
    const allAnthropicTools = buildAnthropicTools(skillDefinitions)
    const stageTools = policy.filterTools(allAnthropicTools, iter)

    let msg: Anthropic.Messages.Message
    try {
      msg = await withRetry(
        (retryClient, retryCtx) => retryClient.messages.create({
          model: retryCtx.model,
          max_tokens: 4096,
          temperature: 0.3,
          system: stagePrompt,
          tools: stageTools.length > 0 ? stageTools : undefined,
          messages: messages as any,
        }, { signal: ac.signal }),
        { querySource: 'sub_agent_loop', model, fallbackModel, signal: ac.signal },
        () => client,
      )
    } catch (err) {
      if (err instanceof FallbackTriggeredError) {
        return { messages: [], caseStatus: 'escalated' as const, transition: 'waiting_human' as const, reason: 'model_fallback_exhausted' }
      }
      if (err instanceof CannotRetryError && err.errorClass === 'aborted') {
        return { messages: [], caseStatus: 'escalated' as const, transition: 'connection_lost' as const, reason: 'aborted' }
      }
      if (err instanceof CannotRetryError) {
        return { messages: [], caseStatus: 'escalated' as const, transition: 'waiting_human' as const, reason: `sub_agent_llm_${err.errorClass}` }
      }
      throw err
    }

    const usage = (msg as any).usage || {}
    totalTokens += (usage.input_tokens || 0) + (usage.output_tokens || 0)

    let textContent = ''
    const toolUses: ToolUse[] = []

    for (const block of msg.content) {
      if (block.type === 'text') {
        textContent += (block as any).text
      } else if (block.type === 'tool_use') {
        toolUses.push({
          id: (block as any).id,
          name: (block as any).name,
          input: (block as any).input || {},
        })
      }
    }

    sendEvent({ type: 'text_delta', data: textContent, timestamp: new Date().toISOString() })

    const assistantMsg: Message = {
      id: crypto.randomUUID(),
      role: 'assistant' as const,
      content: textContent,
      toolUses: toolUses.length > 0 ? toolUses : undefined,
      createdAt: new Date(),
    }

    // Intercept terminal tools before execution
    for (const tu of toolUses) {
      const terminalResult = policy.handleTerminalTool(tu.name, tu.input)
      if (terminalResult && terminalResult.type === 'handled') {
        messages.push({ role: 'assistant' as const, content: msg.content })
        const result = terminalResult.result
        return {
          messages: [assistantMsg],
          caseStatus: result.caseStatus,
          transition: result.transition as LoopResult['transition'],
          currentStage: result.currentStage,
          reason: result.reason,
          pendingSubAgents: result.pendingSubAgents,
        }
      }
    }

    // No tool calls — evaluate continuation
    if (toolUses.length === 0) {
      messages.push({ role: 'assistant' as const, content: msg.content })
      const decision = await policy.evaluateContinuation(assistantMsg, [], iter + 1)
      if (decision.action === 'complete_task') {
        return { messages: [assistantMsg], caseStatus: 'resolved' as const, transition: 'stage_continue' as const, reason: 'sub_agent_complete' }
      }
      if (decision.action === 'stop') {
        return { messages: [assistantMsg], caseStatus: 'resolved' as const, transition: 'stage_continue' as const, reason: decision.reason }
      }
      continue
    }

    // Execute tools
    const execResults = await StreamingToolExecutor.executeAll(skillDefinitions, toolUses, undefined, false)

    const toolResultBlocks = execResults.map((er) => {
      const toolUseId = er.toolUse?.id ?? toolUses.find((tu) => tu.name === er.name)?.id ?? ''
      return { type: 'tool_result' as const, tool_use_id: toolUseId, content: JSON.stringify(unwrapToolExecutionPayload(er.output)) }
    })

    // S1: Guarantee one tool_result per tool_use
    const completedIds = new Set(execResults.map((er) => er.toolUse?.id ?? toolUses.find((tu) => tu.name === er.name)?.id ?? ''))
    const missingBlocks: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = []
    for (const tu of toolUses) {
      if (!completedIds.has(tu.id)) {
        missingBlocks.push({ type: 'tool_result' as const, tool_use_id: tu.id, content: JSON.stringify({ error: 'tool_execution_failed', reason: 'executor_did_not_produce_result' }) })
      }
    }
    const allToolResultBlocks = [...toolResultBlocks, ...missingBlocks]

    messages.push({ role: 'assistant' as const, content: msg.content })
    messages.push({ role: 'user' as const, content: allToolResultBlocks })

    for (const tu of toolUses) {
      sendEvent({ type: 'sub_agent_progress', data: { agentName: ctx.agentId, toolName: tu.name }, timestamp: new Date().toISOString() })
    }

    const policyToolResults: ToolResult[] = execResults.map((er) => ({ ok: true, output: er.output, latencyMs: er.latencyMs }))
    const decision = await policy.evaluateContinuation(assistantMsg, policyToolResults, iter + 1)

    if (decision.action === 'complete_task') {
      return { messages: [assistantMsg], caseStatus: 'resolved' as const, transition: 'stage_continue' as const, reason: 'sub_agent_complete' }
    }
    if (decision.action === 'stop') {
      return { messages: [assistantMsg], caseStatus: 'resolved' as const, transition: 'stage_continue' as const, reason: decision.reason }
    }
  }

  return { messages: [], caseStatus: 'escalated' as const, transition: 'stage_continue' as const, reason: 'max_iterations' }
}
