# Codex Goal: Consolidation M1-M7 (Architect Dispatch Contract)

**Status:** ACTIVE dispatch contract for the consolidation program
**Date:** 2026-06-12
**Role of the receiving session:** dispatching architect / coordinator. You assign and supervise lanes; coding sessions execute them. You do not write feature code yourself except trivial coordination fixes (doc pointers, lane-table updates).
**Owner intent:** execute the owner-approved consolidation program — Procedure single-track, durable ProcedureRun state, runtime/console split, kernelized turn pipeline, mechanized tenant isolation, Operate feedback loop, verification economics — without adding any new product surface.

---

## 1. Read order (before dispatching anything)

1. [`../spec/2026-06-12-architecture-consolidation-modules-spec.md`](../spec/2026-06-12-architecture-consolidation-modules-spec.md) — the normative spec: per-module problem evidence, contracts, remove lists, acceptance gates, freeze list. §1.1 is the current procedure-runtime stability verdict; read it before any runtime lane.
2. [`../to-do/2026-06-12-consolidation-m1-m7-execution-plan.md`](../to-do/2026-06-12-consolidation-m1-m7-execution-plan.md) — the lane/task breakdown, wave map, owned-file declarations, and blocking rules. Dispatch from this document.
3. [`MASTER_BUILD_HANDOFF.md`](./MASTER_BUILD_HANDOFF.md) — active-lanes table (you maintain it), dual-worktree rules, J1B re-run rules.
4. [`PLATFORM_DELIVERY_AUDIT_GOALS.md`](./PLATFORM_DELIVERY_AUDIT_GOALS.md) — the acceptance bar every lane inherits.
5. [`DELIVERY_UNCERTAINTY_LOG.md`](./DELIVERY_UNCERTAINTY_LOG.md) — record uncertain points and default decisions as they surface.

## 2. Dispatch rules

- **Dispatch by wave.** Wave 1: CONS-M2, CONS-M5, CONS-M7A, CONS-M7B in parallel. Wave 2: CONS-M1 (only after CONS-M2 is merged and verified). Wave 3: CONS-M3A+M4 combined lane, CONS-M7C parallel. Wave 4: CONS-M3B and CONS-M6 parallel with the owned-file split from the plan.
- **Never violate the hard blocking rules** in plan §0: `schema.prisma` is sequential (M2 then M1); `session-store.ts`/`loop.ts` chain M2 → M1 → M3A; pause overlapping runtime hotfixes per the dual-worktree rules.
- **Working-tree WIP gate:** before Wave 2, land or explicitly discard the uncommitted WIP on `apps/console/app/build/components/procedures/[name]/page.tsx`. Record the decision in the uncertainty log.
- **Lane prompts must contain:** the module's task list and remove list copied as checkboxes from the plan, the owned-file list, the gates verbatim, the standing rules (plan §10), and the instruction to expand tasks into red→green test-first steps before coding. A lane prompt without the remove list is invalid.
- **Update the MASTER active-lanes table** on every lane start/completion. One file = one lane.
- **J1B matrix re-runs are bundled** at end of Wave 2 and end of Wave 4 (owner-approved default). Targeted scenario suites still run per lane. A failed bundle re-run reopens the responsible lane.
- **Receipts:** every lane produces `.artifacts/delivery-audit/<date>/<lane>/` evidence; production proof on `https://demo.anytrans.ai` per the audit goals. Text-only claims are not acceptance.
- **Freeze list is binding** (spec §9): no marketplace, no new Hook checkpoints, no workflow canvas, no new Pilot persistence models, no ConfigPilot expansion, no multi-instance/Redis work. If a lane asks, the answer is no; log it.
- **Scope discipline:** this program adds no new product features. If validating a lane exposes an adjacent broken function, apply the whole-platform responsibility rule from the audit goals, but route non-trivial discoveries through the uncertainty log instead of growing the lane.

## 3. Completion definition

The program is complete when:

- all nine lanes (CONS-M1, M2, M3A+M4, M3B, M5, M6, M7A, M7B, M7C) are merged with green gates and receipts;
- both bundled J1B matrix re-runs are PASS;
- the spec's grep gates are clean repo-wide (v1 procedure, confirmedFacts, isolation guard, kernel purity, playbook vocabulary);
- `Intera_Harness_架构梳理.md` reflects the post-M2/M3 runtime truth;
- the MASTER active-lanes table is empty of consolidation lanes and the read-first list reflects the M7B compression.

Report completion with a one-page summary linking every lane receipt.
