// Shared classification constants for Tools Admin page.
// Built-in tools are defined in BUILT_IN_TOOLS (tools.ts).
// Business tools come from the database.

/** System Tools — engine-managed, READ-ONLY. The agent loop handles these directly. */
export const SYSTEM_SKILL_NAMES = new Set([
  'dispatch_case_agent',
  'finalize_case',
  'finalize_case_agent',
  'create_human_task',
])

/** Channel Tools — behavior varies per channel. READ-ONLY. Configured in Channels detail page. */
export const CHANNEL_SKILL_NAMES = new Set([
  'finalize_consultation',
  'ask_user_questions',
])

/** Special Skill — configured in dedicated pages (not Tools page). */
export const SPECIAL_SKILL_NAMES = new Set<string>([
  // kb_hybrid_retrieve removed — replaced by dynamic kb_search_* tools
])
