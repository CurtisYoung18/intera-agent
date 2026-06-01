// Shared classification constants for Tools Admin page.
// Built-in skills are defined in BUILT_IN_SKILLS (skills.ts).
// Business skills come from the database.

/** System Tools — engine-managed, READ-ONLY. The agent loop handles these directly. */
export const SYSTEM_SKILL_NAMES = new Set([
  'dispatch_case_agent',
  'propose_cases',
  'finalize_case',
  'finalize_sub_agent',
  'create_human_task',
  'read_case_history',
  'todo_write',
  'todo_read',
])

/** Channel Tools — behavior varies per channel. READ-ONLY. Configured in Channels detail page. */
export const CHANNEL_SKILL_NAMES = new Set([
  'finalize_consultation',
  'request_user_input',
])

/** Special Skill — configured in dedicated pages (not Tools page). */
export const SPECIAL_SKILL_NAMES = new Set<string>([
  // kb_hybrid_retrieve removed — replaced by dynamic kb_search_* tools
])
