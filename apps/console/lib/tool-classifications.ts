// Shared classification constants for Tools workspace.
// Built-in tools are defined in BUILT_IN_TOOLS (tools.ts).
// Custom tools come from the database.

/** System Tools — engine-managed, READ-ONLY. Auto-gifted to every agent. */
export const SYSTEM_TOOL_NAMES = new Set([
  'start_procedure',
  'finalize_procedure',
  'remember',
  'read_chat_memory',
  'read_user_profile',
])

/** Channel Tools — behavior varies per channel. READ-ONLY. Configured in Channels detail page. */
export const CHANNEL_TOOL_NAMES = new Set([
  'create_human_task',
  'ask_user_questions',
])

/** Special tools — configured in dedicated pages (not Tools page). */
export const SPECIAL_TOOL_NAMES = new Set<string>([
  // kb_hybrid_retrieve removed — replaced by dynamic kb_search_* tools
])

/** Retired tool names kept only for filtering old DB rows / historical data. */
export const RETIRED_TOOL_NAMES = new Set([
  'dispatch_case_agent',
  'finalize_case',
])
