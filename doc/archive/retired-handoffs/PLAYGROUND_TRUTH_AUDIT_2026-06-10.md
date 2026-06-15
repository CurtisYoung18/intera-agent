# Playground Truth Audit - 2026-06-10

**Lane:** `PGR1-C`  
**Repo / branch audited:** `/Users/curtis/Desktop/intera-agent` on `main`  
**Audit mode:** docs/spec truth sync only; no broad product-code refactor

---

## 1. Why this audit exists

Several active docs still describe Playground as if it were only a legacy debug sandbox or an in-memory dry-run seam.

That is no longer the truthful product picture on `main`.

Current truth:

- `Pilot Lab` is the logged-in default and the only approved home for Pilot plus Playground.
- `Playground` is the current **Runtime Truth Desk + Manual Test Bench**.
- The active Playground surface is now a shared native workspace owned by Pilot Lab, while `/admin/playground` remains a compatibility wrapper around the same implementation.
- `Release` still owns version/package/publish truth.
- `Components` still owns draft editing truth.

The main thing future lanes must stop assuming is:

`Playground` is not the place that authors config truth, and it is not a zero-persistence toy sandbox either.

---

## 2. Current purpose and boundary

### Pilot vs Playground vs Release

- `Pilot` is the configuration desk. It reads the selected Agent draft, asks ConfigPilot for typed proposals, shows diff, requires explicit accept, and applies draft-only changes through typed APIs.
- `Playground` is the runtime desk. It tests the currently selected Agent version directly, preserves multi-turn session state, restores prior sessions, and shows trace/evidence for what the runtime actually did under dry-run rules.
- `Release` is the version-control desk. It owns Live vs Draft vs Historical state, package import/export, publish/rollback semantics, and receipt-driven release confidence.

### Playground in one sentence

`Playground` is the current **Runtime Truth Desk + Manual Test Bench** for the selected Agent version: it runs the real Agent runtime path with persisted trace/message evidence while mocking operational side effects.

---

## 3. Truth matrix

| Route | Purpose now | Authoritative data sources | Known fake/stale fields or leftovers | Recommended fix lane |
|---|---|---|---|---|
| `/build/pilot-lab` | Native two-tab workspace. `Pilot` is the config desk; `Playground` is the runtime desk. | `apps/console/app/build/pilot-lab/page.tsx`; `/api/admin/config-pilot/context`; `/api/admin/config-pilot/propose`; `/api/admin/config-pilot/apply`; `/api/admin/scenarios`; `/api/admin/scenarios/[name]/run` | Older docs still call this a drawer shell, `Free Test`, or `Test Cases` home. Those are historical, not current product IA. | `PGR1-DOC-TRUTH` |
| `/build/pilot-lab?tab=playground` | Manual multi-turn runtime test bench for the selected Agent version, with trace/evidence inspection and session restore. | `apps/console/app/build/pilot-lab/page.tsx`; `apps/console/components/playground/playground-workspace.tsx`; `/api/admin/playground/run`; `/api/admin/playground/sessions`; `/api/admin/playground/sessions/[chatId]`; `runPlaygroundTurn()` | Visible residue remains: some internal compatibility field names such as `skillCallId`, and older sample/debug phrasing should still be tightened over time. | `PGR2-PLAYGROUND-COPY-CLEANUP` |
| `/admin/playground` | Legacy compatibility entry point, not the active IA home. | `apps/console/middleware.ts`; `apps/console/app/admin/playground/page.tsx`; `apps/console/components/playground/playground-workspace.tsx` | The route is intentionally a thin wrapper so future lanes do not mistake it for the product-defining surface. | `Q3-COMPAT-CLEANUP` |
| `/build/playground` | Redirect-only compatibility path to the Playground tab. | `apps/console/app/build/playground/page.tsx` | Not a product surface of its own. Keep only as compatibility until the owner approves removal. | `Q3-COMPAT-CLEANUP` |
| `/build/release` | Version/package/release truth. Publish, rollback preview, import/export, and validation posture live here, not in Pilot or Playground. | `apps/console/components/release/release-command-center.tsx`; version endpoints; scenario validation summaries | Docs must not imply Pilot or Playground can publish, activate, deploy, or own package history. | `REL-DOC-BOUNDARY` |
| `/build/components/**` | Draft authoring truth for Brain, Procedures, Tools, Hooks, Knowledge, and Integrations. | Native `build/components` routes plus current admin-backed APIs | Docs must not imply Playground owns Tool/Hook/Knowledge editing or that Components owns runtime/debug truth. | `COMPONENT-BOUNDARY-TRUTH` |

---

## 4. Truthful data sources

### 4.1 Playground runtime truth

- The Playground tab renders the shared native `playground-workspace`, and the actual turn execution goes through `/api/admin/playground/run`.
- `/api/admin/playground/run` calls `runPlaygroundTurn()`.
- `runPlaygroundTurn()` loads the selected Agent config from DB via `loadAgentConfig(input.configId)`.
- Prompt assembly is shared with the production message path through `buildModePrompt(...)`, not a separate fake playground-only prompt model.
- Runtime execution uses `AgentLoop.create(...)` with `dryRun: true`.
- Playground sessions create/load real `Case`, `Message`, and `ActionTrace` rows through `createPrismaPersistence()`.
- Session restore uses persisted rows from `/api/admin/playground/sessions` and `/api/admin/playground/sessions/[chatId]`.

### 4.2 What `dryRun: true` really means

- Hook, ProcedureRun, memory, prompt assembly, model/tool orchestration, and trace writing are real runtime paths.
- Operational side effects are still mocked at the tool-dispatch boundary.
- So `runtime-backed` currently means "real runtime logic and real evidence path", not "live external side effects happened."

### 4.3 Scenario truth

- `executionMode = fixture` uses the deterministic Scenario harness.
- `executionMode = agentRuntime` routes through `runScenarioAgentRuntime()` and then through the Playground runtime path.
- Runtime-backed receipts are therefore more truthful than fixture-only receipts about Agent behavior, but their tool execution mode is still currently `mocked`.
- Active docs must distinguish:
  - `fixture-only receipt`
  - `runtime-backed receipt`
  - `mocked operational side effects`

### 4.4 Save-to-chat truth

- `Export synthetic review transcript` does not convert the Playground session into a live customer conversation.
- It creates a synthetic resolved `Case` with a generated `playground-test-*` user id.
- It persists a reviewable transcript plus summarized trace rows so Operate surfaces can inspect the run.
- Treat it as a debugging/export bridge, not as channel-runtime truth.

---

## 5. Stale, fake, or migration leftovers

### Active-doc leftovers

- `GENERIC_HANDOFF.md` still described Playground as a zero-DB in-memory dry-run seam before this audit lane.
- Several docs still used weaker wording like "manual dry-run testing/debug" without clarifying that Playground now exercises the real runtime path with mocked side effects.
- Older Pilot Lab wording such as `Free Test`, `Test Cases`, or drawer-oriented ConfigPilot language is historical only and must not drive new implementation.

### UI/runtime leftovers

- `guardrailCount` in the reused Playground snapshot is hardcoded to `0`, so the visible `0 rules` pill is not authoritative runtime truth.
- `skillCallId` still exists in internal form-request state naming inside the reused page component; treat that as compatibility residue, not approved product vocabulary.
- `/admin/playground` remains as a compatibility wrapper route only; product ownership now lives in the shared `playground-workspace`.
- The Operate bridge is still synthetic/export-style behavior and must not be mistaken for a production continuation path.

---

## 6. What is real now vs deferred

### Real now

- Pilot Lab is the logged-in default.
- Pilot and Playground live together in one workspace.
- Playground runs the selected Agent version, not just a fake mock form.
- Playground persists/restores real session messages and traces.
- Runtime-backed receipts are visibly distinct from fixture-only receipts.
- ConfigPilot reads full draft context and writes draft-only changes through typed backend APIs.
- Release owns publish/version/package semantics.

### Deferred or still partial

- Runtime-backed Scenario runs still mock operational tool side effects.
- Playground still benefits from more copy cleanup around sample phrasing and internal compatibility field names, even though the native workspace split is complete.
- Operate surfaces still do not get the same aggregated trace experience Playground has.

---

## 7. Recommended follow-up lanes

1. `PGR2-PLAYGROUND-COPY-CLEANUP`
   - Remove visible residue such as the hardcoded `0 rules` signal and older sample/debug phrasing.
   - Keep this wording/UI-only unless a runtime owner explicitly expands scope.

2. `S2.1-RUNTIME-SIDE-EFFECT-TRUTH`
   - Decide whether runtime-backed Scenario execution should remain mocked for operational tools or gain a safer semi-real execution tier.

3. `TRACE-OPS-UNIFICATION`
   - Bring the richer aggregated trace/evidence model into Operate conversation and ProcedureRun detail surfaces.

4. `REL-PILOT-COMPONENT-BOUNDARY-SWEEP`
   - Keep Release, Pilot, Playground, and Components docs/copy strict about who owns config truth, runtime truth, and publish truth.

---

## 8. Bottom line

- `Pilot` is the draft configuration desk.
- `Playground` is the **Runtime Truth Desk + Manual Test Bench**.
- `Release` is the publish/version desk.
- `Components` is the component-editing desk.

Future lanes should stop treating Playground as either:

- the place that owns config editing truth, or
- a fake/in-memory debug toy with no real persistence/runtime evidence.
