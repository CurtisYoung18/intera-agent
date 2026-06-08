# Hard Bugs & Landmines Registry

> **Last updated:** 2026-06-08 (architect — code-review pass: verified L1 fixed-in-tree, escalated L5 to confirmed-exploitable, added L6/L7. See signed §"Architect code-review pass" at the bottom).
> **Earlier 2026-06-08:** removed the two verified-fixed bugs per owner; only OPEN landmines remain tracked.
> **Scope:** this file now tracks **open** landmines live in the tree. Fixed-and-verified bugs are reduced to a one-line archive pointer (full write-ups removed once confirmed).
> **Line numbers drift** — cite by `file:symbol`/string, verify the symbol before relying on a line.

---

## ✅ Resolved & archived (verified in code 2026-06-08, removed from active tracking)

- **Playground chat history leaks across org switch** — fixed `88ac4682` (localStorage keys scoped to `userId(+agentId)` + `prevOrgIdRef` org-switch detection). Re-verified present: `playground/page.tsx` scoped-key factory + `isOrgSwitch` clear path.
- **Tool-use renderHint cards disappear after playground refresh** — fixed `570e823e`, `43f13f9a` (`renderHints` carried through the full SSE → trace payload → restore pipeline). Re-verified present: `streaming-tool-executor.ts` push sites, `loop.ts` skill_result payload, `playground/page.tsx` restore.

---

## 🔴 Open landmines (live in the tree — for coding-team dispatch)

> Confirmed-present as of 2026-06-08. Severity = customer/tenant impact, not effort.

### L1 — Hardcoded Chinese escalation message (F8) — 🟢 FIXED IN WORKING TREE, **uncommitted** (verify + commit + close)

~~A customer-facing escalation string is hardcoded in Mandarin in two production paths.~~ **Re-verified in code 2026-06-08 (architect): both call sites now route through a locale-aware source.** The coding team landed the fix but it is **not yet committed** (untracked `apps/console/lib/agent/customer-messages.ts` + modified `loop.ts`/`tool-interceptor.ts` in `git status`):

- `apps/console/lib/agent/loop.ts:829` → `escalationMessageFor(latestUserText(this.messages))` (max-nudges escalation).
- `apps/console/lib/agent/tool-interceptor.ts:390` → `escalationMessageFor(latestUserText(ctx.messages))` (guardrail/legacy escalation fallback).
- The Mandarin literal now lives **once**, as the `zh` value in `customer-messages.ts:29` (its intended home); `grep '您的问题需要由人工专员协助处理'` returns that single hit.

**Action:** commit the fix and close L1. **Residual caveat before closing:** `detectCustomerLocale` (`customer-messages.ts:18`) is a deliberate zh/en-only branch on the CJK Han range `[一-鿿]`. Two known gaps to confirm are acceptable for the current tenant set — (a) Japanese kanji matches the Han range → a JA customer is served the **zh** string; (b) Korean/Thai/Arabic etc. fall through to **en**. Documented as intentional, but flag if a JA/KO tenant is onboarded.

### L2 — No `ChunkLoadError` recovery on deploy window — 🟠 MEDIUM

`grep ChunkLoadError` across `apps/console/app` + `apps/console/components` = **zero hits**. On deploy, hashed chunk filenames change; a client mid-session requesting an old chunk gets a 400/404 with no retry/reload boundary → white screen until manual refresh. The internal-test "deploy freely" posture makes this hit often. Fix: an error boundary that detects chunk-load failure and does a one-time hard reload.

### L3 — `playground/page.tsx` god-component — 🟠 MEDIUM (maintainability)

`wc -l apps/console/app/admin/playground/page.tsx` = **1587 lines** and growing (~1333 when first flagged). Hosts the (now-archived) Bug-1/Bug-2 fixes, the trace pipeline, session restore, multimodal input, and 8 raw `fetch()` calls — all churn concentrates here. Decomposition logged but never executed. FE analog of the `loop.ts` problem — see `doc/2026-06-08-long-term-architecture-review.md`.

### L4 — Guardrail-status trace: code-fixed, prod live-confirm still open — 🟡 LOW (verification gap)

The AC2 fix is present — `trace-aggregator.ts` `deriveStatus` reads structured `payload.policyOutcome` before the legacy `detail` string (~L57-77), so a fired guardrail derives `block`/`warn` (no longer always-green). But live-prod confirm is "pending a guardrail-configured agent" — and prod has only 2 policies on `agent_default_v1`, none wired as a tripping guardrail yet (DB inventory 2026-06-08). Close it once a guardrail-bearing agent exists in prod.

### L5 — Tenant-isolation seam vs. agent-scoped data model — coherence gap (investigate) — see [[project_agent_scoped_pivot]]

The 2026-06-06 agent-scoped migration dropped `org_id` from `policies`/`tools`/`case_types`/`knowledge_sources`/`channel_bindings` (confirmed in prod DB 2026-06-08: `case_types` has `agent_config_id`, no `org_id`). The isolation proxy `repoForOrg`/`scopedModel` injects **`orgId`**, which these models no longer carry → sub-module routes use `repo.raw.*` and scope by `agentConfigId` ad hoc (commits `ef56523a`/`6954f5db`). The orgId→agentConfig **ownership check** is now the real isolation boundary, enforced ad hoc, not at the seam. ~~**Not proven exploitable**~~ Prod currently has 2 orgs (`default`/Test, `demo`/Demo) — a real multi-tenant surface.

> **🔺 ESCALATED 2026-06-08 (architect code-review): CONFIRMED EXPLOITABLE — promote to 🔴 HIGH.** L5 is no longer "unaudited / not proven." Verified in code + a red reproduction test now exists.
> - **The hole, in code:** `app/api/admin/tools/route.ts` `GET`/`POST` pass the **client-supplied** `agentConfigId` (query/body) straight into `repo.raw.tool.findMany/create` with **no check that it belongs to `repo.orgId`** (the session's org). `repo.raw.*` is the UNSCOPED Prisma client — the org proxy never sees it. An authenticated org-A operator who passes org-B's `agentConfigId` reads/writes org-B's tools (incl. the secret HTTP `endpoint`/`headers`).
> - **Amplifier (side-effectful read):** `GET /tools` **auto-creates** built-in tool rows under the supplied `agentConfigId` ([route.ts:35](../../apps/console/app/api/admin/tools/route.ts)) — so a cross-org *read* also **writes** rows into the victim org's agent.
> - **Blast radius:** the same `repo.raw` + client-`agentConfigId`, no-ownership-check pattern is in **every** sub-module admin route — `tools`, `tools/[name]`, `policies`, `policies/[name]`, `case-types`, `case-types/[name]`, `knowledge/sources`, `knowledge/sources/[id]`, `agent-configs/[id]`. The reproduction test covers only `tools`; the fix must cover all of them. There is **no `assertAgentInOrg` helper anywhere** (grep-confirmed) — it does not exist yet.
> - **Threat model (scope it honestly):** requires a valid console session; it is a cross-tenant escalation by an **authenticated operator** of org A reaching org B — not an anonymous internet attacker. The customer-facing runtime (`app/api/messages/route.ts`) is **NOT** affected: it resolves `agentConfigId` from `session.agentConfigId` server-side and enforces an `orgId`-mismatch check ([messages/route.ts:198](../../apps/console/app/api/messages/route.ts)).
> - **Reproduction (red, by design):** `app/api/admin/tools/__tests__/cross-org-isolation.test.ts` (untracked — coding team in progress). Faithfully models the post-migration schema (Tool has no `org_id`; AgentConfig keeps `orgId`) and asserts 403/404 + no-leak + no-write. **Fix = a single `assertAgentInOrg(agentConfigId, repo.orgId)` guard (join `agentConfigId → AgentConfig.orgId`, 403 on mismatch) called at the top of every sub-module route**, then flip the test to green and add the same red→green guard for `policies`/`case-types`/`knowledge`. This is the §P1 lane in `doc/2026-06-08-long-term-architecture-review.md`.

### L6 — Unguarded re-parse of tool-input JSON in the loop → whole turn crashes — 🔴 HIGH (correctness)

The S1 tool-result synthesis block in `loop.ts` re-derives each `tool_use`'s input by **parsing the raw accumulated stream content a second time, without a try/catch**:

- `apps/console/lib/agent/loop.ts:679` — `input: JSON.parse((b as unknown as { content: string }).content || '{}')` inside the `toolUses` map.

This sits **outside** the stream `try/catch` (which closes ~`loop.ts:600`) and outside any other guard, so a throw propagates straight out of `AgentLoop.run()` and kills the turn (case left mid-stage). The first parse of the *same* string — `stream-handler.ts:179` — **is** wrapped in try/catch and falls back to `{}`; the loop's second parse is not. It throws whenever `b.content` is not valid JSON:

- **`stop_reason: 'max_tokens'` mid-`tool_use`** — the model is cut off while streaming `input_json`, leaving truncated JSON. With the default `maxOutputTokens` 4096 + extended thinking + multi-tool turns this is reachable in normal operation. Note the loop treats `max_tokens` as a clean turn end ([loop.ts:1037](../../apps/console/lib/agent/loop.ts)), so it does *not* defend against the truncation it implies.
- **Alt-provider malformed `partial_json`** — `stream-handler.ts:99` explicitly notes MiniMax/DeepSeek diverge on how they stream tool input; a malformed stream from a non-Anthropic provider trips the same line.

**Fix:** don't re-parse — the stream handler already produced `toolUse.input` for each completed block; thread those through instead. If a re-parse must stay, wrap it in the same try/catch (`catch → {}`) as `stream-handler.ts:179`. Add a guard test: a stream whose final `tool_use` block carries truncated `input_json` must synthesize an error `tool_result`, not throw.

### L7 — `dispatch_case_agent` spawns a detached background sub-agent in production whose work is silently discarded — 🟠 MEDIUM-HIGH (wasted spend + severed continuation)

`dispatch_case_agent` is in the **default discovery allowlist** (`conversation-loop.ts:33`), so it fires on the normal "open a case" path — not exotic config. In non-dry-run, `handleDispatchCaseAgent` ([tool-interceptor.ts:186](../../apps/console/lib/agent/tool-interceptor.ts)) builds a **local** `OrchestratorAgent` and calls `dispatchInBackground(tasks)`, which fires `runAll()` **un-awaited** ([orchestrator.ts:400](../../apps/console/lib/agent/orchestrator.ts)). Three independently-verified failure modes:

1. **Results merge from the wrong instance → never surface to the customer.** The background results accumulate on the *local* orchestrator's `this.newResults`; that instance is discarded when `handleDispatchCaseAgent` returns. The only in-memory merge path, `caseLoop.mergeNewSubAgentResults()` ([loop.ts:300](../../apps/console/lib/agent/loop.ts)), reads a **different** orchestrator — the `CaseAgentLoop`'s own ([case-agent-loop.ts:82](../../apps/console/lib/agent/case-agent-loop.ts)) — which is always empty. Findings land only in `ChatMemory.skillResults['subagent:*']`.
2. **The continuation flag is dead.** `dispatchInBackground` sets `needsContinuation = true` "the worker will pick it up" ([orchestrator.ts:421](../../apps/console/lib/agent/orchestrator.ts)) — but **`needsContinuation` has zero readers** (grep-confirmed: only writes + Prisma typedefs; no cron/worker/route consumes it). The chain is severed.
3. **Detached promise outlives the HTTP response.** On a server recycle/redeploy the background LLM calls + `prisma.chatMemory.upsert` ([orchestrator.ts:375](../../apps/console/lib/agent/orchestrator.ts)) are killed mid-flight (partial write); even when alive they do whole-JSON-column upserts on the sub-case row, racing any concurrent same-row writer.

Net: every prod `dispatch_case_agent` burns model tokens on an investigation the customer never sees. *(Partial reader nuance: `policy.ts:244` does read `subagent:*` evidence to satisfy a `requireToolsAny` guardrail — so the data is not 100% write-only, but it is never surfaced as a customer-facing answer and no seeded case type relies on it.)* **This is the F1 "live-but-broken" finding made concrete; it is on the retire path** — Procedure-refactor **Phase 4 / D-a** strips the background spawn and turns `dispatch_case_agent` into an inline "open case" action. Until Phase 4 lands, treat the wasted spend + ChatMemory race as live.

> Broader open items (dry-run isolation seam, vision-gate dual-source, `runTurn` stale-closure) are catalogued in `MASTER_BUILD_HANDOFF.md` — referenced here, not duplicated. **Lower-severity, lower-confidence (architect 2026-06-08, investigate):** the post-turn persistence writes `persistChatSession()`/`compactUserProfile()` are launched fire-and-forget (`.catch(()=>{})`) and **not awaited** before `run()` returns ([loop.ts:990-991, 1008-1009, 1024-1025, 1038-1039](../../apps/console/lib/agent/loop.ts)). On a long-lived Node server they complete, but they race the *next* request's memory load for the same `chatId` (fast follow-up → stale read) and would be dropped entirely on a serverless freeze-after-response. Confirm the deploy target before deciding whether this matters.

---

## Lessons (durable — kept after the bugs themselves were archived)

1. **Trace the full data flow before fixing.** A "disappears on refresh" bug is rarely the restore side alone — check every hop: SSE event → in-memory state → DB trace payload → API response → restore. (The renderHints bug burned two patch attempts on the restore side before someone checked the write side.)
2. **localStorage keys crossing org/agent boundaries must be scoped**, and the UI must detect the scope change (not just the agent change).
3. **A duplicated bug needs a duplicated fix.** L1 (F8) lives in two files with an identical literal — grep the string, fix both, add a guard so it can't be re-hardcoded.
4. **"Fixed in a doc" ≠ fixed in code.** F8 was flagged in a shipped handoff yet stayed live because it was never dispatched. This registry exists so open landmines are tracked, not just lessons from closed ones.
5. **The registry itself drifts when the tree churns.** L1 was tracked as "NOT fixed" while the coding team had already fixed it in an uncommitted change — verify each open entry against the *working tree* (not just HEAD) before dispatching. Re-confirm by `grep`, not by trust.

---

## Architect code-review pass — 2026-06-08

> **Author:** architect (Opus 4.8 session) — read-only code review at owner request ("不改代码"); no source touched, only this registry. Every claim below was checked against the working tree, not the handoffs.

**What I did:** read the core engine (`loop.ts`, `tool-interceptor.ts`, `orchestrator.ts`, `react-loop.ts`, `conversation-loop.ts`, `stream-handler.ts`, `customer-messages.ts`, `policy.ts`), the admin `tools` route, and the new cross-org test, while evaluating whether the sub-agent fan-out is architecturally warranted (it is not — single-main-agent is the real runtime; concur with the Procedure refactor's D2 "retire").

**Changes to this file (all signed, this pass):**
- **L1** → re-verified **fixed in the working tree but uncommitted**; downgraded from 🔴 NOT-fixed to 🟢 fixed-pending-commit + a zh/en-only locale-coverage caveat. Commit `customer-messages.ts` + the `loop.ts`/`tool-interceptor.ts` edits and close it.
- **L5** → **ESCALATED to CONFIRMED-EXPLOITABLE** with the exact route evidence (`tools/route.ts` GET/POST trust the client `agentConfigId` via `repo.raw`, no ownership check), the side-effectful-auto-gift amplifier, the full sub-module blast radius, and the red reproduction test pointer. Fix = one `assertAgentInOrg` guard across all sub-module routes (§P1).
- **L6** *(new)* → unguarded `JSON.parse` of tool-input in `loop.ts:679` (outside any try) crashes the whole turn on `max_tokens`-truncated or alt-provider-malformed tool JSON; the twin parse in `stream-handler.ts:179` is guarded, this one isn't.
- **L7** *(new)* → `dispatch_case_agent`'s production background sub-agent is detached, merged from the wrong orchestrator instance, gated by a zero-reader `needsContinuation` flag, and killed on recycle — wasted spend, results never surface. On the Phase-4 retire path; live until then.
- **Lesson 5** *(new)* + a lower-severity floating-persistence note appended under "Broader open items".

**Highest-leverage next action:** L5 — it is a confirmed cross-tenant read/write the moment a second real tenant transacts, and the guard is a small, well-scoped helper the reproduction test already specifies.
