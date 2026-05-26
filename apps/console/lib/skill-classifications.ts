// Shared classification constants for Skills Admin pages.
// Built-in skills are defined in BUILT_IN_SKILLS (skills.ts).
// Business skills come from the database.

/** System Skills — engine-owned contracts. READ-ONLY in all fields. */
export const SYSTEM_SKILL_NAMES = new Set([
  'create_case',
  'finalize_case',
  'create_human_task',
  'finalize_sub_agent',
  'todo_write',
  'todo_read',
  'read_case_history',
])

/** Special Skill — appears in Skills page as toggle-only; configured in /admin/knowledge. */
export const SPECIAL_SKILL_NAMES = new Set(['kb_hybrid_retrieve'])
