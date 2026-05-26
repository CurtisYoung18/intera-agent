import type { Tool } from '@anthropic-ai/sdk/resources/index.mjs'
import type { ExecutionPolicy, ContinueDecision, TerminalToolResult } from './types'
import type { AssistantMessage, LoopResult, Message } from '@intera/shared/types'

// ── Core Allowlist ─────────────────────────────────────────────────────

/** Tools allowed in discovery mode (no active case). */
const CORE_ALLOWED_TOOLS = new Set([
  'create_case',
  'propose_cases',
  'kb_hybrid_retrieve',
  'propose_interaction',
])

// ── DiscoveryPolicy ────────────────────────────────────────────────────

/**
 * Execution policy for session mode (no active case).
 *
 * Used for casual chat / QA — no case context, no stage awareness.
 * Allows only lookup tools and case-creation tools.
 */
export class DiscoveryPolicy implements ExecutionPolicy {
  // ── Prompt ───────────────────────────────────────────────────────────

  buildPrompt(basePrompt: string): string {
    return basePrompt
  }

  // ── Tools ────────────────────────────────────────────────────────────

  filterTools(allTools: Tool[], _iteration: number): Tool[] {
    return allTools.filter((t) => CORE_ALLOWED_TOOLS.has(t.name))
  }

  // ── Continuation ─────────────────────────────────────────────────────

  evaluateContinuation(
    lastMessage: Message,
    _toolResults: unknown[],
    _iteration: number,
  ): ContinueDecision {
    // Only assistant messages can carry tool calls.
    if (lastMessage.role !== 'assistant') {
      return { action: 'continue' }
    }

    const toolUses = (lastMessage as AssistantMessage).toolUses

    // No tool calls → LLM chose to respond with text only; stop the loop.
    if (!toolUses || toolUses.length === 0) {
      return { action: 'stop', reason: 'no_tools' }
    }

    // create_case was called → transition to case mode.
    if (toolUses.some((tu) => tu.name === 'create_case')) {
      return { action: 'transition', nextStage: 'collecting' }
    }

    return { action: 'continue' }
  }

  // ── Terminal Tools ───────────────────────────────────────────────────

  handleTerminalTool(
    toolName: string,
    _input: unknown,
  ): TerminalToolResult | null {
    switch (toolName) {
      case 'create_case':
        return {
          type: 'handled',
          result: {
            messages: [],
            caseStatus: 'created',
            transition: 'next_turn',
            reason: 'Case created, transitioning to case mode',
          } satisfies LoopResult,
        }

      case 'propose_cases':
        return {
          type: 'handled',
          result: {
            messages: [],
            caseStatus: 'created',
            transition: 'next_turn',
            reason: 'Proposed case types for user clarification',
          } satisfies LoopResult,
        }

      default:
        return { type: 'not_handled' }
    }
  }
}
