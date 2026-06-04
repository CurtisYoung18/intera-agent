// Working-state summary prompt for L2 intra-case compaction.
// Produces a task-focused summary that captures what the agent needs to
// resume work — NOT a user portrait.
//
// P0-2 fix: the old COMPACT_SYSTEM_PROMPT asked for a "user portrait" but
// was used for intra-case compaction (performCompaction). This prompt
// explicitly FORBIDS portrait framing and focuses on task-critical state.

export const CASE_COMPACT_PROMPT = `Summarize this conversation as a working-state snapshot. Focus exclusively on what the agent needs to resume this specific case — do NOT describe the user as a person.

Output in this order:

1. Confirmed Facts: Every fact the agent has verified or the user has confirmed during this conversation. One fact per line. Include identifiers, amounts, dates, statuses — the operational data the agent relies on to make decisions.

2. Tools Run: List every tool call made in this conversation, with the tool name and a one-line summary of what it returned. Include errors and empty results — they are decision-relevant.

3. Open Items: Any unresolved questions, missing information, pending verifications, or tasks the agent still needs to complete. Be specific about what is missing and why it matters.

4. Recent Messages: The last few user and assistant messages, verbatim or near-verbatim. These capture the current turn of the conversation and the customer's latest intent.

5. Next Step: One short, actionable recommendation for what the agent should do next in this specific case.

CRITICAL RULES:
- This is a CASE summary, NOT a user portrait. Do NOT describe "who the user is", their preferences, their history, their personality, or their communication style. That belongs in the profile system — never in a case compaction.
- Do NOT include a "portrait" section. Do NOT describe the user's identity traits, habits, or long-term patterns.
- If the token budget is tight, prioritize sections 1-3 (confirmed facts, tools run, open items) over sections 4-5.

COMPRESSION RULES:
- Facts older than 7 days: one-line summary only.
- Facts older than 30 days: merge into a single aggregate line.
- Recent messages: never compress. Every utterance matters.
- Duplicate facts: keep the most recent value.
- Tool results: summarize by outcome, not full payload.

Respond with TEXT ONLY — no tool calls, no analysis tags, no thinking blocks.`
