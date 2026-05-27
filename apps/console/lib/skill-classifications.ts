// Shared classification constants for Skills Admin pages.
// Built-in skills are defined in BUILT_IN_SKILLS (skills.ts).
// Business skills come from the database.

/** System Skills — engine-owned contracts. READ-ONLY in all fields. */
export const SYSTEM_SKILL_NAMES = new Set([
  'create_case',
  'finalize_case',
  'finalize_sub_agent',
  'todo_write',
  'todo_read',
  'read_case_history',
])

/** Special Skill — configured in dedicated pages (not Skills page). */
export const SPECIAL_SKILL_NAMES = new Set([
  'kb_hybrid_retrieve',
  'create_human_task',
])
