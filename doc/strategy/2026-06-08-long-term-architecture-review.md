# Intera — Long-Term Architecture Review

**Date:** 2026-06-08 | **Author:** architect (review only — code executed by the coding-agent team) | **Branch:** `main`
**Method:** code-first. Every claim below was checked against the working tree, not the handoffs (which `GENERIC_HANDOFF §0.6` warns may be stale). Citations are `file:symbol` (lines drift).

> **Read order:** this is a *strategic* review (the "why we plateaued" and the sequence out). It is now a diagnosis source for the active Foundation Reset, not the implementation plan. Dispatch coding work from [`../to-do/2026-06-08-foundation-reset-domain-model.md`](../to-do/2026-06-08-foundation-reset-domain-model.md).

---

## 0. Thesis — why the project is at a plateau

Intera was built fast by parallel coding agents shipping features lane-by-lane. That velocity is now the bottleneck, because **structural debt is accreting faster than it's retired**, and the foundation that would let you verify changes cheaply is broken. Three forces compound:

1. **Too many half-wired runtimes on one god-loop.** Three execution models (stage / `cc`-SOP / sub-agent fan-out) hang off a 1,352-line `loop.ts`. Only one truly runs; one is dormant; one *spawns background work whose results are never surfaced*. Every new behavior must thread all three.
2. **A major data pivot the rest of the system hasn't caught up to.** The 2026-06-06 "agent-scoped" migration moved all sub-modules from org-scoped to agent-scoped and deleted the old data — but the tenant-isolation seam, the docs, and the verification story still describe the pre-pivot world. The team is now routing around the isolation proxy with `repo.raw.*` (recent commits literally say so).
3. **No safe ground to test on.** Local `DATABASE_URL` tunnels to **production** Postgres; there is no safe local DB; the SQLite dev shim is stale and silently diverges. So the mandated two-phase verification (`GENERIC_HANDOFF §0.3`) is expensive — and it shows: recent waves carry "Phase-2 skipped / Playwright locked / live-confirm pending" residuals.

**The plateau is not any one feature. It's that every change now lands on shifting ground.** The long-term move is **consolidation + foundation, not more features.** This review prioritizes accordingly.

---

## 1. Findings by theme (evidence-backed)

### F1 — The execution layer is three overlapping models on one hub *(severity: structural / highest)*

- `loop.ts` (1,352 lines) imports **27** other agent modules — it is the single hub; `AgentLoop.run` owns the only real ReAct iteration (a `do…while`, not the `while(true)` the spec draws).
- `ConversationLoop` and `CaseAgentLoop` are **misnamed** — neither owns an iteration; they're per-iteration strategy objects called from `loop.ts`. `case-agent-loop.ts` (874) → `stage-executor.ts` (583) + `orchestrator.ts` (609) → `sub-agent.ts` (383). ~3,800 lines implement the case path.
- **A second, independent ReAct loop** exists in `react-loop.ts` + `sub-agent.ts` (`for`-loops), with the "one tool_result per tool_use" invariant **re-implemented** separately from the main loop's `tool-result-invariant.ts`.
- **Execution-model reality:**
  - `executionMode:'stage'` is the default and the only path that meaningfully runs.
  - `'cc'` (SOP) is fully wired and operator-selectable, but **no seed or default puts a case into it** — built, reachable, unused.
  - **Sub-agent fan-out is live-but-broken, which is worse than dead.** `dispatch_case_agent` still spawns a background sub-agent in production (`tool-interceptor.ts → orchestrator.dispatchInBackground`), but the coordination state it produces — `needsContinuation`, `agentTodos`, `dashboardVersion`/dashboard-diff — is **write-only**: persisted every turn (`messages/route.ts`), read by **no one** (`getAgentTodos`/`getDashboardVersion` have zero callers). The continuation chain is severed; background results never return to the customer.

→ The Foundation Reset targets exactly this by making ProcedureExecutor the single Case runtime and retiring detached customer-facing sub-agent fan-out. The older standalone Procedure plan is archived; its useful intent is absorbed by the reset.

### F2 — The agent-scoped pivot is under-reconciled with tenant isolation *(severity: correctness risk / high)*

- Migration `20260606000000_agent_scoped_architecture` **dropped `org_id`** from `policies`, `skills(tools)`, `case_types`, `knowledge_sources`, `channel_bindings`; rescoped them by `agent_config_id`; **`DELETE`d** the old org-scoped rows; dropped `policyHooks` + `capabilityBindings` from `agent_configs`.
- The isolation seam `repoForOrg`/`scopedModel` injects **`orgId`**. Models that no longer *have* `org_id` cannot be scoped by it — so handlers reach for `repo.raw.*` and scope by `agentConfigId` by hand (`app/api/admin/tools/route.ts`; commits `ef56523a`, `6954f5db` = "use repo.raw … by globally-unique ID").
- **The real isolation boundary is now the orgId→agentConfig ownership check, enforced ad hoc rather than at the seam.** Not proven exploitable — but unaudited. This is the kind of gap that turns into a cross-tenant read the day a second real tenant exists. **Needs an isolation audit + guard test** (can org A touch org B's agent's tools via the agent-config id?).

### F3 — Config is JSON-blob-as-schema *(severity: structural / high)*

- **14 stringified-JSON `String` columns** across the 3 core models (`AgentConfig.memoryStrategy`; `CaseType.{requiredFacts,stages,stageConfigs,orchestratorConfig,escalateOn,autoCloseConditions}`; `ChatMemory.{confirmedFacts,missingFacts,skillsCalled,skillResults,keyEvents,todos,agentTodos}`), and the pattern is pervasive platform-wide (`Tool`, `ChannelBinding`, `HumanTask`).
- Consequences already visible: **`executionMode` schema comment says `"stage" | "step"` while the code only implements `'cc'`** — the blob/typed boundary drifts because nothing enforces it; orphaned references are unvalidated (the Procedure plan now has to hand-write a guardrail-orphan check the DB should give for free); migrations are brittle.
- Direction: where a field has a **closed vocabulary** (Procedure actions, Hook checkpoints, Hook decisions, Tool modes), make it typed/contract-validated at the seam (zod) even if it stays a JSON column physically. The reset's `ProcedureAction`, `HookCheckpoint`, and Tool mode contracts should generalize this principle.

### F4 — Vestigial state and dead config accreting *(severity: hygiene / medium, but a tax on every reader)*

- **Write-only / dead memory fields:** `continuationLock` (no reader *and* no writer — pure dead weight), `needsContinuation` (write-only), `agentTodos` + `dashboardVersion` (round-tripped to DB every turn, never consumed by the loop).
- **Duplicate migration number:** two `20260603000008_*` dirs — ambiguous apply order; both touch since-dropped columns.
- **Stale SQLite compat shim** (`sqlite-schema-compat.ts`): hand-maintained ALTER list, already wrong (still references the renamed `skills`→`tools` table), missing ~15 newer columns. See F6.
- These are individually small; collectively they're why "what does this field do?" has no cheap answer, which slows every change.

### F5 — Console: god-components + a real-but-unfinished FE seam *(severity: maintainability / medium)*

- **5 pages over 700 lines:** `playground` 1587, `knowledge` 934, `ops/guide` 853 (mostly static), `tools` 790, `ops/chats/[chatId]` 727.
- The FE↔BE seam shipped (~57 routes on `defineRoute`; `repoForOrg` injected centrally; `apiClient` envelope) — **but two holes:** (a) `repo.raw.*` bypasses scoping (F2); (b) the `useApi` dedup hook was built and then **not adopted** — the four config pages each hand-roll their own load/error/save state with **three divergent save-state enums** and a copy-pasted 800 ms `useRef`+`setTimeout` debounce.
- **`dictionaries.ts`** is 3,037 lines of flat dotted keys, en+zh stacked — the **#1 most-churned file in the repo (74 commits)** and the documented merge hotspot. It is a structural serialization point for the whole parallel-lane model.

### F6 — The verification foundation is broken *(severity: velocity root-cause / high)*

- `GENERIC_HANDOFF §0.3` mandates two-phase verification (local gate + prod browser test) for every task; `§0.4` mandates red→green e2e guards for safety changes. But:
  - Local `DATABASE_URL` → **production** Postgres via tunnel (memory `project_local_db_is_production`); no safe local DB; `SESSION_SECRET` missing from `.env.local`.
  - The SQLite escape hatch is the stale shim (F4) — it can't stand in for a real schema.
- Net effect: you **cannot safely run a write-flow locally**, so Phase-2 keeps slipping ("Phase-2 skipped", "Playwright locked", "live-confirm pending"). The Procedure refactor's own Phase 0/2/3/5 *require* SELECT-only-prod and real local-DB e2e — **it is blocked on this foundation it doesn't own.** Fixing this is the single highest-leverage unblock in the whole review.

### F7 — Observability is bifurcated *(severity: medium)*

- The trace single-contract refactor genuinely shipped: `TraceWriter` writes through `PersistencePort` (prod→Prisma, playground→memory); `trace-aggregator` consumes real `TraceRecord[]`, not SSE. Good.
- But the **5-stage aggregation is playground-only**; production `/ops/chats` and `/ops/cases` render **raw trace rows**. Operators debugging real customer cases get a *worse* view than the playground sandbox. The aggregator should serve both surfaces.

---

## 2. The stale-docs problem (governance debt)

The handoffs are the team's source of truth. At the time of this review, several were materially wrong and were actively misdirecting the coding team.

**2026-06-08 doc reset status:** the live map has now been cleaned:

- [`../handoffs/MASTER_BUILD_HANDOFF.md`](../handoffs/MASTER_BUILD_HANDOFF.md) points to Foundation Reset as the current macro priority.
- [`../spec/Intera_Harness_架构梳理.md`](../spec/Intera_Harness_架构梳理.md) is rewritten as the current architecture source of truth.
- The old standalone Procedure plan is archived at [`../archive/superseded/2026-06-08-case-type-procedure-orchestration-refactor.md`](../archive/superseded/2026-06-08-case-type-procedure-orchestration-refactor.md).
- The Procedure supplement is merged into the architecture doc and archived at [`../archive/superseded/Intera_Customer_Service_Procedure_Model.md`](../archive/superseded/Intera_Customer_Service_Procedure_Model.md).
- [`doc/README.md`](../README.md) now defines read order and current vocabulary.

The governance lesson remains: coding teams cannot execute against a false map. Keep `to-do/` current and move replaced plans to `archive/superseded/`.

---

## 3. From Procedure Plan To Foundation Reset

The older Procedure plan had the right core diagnosis:

- Procedure is soft order, not a rigid flowchart.
- Hook is the hard control layer.
- Execution should be inline through one Case Owner Agent.
- Detached customer-facing sub-agent fan-out should be retired.

The owner later expanded that into a broader Foundation Reset:

- `Policy` / `Guardrail` -> `Hook`
- `Skill` -> `Tool`
- checkpoints -> `PreToolUse`, `PostToolUse`, `Stop`
- ProcedureStep-level Hook bindings
- `.intera-agent.json` package support
- ConfigPilot as a typed-API configuration writer
- Scenario Lab as delivery validation
- no long-term dual-read/dual-write compatibility for the old model

That broader reset is now the implementation source. Dispatch from [`../to-do/2026-06-08-foundation-reset-domain-model.md`](../to-do/2026-06-08-foundation-reset-domain-model.md).

---

## 4. Recommended Sequence Now

Ordered by leverage:

**P0 — Safe local DB + dev/prod parity.**
Shipped 2026-06-08. See [`../what's done/2026-06-08-foundation-safe-local-db.md`](../what's%20done/2026-06-08-foundation-safe-local-db.md). This removed the worst verification blocker.

**P1 — Foundation Reset domain model.**
Active. Run F0-F8 from [`../to-do/2026-06-08-foundation-reset-domain-model.md`](../to-do/2026-06-08-foundation-reset-domain-model.md). This is the main path to the commercial customer delivery chain.

**P2 — Tenant isolation hardening around agent-scoped config.**
L5 is code-fixed, but every new admin sub-module route should continue to prove orgId -> agentConfig ownership. Do not reintroduce raw agentConfig access without the guard.

**P3 — ConfigPilot + Scenario delivery loop.**
After the reset contracts settle, make the practical delivery loop excellent: propose diff, confirm, save through typed APIs, run Scenario, produce receipt, export package.

**P4 — Cross-cutting hygiene.**
Shared trace aggregation for playground and ops, FE editor-hook consolidation, playground decomposition, and dictionary churn reduction remain valuable after the reset.

---

## 5. Owner-Approved Decisions Captured

- Parallel work is allowed, but lanes must declare owned files.
- Old Procedure Phases 4-6 are not a separate dispatch target; they are absorbed into Foundation Reset lanes.
- Keep names `Case`, `CaseType`, `Procedure`, and `Tool`.
- Use `Hook`, not Policy/Guardrail, for new architecture.
- Use `PreToolUse`, `PostToolUse`, and `Stop`; remove `preFinalize`.
- ProcedureStep-level Hook binding is required in the UI and model.
- First launch supports declarative, restricted JavaScript, and HTTP Hook handlers.
- `.intera-agent.json` reserves future marketplace support but first serves internal delivery sharing.

---

*Companion docs: [`../handoffs/HARD_BUGS.md`](../handoffs/HARD_BUGS.md), [`../handoffs/MASTER_BUILD_HANDOFF.md`](../handoffs/MASTER_BUILD_HANDOFF.md), and [`../spec/Intera_Harness_架构梳理.md`](../spec/Intera_Harness_架构梳理.md).*
