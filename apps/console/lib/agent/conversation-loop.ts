// Intera Harness - ConversationLoop
// Core (discovery) mode handler — extracted from AgentLoop as Phase 2.
//
// Responsibilities:
//   • Builds Core-mode system prompt (lightweight, no stage awareness)
//   • Filters tools to the Core allowlist (lookup tools + case creation only)
//
// ConversationLoop does NOT own a ReAct loop — the shared loop lives in
// AgentLoop, which delegates prompt and tool decisions to this class.

import type { Tool } from '@anthropic-ai/sdk/resources/index.mjs'

// ---------------------------------------------------------------------------
// Service bag
// ---------------------------------------------------------------------------

export interface ConversationLoopServices {
  /** Pre-resolved Core system prompt (CORE_SYSTEM_PROMPT with placeholders filled). */
  coreSystemPrompt: string
}

// ---------------------------------------------------------------------------
// ConversationLoop
// ---------------------------------------------------------------------------

export class ConversationLoop {
  /** Tools allowed in Core (discovery) mode — lookup tools + case creation only. */
  private static readonly CORE_ALLOWED_TOOLS = new Set([
    'get_account_status', 'get_kyc_status',
    'get_latest_deposit', 'get_latest_withdrawal', 'get_transaction_history',
    'get_active_promotions', 'get_eligible_promotions', 'get_recommended_games',
    'get_bet_history', 'get_withdraw_conditions', 'read_case_history',
    'dispatch_case_agent',
    'request_user_input',  // needed for asking member_id before creating a case
    'read_chat_memory',    // memory injection — system_info
    'read_user_profile',   // memory injection — system_info
  ])

  private static isAllowedTool(name: string): boolean {
    if (ConversationLoop.CORE_ALLOWED_TOOLS.has(name)) return true
    if (name.startsWith('kb_search_')) return true
    return false
  }

  constructor(private readonly services: ConversationLoopServices) {}

  // ── Prompt ───────────────────────────────────────────────────────────────

  /** Build the Core (discovery) mode system prompt. */
  buildPrompt(): string {
    return this.services.coreSystemPrompt
  }

  // ── Tools ────────────────────────────────────────────────────────────────

  /** Filter tools to the Core allowlist — excludes terminal case tools and investigation tools. */
  filterTools(allTools: Tool[]): Tool[] {
    return allTools.filter((t) => ConversationLoop.isAllowedTool(t.name))
  }
}
