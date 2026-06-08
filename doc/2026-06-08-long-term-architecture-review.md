# Intera — Long-Term Architecture Review

**Date:** 2026-06-08 | **Author:** architect (review only — code executed by the coding-agent team) | **Branch:** `main`
**Method:** code-first. Every claim below was checked against the working tree, not the handoffs (which `GENERIC_HANDOFF §0.6` warns may be stale). Citations are `file:symbol` (lines drift).

> **Read order:** this is a *strategic* review (the "why we plateaued" and the sequence out). It sits above the tactical plans in `doc/to-do/`. It does **not** replace the owner-approved [`2026-06-08-case-type-procedure-orchestration-refactor.md`](to-do/2026-06-08-case-type-procedure-orchestration-refactor.md) — it frames it, endorses its core, and corrects one broken dependency.

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

→ The owner-approved Procedure refactor targets exactly this. **Endorsed** (see §3). The one correction: it must *also* land the loop decomposition (G10/TODO-17), not defer it — the dual-ReAct-loop + misnamed-strategy structure is half the problem.

### F2 — The agent-scoped pivot is under-reconciled with tenant isolation *(severity: correctness risk / high)*

- Migration `20260606000000_agent_scoped_architecture` **dropped `org_id`** from `policies`, `skills(tools)`, `case_types`, `knowledge_sources`, `channel_bindings`; rescoped them by `agent_config_id`; **`DELETE`d** the old org-scoped rows; dropped `policyHooks` + `capabilityBindings` from `agent_configs`.
- The isolation seam `repoForOrg`/`scopedModel` injects **`orgId`**. Models that no longer *have* `org_id` cannot be scoped by it — so handlers reach for `repo.raw.*` and scope by `agentConfigId` by hand (`app/api/admin/tools/route.ts`; commits `ef56523a`, `6954f5db` = "use repo.raw … by globally-unique ID").
- **The real isolation boundary is now the orgId→agentConfig ownership check, enforced ad hoc rather than at the seam.** Not proven exploitable — but unaudited. This is the kind of gap that turns into a cross-tenant read the day a second real tenant exists. **Needs an isolation audit + guard test** (can org A touch org B's agent's tools via the agent-config id?).

### F3 — Config is JSON-blob-as-schema *(severity: structural / high)*

- **14 stringified-JSON `String` columns** across the 3 core models (`AgentConfig.memoryStrategy`; `CaseType.{requiredFacts,stages,stageConfigs,orchestratorConfig,escalateOn,autoCloseConditions}`; `ChatMemory.{confirmedFacts,missingFacts,skillsCalled,skillResults,keyEvents,todos,agentTodos}`), and the pattern is pervasive platform-wide (`Tool`, `ChannelBinding`, `HumanTask`).
- Consequences already visible: **`executionMode` schema comment says `"stage" | "step"` while the code only implements `'cc'`** — the blob/typed boundary drifts because nothing enforces it; orphaned references are unvalidated (the Procedure plan now has to hand-write a guardrail-orphan check the DB should give for free); migrations are brittle.
- Direction: where a field has a **closed vocabulary** (Procedure actions, guardrail `when`, policy outcomes), make it typed/contract-validated at the seam (zod) even if it stays a JSON column physically. The Procedure refactor's `ProcedureAction` closed vocab is the first correct instance — generalize the principle.

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

The handoffs are the team's source of truth, and three are materially wrong **right now** — which actively misdirects the coding team:

| Doc | Problem | Impact |
|---|---|---|
| `GENERIC_HANDOFF.md` (2026-06-04) | Predates the 2026-06-06 agent-scoped pivot. §1/§2 still describe org-scoped config + `capabilityBindings` + the old engine. | New agents onboard to a data model that no longer exists. **High.** |
| `MASTER_BUILD_HANDOFF.md` | Says model-page refactor "✅ SHIPPED — 6 phases." But the **draft→publish gate was built then removed** (`f22adf59 "remove draft gate"`); `useDraftGate` does not exist in code. | A downstream plan depends on it (next row). **High.** |
| `to-do/2026-06-08-case-type-procedure-…refactor.md` | Phase 6 says "reuse model-page `useDraftGate`." That hook **does not exist** (removed). Several schema line refs also pre-date the model-page migration. | Phase 6 has an unfounded dependency; will fail at dispatch. **High.** |
| `spec/Intera_Harness_架构梳理.md` (2026-05-13) | Philosophy still canonical; all routes/tool-names/app-split are pre-consolidation. | Reference-only; flag the header, don't rewrite. **Low.** |

These are fixed cheaply (text), and they're load-bearing — proposed corrections in §4.

---

## 3. The Procedure refactor — endorsed, with corrections

The owner-approved Procedure plan is **the right first structural move** — its diagnosis matches the code (F1), and "Procedure (soft order) + Hooks (hard gates), single inline agent" is both Fin-aligned and matches Intera's own canonical philosophy ("不做 Flow-Chatbot"). Endorsed. Three corrections before dispatch:

1. **Break the Phase-6 `useDraftGate` dependency.** ✅ **Owner-approved 2026-06-08: drop the draft-gate** — ship the Procedure Builder against the existing version system (`agent-version-picker` fork/activate). The plan's §3.5 + Phase 6 are annotated accordingly.
2. **Fold in the loop decomposition (G10), don't defer it.** Phase 5 already touches `loop.ts`; collapsing the dual ReAct loops + misnamed strategy objects into "Core loop + ProcedureExecutor on one engine" is the point. Deferring it leaves half the F1 debt standing.
3. **Sequence it in parallel with a thin foundation slice (F6).** ✅ **Owner-approved 2026-06-08: parallel** — the Procedure plan's additive Phases 0–3 run concurrently with the P0 foundation lane on non-overlapping files; Phases 4–6 are **gated on the foundation landing** (they need SELECT-only-prod + real local-DB e2e).

---

## 4. Recommended long-term sequence (consolidation, not patches)

Ordered by leverage. Each is a *direction* for a `doc/to-do/` plan, not a code diff.

**P0 — Foundation: safe local DB + dev/prod parity.** *(unblocks everything; ~1 focused lane)*
A real local Postgres (the `docker-compose.yml` Postgres:16 already exists — wire it as the dev `DATABASE_URL`); seed it; retire `sqlite-schema-compat.ts` (or make SQLite truly unsupported). Restore `SESSION_SECRET` to `.env.local`. Outcome: write-flows run locally, Phase-2 stops slipping, the Procedure refactor's verification phases become real.

**P1 — Reconcile tenant isolation with the agent-scoped model (F2).** *(correctness; before a 2nd real tenant)*
Decide the boundary: either give the seam an `agentConfig`-aware scoping mode, or formalize the orgId→agentConfig ownership check as a single guard helper every sub-module route calls. Add the cross-tenant guard test. Stop the `repo.raw.*` drift.

**P2 — Execution-model collapse = the Procedure refactor (F1) + loop decomposition (G10).** *(the headline structural win)*
As §3. One execution path; kill the write-only continuation state (F4); one ReAct engine.

**P3 — Config detyping where it's closed-vocabulary (F3).** *(rides on P2)*
Procedure actions / guardrail `when` / policy outcomes get zod contracts at the seam; resolve the `executionMode` comment/code drift as it's deleted. Generalize the "closed vocab ⇒ validated" rule.

**P4 — Cross-cutting hygiene (F4/F5/F7).** *(parallelizable, lower urgency)*
Delete dead fields + duplicate migration; one trace aggregation for playground **and** ops; extract the shared FE `useResourceEditor` hook (load/error/save-state) and actually adopt `useApi`; begin decomposing `playground/page.tsx`. Consider a key-generation or namespaced-file approach for `dictionaries.ts` to de-serialize the parallel lanes.

**Governance, continuous:** truth-up the three stale docs (§2 / §4-proposals) as the prerequisite for everything above — agents can't execute against a false map.

---

## 5. Decisions — owner-approved 2026-06-08

1. **Sequencing → PARALLEL.** P0 foundation lane runs concurrently with the Procedure plan's additive Phases 0–3 (non-overlapping files; declare lanes). Procedure Phases 4–6 gated on the foundation landing.
2. **Procedure Phase 6 → DROP THE GATE.** Ship the Procedure Builder against the existing version system; no `useDraftGate`. Plan annotated.
3. **Doc corrections → APPROVED (all three).** Applied 2026-06-08: `GENERIC_HANDOFF` (agent-scoped pivot callout), `MASTER_BUILD` (model-page draft-gate correction), Procedure plan (Phase-6 annotation). `HARD_BUGS.md` rewritten as a fixed + open-landmines registry.

### Next architect deliverable
Write the **P0 foundation plan** (`doc/to-do/2026-06-08-foundation-safe-local-db.md`): wire the existing `docker-compose.yml` Postgres:16 as the dev `DATABASE_URL`, seed it, restore `SESSION_SECRET` to `.env.local`, retire/replace `sqlite-schema-compat.ts`, and add the cross-tenant isolation guard test (F2/§L5). This is the lane that unblocks the Procedure refactor's verification.

---

*Companion: `doc/handoffs/HARD_BUGS.md` now tracks the live landmines surfaced here (F8 i18n, ChunkLoadError, playground god-component, guardrail live-confirm, isolation-seam gap).*
