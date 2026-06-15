# Hard Bugs & Landmines Registry

> **Last updated:** 2026-06-12 (runtime_signal branch deadlock fixed `26a6c948`; deployed by later main sync `1c550973`; dedicated prod browser confirm still pending).
> **Scope:** this file now tracks **open** landmines live in the tree. Fixed-and-verified bugs are reduced to a one-line archive pointer (full write-ups removed once confirmed).
> **Line numbers drift** — cite by `file:symbol`/string, verify the symbol before relying on a line.

---

## ✅ Resolved & archived (verified in code 2026-06-08, removed from active tracking)

- **Playground chat history leaks across org switch** — fixed `88ac4682` (localStorage keys scoped to `userId(+agentId)` + `prevOrgIdRef` org-switch detection). Re-verified present: `playground/page.tsx` scoped-key factory + `isOrgSwitch` clear path.
- **Tool-use renderHint cards disappear after playground refresh** — fixed `570e823e`, `43f13f9a` (`renderHints` carried through the full SSE → trace payload → restore pipeline). Re-verified present: `streaming-tool-executor.ts` push sites, `loop.ts` skill_result payload, `playground/page.tsx` restore.
- **L1 — Hardcoded Chinese escalation message (F8)** — fixed `5bd7326b`. `customer-messages.ts` locale-aware zh/en detector; hardcoded Mandarin replaced by `escalationMessageFor(latestUserText(…))` in `loop.ts` + `tool-interceptor.ts`. Residual caveat: `detectCustomerLocale` is zh/en-only on CJK Han range — JA kanji matches zh; KO/TH/AR fall to en. Flag if JA/KO tenant onboarded.
- **L2 — ChunkLoadError deploy-window recovery** — fixed `5bd7326b`. `global-error.tsx` + `error.tsx` error boundaries with `sessionStorage`-debounced auto-reload; shared logic in `app/_lib/chunk-error.ts`.
- **L5 — Tenant-isolation cross-org read/write exploit** — fixed `5bd7326b`. `assertAgentInOrg()` guard (joining `agentConfigId → AgentConfig.orgId` via org-scoped proxy, 404 on mismatch) wired into all 11 sub-module admin routes: `tools`, `policies`, `case-types`, `knowledge/sources`, `knowledge/gptbots`, `livechat/config`, `livechat/groups`, `agent`. Red reproduction test (`cross-org-isolation.test.ts`) confirms the hole pre-fix; existing route tests updated with `agentConfig` mock.
- **L6 — Unguarded re-parse of tool-input JSON in the loop → whole turn crashes** — fixed `fb872f53`. Unified both tool-input parses behind shared guarded helpers in `stream-handler.ts`: `parseToolInput()` (try/catch → `{}`) + `buildToolUsesFromBlocks()`; the stream handler's first parse and the loop's S1 synthesis (was `loop.ts:679`) now both use them, so a `max_tokens`-truncated or alt-provider-malformed `tool_use` synthesizes an error `tool_result` instead of throwing out of `runReActLoop`. Guard test (red→green, `unit/stream-handler.test.ts`): a truncated tool_use through real `consumeStream` yields `{input:{}}` without throwing. **Phase-1:** tsc 0 · keyless 637 passed · build ✓. **Phase-2 (prod demo.anytrans.ai):** playground 4-tool turn on deepseek-v4-flash (alt-provider) completes end-to-end, no crash/regression.
- **L7 — `dispatch_case_agent` detached background sub-agent path** — fixed by `c4c7365c` and physically cleaned by `810ac9cd`. `dispatch_case_agent` is now only a compatibility wrapper for inline Procedure start/select, and R2 removed the old Policy/stage/sub-agent/skills physical runtime. Follow-up naming work belongs to R3, not this old landmine.
- **L9 — `runtime_signal` branch condition deadlocks ProcedureRuns** — fixed `26a6c948`. `session-store.ts:evaluateBranchCondition` returned permanent `pending` for `runtime_signal`, so an operator-configured "IF customer asks for human" branch could never match, blocked the `else` fallback behind it, and (via `finalizationBlockers`) made `finalize_procedure` impossible without a human handoff — while the Console editor offered `runtime_signal` as a normal if-condition. New decision-time semantics: active signal → `matched`, inactive → `skipped`; `maybeCompleteStep` now also completes branch-only steps once every branch resolves with no applicable action (if-without-else shape). Red→green tests in `unit/session-store.test.ts`. **Phase-1:** tsc 0 · keyless 911 passed (UI-page timeouts proven load-flaky, pass in isolation pre/post change) · build ✓. **Phase-2:** deployed by later `main` sync at `1c550973`; deploy build + health passed, but no dedicated L9 browser reproduction/confirm was run in that lane.

---

## 🔴 Open landmines (live in the tree — for coding-team dispatch)

> Confirmed-present as of 2026-06-08. Severity = customer/tenant impact, not effort.

### L1 — ✅ RESOLVED (see archive above)

### L2 — ✅ RESOLVED (see archive above)

### L3 — `playground/page.tsx` god-component — 🟠 MEDIUM (maintainability)

`wc -l apps/console/app/admin/playground/page.tsx` = **1587 lines** and growing (~1333 when first flagged). Hosts the (now-archived) Bug-1/Bug-2 fixes, the trace pipeline, session restore, multimodal input, and 8 raw `fetch()` calls — all churn concentrates here. Decomposition logged but never executed. FE analog of the `loop.ts` problem — see `doc/strategy/2026-06-08-long-term-architecture-review.md`.

### L4 — Legacy Guardrail-status trace: code-fixed, prod live-confirm still open — 🟡 LOW (verification gap)

The AC2 fix is present — `trace-aggregator.ts` `deriveStatus` reads structured `payload.policyOutcome` before the legacy `detail` string (~L57-77), so a fired legacy guardrail derives `block`/`warn` (no longer always-green). But live-prod confirm is "pending a configured agent that trips it." During the Foundation Reset, this should be converted into Hook Scenario coverage rather than extended as a separate legacy guardrail lane.

### L5 — ✅ RESOLVED (see archive above)

### L6 — ✅ RESOLVED `fb872f53` (see archive above)

### L7 — ✅ RESOLVED `c4c7365c` + `810ac9cd` (see archive above)

### L8 — Model page: cleared prompt reappears after refresh — 🟠 MEDIUM (data loss illusion)

`apps/console/app/admin/model/page.tsx:64` — `raw.coreSystemPrompt ? stripTokens(...) : CLEAN_CORE_PROMPT`

When the user clears the Core Prompt and saves, the server stores `coreSystemPrompt: ''` (empty string). On next load, `''` is **falsy**, so the ternary falls through to the default `CLEAN_CORE_PROMPT` — the empty value the user intentionally saved is silently overwritten. **Prod-reproduced 2026-06-08:** clear → Save → refresh → 2703-char default prompt returns.

**Fix:** `raw.coreSystemPrompt != null ? stripTokens(String(raw.coreSystemPrompt)) : CLEAN_CORE_PROMPT` (null-check, not truthy-check). One line.

> Broader open items (dry-run isolation seam, vision-gate dual-source, `runTurn` stale-closure) are catalogued in `archive/retired-handoffs/MASTER_BUILD_HANDOFF.md` — referenced here, not duplicated. **Lower-severity, lower-confidence (architect 2026-06-08, investigate):** the post-turn persistence writes `persistChatSession()`/`compactUserProfile()` are launched fire-and-forget (`.catch(()=>{})`) and **not awaited** before `run()` returns ([loop.ts:990-991, 1008-1009, 1024-1025, 1038-1039](../../apps/console/lib/agent/loop.ts)). On a long-lived Node server they complete, but they race the *next* request's memory load for the same `chatId` (fast follow-up → stale read) and would be dropped entirely on a serverless freeze-after-response. Confirm the deploy target before deciding whether this matters.

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
- **L1** → ✅ **COMMITTED & CLOSED** `5bd7326b`. `customer-messages.ts` locale-aware zh/en detector; hardcoded Mandarin replaced in `loop.ts` + `tool-interceptor.ts`. Residual caveat: CJK Han range matches JA kanji as zh.
- **L2** → ✅ **COMMITTED & CLOSED** `5bd7326b`. ChunkLoadError auto-reload error boundaries (`global-error.tsx`, `error.tsx`, `app/_lib/chunk-error.ts`).
- **L5** → ✅ **COMMITTED & CLOSED** `5bd7326b`. `assertAgentInOrg()` guard wired into all 11 sub-module admin routes; red reproduction test now anchors the fix.
- **L6** *(new)* → unguarded `JSON.parse` of tool-input in `loop.ts:679` (outside any try) crashes the whole turn on `max_tokens`-truncated or alt-provider-malformed tool JSON; the twin parse in `stream-handler.ts:179` is guarded, this one isn't.
- **L7** *(new)* → `dispatch_case_agent`'s production background sub-agent is detached, merged from the wrong orchestrator instance, gated by a zero-reader `needsContinuation` flag, and killed on recycle — wasted spend, results never surface. On the Phase-4 retire path; live until then.
- **Lesson 5** *(new)* + a lower-severity floating-persistence note appended under "Broader open items".

**Next action:** ~~L6~~ ✅ closed `fb872f53` (coding-team-leader session, two-phase verified). ~~L7~~ ✅ closed by the Foundation Reset R1/R2 path. Current commercial-readiness risks now live in [`ARCHITECT_AUDIT_2026-06-09.md`](../archive/retired-handoffs/ARCHITECT_AUDIT_2026-06-09.md), especially ConfigPilot P1, system Tool rename R3, Scenario runtime S2, and package/version PKG1. *(L8 code-fixed + deployed `2d9249d9` by a parallel lane; its detailed entry below + close is that lane's to finalize. L3/L4 lower priority.)*
