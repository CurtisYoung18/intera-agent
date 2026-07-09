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
import { isUnifiedKnowledgeToolName } from './knowledge-tooling'

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
  /** Tools allowed in Core (discovery) mode. Business tools load after Procedure selection. */
  private static readonly CORE_ALLOWED_TOOLS = new Set([
    'start_procedure',
    'search_knowledge',
    'ask_user_questions',
    'create_human_task',
    'read_user_profile',
    'remember',
    'get_current_time',
  ])

  private static isAllowedTool(name: string): boolean {
    if (ConversationLoop.CORE_ALLOWED_TOOLS.has(name)) return true
    if (isUnifiedKnowledgeToolName(name)) return true
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
