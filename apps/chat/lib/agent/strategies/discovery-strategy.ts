import type { Tool } from '@anthropic-ai/sdk/resources/index.mjs'
import type { ExecutionStrategy, ContinueDecision, TerminalToolResult } from './types'
import type { AssistantMessage, LoopResult, Message } from '@intera/shared/types'

// ── Core Allowlist ─────────────────────────────────────────────────────

/** Tools allowed in discovery mode (no active case). */
const CORE_ALLOWED_TOOLS = new Set([
  'dispatch_case_agent',
  'propose_cases',
])

function isCoreAllowed(name: string): boolean {
  if (CORE_ALLOWED_TOOLS.has(name)) return true
  if (name.startsWith('kb_search_')) return true
  return false
}

// ── DiscoveryStrategy ────────────────────────────────────────────────────

/**
 * Execution policy for session mode (no active case).
 *
 * Used for casual chat / QA — no case context, no stage awareness.
 * Allows only lookup tools and case-creation tools.
 */
export class DiscoveryStrategy implements ExecutionStrategy {
  // ── Prompt ───────────────────────────────────────────────────────────

  buildPrompt(basePrompt: string): string {
    return basePrompt
  }

  // ── Tools ────────────────────────────────────────────────────────────

  filterTools(allTools: Tool[], _iteration: number): Tool[] {
    return allTools.filter((t) => isCoreAllowed(t.name))
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

    // dispatch_case_agent was called → transition to case mode.
    if (toolUses.some((tu) => tu.name === 'dispatch_case_agent')) {
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
      case 'dispatch_case_agent':
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
