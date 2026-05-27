import type { Tool } from '@anthropic-ai/sdk/resources/index.mjs'
import type { ExecutionStrategy, ContinueDecision, TerminalToolResult } from './types'
import type { Message, SubAgentResult, LoopResult, ToolResult } from '@intera/shared/types'

// ── TaskChecklist ────────────────────────────────────────────────────────

interface TaskChecklist {
  goal: string
  requiredChecks: string[]
  outputFormat: string
  rules: string[]
}

// ── ChecklistStrategy ──────────────────────────────────────────────────────

/**
 * ExecutionStrategy for Sub-Agent execution.
 *
 * - Injects a structured task checklist into the system prompt.
 * - Restricts the sub-agent to only the tools whitelisted in `allowedTools`.
 * - Intercepts `finalize_sub_agent` to produce a `SubAgentResult` and
 *   signal `complete_task`.
 * - Stops the loop if the sub-agent produces no tool calls beyond the
 *   first iteration (stuck guard).
 */
export class ChecklistStrategy implements ExecutionStrategy {
  private allowedTools: Set<string>
  private taskChecklist?: TaskChecklist
  private pendingSubAgentResult: SubAgentResult | null = null

  constructor(opts: {
    allowedTools: Set<string>
    taskChecklist?: TaskChecklist
  }) {
    this.allowedTools = opts.allowedTools
    this.taskChecklist = opts.taskChecklist
  }

  // ── buildPrompt ──────────────────────────────────────────────────────

  buildPrompt(basePrompt: string): string {
    if (!this.taskChecklist) return basePrompt

    const { goal, requiredChecks, outputFormat, rules } = this.taskChecklist

    const checklistSection = [
      `[SUB-AGENT TASK: ${goal}]`,
      'Required checks:',
      ...requiredChecks.map((c) => `  □ ${c}`),
      `Output format: ${outputFormat}`,
      'Rules:',
      ...rules.map((r) => `  - ${r}`),
    ].join('\n')

    return `${basePrompt}\n\n${checklistSection}`
  }

  // ── filterTools ──────────────────────────────────────────────────────

  filterTools(allTools: Tool[], _iteration: number): Tool[] {
    return allTools.filter((t) => this.allowedTools.has(t.name))
  }

  // ── evaluateContinuation ─────────────────────────────────────────────

  evaluateContinuation(
    lastMessage: Message,
    _toolResults: ToolResult[],
    iteration: number,
  ): ContinueDecision {
    // If finalize_sub_agent was intercepted by handleTerminalTool, complete.
    if (this.pendingSubAgentResult) {
      const result = this.pendingSubAgentResult
      this.pendingSubAgentResult = null
      return { action: 'complete_task', result }
    }

    // No tool calls and past the first iteration → stuck, stop.
    const hasToolCalls =
      lastMessage.role === 'assistant' &&
      (lastMessage.toolUses?.length ?? 0) > 0
    if (!hasToolCalls && iteration > 1) {
      return { action: 'stop', reason: 'no_tools' }
    }

    return { action: 'continue' }
  }

  // ── handleTerminalTool ───────────────────────────────────────────────

  handleTerminalTool(toolName: string, input: unknown): TerminalToolResult | null {
    if (toolName !== 'finalize_sub_agent') return { type: 'not_handled' }

    const data = input as Record<string, unknown>

    const findings = (data.findings as Record<string, unknown>) ?? {}
    const evidence = (data.evidence as Record<string, unknown>[]) ?? []
    const recommendation = data.recommendation as string | undefined

    this.pendingSubAgentResult = {
      taskId: '',
      agentName: '',
      caseId: '',
      findings,
      evidence,
      recommendation,
      tokensUsed: 0,
      durationMs: 0,
    }

    const loopResult: LoopResult = {
      messages: [],
      caseStatus: 'resolved' as const,
      transition: 'stage_continue' as const,
      reason: 'finalize_sub_agent called',
    }

    return { type: 'handled', result: loopResult }
  }

  /** Retrieve the SubAgentResult produced by finalize_sub_agent, if any. */
  getSubAgentResult(): SubAgentResult | null {
    return this.pendingSubAgentResult
  }
}
