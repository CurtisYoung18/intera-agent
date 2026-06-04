# Sub-Agent maxIterations Per-Stage Config

## Problem

Sub-agent iteration count is currently **not configurable** per stage or per case type. It always inherits the main agent's `maxIterations` (default **20**), which is far too high for sub-agents that should run quick, focused investigations (typically **3–5 turns**).

### Root cause

In [loop.ts:1178](apps/console/lib/agent/loop.ts#L1178), when building `SubAgentConfig` for dispatch:

```typescript
maxIterations: this.deps.config.maxIterations,  // ← main agent's value (default 20)
```

The per-stage `maxIterations` field doesn't exist anywhere in the pipeline — not in the UI, not in the stage config type, not in the DB read.

### Current flow (broken)

```
CaseType page → StageConfigEditor → stageConfigs JSON → DB
                                                         ↓
loop.ts builds SubAgentConfig ← maxIterations = main agent's config (20) ← WRONG
                                                         ↓
orchestrator.ts → ctx.maxIterations = task.agentConfig.maxIterations || 5
                                                         ↓
react-loop.ts → for (iter = 0; iter < ctx.maxIterations; iter++)
```

### Unused dead code

- [sub-agent-form.tsx](apps/console/components/admin/sub-agent-form.tsx) — has `maxIterations` field (line 26, 131) but is **never imported** by any page
- [sub-agent-summary-list.tsx](apps/console/components/admin/sub-agent-summary-list.tsx) — also unused

---

## Solution

Add `maxIterations` to the per-stage config UI (`StageConfigEditor`), store it in `stageConfigs` JSON in DB, and read it when building `SubAgentConfig` in `loop.ts`.

---

## Changes (code-level, in order)

### 1. UI Type — `stage-config-editor.tsx`

**File**: [apps/console/components/admin/stage-config-editor.tsx](apps/console/components/admin/stage-config-editor.tsx)

**Line 35-47** — Add `maxIterations` to `StageCfg` interface:

```typescript
interface StageCfg {
  name: string
  description?: string
  model?: string
  systemPrompt?: string
  temperature?: number
  thinkingBudget?: number
  maxIterations?: number          // ← ADD
  requiredSkills?: string[]
  availableSkills?: string[]
  guardrails?: StageGuardrail[]
  evidenceRequirements?: EvidenceReq[]
  transition?: TransitionRule
}
```

**After line 311** — Add number input in the "Model & Prompt" section, next to Thinking Budget. In the `expandedSections.model` block, inside the grid:

```tsx
<label className="space-y-1">
  <span className="text-[10px] text-[var(--fog)] uppercase tracking-wide">Max Iterations</span>
  <input
    type="number"
    min={1}
    max={20}
    step={1}
    value={cfg.maxIterations ?? ''}
    onChange={(e) => updateStage(activeStage, { maxIterations: e.target.value ? parseInt(e.target.value) : undefined }, stageConfigs, onChange)}
    placeholder="5"
    className="glass-input-console text-[12px] py-1.5"
  />
</label>
```

Place it in the existing 4-column grid (line 273). Currently 3 fields (Model col-span-2, Temperature, Thinking Budget). Either:
- **Option A**: Keep 4-col grid, add as 4th column → all 4 in one row
- **Option B**: Add a second row with Max Iterations + a spacer

Recommend Option A — cleanest, keeps related numeric params together.

**Evidence**: The grid is at [stage-config-editor.tsx:273-311](apps/console/components/admin/stage-config-editor.tsx#L273-L311).

---

### 2. Page Type — `case-types/[name]/page.tsx`

**File**: [apps/console/app/admin/case-types/[name]/page.tsx](apps/console/app/admin/case-types/[name]/page.tsx)

**Line 37-49** — Same `StageCfg` interface duplicated in this file. Add `maxIterations`:

```typescript
interface StageCfg {
  name: string
  description?: string
  model?: string
  systemPrompt?: string
  temperature?: number
  thinkingBudget?: number
  maxIterations?: number          // ← ADD
  requiredSkills?: string[]
  availableSkills?: string[]
  guardrails?: unknown[]
  evidenceRequirements?: unknown[]
  transition?: unknown
}
```

**Note**: No other changes needed in this file. The `stageConfigs` JSON blob is read/written as-is through the API, so the new field automatically persists to DB.

---

### 3. SubAgentConfig builder — `loop.ts`

**File**: [apps/console/lib/agent/loop.ts](apps/console/lib/agent/loop.ts)

**Lines 1148-1178** — Currently builds `SubAgentConfig` with `maxIterations: this.deps.config.maxIterations`. Need to derive it from stage configs instead.

**Evidence** — current code at line 1171-1178:

```typescript
const subAgentConfig: import('@intera/shared/types').SubAgentConfig = {
  name: `case_agent_${caseType}`,
  model: this.deps.config.model,
  systemPrompt: this.deps.config.systemPrompt,
  skills: Array.from(stageSkillNames),
  taskTemplate: taskPrompt,
  parallel: true,
  maxIterations: this.deps.config.maxIterations,   // ← CHANGE THIS
  fallbackModel: this.deps.config.fallbackModel,
}
```

**Change to**:

```typescript
// Resolve maxIterations: use the max of all stage configs, or default to 5
let subAgentMaxIterations = 5
const stageMaxIterValues = Object.values(stageConfigs)
  .map((sc) => (sc as Record<string, unknown>).maxIterations)
  .filter((v): v is number => typeof v === 'number' && v > 0)
if (stageMaxIterValues.length > 0) {
  subAgentMaxIterations = Math.max(...stageMaxIterValues)
}

const subAgentConfig: import('@intera/shared/types').SubAgentConfig = {
  // ... rest unchanged ...
  maxIterations: subAgentMaxIterations,   // ← FIXED
  // ...
}
```

**Rationale**: Taking `Math.max(...)` across all stages means if any stage needs 7 iterations, the sub-agent gets 7. Individual stage limits are enforced by the stage transition logic (`min_iterations` condition), not by capping the sub-agent loop. If per-stage strict enforcement is desired later, that's a separate feature — for now the sub-agent runs all stages in one ReAct loop so it needs the max across all.

---

### 4. Data flow verification (no changes needed)

These files already handle `maxIterations` correctly from the `SubAgentConfig`:

| File | Line | What it does |
|---|---|---|
| [orchestrator.ts](apps/console/lib/agent/orchestrator.ts) | 602 | `maxIterations: task.agentConfig.maxIterations \|\| 5` ✅ |
| [react-loop.ts](apps/console/lib/agent/react-loop.ts) | 47 | `for (let iter = 0; iter < ctx.maxIterations; iter++)` ✅ |
| [sub-agent.ts](apps/console/lib/agent/sub-agent.ts) | 15, 149 | Deprecated path: `this.config.maxIterations \|\| DEFAULT_MAX_ITERATIONS` ✅ |

---

### 5. (Optional) Dead code cleanup

Two components exist but are never imported — consider deleting or re-integrating later:

- [components/admin/sub-agent-form.tsx](apps/console/components/admin/sub-agent-form.tsx) — full SubAgentConfig form with maxIterations field
- [components/admin/sub-agent-summary-list.tsx](apps/console/components/admin/sub-agent-summary-list.tsx) — read-only summary list

If these were part of a planned but abandoned "Sub-Agent Registry" page, delete them. If they'll be used for a future registry, leave them.

---

## Summary

| # | File | Change | Effort |
|---|---|---|---|
| 1 | `components/admin/stage-config-editor.tsx` | Add `maxIterations` to `StageCfg` type + number input in Model panel | Small |
| 2 | `app/admin/case-types/[name]/page.tsx` | Add `maxIterations` to local `StageCfg` type | Small |
| 3 | `lib/agent/loop.ts` | Derive sub-agent maxIterations from stage configs instead of main agent config | Small |
| 4 | (Optional) Dead components | Remove or document `SubAgentForm` / `SubAgentSummaryList` | Small |
