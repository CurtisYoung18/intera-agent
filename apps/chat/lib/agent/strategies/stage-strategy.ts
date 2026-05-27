// Intera Harness — StageStrategy
// ExecutionStrategy for executionMode='stage'.
// LLM-driven execution with stage transitions, tool allowlisting,
// and nudge-based progressive narrowing of available tools.
//
// This is the DEFAULT policy for case execution.

import type { Tool } from '@anthropic-ai/sdk/resources/index.mjs'
import type { Message, LoopResult, ToolResult, StageConfig } from '@intera/shared/types'
import type { ContinueDecision, TerminalToolResult } from './types'
import type { StageExecutor } from '../stage-executor'

// ── Terminal tools always available regardless of stage filtering ──
const TERMINAL_TOOLS = new Set([
  'create_human_task',
  'finalize_case',
  'request_user_input',
  'propose_cases',
  'finalize_consultation',
])

export interface StageStrategyOptions {
  /** Stage configuration for the current stage. */
  stageConfig?: StageConfig
  /** StageExecutor instance for transition evaluation and nudge generation. */
  stageExecutor?: StageExecutor
  /** Current nudge count (drives progressive tool narrowing). */
  nudgeCount?: number
}

// NOTE: StageStrategy conforms to the ExecutionStrategy interface shape but does
// not formally `implements ExecutionStrategy` because evaluateContinuation must
// be async (StageExecutor.evaluateTransition() may call an LLM), while the
// current ExecutionStrategy interface declares a synchronous return type.
// The interface in types.ts should be updated to Promise<ContinueDecision>.
export class StageStrategy {
  private stageConfig?: StageConfig
  private stageExecutor?: StageExecutor
  private nudgeCount: number

  constructor(options: StageStrategyOptions = {}) {
    this.stageConfig = options.stageConfig
    this.stageExecutor = options.stageExecutor
    this.nudgeCount = options.nudgeCount ?? 0
  }

  // ── Prompt building ──────────────────────────────────────────────────

  /**
   * Prepends stage context (current stage, goal, required/available skills,
   * SOP appendix if present) to the base prompt.
   */
  buildPrompt(basePrompt: string): string {
    // Delegate to StageExecutor when available (includes evidence requirements
    // and transition info in addition to stage description and skills).
    if (this.stageExecutor) {
      const stage = this.stageExecutor.getCurrentStage()
      return this.stageExecutor.buildStagePrompt(stage, basePrompt)
    }

    const cfg = this.stageConfig
    if (!cfg) return basePrompt

    const parts: string[] = [basePrompt]

    if (cfg.systemPrompt) {
      parts.push(`\n## Stage: ${cfg.name}\n${cfg.systemPrompt}`)
    } else if (cfg.description) {
      parts.push(`\n## Current Stage: ${cfg.name}\n${cfg.description}`)
    }

    if (cfg.requiredSkills?.length) {
      parts.push(
        `\n**Required actions in this stage:** ${cfg.requiredSkills.join(', ')}`,
      )
    }

    if (cfg.availableSkills?.length) {
      parts.push(
        `**Available tools:** ${cfg.availableSkills.join(', ')}`,
      )
    }

    // Inject SOP appendix when present
    if (cfg.sop) {
      parts.push(`\n## SOP Appendix\n${cfg.sop}`)
    }

    return parts.join('\n')
  }

  // ── Tool filtering ───────────────────────────────────────────────────

  /**
   * Filters to availableSkills whitelist. After nudge_count >= 2,
   * progressively narrows to requiredSkills only (plus terminal tools).
   */
  filterTools(allTools: Tool[], _iteration: number): Tool[] {
    const cfg = this.stageConfig
    if (!cfg?.availableSkills?.length) return allTools

    // Nudge >= 2: progressive narrowing to requiredSkills only.
    // Forces the LLM to call missing required tools by removing all other
    // tools from the available set (terminal tools remain for exit paths).
    if (this.nudgeCount >= 2 && cfg.requiredSkills?.length) {
      const forced = new Set(cfg.requiredSkills)
      TERMINAL_TOOLS.forEach((t) => forced.add(t))
      return allTools.filter((t) => forced.has(t.name))
    }

    // Normal operation: allow configured skills + terminal tools + kb_search_*
    const allowed = new Set(cfg.availableSkills)
    TERMINAL_TOOLS.forEach((t) => allowed.add(t))
    const isAllowed = (name: string) => allowed.has(name) || name.startsWith('kb_search_')

    // Prevent duplicate case creation — once past the "created" stage,
    // remove create_case so the agent doesn't call it again.
    if (cfg.name !== 'created') {
      allowed.delete('create_case')
    }

    return allTools.filter((t) => isAllowed(t.name))
  }

  // ── Continuation decision ────────────────────────────────────────────

  /**
   * Delegates to StageExecutor.evaluateTransition() if available.
   * Otherwise uses a simple heuristic:
   *  - finalize_case tool use → stop (resolved)
   *  - create_human_task tool use → stop (waiting_human)
   *  - otherwise → continue
   */
  async evaluateContinuation(
    lastMessage: Message,
    _toolResults: ToolResult[],
    iteration: number,
  ): Promise<ContinueDecision> {
    // Delegate to StageExecutor for full transition evaluation
    // (handles manual, auto-condition, and LLM-evaluation transition types).
    if (this.stageExecutor) {
      const stage = this.stageExecutor.getCurrentStage()
      const eval_ = await this.stageExecutor.evaluateTransition(stage, iteration)

      if (eval_.shouldTransition) {
        if (eval_.nextStage) {
          return { action: 'transition', nextStage: eval_.nextStage }
        }
        // End of stage pipeline — no further stages
        return { action: 'stop', reason: eval_.reason || 'all stages complete' }
      }

      return { action: 'continue' }
    }

    // No StageExecutor — fall back to simple heuristic based on the
    // assistant's tool calls in the last message.
    if ('toolUses' in lastMessage) {
      const toolUses = (lastMessage as { toolUses?: Array<{ name: string }> }).toolUses
      if (toolUses?.length) {
        const names = toolUses.map((t) => t.name)

        if (names.includes('finalize_case')) {
          return { action: 'stop', reason: 'case resolved via finalize_case' }
        }

        if (names.includes('create_human_task')) {
          return { action: 'stop', reason: 'waiting human via create_human_task' }
        }
      }
    }

    return { action: 'continue' }
  }

  // ── Terminal tool interception ───────────────────────────────────────

  /**
   * Intercepts terminal tools and returns the appropriate LoopResult
   * to short-circuit the agent loop.
   *
   *  - finalize_case → resolved LoopResult
   *  - create_human_task → waiting_human LoopResult
   *  - everything else → not_handled (pass through to normal execution)
   */
  handleTerminalTool(
    toolName: string,
    _input: unknown,
  ): TerminalToolResult | null {
    if (toolName === 'finalize_case') {
      return {
        type: 'handled',
        result: {
          messages: [],
          caseStatus: 'resolved',
          transition: 'stage_continue',
          reason: 'case finalized by agent',
        },
      }
    }

    if (toolName === 'create_human_task') {
      return {
        type: 'handled',
        result: {
          messages: [],
          caseStatus: 'waiting_human',
          transition: 'stage_continue',
          reason: 'case escalated to human',
        },
      }
    }

    return { type: 'not_handled' }
  }
}
