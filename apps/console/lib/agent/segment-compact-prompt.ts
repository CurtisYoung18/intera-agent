// Conversation-segment compact prompt.
// A segment may be followed by a totally different customer intent, so this
// prompt records facts and state without predicting the next action.

export const SEGMENT_COMPACT_PROMPT = `Summarize this completed conversation segment for future continuity.

Goal:
Create a compact factual handoff for the same customer or external chat. The next user message may be about a different issue, so do not predict or recommend the next action.

Output in this exact structure:

1. Segment Scope
- Time range of this segment if available.
- Conversation status: resolved, escalated, waiting_human, abandoned, idle_closed, or unknown.
- Topics actually discussed in this segment. List multiple topics if the segment drifted.

2. Durable Customer Facts
- Stable facts that may be reused across future issues, such as confirmed member_id, account identity, language preference, verified KYC/account status, or durable contact detail.
- Include exact values only when confirmed by the customer, a form answer, a rich-message response, or a verified tool result.
- Leave empty if none.

3. Topic Ledger
For each topic discussed, write:
- Topic:
- Customer claim / request:
- Verified facts:
- Current state: answered, unresolved, escalated, unclear, or waiting_human.

4. Verified System Results
- Include only decision-relevant tool/procedure results.
- Prefer latest status, timestamp, amount, account/payment state, promotion/turnover/account/KYC result, important error, or "not found" conflict.
- Do not list every tool call.
- Do not include raw JSON, tool_use/tool_result text, trace IDs, run IDs, or internal protocol details.

5. Customer Evidence
- Summarize uploaded screenshots, submitted forms, request cards, quick-reply choices, or customer-provided evidence.
- Keep filenames only if they are the only useful reference.

6. Human Handoff
- If a real HumanTask or handoff note exists, include queue, status, and a concise handoff note.
- If no real HumanTask exists, leave empty.

7. Latest Visible Context
- Last meaningful customer message.
- Last meaningful assistant message, only if it affects continuity.
- Do not include blank messages or internal notes.

Rules:
- Target 500-800 tokens. Hard maximum 1000 tokens.
- Facts over narrative.
- Separate durable facts from segment-specific facts.
- Do not recommend the next step.
- Do not tell the next agent "do not ask again"; just provide the facts already known.
- If space is tight, prioritize Durable Customer Facts, Topic Ledger, Verified System Results, and Human Handoff.
- Respond with text only.`
