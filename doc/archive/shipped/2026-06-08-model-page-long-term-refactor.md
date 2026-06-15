> **Historical receipt note (2026-06-08):** This file is preserved as past-work evidence. It may contain old terms such as `Skill`, `Policy`, `Guardrail`, `stage`, or `sub-agent`, and some files still read like implementation plans. Do not dispatch new work from this file. Current work starts at [../README.md](../README.md), [../handoffs/MASTER_BUILD_HANDOFF.md](../handoffs/MASTER_BUILD_HANDOFF.md), and [../to-do/2026-06-08-foundation-reset-domain-model.md](../to-do/2026-06-08-foundation-reset-domain-model.md).

# Model Page Long-Term Refactor — Audience Separation, Prompt Assembly, Capability Model, Version Governance

**Date:** 2026-06-08 | **Branch:** `main` | **Author:** architect (plan only — code executed by coding-agent team) | **Status:** 📋 PLAN — awaiting owner review, then dispatch.

> Read [`GENERIC_HANDOFF.md §0`](../handoffs/GENERIC_HANDOFF.md) first. This plan touches **`schema.prisma` (the documented hotspot)** and the **core agent loop** — declare lanes in `MASTER_BUILD_HANDOFF.md` Active Lanes before any file is touched, and sequence the schema phase as a single owned lane.

---

## 1. Why (diagnosis)

`/admin/model` (the agent "brain config") conflates **three audiences** in one flat form:

1. **Config operators** (daily users): model, generation params, the *authored prose* of the system prompt, case behavior.
2. **System-internal mechanics** leaked as raw tokens: `{{available_tools}}`, `{{case_types}}`, `{{session_binding}}`, `{{case_schema}}`, `{{case_state}}`, `{{active_policies}}`, `{{confirmed_facts}}` — all **100% machine-derived injection points**, none authored.
3. **Developer/debug**: `showThinking`, `invariantCheck`, `debugMode`.

Concrete problems found in code (file:line refs):

- **Placeholder footgun.** Operators can delete/typo system tokens with no validation. `resolvePrompt` ([prompt-resolver.ts:114](../../apps/console/lib/agent/prompt-resolver.ts)) only knows 6 tokens; a typo (`{{available_tool}}`) is sent to the model verbatim; a deletion silently drops the curated tool catalog / case-type routing list / session binding.
- **`showThinking` is mis-named and double-duty.** It gates whether `thinking:{type:'enabled'}` is even **requested from the model** ([loop.ts:394](../../apps/console/lib/agent/loop.ts)), *and* whether `thinking_delta` streams. **No production/customer surface renders `thinking_delta` — only the playground does** ([playground/page.tsx:492](../../apps/console/app/admin/playground/page.tsx)). So in prod it costs thinking tokens + latency and emits SSE nobody displays. There is **no `supportsThinking` capability guard** — enabling it on a non-thinking model (default `deepseek-v4-flash`) sends an unsupported param (undefined behavior).
- **`invariantCheck`** ([loop.ts:703](../../apps/console/lib/agent/loop.ts)) is a dev-only `console.error` assertion (its own i18n hint says "leave off in production"), already env-togglable (`INTERA_INVARIANT_CHECK=1`), and **its existing hint is never wired to a tooltip**. The zh label "工具结果一致性检查" mis-describes it (it asserts the *message-structure invariant*, not result "consistency").
- **`debugMode`** ([debug-logger.ts](../../apps/console/lib/agent/debug-logger.ts)) writes unbounded payload files to server-local `debug-logs/<caseId>/` — useless on cloud/ephemeral deploys. The product already has a cloud-native debug surface: the **trace system** (TraceWriter → DB → playground/ops trace views).
- **`caseAddendum`** is a global case addendum ([buildModePrompt.ts:91](../../apps/console/lib/agent/buildModePrompt.ts)) that overlaps in purpose with per-type/per-stage SOPs on the case-types page — undefined ownership, not literal duplication. Plus **three** case-prompt assembly paths exist (legacy swap / global addendum / per-stage SOP).
- **No publish gate.** The page autosaves **in place to the active (live) version** ([page.tsx:101](../../apps/console/app/admin/model/page.tsx)) — even though `AgentConfig` has a full version system (`fork`/`activate`/`releaseNote`/`publishedAt`) the page ignores.

## 2. Decisions taken (owner-approved 2026-06-08)

| # | Decision | Choice |
|---|---|---|
| Q1 | System `{{...}}` placeholders | **Hide the entire family from the editor; system injects them deterministically. Add a read-only "assembled prompt" preview.** |
| Q2 | `caseAddendum` | **Remove. Fold cross-cutting case behavior into core prompt; type/stage specifics live on case-types page.** |
| Q3 | `showThinking` / `invariantCheck` / `debugMode` | **Split out "extended thinking" as a capability-guarded model-behavior knob; move display-thinking to playground only; move invariant + debug off the operator page (env-driven); cloud debug = trace system.** |
| A | Schema cleanup depth | **Full cleanup** (rename/drop columns + remove legacy path). |
| C | Version governance | **Do it now** — model-page edits go through draft→publish gate, reusing the existing version system. |

**Architect-recommended detailed choices (open to change at spec review):**

- **D1 — Injection layout.** Keep the *proven* default prompt layout as the canonical, non-editable assembly template; operators edit only prose. **Invariant:** for any existing config, the newly-assembled prompt must be **semantically equivalent** to today's `resolvePrompt` output (enforced by a golden-snapshot test). This de-risks "move the tokens" from a quality regression into a verifiable refactor.
- **D2 — Draft gate UX (owner-refined 2026-06-08): git-like Save + Publish.** Replace the silent 800ms autosave with an **explicit Save button**. The **active** version is **read-only** ("viewing live vN") with a primary **"Edit as draft"** action (existing `fork`); on a **draft**, **Save** persists edits to that draft (`isActive:false`) and **does NOT bust the live cache**. **Publish** (on a draft) **requires a non-empty commit message** → existing `activate` route (already writes `releaseNote`/`publishedAt`/`publishedBy`, atomic swap, cache bust, audit). Surface the release message + publisher + timestamp in the version-history list so colleagues can read version notes. "热更新" is preserved on drafts (Save → test in playground against the draft); **live only changes on Publish**. Implement the gate as a **shared hook** so other config pages (case-types, guardrails, tools — same in-place-autosave bypass) adopt it as fast-follow. (Note: `activate` route schema currently `releaseNote: optional` — UI enforces required at the model-page Publish entry; optionally tighten the schema.)
- **D3 — Prod thinking exposure.** Production **never** streams `thinking_delta` to API/LiveChat consumers. `extendedThinking` may still be *requested* in prod (answer-quality use); display is a separate, playground-only concern.

## 3. Target architecture

### 3.1 Prompt-layering contract (document it + cross-link the two pages)
- **Layer 0 — Core / discovery prompt** (model page): always present; **authored prose only**.
- **Layer 2 — Case-type / stage SOP** (case-types page): type- and stage-specific.
- ~~Layer 1 — global case addendum~~ **removed**.
- **All `{{...}}` injection is system-managed at every layer.** The editor contains no tokens.
- **One** case-prompt path: core + stage SOP. Legacy swap (`CASE_SYSTEM_PROMPT` / `useLegacyCasePrompt` / `systemPrompt`) deleted.

### 3.2 Model capability model
- Add `supportsThinking` to `ModelInfo` / `build-model-list.ts` (sibling of existing `supportsVision`).
- The `extendedThinking` toggle is disabled/hidden when the selected model lacks the capability, with an inline explanation.

### 3.3 `extendedThinking` (replaces `showThinking` semantics)
- **Behavior knob** (model page, under Generation, capability-guarded; `thinkingBudget` nested beneath it): controls whether the API request includes `thinking:{type:'enabled', budget_tokens}`.
- **Display** ("show thinking") is decoupled and lives only in the playground (its existing per-turn toggle). Prod emit = always false (D3).

### 3.4 Developer/diagnostics — off the operator page
- `invariantCheck`: env-only (`INTERA_INVARIANT_CHECK=1`); removed from config + UI; concept renamed "tool-result invariant assertion (dev)".
- `debugMode` disk logging: env-only (`INTERA_DEBUG_LOGS=1`); removed from config + UI. Playground keeps its own client-side `debug` trace-detail toggle (already `pc.debug`).
- Cloud debugging is the **trace system** (no new work; just stop pretending disk files are the answer).

### 3.5 Version governance
- Model page reuses **existing** `fork` + `activate` routes and `useIsActiveVersion`. Active version is read-only in the editor; drafts are editable; Publish = activate (atomic swap + cache bust + audit, all already implemented).

## 4. Affected-files map (ripple — enumerate so nothing silently breaks)

**Schema/data:** `packages/shared/prisma/schema.prisma` (AgentConfig), new migration(s), `packages/shared/prisma/seed.ts`, `packages/shared/prisma/sqlite-schema-compat.ts`, `packages/shared/prisma/migrate-legacy-case-prompt.ts` (delete after), `packages/shared/types/index.ts` (`AgentConfigData`), `packages/shared/defaults/index.ts` (`CASE_SYSTEM_PROMPT`, `DEFAULT_SYSTEM_PROMPT` — verify dead, `CORE_SYSTEM_PROMPT` injection markers).

**Agent runtime:** `lib/agent/loop.ts` (394/474 thinking, 181/376/438/607 debug, 216/703 invariant), `lib/agent/stream-handler.ts` (emit gate rename), `lib/agent/debug-logger.ts` (env gate), `lib/agent/config-loader.ts` (field map), `lib/agent/buildModePrompt.ts` (drop legacy branch + caseAddendum; deterministic injection), `lib/agent/prompt-resolver.ts` (system-managed slots), `lib/agent/playground-runner.ts` (62 override, 72 caseAddendum, 73 useLegacy, 264 debug), `lib/agent/build-model-list.ts` (+`supportsThinking`).

**API routes:** `app/api/messages/route.ts` (buildModePrompt/legacy refs), `app/api/admin/agent/route.ts` (validation/update of the 3 flags), `app/api/admin/agent-configs/route.ts` (copy list :47), `app/api/admin/agent-configs/[id]/fork/route.ts` (copy list :37-44), `app/api/cases/[id]/export/route.ts` (:65), **new** `app/api/admin/agent/assembled-prompt/route.ts` (preview).

**UI:** `app/admin/model/page.tsx` (the page), `app/admin/playground/page.tsx` (decouple display toggle), `app/admin/agent/types.ts` (`ModelInfo`+capability, config types), `app/ops/guide/page.tsx` (docs refs), `components/admin/agent-synthetic-templates-panel.tsx`, `components/admin/agent-flow.tsx`, `components/admin/version-context-bar.tsx` / `agent-version-picker.tsx` (draft-gate wiring), new shared `useDraftGate` hook.

**i18n:** `lib/i18n/dictionaries.ts` — remove dead keys (`model.showThinking/invariantCheck*/debugMode`, `model.caseAddendum*`), add `model.extendedThinking*`, preview keys, draft-gate keys (en + zh, keep counts equal — shared hotspot, declare keys).

**Tests:** update factories/smoke/integration/route tests referencing the 3 flags; add the new guard tests in §5.

## 5. Phased plan (each phase independently shippable + two-phase-verified)

### Phase 0 — Read-only inventory (no code) ⟶ architect
- **Goal:** evidence before destruction. Confirm what real `caseAddendum` content exists and which models support thinking.
- **Steps:** read-only `SELECT id,name,version,length(caseAddendum) FROM agent_configs WHERE caseAddendum IS NOT NULL AND caseAddendum <> ''` (local `DATABASE_URL` → prod tunnel; **SELECT only, no writes** — see memory `project_local_db_is_production`). Capture any non-empty content for migration. Catalog per-model thinking support for `build-model-list`.
- **Verify:** inventory pasted into this doc before Phase 5 runs.

### Phase 1 — Foundation: capability + deterministic injection (no behavior change for operators)
- **Goal:** make placeholder injection independent of operator-placed tokens; add `supportsThinking`.
- **Steps:** (a) `buildModePrompt`/`prompt-resolver`: assemble system blocks at canonical slots regardless of whether tokens appear in the prose; (b) add `supportsThinking` to `ModelInfo`/`build-model-list`.
- **Guard tests (red→green):** golden-snapshot — assembled prompt for the seed/default config is semantically equivalent to current `resolvePrompt` output (**D1 invariant**); a config whose prose has *no* tokens still receives tools/case_types/session_binding.
- **Verify:** Phase-1 local gate; deploy; no operator-visible change.

### Phase 2 — Prompt editor cleanup + assembled preview
- **Goal:** Q1 + Q2 (UI/runtime, pre-schema).
- **Steps:** remove `{{...}}` highlight/affordance from the editor; remove the **Case Addendum** section; `buildModePrompt` stops appending `caseAddendum`; **migrate** any Phase-0 non-empty `caseAddendum` into `coreSystemPrompt`; add the read-only **assembled-prompt preview** (new `assembled-prompt` route + panel).
- **Guard tests:** preview endpoint returns a fully-resolved prompt (tokens gone, tools/case-types listed); base+append path no longer references `caseAddendum`.
- **Verify:** two-phase; on prod, confirm editor has no tokens and preview shows the real assembled prompt.

### Phase 3 — `extendedThinking` split + stop prod thinking leak
- **Goal:** Q3 (thinking half) + D3.
- **Steps:** introduce `extendedThinking` **semantics on the existing `showThinking` column** (the column *rename* happens in Phase 5 — do not rename here, to avoid colliding with the schema lane); `loop.ts:394` requests thinking iff thinking-enabled **and** model `supportsThinking`; rename the stream emit flag (`showThinking`→`emitThinking`) — playground sets it per-turn, **prod messages route sets it false**; model-page Generation gains the capability-guarded toggle with nested budget; `cases/export` updated.
- **Guard tests:** non-thinking model never receives `thinking` param; prod path emits **no** `thinking_delta`; playground still shows thinking when its toggle is on.
- **Verify:** two-phase; prod smoke — thinking off by default, no SSE leak; playground thinking still works.

### Phase 4 — Relocate dev flags to env
- **Goal:** Q3 (invariant + debug halves).
- **Steps:** `invariantCheck` → env-only (drop config half at `loop.ts:216`); `debugMode` disk logging → `INTERA_DEBUG_LOGS=1`; playground trace detail uses its own `pc.debug`; remove both checkboxes from the page; fix/rename remaining i18n.
- **Guard tests:** invariant assertion fires under env flag, not config; debug files only written under env flag.
- **Verify:** two-phase.

### Phase 5 — Schema cleanup + legacy removal (single owned lane; schema hotspot)
- **Goal:** decision A — reach the clean terminal state. **Run only after Phases 1-4 removed all UI/runtime references.**
- **Steps:** migration — drop `caseAddendum`, `invariantCheck`, `debugMode`, `systemPrompt`, `useLegacyCasePrompt`; rename `showThinking`→`extendedThinking`. Update `types`, `config-loader`, `seed`, `sqlite-compat`, **fork copy list** (`fork/route.ts:37-44`), **agent-configs copy** (`route.ts:47`), `agent/route.ts` validation, `defaults` (delete `CASE_SYSTEM_PROMPT`; delete `DEFAULT_SYSTEM_PROMPT` if now unused — verify), collapse `buildModePrompt` to the single base+stage path, delete `migrate-legacy-case-prompt.ts`. Update all tests.
- **Guard tests:** fork of a config preserves `extendedThinking` and omits dropped columns; case-active assembly uses only core+stage (no legacy branch reachable).
- **Verify:** `db:generate` → `build:console` (standalone Prisma embed, gotcha #1); full keyless suite; deploy; prod case-mode smoke (open a case, confirm prompt assembles).

### Phase 6 — Version governance (explicit Save + Publish-with-message) — D2
- **Goal:** decision C, per refined D2.
- **Steps:** (a) remove silent autosave (drop the 800ms debounce + flush-on-unmount + `bustConfigCache` from the page); (b) add an **explicit Save button** with dirty-state tracking + **unsaved-changes guard** on navigation; (c) `useDraftGate` shared hook + `useIsActiveVersion`: **active version read-only** with **"Edit as draft"** (existing `fork`); **Save writes to the draft only, no live cache bust**; (d) **Publish** dialog **requires a non-empty commit message** → existing `activate` (records `releaseNote`/`publishedAt`/`publishedBy`, atomic swap, cache bust, audit); (e) **surface release message + publisher + timestamp** in the version-history/picker UI. (Roll the hook to case-types/guardrails/tools as **fast-follow**, tracked separately.)
- **Guard tests (e2e, red→green — required by §0.4):** editing/Saving while the active version is selected does **not** mutate the live config (forces a draft); a draft Save does **not** bust the live cache; Publish with empty message is rejected; Publish atomically swaps `isActive`, busts cache, writes `releaseNote`/`publishedBy` + audit row.
- **Verify:** two-phase; prod — Save creates/updates a draft, live traffic unaffected; test the draft in playground; Publish (with message) takes effect and the note shows in version history.

## 6. Sequencing, risk, rollback
- **Order is load-bearing:** 0 → 1 → 2 → 3 → 4 → 5 → 6. Phases 1-4 must remove every reference **before** Phase 5 drops columns. 6 can run in parallel with 3-4 (different files) but coordinate the model-page lane.
- **Biggest risk:** Phase 1 prompt-equivalence (mitigated by the golden snapshot) and Phase 5 schema migration on a multi-tenant, versioned table (mitigated by Phases 1-4 first + keyless suite + prod case smoke).
- **Rollback:** Phases 1-4 are revertible by commit. Phase 5 migration needs a tested down-path (or forward-fix); take a `pg_dump` before applying (backups already daily).
- **Parallel-lane:** `schema.prisma` = Phase 5 owns it exclusively. `dictionaries.ts` = pre-declare keys. `loop.ts` is touched in 1/3/4/5 — ideally one lane carries the loop across phases, or strictly sequence.

## 7. Out of scope (flag as follow-ups)
- Rolling `useDraftGate` to other config pages (case-types/guardrails/tools).
- Resolving the case-types **stage `description` vs `systemPrompt`** redundancy.
- A dedicated "Developer/Diagnostics" console surface (if ever wanted) — env flags suffice now.

## 8. Definition of done
- Operator `/admin/model` shows only: model, generation (incl. capability-guarded extended-thinking), authored core prompt + assembled preview. No tokens, no case-addendum, no debug checkboxes.
- One case-prompt path; legacy gone; dropped columns absent from schema.
- Non-thinking models can't request thinking; prod leaks no `thinking_delta`.
- Explicit **Save**→draft (no silent autosave, no live cache bust); **Publish** requires a commit message; live traffic only changes on Publish; release notes visible in version history.
- Each phase: Phase-1 local gate + Phase-2 prod browser verification pasted as receipt; new guard tests green.
