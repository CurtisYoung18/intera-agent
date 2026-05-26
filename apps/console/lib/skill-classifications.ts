// Shared classification constants for Skills Admin pages.
// Built-in skills are defined in BUILT_IN_SKILLS (skills.ts).
// Business skills come from the database.

/** Skill names that are defined in BUILT_IN_SKILLS — these are System Skills. */
export const BUILT_IN_SKILL_NAMES = new Set([
  'create_case', 'propose_cases', 'read_case_history', 'query_order_status',
  'query_payment_channel_status', 'search_delay_notice', 'get_account_status',
  'get_kyc_status', 'get_latest_withdrawal', 'get_withdraw_conditions',
  'get_transaction_history', 'get_active_promotions', 'get_eligible_promotions',
  'ocr_receipt', 'create_human_task', 'finalize_case', 'kb_hybrid_retrieve',
  'request_user_input', 'finalize_consultation', 'propose_interaction',
  'todo_write', 'todo_read', 'finalize_sub_agent',
])

/** Critical System Skills — core name/inputSchema/mode fields are READ-ONLY. */
export const CRITICAL_SKILL_NAMES = new Set([
  'create_case', 'finalize_case', 'create_human_task',
  'finalize_sub_agent', 'todo_write', 'todo_read',
])
