// Working-state summary prompt for L2 intra-case compaction.
// Produces a task-focused summary that captures what the agent needs to
// resume work — NOT a user portrait.
//
// P0-2 fix: the old COMPACT_SYSTEM_PROMPT asked for a "user portrait" but
// was used for intra-case compaction (performCompaction). This prompt
// explicitly FORBIDS portrait framing and focuses on task-critical state.

export const CASE_COMPACT_PROMPT = `Summarize this conversation as a working-state snapshot. Focus exclusively on what the agent needs to stay oriented inside this specific case — do NOT describe the user as a person.

Output in this order:

1. Current Focus: The latest customer-visible issue or question in this case. If the case drifted across multiple topics, say that explicitly and identify the current topic.

2. Context Map: Every business fact the agent has verified or the user has confirmed during this conversation. One fact per line. Include identifiers, amounts, dates, statuses, payment channel, account/KYC state, promotion/turnover state, and screenshot/form facts when they are decision-relevant.

3. Topic Ledger: For each topic actually discussed in this case, write the topic, customer claim/request, verified facts, and state: answered, unresolved, escalated, unclear, or waiting_human.

4. Verified System Results: Include only decision-relevant tool/procedure outcomes. Prefer the latest status, timestamp, amount, account/payment/promotion/KYC result, important errors, or "not found" conflicts. Do not list every tool call just because it happened.

5. Open Items: Any unresolved questions, missing information, pending verifications, human handoff state, or conflict between customer evidence and system results. Be specific about what is still unknown and why it matters.

6. Latest Visible Context: The last meaningful customer message and last meaningful assistant message if it affects continuity. Never include blank messages or internal tool transcript blocks.

CRITICAL RULES:
- This is a CASE summary, NOT a user portrait. Do NOT describe "who the user is", their preferences, their history, their personality, or their communication style. That belongs in the profile system — never in a case compaction.
- Do NOT include a "portrait" section. Do NOT describe the user's identity traits, habits, or long-term patterns.
- Do NOT recommend a next action. Record the current focus, verified facts, unresolved state, and latest visible context.
- If the token budget is tight, prioritize sections 1-5 over section 6.
- Keep tool information as human-readable outcomes. Never include raw provider transcript markers such as [assistant tool_use ...] or [user tool_result ...].
- Rich messages matter: include submitted forms, request cards, quick-reply choices, image evidence, and HumanTask handoff notes when they affect the case.

COMPRESSION RULES:
- Facts older than 7 days: one-line summary only.
- Facts older than 30 days: merge into a single aggregate line.
- Recent messages: keep only meaningful customer-visible turns. Do not preserve empty assistant turns or repeated acknowledgements.
- Duplicate facts: keep the most recent value.
- Tool results: summarize by outcome, not full payload.

Respond with TEXT ONLY — no tool calls, no analysis tags, no thinking blocks.`
