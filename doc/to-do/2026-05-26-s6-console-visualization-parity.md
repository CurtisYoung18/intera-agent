# S6 — Console Visualization Parity

> **Wave 2, sub-project 6 of 6.** Final piece of the Intera-vs-CC alignment audit.
> **Depends on**: S1–S5 all merged. S6 visualizes the abstractions the previous specs put in place.
> **Composes with**: console-audit-v5 (already implementing the structural fixes), case-type-subagent-ux addendum (already implementing case-type IA).

---

## 0. The goal (one sentence)

> **Bring the console to the point where a tech-member operator can configure, observe, and debug a deployed agent end-to-end without reading code — making the engine's new capabilities (built-in tool registry, channel binding, sub-agent dispatch, S1's invariant traces) first-class in the UI.**

After S6:
- **Live trace viewer** shows the engine's state machine as it runs — iteration boundaries, S1's tool-result invariant assertions, S2's retry events, sub-agent dispatches, channel-render decisions.
- **Sub-agent execution graph** visualizes the parent + dispatched sub-agents as a tree with status, model, tool calls, and findings — animated when running.
- **Render-hint preview** lets operators see how a tool's output will appear on each configured channel without launching a real chat.
- **Tool source labels** (built-in vs business vs sub-agent) make the editor's permission model obvious.
- **Trace dashboards** aggregate retry, fallback, invariant, channel-filter events from S1–S5 so operators can spot drift before a customer notices.

---

## 1. Why this is needed

### 1.1 Today's shape

- [`apps/console/components/ops/case-trace-view.tsx`](apps/console/components/ops/case-trace-view.tsx) renders trace rows in a flat list with per-action accents. Good baseline; doesn't visualize structure (iteration boundaries, sub-agent boundaries, retry attempts).
- `/ops/chats/[chatId]` is the closest thing to a debug view. It's read-after-the-fact, not live.
- No way to visualize what a tool's output will look like across channels — operators have to launch a real chat session and trigger the tool.
- No aggregation: "how many retries fired this week?" requires SQL.

### 1.2 What S1–S5 added that the console doesn't yet show

| Engine capability | New trace event | Console surface today |
|---|---|---|
| S1 — tool-result invariant | `tool_result_synthesized` (new) | None |
| S2 — centralized retry | `api_retry_recovered`, `api_call_failed`, `api_model_fallback`, `api_aborted` | None |
| S3 — loop slimming | `Continue / Terminal` transition logging | Trace view shows individual actions; no iteration grouping |
| S4 — tool interface | tool `source: 'builtin' \| 'business'`; `dispatch_subagent` | Skills page shows tier (post-console-audit-v5); no source label |
| S5 — channel binding | `channel_skill_filtered` (new) | None |
| Sub-agent registry (case-type-subagent-ux) | Sub-agent dispatch events | Per-case sub-agent shown as flat events; no parent/child tree |

S6 is the visualization layer for all of this.

---

## 2. Design

### 2.1 Live trace viewer

**Location**: `/ops/chats/[chatId]` becomes the canonical chat debugger. The existing route is augmented; no new route needed.

**Layout** (replaces the current flat-list trace view):

```
┌─ Chat: chat_20260526_abc123 ─────────────────────────────────┐
│ Customer: jayabaji   ·   Channel: livechat   ·   Status: live │
├──────────────────────────────────────────────────────────────┤
│ Cases in this chat (1)                                       │
│   case_20260526_xyz: withdrawal_issue · investigating       │
├──────────────────────────────────────────────────────────────┤
│ Live trace (iteration-grouped)                              │
│                                                              │
│ ▼ Turn 1   user: "我的提现还没到账"          09:12:34       │
│   ▼ Iteration 1                                              │
│     • fact_extracted: amount=500, channel=wechat_pay        │
│     • llm_request_start  (model: M2.7, msgs: 4)             │
│     • api_retry_recovered (attempts: 2, class: overloaded)  │
│     • tool_executing: create_case                            │
│     • skill_result: create_case → caseId=…                  │
│     • tool_executing: query_order_status                     │
│     • skill_result: query_order_status → completed (180ms)  │
│     • policy_hit: investigate_before_escalation (pass)      │
│   ▼ Iteration 2                                              │
│     • sub_agent_dispatched: withdrawal_verifier              │
│       └─ [embedded sub-agent panel — see §2.2]              │
│     • sub_agent_merged: 3 findings, 250ms                   │
│     • stage_transition: investigating → resolved            │
│   ◐ Iteration 3 (running…)                                  │
│     • llm_request_start (streaming)                          │
│     • text_delta: 已确认您的提现已经…                       │
└──────────────────────────────────────────────────────────────┘
```

**Key behaviors:**
- Events are **grouped by iteration** using S3's `LoopState.iterationCount`. The grouping reveals what the loop saw on each pass.
- The "iteration boundary" is rendered as a collapsible row. Default: latest iteration expanded, prior ones collapsed.
- **Retry events** appear inline with a 🔁 affordance and tooltip showing class + attempts.
- **Policy hits** are color-coded: green (pass), yellow (hint), red (blocked), grey (escalated).
- **Stream**: when the case is live, new events stream into the viewer via SSE (reusing the existing `/api/cases/[id]/stream` endpoint). The "running" iteration auto-scrolls.
- **Filter bar**: toggles for {LLM, Tools, Policy, Sub-agents, Retries, Stream}. Multi-select. Persists per-operator in localStorage.

**Implementation notes**:
- The viewer is read from the existing `Trace` table + new trace events S1/S2/S5 add.
- Iteration boundaries are derived from the `iteration` field on trace payloads (S3 makes this consistent).
- Live updates use the same SSE source as the chat widget; the console subscribes as an observer.

### 2.2 Sub-agent execution graph

When the trace view encounters a `sub_agent_dispatched` event, an embedded mini-panel renders the sub-agent's own trace as a child:

```
sub_agent_dispatched: withdrawal_verifier
└─┐  withdrawal_verifier (M2.7 · 3/3 iter)
  ├ Goal: Verify the withdrawal status & expected timing
  ├ Iteration 1
  │  • tool: get_latest_withdrawal → {status: pending, age: 4h}
  │  • tool: query_payment_channel_status → {normal, no delay}
  ├ Iteration 2
  │  • tool: finalize_sub_agent
  │     findings: [pending_normal, no_delay, age_within_sla]
  │     recommendation: "advise user to wait 24h"
  └ ✓ completed in 1.8s · 2 tool calls
```

When the parent case has multiple sub-agents (stage-mode "parallel" or cc-mode multi-dispatch), they render as siblings under the parent iteration. Animation: pulsing border while running, fade-in once `sub_agent_complete` arrives.

For cc-mode cases, the dispatch tool call shows up like any other tool call but expands into the graph. For stage-mode cases, the dispatch is shown under the stage's "auto-dispatch on entry" annotation.

### 2.3 Render-hint preview

**Location**: a new tab on the Skills page (for business tools) and on each built-in tool's read-only detail view.

```
Tool: propose_interaction
┌─ Preview ─────────────────────────────────────────────────────┐
│ Sample input:                                                  │
│ {                                                              │
│   "title": "How would you like to proceed?",                  │
│   "options": [                                                 │
│     { "id": "wait", "label": "Wait 24h" },                    │
│     { "id": "escalate", "label": "Escalate to specialist" }   │
│   ]                                                            │
│ }                                                              │
│ [Edit sample]                                                  │
├────────────────────────────────────────────────────────────────┤
│ Channel preview:                                               │
│ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐      │
│ │ web-chat  │ │ livechat  │ │ slack     │ │ whatsapp  │      │
│ │ ─────     │ │ ─────     │ │ ─────     │ │ ─────     │      │
│ │ [Buttons  │ │ [Quick    │ │ [Block    │ │ [QR ≤ 3]  │      │
│ │  inline]  │ │  reply]   │ │  kit]     │ │           │      │
│ │ ╱╲ render │ │ render    │ │ render    │ │ render    │      │
│ │ ╲╱        │ │           │ │           │ │           │      │
│ │ Wait 24h  │ │ Wait 24h  │ │ Wait 24h  │ │ Wait 24h  │      │
│ │ Escalate  │ │ Escalate  │ │ Escalate  │ │ Escalate  │      │
│ └───────────┘ └───────────┘ └───────────┘ └───────────┘      │
│                                                                │
│ Hint resolution chain (for livechat):                          │
│   1. Tool default: { kind: 'card', buttonStyle: 'quick-reply' }│
│   2. Binding override:    (none)                              │
│   3. Binding defaults:    (none)                              │
│   → Final: { kind: 'card', buttonStyle: 'quick-reply' }      │
└────────────────────────────────────────────────────────────────┘
```

**Implementation**: each channel renderer (S5) exports a `previewSync` method that takes a canonical event and returns either an HTML string (for iframe rendering) or a structured action snapshot. The preview component runs all 4 renderers against the operator's sample input and shows them side-by-side.

For channels without a real HTML preview (Slack, WhatsApp), show a structured "what the API call would look like" view — JSON-prettified payload with channel-specific UI annotations.

### 2.4 Tool source labels & editor gating

Built on top of console-audit-v5 Phase A (Skills page tiers):

- **Built-in tools** show a `BUILT-IN` badge, lock icon, and "Defined in code (apps/chat/lib/agent/tools/builtin/<name>.ts)". The editor is read-only across the board (no inputs editable).
- **Special tools** (kb_hybrid_retrieve) show `SPECIAL` badge + "Configure in Knowledge Retrieval" link card (existing pattern).
- **Business tools** show `BUSINESS` badge; editable.

S6 adds a fourth label:

- **Sub-agent tools** (from the registry, for cc mode) show `SUB-AGENT` badge. Clicking opens the sub-agent editor at `/admin/sub-agents/<name>` — not the Skills page editor. This makes sub-agent definitions discoverable from the Skills page without conflating their config UI.

### 2.5 Trace dashboards (aggregate metrics)

New page: `/ops/dashboards`. Cards for engine health:

```
┌──────────────────────────────────────────────────────────────┐
│ Engine health · last 24h                                     │
├──────────────────────────────────────────────────────────────┤
│ ┌────────────────────┐  ┌────────────────────┐               │
│ │ Tool-result        │  │ API retries         │              │
│ │ invariant          │  │                     │              │
│ │ 0 violations       │  │ Recovered: 142     │              │
│ │ 24 synth (policy)  │  │ Failed: 3          │              │
│ │ 8 synth (trunc)    │  │ Fallback: 1        │              │
│ └────────────────────┘  └────────────────────┘               │
│ ┌────────────────────┐  ┌────────────────────┐               │
│ │ Sub-agents         │  │ Channel rendering   │              │
│ │                    │  │                     │              │
│ │ Dispatched: 89     │  │ web-chat: 1.2k     │              │
│ │ ✓ completed: 86    │  │ livechat: 380      │              │
│ │ Avg dur: 1.4s      │  │ Filtered out: 2    │              │
│ └────────────────────┘  └────────────────────┘               │
│                                                              │
│ ── Per-case-type latency (P50 / P95) ─────────────────────  │
│ withdrawal_issue   8.2s / 24.1s   ▁▂▃▅▆▇▆▅▃                │
│ deposit_issue      4.8s / 11.3s   ▁▂▂▃▃▄▃▂▁                │
│ account_issue      3.1s / 9.8s    ▁▁▂▃▃▂▂▁▁                │
│                                                              │
│ [↻ Refresh]  [Time range: last 24h ▾]  [Export CSV]         │
└──────────────────────────────────────────────────────────────┘
```

Implementation: aggregate queries on the `Trace` table. Cards refresh on a 30s timer (configurable). Operators with read-only access can view; admins can drill into individual cases by clicking any number.

### 2.6 Agent Config — final blueprint polish

After console-audit-v5 lands the 6-satellite blueprint (Brain, Memory, Guardrails, Human Ops, Knowledge, Sub-Agents), S6 adds:

- **Live tool inventory** chip on the Brain satellite: "31 tools enabled (8 built-in, 22 business, 1 dispatch)" — clickable, opens an inventory modal.
- **Guardrail hit count** badge: shows the last-24h hit count per guardrail; clicking opens the policy detail with sample triggering cases.
- **Sub-agent run frequency** on each sub-agent satellite leaf: "withdrawal_verifier: dispatched 18× this week, avg 1.4s, 3 errors".
- **Channel availability** strip across the top: shows which channels are bound and their last-event timestamp ("livechat: 2m ago, web-chat: live").

These are read-only metric overlays — they don't change config; they make the satellite a dashboard, not just a static link.

### 2.7 Per-customer settings consolidation

Multiple settings have accumulated across pages: `enableLlmSanitization`, `debugMode`, `showThinking`, `evaluationModel`, `fallbackModel`. After S3/S4 cleanup, the survivors live in the Brain drawer (per console-audit-v5 Phase B).

S6 adds a new "Engine internals" section *visible only to admin-level operators* on the Brain drawer, surfacing:

- `INTERA_INVARIANT_CHECK` (S1) — toggle.
- `INTERA_CENTRAL_RETRY` (S2) — toggle.
- `INTERA_CHANNEL_RENDERERS` (S5) — toggle.

These are runtime flags that previously required env-var changes. The toggle writes to a per-customer engine-flags JSON column. Existing env vars take precedence for migrations.

### 2.8 Skills page final layout (recap of console-audit-v5 + S4/S6 additions)

```
Skills
├ System Skills (7) — read-only, BUILT-IN badge
│   create_case, finalize_case, read_case_history,
│   create_human_task, finalize_sub_agent, todo_write, todo_read
├ Special (1) — kb_hybrid_retrieve · Configure in Knowledge Retrieval
├ Business Skills (22) — fully editable
│   get_account_status, get_kyc_status, …
├ Sub-Agents (3) — discoverable here, edit in /admin/sub-agents
│   withdrawal_verifier, history_reviewer, order_verifier
└ [+ New business tool]
```

Each card shows: source badge, enable toggle, last-24h call count (S6 addition), preview link (S6 addition).

---

## 3. Phasing

| Phase | What | Effort |
|---|---|---|
| **6a** | Live trace viewer iteration grouping. Refactor existing `case-trace-view.tsx` to be iteration-aware. New trace event types from S1/S2/S5 wired into the legend. | 4 days |
| **6b** | Sub-agent execution graph (§2.2). Reuses the trace viewer infrastructure; new component for the embedded panel. | 3 days |
| **6c** | Render-hint preview (§2.3). Per-channel preview component. Needs S5 renderers' `previewSync` method exposed. | 3 days |
| **6d** | Tool source labels & 4th tier (sub-agent) on Skills page. Builds on console-audit-v5 Phase A. | 1 day |
| **6e** | Trace dashboards (§2.5). New page `/ops/dashboards`. Aggregate queries on `Trace`. | 4 days |
| **6f** | Agent Config blueprint live overlays (§2.6) — tool inventory, hit counts, sub-agent stats, channel strip. | 3 days |
| **6g** | Engine internals admin section (§2.7) — runtime feature flags. Includes the per-customer flags table migration. | 1 day |

**Total: ~19 working days (≈4 weeks).**

Phases are mostly independent — 6a is the dependency for 6b and partial dep for 6e. Others can ship in parallel by different operators.

---

## 4. Acceptance criteria

### 4.1 Live trace viewer (6a)
- [ ] Trace events grouped by iteration; iteration boundary is collapsible.
- [ ] Retry events render with the 🔁 affordance and tooltip showing attempts + class.
- [ ] Live SSE updates: new events appear within 500ms of being written.
- [ ] Filter bar toggles persist in localStorage.
- [ ] Performance: 1000-event trace renders in < 500ms on first paint.

### 4.2 Sub-agent graph (6b)
- [ ] Dispatched sub-agents render as embedded panels under their iteration.
- [ ] Parallel sub-agents (stage mode) render side-by-side with synced status pulses.
- [ ] Sub-agent's own tool calls + findings visible in the embedded panel.
- [ ] Click → expand to full-screen sub-agent trace.

### 4.3 Render-hint preview (6c)
- [ ] 4 channel previews render for `propose_interaction` and `kb_hybrid_retrieve` against a sample input.
- [ ] Hint resolution chain display matches actual engine resolution (verified via shared logic).
- [ ] "Edit sample" textarea lets operator paste arbitrary JSON; preview re-renders within 100ms.

### 4.4 Tool source labels (6d)
- [ ] Every tool card on Skills page shows the right badge.
- [ ] Sub-agent cards link to `/admin/sub-agents/<name>`.
- [ ] Special tools' "Configure in Knowledge Retrieval" link works.

### 4.5 Dashboards (6e)
- [ ] All 4 health cards render with last-24h numbers.
- [ ] Per-case-type latency table sorts by P95.
- [ ] CSV export contains all visible rows.
- [ ] Time-range selector covers 1h/24h/7d/30d.

### 4.6 Blueprint overlays (6f)
- [ ] Brain satellite shows live tool count, updates on a 30s refresh.
- [ ] Guardrail satellite shows per-rule hit count; click opens policy detail.
- [ ] Sub-agent satellite shows per-leaf dispatch frequency + avg duration.
- [ ] Channel strip's last-event-timestamps update via SSE.

### 4.7 Engine internals (6g)
- [ ] Toggles for the 3 INTERA_* flags work and persist per customer.
- [ ] Env vars take precedence over the per-customer setting.
- [ ] Section only visible to operators with admin role.

---

## 5. File map

### New
- `apps/console/components/ops/iteration-group.tsx` — collapsible iteration boundary.
- `apps/console/components/ops/sub-agent-graph.tsx` — embedded sub-agent panel.
- `apps/console/components/ops/render-hint-preview.tsx` — 4-channel side-by-side previewer.
- `apps/console/app/ops/dashboards/page.tsx` — aggregate dashboards.
- `apps/console/components/ops/dashboard-cards/*.tsx` — one component per metric card.
- `apps/console/app/api/ops/dashboards/route.ts` — aggregate query endpoints.
- `apps/console/components/admin/engine-internals-panel.tsx` — feature flag toggles.
- `apps/console/lib/role.ts` — admin role check helper (new abstraction; assume single-role today, extend if needed).
- Prisma migration `<ts>_customer_engine_flags` — adds `engineFlags: String? // JSON` column to Customer.

### Modified
- `apps/console/components/ops/case-trace-view.tsx` — iteration grouping, retry chips, live SSE.
- `apps/console/app/ops/chats/[chatId]/page.tsx` — wraps the trace view in the new layout.
- `apps/console/app/admin/skills/page.tsx` — adds Sub-Agents section, source labels, last-24h call count.
- `apps/console/components/admin/agent-blueprint.tsx` — live overlay chips on satellites.
- `apps/console/components/admin/agent-config-drawer-ui.tsx` — Brain drawer gains Engine Internals collapsible.
- `apps/chat/channels/*/renderer.ts` (from S5) — exposes `previewSync(event, hint)` method.

### Untouched
- Engine (`apps/chat/lib/agent/*`).
- Channel renderers' production behavior (S5).
- Tool registry (S4).
- Sub-agent registry (case-type-subagent-ux).

---

## 6. Risk + rollback

**Risk 1**: Live SSE in trace viewer puts excess load on the database (trace table read per event). *Mitigation*: viewer subscribes to the same SSE stream the chat widget uses, not a polling query. Trace table reads are limited to initial load + filtered drill-down.

**Risk 2**: Dashboards' aggregate queries are slow against large `Trace` tables. *Mitigation*: add Prisma indexes on `(customerId, createdAt, actionType)`. For customers with > 1M trace rows, the dashboards run against the last 7 days only by default.

**Risk 3**: Render-hint preview goes stale if channel renderers change behavior. *Mitigation*: preview uses the *exact* same renderer module as production (no duplicate logic). Test: snapshot the preview output, compare against a real chat session's output for the same input.

**Risk 4**: Operators see metrics they don't understand and act on them (e.g., "0 retries — turn off retry?"). *Mitigation*: every dashboard card has an info tooltip explaining what it means and what action it suggests.

**Rollback**: each phase is its own PR. The new `engineFlags` column is additive. Other changes are UI-only.

---

## 7. Estimated effort

~19 working days total. The dashboard work (6e) is the largest single chunk; it can be parallelized with 6c/6d if a second operator is available.

---

## 8. Hand-off to implementer

Order of work:
1. **6a first** — establishes the iteration-grouped data shape that 6b and 6e build on.
2. **6d next** — tiny, satisfies the immediate "where do I find sub-agents" UX question.
3. **6b, 6c, 6e in parallel** — independent enough.
4. **6f** — needs 6a's iteration data + S5's channel awareness.
5. **6g last** — small, isolated.

Before starting:
- S1–S5 must all be merged and have produced one week of real production traces. The dashboards need data to display.
- Capture screenshots of today's trace view as the "before" baseline.

Do NOT do these in the same PRs:
- Engine changes — S6 is console-only.
- New trace event types — those belong in S1/S2/S5 specs.
- New channels — those belong in S5.

---

## 9. Open questions

### 9.1 Role-based access for /ops/dashboards and engine internals

S6 assumes a single admin/operator distinction. Today the console doesn't formally model roles ([apps/console/lib/auth.ts](apps/console/lib/auth.ts) is a thin session-cookie check). Two paths:

- **Quick**: add a `role: 'admin' | 'operator'` column to Customer/AdminUser; show/hide the engine-internals section based on that. ~1 day.
- **Proper**: introduce a role + permission abstraction. Multi-week effort, deferred to a future cycle.

Default: do the quick version in 6g; flag the proper version as a follow-up.

### 9.2 Trace retention

The dashboards aggregate from `Trace`. As customers grow, this table grows unboundedly. Retention policy not in scope for S6, but the dashboard's default time range (last 24h) is chosen so the aggregations stay fast. **Worth a separate retention spec**: "trace rows older than 30 days move to cold storage / get deleted".

### 9.3 Visual companion for render previews

The 4-channel preview is text-heavy. For channels that have an actual rendered HTML appearance (web-chat, LiveChat), an iframe with the real component works. For Slack/WhatsApp, the preview is a structured "API call shape" view. Worth confirming this is acceptable, or if you want to invest in faithful pixel-perfect previews for non-HTML channels — that's a much larger build.

### 9.4 Real-time vs polled refresh

Live trace viewer uses SSE. Dashboards use 30s polling. The 30s is operator-friendly (not noisy) but means metrics lag by half a minute. Acceptable for the "is the engine drifting?" use case. If you want live updates on dashboards too, the implementation is one channel binding — but the visual experience may need throttling to avoid distracting flicker.

---

# Conclusion — open questions across S5 + S6 to confirm

Compiling the questions that surfaced in S5 and S6, ordered by how blocking each is:

### Blocking before impl of the corresponding phase

**Q1 (S5 §7.1) — Target channels**: locked five (web-chat, livechat, slack, discord, whatsapp). Missing any from your roadmap? Specifically: do we need WeChat, Telegram, or Line as first-class? Each is one row in `CHANNEL_CAPS` + a renderer module.

**Q2 (S5 §7.2) — `channelSkillBinding`: allowlist or denylist?** Defaulted to allowlist (binding declares which tools are exposed). Safer for compliance; heavier ops. Confirm before Phase 5e.

**Q3 (S5 §7.3) — Channel credentials migration**: today LiveChat credentials live in `LiveChatConfig` table. S5 moves them into the new `ChannelBinding.credentials` column. Confirm no other code path reads `LiveChatConfig` directly that we'd break.

**Q4 (S6 §9.1) — Role model**: 6g (engine internals admin section) needs a way to gate visibility. Two paths: quick role column (~1 day) vs proper role/permission abstraction (multi-week). Defaulted to quick. Confirm.

### Nice-to-confirm but not blocking

**Q5 (S5 §7.4)** — sub-agent invoking a channel-specific render hint mid-investigation should "just work" but worth verifying with one real case.

**Q6 (S6 §9.2)** — trace retention policy. The dashboards work fine today; this is a "before we hit 10M trace rows" question.

**Q7 (S6 §9.3)** — render previews: HTML iframe for web-chat/livechat, structured JSON for Slack/WhatsApp. Acceptable, or invest in faithful pixel previews for non-HTML?

**Q8 (S6 §9.4)** — dashboard refresh cadence (30s polling vs live SSE). Defaulted to polling for the smooth-UX reason.

### Carry-overs from prior specs that are still open

**Q9** (S3 §3.2) — LLM leak sanitizer: kill or keep? Defaulted to kill in S3. Confirm before S3's Phase 3c lands.

**Q10** (case-type-subagent-ux) — "Adaptive" vs alternative labels for the cc-mode UI label. Locked in our last conversation but worth re-verifying once operators see it.

When you're back: pick off Q1–Q4 first (those gate phases that ship in the next few weeks). Q5–Q10 can wait until impl starts.

**Wave 2 fully specced.** S1–S6 cover the full Intera-vs-CC alignment audit:
- Stability (S1 + S2): tool-result invariant + centralized retry.
- Maintainability (S3): loop slimmed, dead code deleted, sub-agents on the same iteration body.
- Re-architecture (S4 + S5): tool interface, dispatch_subagent + cc mode, channel binding.
- Visibility (S6): live trace, sub-agent graph, render preview, dashboards.

Total estimated impl effort across all six: ~12–14 weeks for a single-stream pace. Faster with parallelism on S6 + S5's independent sub-phases. The Wave 1 stability fixes (S1 + S2 + S3) should ship before any Wave 2 work starts; that's ~6 weeks of the total.
