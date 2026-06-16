# Intera Architecture Consolidation Spec: Module Dispatch M1-M7

**Status:** Draft for owner review and construction dispatch
**Date:** 2026-06-12
**Author:** architect session (spec only; coding lanes execute per module)
**Verified against:** working tree at `e169bf50` (procedure v2 hardening, landed 2026-06-12)
**Anchors:**

- [`Intera_Harness_架构梳理.md`](./Intera_Harness_架构梳理.md) — product/architecture source of truth
- Fin-style procedure authoring/runtime spec (owner-approved external reference for the Procedure engine cleanup; mirror it into `doc/spec/` before dispatching a procedure-authoring lane that depends on it) — M1/M2 complete its owner-approved cleanup
- [`../strategy/2026-06-08-long-term-architecture-review.md`](../strategy/2026-06-08-long-term-architecture-review.md) — diagnosis history
- [`../archive/retired-handoffs/PLATFORM_DELIVERY_AUDIT_GOALS.md`](../archive/retired-handoffs/PLATFORM_DELIVERY_AUDIT_GOALS.md) — acceptance bar; all module gates inherit it

---

## 0. Executive Decision

Intera's product thesis is correct and stays unchanged: the model owns conversation quality and adaptive reasoning; the runtime owns safety, evidence, and completion truth. This spec does not change product direction. It consolidates the implementation so that thesis is actually true across deploys, human waits, and a second customer.

The recurring failure mode this spec exists to stop:

> A new center is built, the old center is not deleted in the same plan, and both stay live. This produced the stage/cc/sub-agent era (killed by the Foundation Reset) and is now reproducing as Procedure v1/v2 dual-track.

Standing rule going forward:

> **Every lane that introduces a new center must contain the old center's remove list and execute it in the same lane.** A plan without a deletion section is not dispatchable.

### 0.1 Data Scope Contract

The ownership ladder is **Account -> Org -> Agent**:

- Account owns one or more org workspaces.
- Org is the membership, billing, and admin boundary.
- AgentConfig/Agent version is the unit for operational data.

All customer-facing runtime/config evidence must be addressable by `agentConfigId`: Chats, Runtime shells, ProcedureRuns, Messages, Traces, HumanTasks, Memory, Scenario receipts, Operate queues, and Operate metrics. Org/account views may aggregate only through explicit roll-ups and must label themselves as roll-ups; they must not masquerade as the selected Agent's data. Legacy rows without `agentConfigId` are unattributed legacy data and are excluded from agent-scoped truth unless a migration/backfill assigns them to a specific Agent.

Selected-Agent surfaces must be URL-addressable by Agent. The current compatibility contract is `?agentId=<agentConfigId>` on Operate/runtime routes; a future path route such as `/agents/[agentId]/operate/...` can replace that once redirects and navigation are migrated. LocalStorage/context selection is only a convenience cache: server reads must require an explicit agent parameter, validate org ownership, and never silently fall back to org-wide runtime data.

Known legacy caveat: `UserProfile` remains org-scoped storage in the current schema. Agent-selected user/profile screens can show stats derived from agent-scoped Cases/ProcedureRuns, but the markdown profile row is a legacy shared profile until a schema migration adds `agentConfigId` and backfills existing rows.

Seven modules, two priorities:

| Module | Name | Priority | Depends on |
|---|---|---|---|
| M1 | Procedure single-track (v2 canonical, v1 deleted) | P0 | — |
| M2 | Durable ProcedureRun state | P0 | — (schema lane; parallel with M1) |
| M3 | Runtime/console process split | P1 | M2 |
| M4 | Turn pipeline + ProcedureRun kernel | P1 | M1; rides with M3 |
| M5 | Tenant isolation seam mechanization | P1 | — |
| M6 | Operate feedback loop (resolution metrics) | P2 | M2 |
| M7 | Verification & governance economics | P2 | — |

---

## 1. Verified Runtime Truth (2026-06-12)

This section records what was checked in code, so the module problem statements stand alone.

### 1.1 Procedure runtime stability verdict

**Control-plane logic: medium-high stability.** The v2 hardening (`e169bf50`) shipped today with real enforcement and real tests:

- Reconcile gate blocks Tools when `needsReconcile` except `reconcile_procedure_input`/`read_chat_memory`/`read_user_profile` (`loop.ts` ~L525-538).
- Stale text replies are withheld and traced (`loop.ts` ~L719-728).
- Tool calls/results stamp `basedOnInputEpoch`; stale results become evidence without advancing steps (`session-store.ts: recordProcedureToolCall/recordProcedureToolResult`).
- `llm_eval` conditions execute with evaluator receipts (`procedure-llm-evaluator.ts`, `evaluatePendingProcedureConditions`).
- Failed/empty/schema-invalid/non-persisted tool and handoff outcomes block instead of pretending success.
- Owner decision as of 2026-06-15: once human handoff succeeds on any channel, the Procedure is finalized. Do not model successful handoff as a resumable paused state.
- ~1,150 new test lines across session-store, runtime artifact, contract, evaluator, runner.
- The lane's own receipt is honest: `PARTIAL PASS`, `toolExecutionMode=mocked`, `llm_eval provider proof: injected only`, not deployed, no authenticated UI proof. v2 has control-plane proof, not live-connector or production proof.

**State durability: structurally unstable.** Three concrete break points, all in `apps/console/lib/agent/session-store.ts`:

1. **The original paused-waiting-human mismatch is now an archival risk, not the target contract.** `SESSION_TTL_MS = 30 * 60 * 1000` (L324); `cleanupStaleSessions` evicts idle sessions every 5 minutes; `createSession` starts with empty `procedureRuntime` (L1066). Before the 2026-06-15 owner decision, v2 made `create_human_task` pause the run (`status=paused`, "Waiting for human handoff"), which contradicted real handoff timelines and justified M2's production proof lane. The current contract is stricter: once human handoff succeeds on any channel, the Procedure is finalized, so that common escalation path is no longer resumable state. The durability risk still exists for truly paused runs (for example session eviction or non-terminal pause semantics): after eviction, the resume path (`startProcedureRun` matching `pausedProcedureRuns`, L624-625) still finds nothing, and ProcedureRun truth is lost across session boundaries.
2. **Deploy/restart loses all active and paused runs.** Accepted P0 assumption in the harness doc §3.4, but already bitten in production (see `.artifacts/delivery-audit/2026-06-11/j1b-receipt-durability-gate*`).
3. **`latestInputEpoch` lives on the ephemeral session.** After eviction/restart the epoch counter resets to 0, so the stale-evidence invariant ("every step advance is based on the latest inputEpoch") silently degrades across session boundaries.

Additional risks on the same surface:

- Post-turn persistence (`persistChatSession`/`compactUserProfile`) is fire-and-forget and races the next request's memory load (HARD_BUGS tail note; `loop.ts` ~L990-1039).
- Per-case concurrency relies on `hasSession()` check-then-register inside one event loop (`api/messages/route.ts` ~L671-697) — safe single-process, breaks the moment a second instance exists.

**Dual-track tax: live in four layers.** v1 and v2 branch in `procedure-executor.ts` (two prompt assembly paths: `buildPrompt` with todos/facts vs `buildDefinitionPrompt` with runtime tail), `tool-interceptor.ts` (`collectedFacts` only for v1, L157-166), `loop.ts` (`exposeConfirmedFacts = activeRun?.procedureVersion !== 'v2'`, L1367), and `packages/shared/contracts/procedures.ts` (both schemas). `confirmedFacts` is half-removed: spec §7.0 says delete; runtime still gates by version because v1 is the remaining consumer. Every branch is regression surface.

**Self-violation:** `v2ActionMatchesTool` resolves Knowledge tools by `toolName.startsWith('kb_search_')` (`procedure-executor.ts` ~L325) — the fin-style spec §7.0 owner decision requires Knowledge Tool identity fixed at source create/update/import time, not guessed at runtime.

**One-line verdict:** stable within a short session (< 30 min idle, no deploy, no human wait); crossing any of those three boundaries loses ProcedureRun truth. That was an acceptable P0 assumption before v2 made "paused, waiting for human" a first-class state; now it contradicts the engine's own product claims. Hence M2 is P0.

### 1.2 Other verified facts the modules cite

- `loop.ts` is 2,037 lines (was 1,352 at the 2026-06-08 review); `session-store.ts` is 2,213 lines; `/api/messages/route.ts` is 966 lines; the v2 editor page `app/build/components/procedures/[name]/page.tsx` is ~1,980 lines.
- 91 API route files; 34 Prisma models, 11 of them Pilot-cockpit persistence.
- Old orchestrator/sub-agent/react-loop/stage files are physically gone (R2 confirmed). `ConversationLoop`/`CaseAgentLoop` remain as per-iteration strategies called from `loop.ts`.
- Tenant isolation and data scope: `assertAgentInOrg()` wired into the 11 admin sub-module routes (L5 fix, `5bd7326b`); enforcement is per-route convention, not a mechanized seam. Runtime, Operate, and config read paths must resolve the selected Agent before querying agent-owned data.
- `dictionaries.ts` is 3,772 lines (was 3,037), still the #1 churn file.
- Deploy: single host, systemd `intera-console.service` + Caddy; runtime lives inside the Next.js process.

---

## 2. M1 — Procedure Single-Track (P0)

### 2.1 Problem

Procedure v1 (step machine: `use/read/ask/decide/tag/escalate/finalize`) and v2 (playbook: `ask/search_knowledge/call_tool/request_human_handoff/end` + conditions) are both live. The dual track blocks completing the owner-approved `confirmedFacts` removal (fin spec §7.0.1), doubles prompt-assembly and interceptor logic, and is the seed of a third runtime-overlap era.

### 2.2 Decision

v2 is canonical. v1 is deleted — schema content migrated, code paths removed, no long-term dual-read. Same discipline the Foundation Reset used on stage/sub-agent.

### 2.3 Migration: v1 → v2 mapping

A one-time migration script normalizes every stored `CaseType.procedure` JSON; the write path accepts only v2 afterward.

| v1 step | v2 equivalent |
|---|---|
| `ask` (target/guidance) | step with `ask` action; guidance preserved |
| `use` / `read` (target=tool) | step with `call_tool` action, `toolName=target` |
| `escalate` | step with `request_human_handoff` action |
| `finalize` | step with `end` action |
| `decide` / `tag` | step `guidance` text (no action) — these were always model guidance |
| `when` condition (free text) | branch with `llm_eval` condition (prompt = the `when` text), or `skipGuidance` when it only explains skipping |
| `required: true` on use/read | `completionGuidance` + Code Safety Kernel required-evidence check (tool_event condition `succeeded`) |

Migration is idempotent and keeps the original v1 JSON under `legacy.procedureV1` inside the CaseType row for audit (read by nothing).

### 2.4 Remove list (executed in this lane)

- `packages/shared/contracts/procedures.ts`: v1 `procedureSchema` / `procedureStepSchema` / `PROCEDURE_ACTIONS` export surface (keep internal types only if migration script needs them, then delete with the script).
- `packages/shared/contracts/case-types.ts`: `parseProcedure` v1 path; `normalizeProcedureDefinition` v1 branch.
- `apps/console/lib/agent/procedure-executor.ts`: `renderProcedureSteps`, `seedProcedureTodos`, `requiredToolTargets`, `isProcedureComplete`, v1 `buildPrompt` path with todos/facts; keep only the v2 definition prompt + step/tool scope mapping.
- `apps/console/lib/agent/tool-interceptor.ts`: `collectedFacts` v1 branch (~L157-166).
- `apps/console/lib/agent/loop.ts`: `exposeConfirmedFacts` version gate (~L1367) — after M1 nothing exposes confirmedFacts.
- `apps/console/lib/agent/session-store.ts`: `legacyFacts` on `ProcedureRunState`; `buildLegacyStepTitle`; v1 branches in `buildInitialSteps`.
- ChatMemory `todos` seeding from procedure steps (`seedProcedureTodos` consumers) — ProcedureRun step state is the only progress truth (fin spec §7.0 already requires proving ChatMemory-todo ownership is gone; this lane is where it happens).
- **Completes fin spec §7.0.1:** with v1 gone, delete `ChatMemory.confirmedFacts` field, contracts, prompt blocks, `remember(scope="chat")` fact writes, and Hook `requireFacts` — the full owner-approved remove list.
- Knowledge tool identity: replace `toolName.startsWith('kb_search_')` in `v2ActionMatchesTool` with tool names resolved from the KnowledgeSource config at load time (per fin spec §7.0 owner decision).

### 2.5 Out of scope

- Editor visual redesign beyond what v2-only requires (the ~1,980-line editor page split is M7-adjacent hygiene, separate lane).
- `@Switch Procedure` insert (fin spec marks it post-P0).

### 2.6 Acceptance gates

```bash
# grep gates — only migration scripts / archived docs may hit:
rg "procedureVersion|isProcedureV2Definition|legacyFacts|collectedFacts|exposeConfirmedFacts" apps packages
rg "confirmedFacts|requireFacts|ingestUserMessageFacts" apps packages
rg "seedProcedureTodos|renderProcedureSteps" apps packages
```

- Typecheck, keyless tests, clean `build:console`.
- Migration script run against a production snapshot copy: every existing CaseType procedure parses as v2 afterward.
- J1B scenario regression suite re-run (runtime/prompt/procedure changed → per MASTER handoff rules the matrix re-run is required).
- Production receipt: one v2 procedure executes end-to-end on `demo.anytrans.ai` with the live editor.

---

## 3. M2 — Durable ProcedureRun State (P0)

### 3.1 Problem

See §1.1. In-memory-only run state + 30-minute TTL + restart amnesia contradicts the paused-waiting-human path and the receipt-durability requirement. The harness doc said "no Prisma ProcedureRun table unless a schema lane is explicitly approved" — **this spec is that approval request.**

### 3.2 Decision

Write-through Postgres, in-memory cache. Not Redis: no new infra dependency on a single-host deploy, turn cadence is seconds (PG round-trips are irrelevant at this rate), and durability — not latency — is the goal. Redis/leases become relevant only at M3+ multi-instance, and the PG schema still serves there.

### 3.3 Schema (schema lane, exclusive ownership of `schema.prisma`)

```prisma
model ProcedureRun {
  id              String   @id            // runId
  caseId          String
  agentConfigId   String
  procedureId     String
  procedureVersion String  @default("v2")
  status          String                   // active | paused | completed | cancelled
  inputEpoch      Int      @default(0)
  needsReconcile  Boolean  @default(false)
  currentStepId   String?
  outcome         String?                  // M6: resolved_by_agent | handed_off | abandoned | expired
  state           Json                     // steps, inputs, evidence, evaluations, signals, timeline, blockers
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([caseId, status])
  @@index([agentConfigId, procedureId, status])
}
```

- One row per run, JSONB document for the structured state — **not** normalized event tables; `ActionTrace` already covers append-only audit. The document shape is exactly `ProcedureRunState` from `session-store.ts`.
- `Case.runtimeInputEpoch Int @default(0)`: the epoch counter is per case, not per run, and must survive session eviction. `nextInputEpoch` increments it write-through.

### 3.4 Runtime behavior

- `session-store.ts` keeps the same exported API; every mutation that today edits the in-memory run also persists (await, not fire-and-forget — these are the canonical-truth writes; ordinary chat persistence may stay async).
- `getOrCreateSession` hydrates: `procedureRuntime` from `ProcedureRun` rows (`status IN (active, paused)`) and `latestInputEpoch` from `Case.runtimeInputEpoch`.
- TTL eviction keeps DB rows. Eviction of a session with an `active` run marks the run `paused` with `reason="session evicted"` (it can resume on the next input).
- `closeSession` on explicit case close marks remaining runs `cancelled` with `outcome='abandoned'`.
- Queue stays in-memory (transient by design; LiveChat already has retry + dedup at ingress).

### 3.5 Remove list

- The comment block in `session-store.ts` declaring in-memory-only authority (L20-24) and the harness doc §3.3 R3 boundary line "First version should not add a Prisma ProcedureRun table…" — update the harness doc to point here.

### 3.6 Acceptance gates

- Red→green kill-and-resume test: start v2 run → `create_human_task` pauses it → simulate eviction/restart (clear session map) → `human_task_result` arrives → run resumes with inputs/evidence/evaluations intact and correct `inputEpoch`.
- Epoch durability test: input at epoch N → evict → new input hydrates and stamps epoch N+1 (not 1).
- Production receipt: restart `intera-console.service` mid-run on `demo.anytrans.ai`, then resume the conversation; ProcedureRun timeline shows continuity across the restart.
- No double-write divergence: a property/invariant test asserts in-memory state equals rehydrated DB state after each mutation batch.

---

## 4. M3 — Runtime/Console Process Split (P1)

### 4.1 Problem

The agent runtime (ReAct loop, streaming tool execution, session store, LiveChat bridge) lives inside the Next.js console process. Console deploys kill active turns; Next.js route handlers are a poor host for long-lived stateful loops; horizontal scale is impossible. cc's single-process shape is right for a single-user CLI and wrong for a multi-tenant server — copy cc's harness semantics, not its process architecture.

### 4.2 Decision

Two steps, M2 first (so the runtime service may restart freely):

**Step 1 — `packages/runtime-core` (pure library).** Move the Next-free parts of `apps/console/lib/agent/**` (loop, session-store, hook-engine, tool router, trace, memory, procedure modules, llm evaluator) plus `lib/livechat/bridge` dependencies into a workspace package. The seam already exists: `persistence-port.ts` and `packages/shared/contracts`. Console keeps importing it; zero behavior change; CI gate forbids `next/*` imports inside the package.

**Step 2 — `apps/runtime` (standalone Node service).** Hosts runtime-core behind an internal HTTP API:

```text
POST /internal/cases/:caseId/messages     → SSE stream (same event contract as today's /api/messages)
POST /internal/cases/:caseId/close
GET  /internal/health                     → { sessions, activeRuns, queueDepth }
```

- Console `/api/messages` and the LiveChat webhook route become thin authenticated proxies (auth, org resolution, rate limit stay in console; runtime trusts only the internal network/token).
- Both processes share the Prisma client and the same Postgres.
- Deploy: second systemd unit `intera-runtime.service`; Caddy unchanged (single public origin). Console deploys no longer touch active runs; runtime deploys are safe because of M2.

### 4.3 Out of scope

- Multi-instance runtime, Redis leases, work-stealing — explicitly frozen until a customer SLA demands it. The split makes them possible; it does not implement them.

### 4.4 Acceptance gates

- `packages/runtime-core` has no `next` imports (CI grep gate) and builds standalone.
- Production receipt: deploy console while a run is mid-turn → turn completes, SSE uninterrupted (proxy reconnect acceptable, run state intact).
- LiveChat webhook → runtime → reply round-trip receipt on production.
- `/internal/health` metrics visible in Operate.

---

## 5. M4 — Turn Pipeline + ProcedureRun Kernel (P1, rides with M3 step 1)

### 5.1 Problem

`loop.ts` regrew from 1,352 to 2,037 lines because there is no Turn abstraction — the loop owns context assembly, model call, stream consumption, tool dispatch, hook checkpoints, memory, compaction, procedure overlay, and persistence, so every new behavior lands in the hub. The hardest invariants in the system (epoch/reconcile/stale-evidence) live mixed with IO in a 2,213-line session-store.

### 5.2 Decision

Two deepenings, done while files move into `runtime-core` (M3 step 1), not as a separate big-bang:

**ProcedureRun kernel.** Extract the pure transition logic from `session-store.ts` into `procedure-run-kernel.ts`:

```ts
// Pure: no IO, no Date.now (clock injected), no prisma, no fetch.
export function applyRunEvent(
  state: ProcedureRunState,
  event: RunEvent,        // input | tool_call | tool_result | text_reply | reconcile | finalize | handoff | eval_receipt
  clock: () => string,
): { state: ProcedureRunState; effects: RunEffect[] }
```

`session-store.ts` becomes the adapter: storage (M2 write-through), queue, and TTL. The kernel gets property tests on the core invariant — *no step advance when `basedOnInputEpoch < state.inputEpoch`* — plus table tests for every transition.

**Turn pipeline.** Restructure `AgentLoop.run` into named phases with explicit inputs/outputs: `assembleContext → callModel → dispatchTools → runCheckpoints → persistTurn`. Procedure overlay, memory, and compaction plug in at phase seams. Hard caps after M4: `loop.ts` ≤ 800 lines; kernel file imports nothing impure (CI grep gate).

### 5.3 Acceptance gates

- `rg "from '@intera/shared/prisma'|fetch\(|Date\.now" packages/runtime-core/src/procedure-run-kernel.ts` → empty.
- Property test suite for the epoch invariant green.
- `wc -l loop.ts` ≤ 800; no behavior diffs in the J1B scenario suite.

---

## 6. M5 — Tenant Isolation Seam Mechanization (P1)

### 6.1 Problem

Since the agent-scoped pivot, isolation is enforced by convention: each admin sub-module route remembers to call `assertAgentInOrg()`. The L5 exploit was real and is fixed in 11 routes, but nothing stops route #12 from forgetting. Before customer #2, the seam must be mechanical, not disciplinary.

### 6.2 Decision

- `defineRoute` gains a scope declaration: `scope: 'agent'` runs `assertAgentInOrg(orgId, agentConfigId)` before the handler; `scope: 'org'` requires the org-scoped repo only.
- `scope: 'agent'` is the default for config/runtime/operate data: Procedure types, Procedures, Tools, Hooks, Knowledge, Integrations, Chats, Runtime shells, ProcedureRuns, Messages, Traces, HumanTasks, Memory, Scenario receipts, queues, and metrics.
- `scope: 'org'` is reserved for org profile, members, account/org preferences, agent list/switcher data, and explicitly labeled aggregate roll-ups.
- CI guard: under `apps/console/app/api/admin/**`, any file containing `repo.raw` or direct `prisma.` access must either declare `scope: 'agent'` via `defineRoute` or appear in a reviewed allowlist. The gate ships red against a deliberate canary first, then green.
- `cross-org-isolation.test.ts` becomes the template: every new admin sub-module lane must add its red→green cross-org case before merge.

### 6.3 Acceptance gates

- CI gate demonstrably red on an unguarded canary route, green after.
- Full isolation suite green; canary removed.

---

## 7. M6 — Operate Feedback Loop (P2, depends on M2)

### 7.1 Problem

The platform can author, simulate, and guard procedures, but cannot answer "which playbook is failing in production and why" — the measurement loop that makes Fin-class products compound is missing. Operate has handoff metrics only.

### 7.2 Decision

- `ProcedureRun.outcome` (schema in M2): `resolved_by_agent` (finalize passed safety checks), `handed_off` (human task created), `abandoned` (cancelled/expired/evicted), recorded by the runtime at the terminal transition.
- Owner decision on 2026-06-16: the standalone `/operate/procedures` page and `/api/operate/procedures/metrics` endpoint are removed from the active product surface. Do not reintroduce them without a new product decision.
- Operate feedback should now flow through conversations, human handoff, and explicit case drill-down surfaces rather than a separate aggregate Procedure metrics page.

### 7.3 Out of scope

- Auto-tuning, LLM-suggested playbook edits, per-resolution billing. The outcome data model deliberately makes these possible later.

### 7.4 Acceptance gates

- No active route/API/sidebar entry exists for `/operate/procedures` or `/api/operate/procedures/metrics`.
- Outcome recording remains available for future Operate surfaces that have an explicit product decision.
- Typecheck, tests, build, and production 404/absence proof pass after removal.

---

## 8. M7 — Verification & Governance Economics (P2)

### 8.1 Problem

The receipt culture is correct but manually executed: screenshot lanes consume agent time on every change. The doc system has 21 read-first entries and has already misdirected coding teams once when stale. `dictionaries.ts` (3,772 lines) remains the #1 merge hotspot.

### 8.2 Decision

- **Receipts as CI artifacts.** The scenario `runtime-runner` already executes real runtime paths; wrap it in a headless suite per agent template plus a Playwright screenshot script reusing the existing `.artifacts` layout, run on schedule and on deploy, writing `.artifacts/ci/<date>/`. Manual screenshot lanes remain only for new-surface acceptance, not regression.
- **Docs compression.** Read-first collapses to four live docs: the harness architecture doc (current truth), one roadmap, the single current dispatch doc, and the uncertainty log. Everything labeled "source history" moves under `archive/` with an index. The handoff discipline stays; the layer count drops.
- **Vocabulary lock.** `Procedure` is the API/schema/runtime term; UI copy may render it as "Playbook" via i18n, but no new code identifiers introduce `playbook`.
- **`dictionaries.ts` split** into per-surface modules (`build`, `operate`, `settings`, `common`) with a mechanical merge step — separate, purely mechanical lane.

### 8.3 Acceptance gates

- CI produces a dated receipt bundle without human action twice in a row.
- `doc/README.md` read order ≤ 5 live entries; archived docs indexed.
- `rg -i "playbook" apps packages --type ts` hits only i18n dictionary values.

---

## 9. Freeze List

Explicitly not built while M1-M7 are open:

- marketplace (publishing, payments, ratings)
- new Hook checkpoints beyond `PreToolUse` / `PostToolUse` / `Stop`
- workflow Tool builder / node canvas
- new Pilot-cockpit persistence models (the existing 11 are capped)
- ConfigPilot capability expansion (it remains an accelerator, never a gate)
- multi-instance runtime / Redis leases (unblocked by M3, deferred until an SLA requires it)

---

## 10. Dispatch Rules

- One module = one lane. M1 and M2 may run in parallel; the M2 schema lane owns `packages/shared/prisma/schema.prisma` exclusively per MASTER handoff rules.
- Each lane's implementation plan (in `doc/to-do/`) must reproduce its module's **remove list as checkboxes** and execute it in the same lane — deletion is not follow-up work.
- Each lane inherits the two-phase verification and production acceptance bar from [`PLATFORM_DELIVERY_AUDIT_GOALS.md`](../archive/retired-handoffs/PLATFORM_DELIVERY_AUDIT_GOALS.md).
- Runtime/prompt/procedure-touching lanes (M1, M2, M4) trigger the J1B scenario matrix re-run rule from the MASTER handoff.
- When M2 lands, update `Intera_Harness_架构梳理.md` §3.3/§3.4 (R3 in-memory boundary) to reference this spec instead of the single-process assumption.
