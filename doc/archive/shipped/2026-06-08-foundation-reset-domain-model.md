# Foundation Reset Domain Model - Hooks, Tools, Procedures, Templates

**Date:** 2026-06-08
**Status:** SHIPPED BASELINE THROUGH Q3-B1 - owner-approved direction; remaining old terms in this file are historical migration instructions
**Target window:** 3-5 days foundation reset, then 7-9 days commercial delivery chain
**Primary goal:** reset the domain model before real customer launch so ConfigPilot, `.intera` packages, Procedure Builder, Scenario Lab, and the runtime all speak one vocabulary.
**Companion UI/UX spec:** [`../spec/Intera_UI_UX_Design_System.md`](../spec/Intera_UI_UX_Design_System.md)

> Read first: `doc/handoffs/GENERIC_HANDOFF.md` parallel protocol and `doc/handoffs/MASTER_BUILD_HANDOFF.md` Active Lanes. This reset intentionally allows physical schema, route, runtime, UI, event, and test renames. Do not preserve long-term compatibility with the old model unless this plan explicitly says so.

> Post-Q3 note (2026-06-10): the first Foundation Reset wave, post-foundation UI/runtime lanes, U-Pilot, PKG1, BASE1, and Q3-B1 are shipped locally. Q3-B final cleanup keeps current routes/docs/components aligned without reopening schema/runtime scope. New code and new copy should use Hook, Tool, Procedure, ProcedureRun, HumanTask, Trace, Memory, `remember(scope="chat" | "user")`, and `finalize_procedure`. Treat references to older names below as migration/history context, not product language to reintroduce.

---

## 0. Owner decisions frozen in this session

### 0.1 Product and launch direction

- First design user: **implementation / delivery staff**.
- Two-week commercial target: **one real customer Agent delivery package**, not a generic feature checklist.
- First launch boundary: **information collection + read-only lookup + structured human transfer**. High-risk business actions can be represented as Tools/Hooks but should be gated or routed to human.
- Development priority before launch: **functionality and clean foundation first**. Security/compliance must be architecturally reserved, but not allowed to block the first commercial slice.
- First industry template: **Gaming / iGaming support**.
- Delivery path: import `Gaming Support Starter.intera-agent.json` -> adapt with UI + ConfigPilot -> run Scenario receipt -> activate -> export customer-customized package.
- UI/UX source of truth: **Quiet Agent Studio**, a unified light-first Console with top-level nav `Build / Operate / Settings`, logged-in default `Build -> Pilot Lab`, Pilot Lab as the ConfigPilot home, Command Bar, and Config Diff Viewer. ConfigPilot is not a global drawer in P0. Pilot Lab has two main tabs: `Pilot` for chat-based agent building and `Playground` for manual dry-run testing/debug with existing Trace Sidebar capability. Do not introduce dark immersive workspaces in P0 except small functional code/JSON/raw-payload viewers.
- Code baseline as of `373d2eed`: additive Procedure Phases 1-3 are shipped. `CaseType.procedure`, `CaseType.guardrails`, `maxAutoTurns`, ProcedureExecutor prompt path, and case-scoped legacy guardrail activation exist. Treat them as **migration inputs** for Hook/HookBinding and runtime cleanup, not as the final model.

### 0.2 Vocabulary

Keep:

- `Case` - runtime customer issue instance, with status, memory, messages, traces, and human tasks.
- `CaseType` - configurable issue category / routing target. Keep the code and manifest name `caseTypes`.
- `Procedure` - the soft process attached to a CaseType.
- `Tool` - every Agent-callable capability.

Physically replace:

- `Policy` / `Guardrail` -> `Hook`
- `Skill` -> `Tool`
- `preTool` / `postTool` / `preFinalize` -> `PreToolUse` / `PostToolUse` / `Stop`

Delete as target architecture:

- stage state machine
- detached sub-agent fan-out
- `executionMode`
- long-term policy/guardrail compatibility
- long-term skill naming

### 0.3 Hook lifecycle

Intera adopts Claude Code-style Hook naming, but only implements customer-service-critical lifecycle hooks first:

```ts
type HookCheckpoint = 'PreToolUse' | 'PostToolUse' | 'Stop'
```

- `PreToolUse`: before a Tool runs. Used for prerequisites, high-risk Tool blocking, transfer-before-investigation checks, input validation.
- `PostToolUse`: after a Tool returns. Used for evidence conflicts, output validation, auto-escalation triggers, normalization checks.
- `Stop`: before the current customer-visible answer is committed/sent. Used for final-answer safety, evidence completeness, promise/compensation checks, broken-link protection, and "block and retry" feedback.

`preFinalize` is removed. Former finalization rules migrate to `Stop` because ordinary customer-facing replies can also contain unsafe conclusions.

`Stop` decisions:

```ts
type HookDecisionAction = 'allow' | 'warn' | 'block' | 'escalate'
```

- `allow`: send the answer.
- `warn`: send the answer but record risk.
- `block`: do not send the current answer; inject Hook feedback and let the Agent repair within a bounded retry count.
- `escalate`: trigger human transfer or force the Agent to create a human task.

### 0.4 Hook scope

Hooks are top-level Agent-scoped resources. Activation is controlled by bindings.

Implemented scopes:

```ts
type HookScopeType = 'agent' | 'caseType' | 'procedureStep' | 'tool'
```

- `agent`: global for the Agent version.
- `caseType`: active for cases of a specific CaseType.
- `procedureStep`: active when a specific Procedure step is the current or matching step. This replaces old stage-level guardrails.
- `tool`: active for a specific Tool.

Binding behavior is additive:

```text
active hooks = agent bindings + active CaseType bindings + active ProcedureStep bindings + matching Tool bindings
```

No lower scope can silently disable higher-scope Hooks. If any active Hook blocks, the checkpoint blocks.

### 0.5 Hook handlers

First launch supports all three handler types:

```ts
type HookHandler =
  | { kind: 'declarative'; check: HookCheck; effect: HookEffect }
  | { kind: 'code'; runtime: 'javascript'; source: string }
  | { kind: 'http'; endpoint: string; method: 'POST'; headers?: Record<string, string>; secretRefs?: HookSecretRef[]; timeoutMs: number }
```

- Declarative Hook: preferred path for ConfigPilot and most implementation work.
- Code Hook: restricted JS function only. No filesystem, shell, raw DB, or arbitrary network access.
- HTTP Hook: external customer rule/risk/approval services. Secrets are referenced, not embedded.

Code Hook shape:

```ts
async function hook(ctx: HookContext): Promise<HookDecision> {
  return { action: 'allow' }
}
```

Allowed context: checkpoint, tool name/input/output, case facts, missing facts, current reply draft, current CaseType, Procedure step, previous Tool calls, and trace summary.

External calls go through HTTP Hook, not Code Hook.

### 0.6 `.intera` package

The package is an **Agent Template Package** for internal delivery reuse and future marketplace support. It is not a DB dump and not a public marketplace product yet.

Top-level uses the new model. Old data may be exported only under `legacy`.

```json
{
  "schemaVersion": "intera.agentTemplate.v1",
  "agent": {},
  "caseTypes": [],
  "tools": [],
  "hooks": [],
  "hookBindings": [],
  "scenarios": [],
  "legacy": {
    "caseTypes": [],
    "policies": [],
    "guardrails": [],
    "skills": [],
    "stageConfigs": [],
    "subAgents": []
  }
}
```

Secrets and real customer credentials should still be represented as placeholders/refs, even though the first audience is internal staff. Data privacy is not a blocker for the first internal package, but the manifest should not force future unsafe habits.

---

## 1. Target data model

### 1.1 Prisma model direction

Create `Hook` and `HookBinding`. Drop `Policy` after backfill. Keep `CaseType`.

```prisma
model Hook {
  id            String   @id @default(cuid())
  agentConfigId String   @map("agent_config_id")

  name          String
  displayName   String?
  description   String?

  checkpoint    String   // PreToolUse | PostToolUse | Stop
  handlerKind   String   // declarative | code | http
  handler       String   // JSON HookHandler
  enabled       Boolean  @default(true)
  severity      String   @default("medium") // low | medium | high | critical

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  agentConfig   AgentConfig @relation(fields: [agentConfigId], references: [id], onDelete: Cascade)
  bindings      HookBinding[]

  @@unique([agentConfigId, name])
  @@index([agentConfigId, checkpoint])
  @@map("hooks")
}

model HookBinding {
  id              String   @id @default(cuid())
  agentConfigId   String   @map("agent_config_id")
  hookId          String   @map("hook_id")

  scopeType       String   // agent | caseType | procedureStep | tool
  scopeKey        String   // agent | caseType:<id> | procedureStep:<caseTypeId>:<stepId> | tool:<id>

  caseTypeId      String?  @map("case_type_id")
  procedureStepId String?  @map("procedure_step_id")
  toolId          String?  @map("tool_id")

  enabled         Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  hook            Hook      @relation(fields: [hookId], references: [id], onDelete: Cascade)

  @@unique([agentConfigId, hookId, scopeKey])
  @@index([agentConfigId, scopeType])
  @@index([agentConfigId, scopeKey])
  @@map("hook_bindings")
}
```

Notes:

- Use `scopeKey` as the canonical uniqueness key because nullable compound unique constraints do not protect all scope combinations cleanly.
- `caseTypeId` and `toolId` are optional denormalized pointers for admin UI and joins. `scopeKey` is the runtime identity.
- `.intera` import/export maps DB ids to stable names (`caseType.type`, `tool.name`, `procedure.steps[].id`) at package boundaries.

### 1.2 Existing model changes

`AgentConfig`

- Replace `policies Policy[]` with `hooks Hook[]`.

`CaseType`

- Keep `CaseType`.
- Keep `procedure`.
- Drop `guardrails`.
- Drop old stage/sub-agent/SOP fields during the reset:
  - `stages`
  - `stageConfigs`
  - `orchestratorConfig`
  - `sop`
  - `executionMode`
  - `sopMaxAutoTurns`
  - `requireHumanReview`
- Keep or rename only if still needed:
  - `requiredFacts`
  - `defaultGoal`
  - `escalateOn`
  - `autoCloseConditions`
  - `maxAutoTurns`

`ChatMemory`

- `skillsCalled` -> `toolsCalled`
- `skillResults` -> `toolResults`
- Drop sub-agent dead fields:
  - `agentTodos`
  - `dashboardVersion`
  - `needsContinuation`
  - `continuationLock`

`Tool`

- Keep table/model name `Tool`.
- Normalize mode naming in code/contracts:
  - `mock` -> `static_fixture`
  - `mockFixture` may be physically renamed to `staticFixture` if this lane can safely carry it. If not, keep DB column but expose API/UI as `staticFixture` and schedule a follow-up physical rename before marketplace work.

### 1.3 Hook migration/backfill

Backfill from current data:

- `Policy` row -> `Hook` row.
- `Policy.name` -> `Hook.name`.
- `Policy.description` -> `Hook.description`.
- `Policy.guardrailConfig` -> `Hook.handler` with `handlerKind='declarative'`.
- `Policy.hook` or `guardrailConfig.when` maps:
  - `preTool` -> `PreToolUse`
  - `postTool` -> `PostToolUse`
  - `preFinalize` -> `Stop`
- `CaseType.guardrails[]` -> `HookBinding(scopeType='caseType')`.
- Any stage-level guardrails found in legacy `stageConfigs` -> best-effort `HookBinding(scopeType='procedureStep')` only after the Procedure step ids exist. If no reliable mapping exists, preserve them in `.intera.legacy` and log a migration warning. Current inventory says seeded stage guardrail arrays are empty.

No long-term dual-read. No long-term dual-write.

### 1.4 Event and trace rename

Physically rename runtime/event vocabulary:

- `skill_call` -> `tool_call`
- `skill_result` -> `tool_result`
- `skillsCalled` -> `toolsCalled`
- `skillResults` -> `toolResults`
- `SkillDefinition` -> `ToolDefinition`
- `SkillRunResult` -> `ToolRunResult`
- UI copy: "Skill" -> "Tool"

Backfill old traces where practical:

- `ActionTrace.type='skill_call'` -> `tool_call`
- `ActionTrace.type='skill_result'` -> `tool_result`

If historical traces are too costly to fully migrate, keep a read-only display adapter for old trace rows only. Do not emit new `skill_*` events after this reset.

---

## 2. Runtime target

### 2.1 Single execution model

Terminal state:

```text
Discovery -> dispatch_case_agent opens/selects Case -> active CaseType -> ProcedureExecutor -> shared ReAct loop
```

Delete the production background sub-agent path:

- `OrchestratorAgent.dispatchInBackground`
- `SubAgent`
- `dispatch_subagent`
- `needsContinuation`
- sub-agent SSE/events
- stage executor as runtime path

Keep `dispatch_case_agent` only as "open/select a Case and attach CaseType/Procedure".

### 2.2 Procedure step scope

Procedure Builder must show Hook controls at each step.

Data remains top-level Hook + HookBinding:

- Step UI: "Hooks for this step"
- User can attach existing Hook to a step.
- User can create a Hook from the step UI; save creates a top-level Hook and a `procedureStep` binding.
- Step UI shows inherited active Hooks from Agent, CaseType, and Tool scopes.

Runtime active step resolution:

- `ProcedureExecutor` tracks current/pending step ids in case working state.
- `HookEngine` receives `procedureStepIds` in `HookContext`.
- For `PreToolUse` / `PostToolUse`, include a step binding when:
  - the Tool matches the step target, or
  - ProcedureExecutor marks the step as current/active.
- For `Stop`, include step bindings for steps completed or active in the current turn, plus CaseType and Agent bindings.

The first implementation can keep step progress in existing case memory JSON if a dedicated `CaseNotebook` table is too large for the reset window. The important part is that HookContext contains stable `procedureStepIds`.

### 2.3 Stop checkpoint

All customer-visible final text must pass through `HookEngine.evaluate('Stop', ctx)` before it is sent or persisted as the final assistant answer.

Required behavior:

- `allow`: send/persist.
- `warn`: send/persist and trace warning.
- `block`: do not send current answer; inject feedback into the next model turn.
- `escalate`: create/require human task.

Bound retries:

- Add `maxStopRetries`, default `2`.
- If Stop still blocks after retries, create human task or return a safe fallback message.

This closes the old gap where only `finalize_case` was checked but ordinary replies could still make unsafe promises.

---

## 3. API and UI target

### 3.1 Routes

New:

- `/api/admin/hooks`
- `/api/admin/hooks/[name]`
- `/admin/hooks`

Old:

- `/admin/guardrails` redirects to `/admin/hooks`.
- `/api/admin/policies` returns `410 Gone` or is removed.
- `/api/admin/policies/[name]` returns `410 Gone` or is removed.

No new code may call `/api/admin/policies`.

### 3.2 Hook Builder UI

The Hook page must support:

- list/create/update/delete Hooks
- checkpoint selector: `PreToolUse`, `PostToolUse`, `Stop`
- handler kind selector: declarative, code, http
- declarative builder for common checks/effects
- code editor for restricted JS handler
- HTTP endpoint/timeout/header/secretRef editor
- binding manager:
  - Agent
  - CaseType
  - ProcedureStep
  - Tool

The CaseType Procedure Builder must include a step-level Hook binding panel.

### 3.3 ConfigPilot write boundary

ConfigPilot can create and bind Hooks in the first commercial version, including declarative, code, and HTTP Hooks.

Still required:

```text
proposal -> structured diff -> user confirm -> typed API save -> Scenario receipt
```

ConfigPilot must not write DB directly.

---

## 4. `.intera` package target

### 4.1 First implementation

Do now:

- `packages/shared/contracts/agent-template.ts`
- export current Agent version to `.intera-agent.json`
- import `.intera-agent.json` into a new draft/fork Agent
- include `legacy` snapshot namespace
- include Hook and HookBinding data
- include Scenario definitions
- include secret placeholders

Do not do now:

- public marketplace
- payment / licensing
- author storefront
- review/rating/search

### 4.2 Manifest sections

```ts
interface InteraAgentTemplateV1 {
  schemaVersion: 'intera.agentTemplate.v1'
  metadata: {
    templateId?: string
    name: string
    industry?: string
    locales?: string[]
    publisher?: string
    license?: string
    marketplace?: {
      priceTier?: string
      category?: string
      tags?: string[]
    }
  }
  agent: Record<string, unknown>
  caseTypes: TemplateCaseType[]
  tools: TemplateTool[]
  hooks: TemplateHook[]
  hookBindings: TemplateHookBinding[]
  scenarios: TemplateScenario[]
  secrets?: TemplateSecretPlaceholder[]
  legacy?: Record<string, unknown>
}
```

Top-level fields use new names only. Old fields live under `legacy`.

---

## 5. Scenario soft gate

Scenario Lab is the commercial acceptance gate, but first launch uses soft blocking:

- Every customer delivery package should have a Scenario suite.
- Import, ConfigPilot mutation, Procedure edits, Tool edits, and Hook edits should mark the Agent as `Changed since last validation`.
- Running Scenario suite creates a receipt.
- Activation is not hard-blocked in first launch; owner/admin can override.

States:

- `Validated`
- `Changed since last validation`
- `Validation failed`
- `Not validated`

---

## 6. Parallel lane plan

> Each lane must declare itself in `MASTER_BUILD_HANDOFF.md` Active Lanes before editing. The same file cannot be owned by two lanes. `schema.prisma` is exclusive. `dictionaries.ts` should be handled by a final I18N Sweep lane unless a lane absolutely needs visible copy.

### Lane F0 - Reset Preflight and Lockfile

**Goal:** freeze this plan into handoffs and prevent old-task confusion.

**Status:** completed by the 2026-06-08 doc reset pass. Re-check if the branch has moved, but do not redispatch this as a coding lane unless docs drift again.

**Owned files:**

- `doc/handoffs/MASTER_BUILD_HANDOFF.md`
- this plan
- optional short glossary doc if desired

**Tasks:**

- Add Foundation Reset as the current macro priority.
- Mark the old Procedure refactor Phases 4-6 as superseded/absorbed by this reset.
- Add Active Lane template rows for F1-F8.

**Can run parallel?** No, first.

### Lane F1 - Schema and Contracts

**Goal:** create the new physical model and shared contracts.

**Owned files:**

- `packages/shared/prisma/schema.prisma`
- new migration under `packages/shared/prisma/migrations/*`
- `packages/shared/types/index.ts`
- `packages/shared/contracts/hooks.ts`
- `packages/shared/contracts/agent-template.ts`
- `packages/shared/contracts/case-types.ts`
- `packages/shared/contracts/tools.ts`
- contract tests

**Tasks:**

- Add `Hook` and `HookBinding`.
- Remove `Policy`.
- Drop `CaseType.guardrails` and stage/sub-agent/SOP fields.
- Rename memory `skills*` fields to `tools*`.
- Define Hook lifecycle/check/effect/handler zod schemas.
- Define `.intera` manifest schema.
- Define import/export-safe names.

**Can run parallel?** Exclusive for schema. Other lanes may read contracts after F1 lands.

### Lane F2 - HookEngine and Runtime Checkpoints

**Goal:** replace PolicyEngine with HookEngine and wire `PreToolUse`, `PostToolUse`, and `Stop`.

**Owned files:**

- `apps/console/lib/agent/policy.ts` -> delete/rename to `hook-engine.ts`
- `apps/console/lib/agent/loop.ts`
- `apps/console/lib/agent/case-agent-loop.ts`
- `apps/console/lib/agent/procedure-executor.ts`
- `apps/console/lib/agent/tool-interceptor.ts`
- `apps/console/lib/agent/prompt-selector.ts`
- runtime tests for HookEngine and Stop retry

**Tasks:**

- Implement HookEngine loading active bindings.
- Implement declarative, restricted code, and HTTP handler dispatch.
- Wire `PreToolUse`.
- Wire `PostToolUse`.
- Wire `Stop` before customer-visible final output.
- Add bounded Stop repair loop.
- Pass `caseType`, `tool`, and `procedureStepIds` into HookContext.

**Can run parallel?** After F1. Must not overlap with Tool Naming lane on `loop.ts`; coordinate if F3 needs loop edits.

### Lane F3 - Tool Naming and Event Reset

**Goal:** remove Skill vocabulary from runtime contracts, SSE, trace, memory, and UI-facing data.

**Owned files:**

- `packages/shared/types/index.ts` after F1, if needed
- `apps/console/lib/agent/tools.ts`
- `apps/console/lib/agent/streaming-tool-executor.ts`
- `apps/console/lib/agent/stream-handler.ts`
- `apps/console/lib/agent/trace.ts`
- `apps/console/lib/agent/trace-aggregator.ts`
- chat/playground rendering components that consume `skill_*`
- tests containing `skill_call` / `skill_result`

**Tasks:**

- Rename event types to `tool_call` / `tool_result`.
- Rename TypeScript types.
- Rename memory field access.
- Migrate trace display and restored playground session data.
- Keep read-only adapter for historical old trace rows only if needed.

**Can run parallel?** After F1. Coordinate with F2 on any shared runtime files.

### Lane F4 - Hooks API and Admin UI

**Goal:** replace Policies/Guardrails admin surface with Hooks.

**Owned files:**

- `apps/console/app/api/admin/hooks/**`
- `apps/console/app/api/admin/policies/**` deletion or 410 routes
- `apps/console/app/admin/hooks/page.tsx`
- `apps/console/app/admin/guardrails/page.tsx` redirect
- `apps/console/components/admin/*hook*` new components
- route/UI tests

**Tasks:**

- Build Hook CRUD.
- Build HookBinding CRUD or nested binding endpoints.
- Implement API 410 for old policy endpoints.
- Redirect old guardrails page.
- Support declarative/code/http editing.
- Support Agent/CaseType/ProcedureStep/Tool binding.

**Can run parallel?** After F1. Avoid `dictionaries.ts` until I18N Sweep.

### Lane F5 - Procedure Runtime Cleanup

**Goal:** absorb old Procedure refactor Phases 4-6 into the reset and delete old runtime paths.

**Owned files:**

- `apps/console/lib/agent/stage-executor.ts`
- `apps/console/lib/agent/orchestrator.ts`
- `apps/console/lib/agent/sub-agent.ts`
- `apps/console/lib/agent/react-loop.ts`
- `apps/console/lib/agent/conversation-loop.ts`
- `apps/console/lib/agent/strategies/*`
- `packages/shared/defaults/index.ts`
- `packages/shared/prisma/seed.ts`
- Procedure runtime tests

**Tasks:**

- Delete stage machine runtime.
- Delete detached sub-agent fan-out.
- Rewrite seeds as Procedure-based CaseTypes.
- Ensure `dispatch_case_agent` opens/selects a Case inline only.
- Ensure all seeded CaseTypes run through ProcedureExecutor.

**Can run parallel?** After F1. Coordinate tightly with F2 because both touch runtime concepts.

### Lane F6 - `.intera` Export/Import

**Goal:** make Agent Template Package real.

**Owned files:**

- new `apps/console/lib/agent-template/**`
- new `apps/console/app/api/admin/agent-templates/export/route.ts`
- new `apps/console/app/api/admin/agent-templates/import/route.ts`
- optional minimal UI entry in Agent management drawer
- `templates/gaming-support-starter.intera-agent.json`
- template tests

**Tasks:**

- Export current Agent version with caseTypes, procedures, tools, hooks, hookBindings, scenarios.
- Include `legacy` snapshot if available.
- Import into new draft/fork Agent.
- Map stable manifest names to DB ids.
- Preserve secret placeholders, not values.

**Can run parallel?** After F1. Low conflict.

### Lane F7 - Scenario Soft Gate

**Goal:** create the validation receipt backbone.

**Owned files:**

- `packages/shared/contracts/scenarios.ts`
- new scenario Prisma models if F1 includes them, otherwise JSON-backed first slice
- `apps/console/app/api/admin/scenarios/**`
- `apps/console/app/admin/scenarios/**` or playground integration
- scenario runner tests

**Tasks:**

- Save multi-turn scenario definitions.
- Define expected outcomes: Tool calls, Hook decisions, human transfer, forbidden phrases, final status.
- Run scenarios against the Agent runtime.
- Generate receipt.
- Mark Agent state as validated/changed/failed/not validated.

**Can run parallel?** After F1. Coordinate with F2 for runtime runner API.

### Lane F8 - I18N, Docs, and Navigation Sweep

**Goal:** remove stale user-facing vocabulary after code settles.

**Owned files:**

- `apps/console/lib/i18n/dictionaries.ts`
- `apps/console/components/console-sidebar.tsx`
- `apps/console/components/admin/agent-onboarding.tsx`
- `apps/console/app/ops/guide/page.tsx`
- `apps/console/components/ops/runtime-guide-*`
- README/docs touched by old terms

**Tasks:**

- Replace Guardrails/Policies with Hooks.
- Replace Skills with Tools.
- Remove state-machine/stage/sub-agent copy from current docs.
- Preserve historical docs under `doc/what's done` unless they are actively misleading current handoffs.
- Ensure en/zh key parity.

**Can run parallel?** Last, or after UI routes stabilize.

---

## 7. Reset migration gate

Foundation Reset may deploy to production, but only with this gate:

### Local gate

```bash
npx tsc --noEmit -p apps/console/tsconfig.json
env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npm test
npm run build:console
```

### Database gate

- Local Postgres migration succeeds.
- Seed succeeds.
- Export a local `.intera-agent.json`.
- Import it into a fresh local Agent.
- Run the core Scenario smoke suite locally.

### Production gate

Before migration:

- take `pg_dump`
- record deployed git SHA
- confirm no active lane owns schema/runtime files

After migration/deploy:

- health check is OK
- login works
- `/admin/hooks` renders
- `/admin/case-types` renders Procedure data
- `/admin/tools` renders
- old `/admin/guardrails` redirects
- old `/api/admin/policies` returns 410 or is removed as intended
- run a live or local non-dry-run message that triggers:
  - `dispatch_case_agent`
  - one Tool call
  - `PreToolUse`
  - `PostToolUse`
  - `Stop`
  - visible final answer or human transfer

Prefer forward-fix over compatibility rollback. Use backup only for true data loss or unrecoverable migration failure.

---

## 8. Commercial delivery chain after reset

After Foundation Reset lands, run the 7-9 day commercial chain:

1. **Template Package UI** - import/export from Console, not just API.
2. **Procedure Builder** - CaseType Procedure editor with step-level Hook bindings.
3. **ConfigPilot** - proposal -> diff -> confirm -> typed API save -> Scenario receipt.
4. **Scenario Lab** - saved suites, regression run, receipt, soft gate badge.
5. **Gaming Starter Content** - a small set of high-quality CaseTypes/Procedures/Tools/Hooks/Scenarios. Do not chase 30+ flows before routing stability is proven.
6. **UI/UX Reset** - follow [`../spec/Intera_UI_UX_Design_System.md`](../spec/Intera_UI_UX_Design_System.md). Only the design-token/primitives lane should start early; route/navigation/page lanes should wait until F8 has stabilized vocabulary, redirects, and i18n.

Recommended first template content:

- few high-signal CaseTypes, not many
- representative Procedure steps
- one or two HTTP Tool examples
- several Static Fixture Tools
- common Hooks:
  - no compensation promise
  - preserve image/link URLs
  - require investigation before human transfer
  - conflict requires human
  - stop unsafe final answer
- Scenario samples for each core flow

Recommended UI lane order is documented in the UI/UX spec. The short version:

- UX0 design primitives may run early if it does not rewrite navigation.
- UX1 route/shell/nav waits for Foundation Reset navigation vocabulary.
- UX2 Release + Diff Viewer and UX4 Pilot Lab + ConfigPilot can run in parallel after version/package/scenario APIs exist.
- UX3 Components workspace can split by subroute once the shell exists.
- UX5 Operate can run after trace/handoff contracts are stable.
- UX6 owns the final i18n/responsive/browser QA sweep.

---

## 9. Definition of done

Foundation Reset is done when:

- Prisma has `Hook` and `HookBinding`; `Policy` is gone.
- Runtime code uses `HookEngine`, not `PolicyEngine`.
- New checkpoints are exactly `PreToolUse`, `PostToolUse`, `Stop`.
- `preFinalize` is gone from runtime, seed, contracts, and new docs.
- `CaseType.guardrails` is gone; Hook activation uses `HookBinding`.
- Stage machine and detached sub-agent fan-out are gone from active runtime.
- New events emitted by runtime are `tool_call` and `tool_result`.
- New memory fields are `toolsCalled` and `toolResults`.
- User-facing current UI says Hooks and Tools, not Guardrails/Policies/Skills.
- `/admin/hooks` and `/api/admin/hooks` are canonical.
- `/admin/guardrails` redirects; `/api/admin/policies` does not silently work.
- `.intera` manifest exports new top-level fields plus optional `legacy`.
- A reset smoke Scenario passes through Tool + Hook + Stop.
- `MASTER_BUILD_HANDOFF.md` accurately states what landed and what commercial lanes are unblocked.
