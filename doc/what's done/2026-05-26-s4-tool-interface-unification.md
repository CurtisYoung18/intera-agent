# S4 — Tool Interface Unification

> **Wave 2, sub-project 4 of 6.** Part of the Intera-vs-CC alignment audit.
> **Depends on**: S1 (synthesis), S2 (retry), S3 (loop slimming) all merged. S4 builds on the seams those create.
> **Foundation for**: S5 (channel binding) — render hints live on the tool. S6 (console viz) — tool metadata drives the editor.

---

## 0. The goal (one sentence)

> **Replace `SkillDefinition` (DB row + branching executor) with a `Tool<I,O>` interface implemented by both code-defined built-in tools and DB-defined business tools, so every tool — built-in or operator-configured — looks identical to the engine.**

After S4:
- Built-in skills (case lifecycle, todo, dispatch_subagent, etc.) are **code modules** that own their input schema, validation, dynamic concurrency, and channel render hints in one file.
- Business skills (operator's HTTP integrations) stay DB-backed but expose the same `Tool<I,O>` interface via an adapter.
- The executor calls `tool.execute(input, ctx)` — never branches on `mode === 'http' | 'mock'`.
- `dispatch_subagent` becomes a real built-in tool; `executionMode: 'sop'` is renamed `'cc'`; the registry from the [case-type-subagent-ux addendum](2026-05-26-case-type-subagent-ux.md) is wired through it.

---

## 1. Why this is needed

### 1.1 Today's shape

`SkillDefinition` ([packages/shared/types/index.ts:81](packages/shared/types/index.ts#L81)) is **data**, not behavior:

```ts
interface SkillDefinition {
  name, description, inputSchema, outputSchema
  mode: 'mock' | 'http'
  endpoint?, httpMethod?, headers?, timeoutMs?, mockFixture?
  isConcurrencySafe: boolean     // static
  enabled: boolean
  displayVerb?: { text, icon }
  zodSchema?: ZodType
}
```

The executor ([streaming-tool-executor.ts](apps/chat/lib/agent/streaming-tool-executor.ts)) branches on `definition.mode`:

```ts
if (tool.definition.mode === 'mock') {
  output = await this.executeMock(definition)
} else {
  output = await this.executeHttp(definition, input)
}
```

And the kb_hybrid_retrieve special-case is inline ([streaming-tool-executor.ts:316-362](apps/chat/lib/agent/streaming-tool-executor.ts#L316)) — 50 lines of "if name === kb_hybrid_retrieve, do this special thing with KnowledgeSources from prisma".

### 1.2 What this prevents us from doing

| Want | Blocker |
|---|---|
| Per-tool **dynamic** concurrency (e.g. `query_X` is safe with `read=true` but not with `delete=true`) | `isConcurrencySafe` is a static boolean on the DB row |
| Channel-specific **render hints** for tools like `propose_interaction` (cards in LiveChat, plain buttons in chat widget, block kit in Slack) | No place on the type to put per-channel render config |
| Per-tool **execution context** (lifecycle tools need DB write, dispatch_subagent needs the registry, kb_hybrid needs sources) | Everything is shoved into the executor's `executeHttp`/`executeMock` branches |
| **`dispatch_subagent`** as a real tool the model calls | No tool type can encode "this tool runs a sub-agent loop"; would have to extend the `mode` enum and inline the dispatch path in the executor |
| **Per-tool tests** | The executor is the unit; you can't test "create_case behavior" in isolation |

### 1.3 What CC does that we're porting (selectively)

CC's [`Tool<I, O>`](claude-code-source-code-ref-only/Tool.ts#L362) has ~40 fields. We don't need most — CC is REPL-bound and bundles its UI rendering into the tool. The fields we ARE porting:

- `name`, `description`
- `inputSchema: ZodSchema`
- `isConcurrencySafe(input) → boolean` (dynamic, per-input)
- `isReadOnly(input) → boolean`
- `isEnabled() → boolean`
- `prompt(opts) → string` (what shows up in the LLM's tool list — dynamic so we can interpolate registry contents)
- `call(args, context) → Promise<Output>`
- `validateInput?(input, ctx) → ValidationResult`

What we're NOT porting:
- aliases / searchHint / shouldDefer / alwaysLoad / inputJSONSchema (CC-internal)
- userFacingName* / renderToolUseMessage* (chat-side handles UI in Intera)
- checkPermissions / preparePermissionMatcher (PolicyEngine handles guardrails)
- isSearchOrReadCommand / toAutoClassifierInput (CC-specific)
- mcpInfo / isMcp / isLsp (Intera has no MCP yet)
- mapToolResultToToolResultBlockParam (S1's synthesizer owns this)

What we're ADDING (Intera-specific):
- `guardPhase: 'pre' | 'post' | null` (when PolicyEngine evaluates)
- `displayVerb: { text, icon }` (UI spinner state — moved from SkillDefinition)
- `source: 'builtin' | 'business'` (editor gating; matches S1's `SYSTEM_SKILL_NAMES`)
- `renderHints?: Partial<Record<Channel, RenderHint>>` (S5 foundation — schema here, S5 wires the renderer)

---

## 2. Design

### 2.1 The interface

**Location**: `packages/shared/tools/tool.ts` (new).

```ts
import { z, type ZodType } from 'zod'
import type { SpinnerIcon } from '../types'

/** Channels the agent may be deployed on. Extend as new integrations land. */
export type Channel = 'web-chat' | 'livechat' | 'slack' | 'discord' | 'whatsapp'

/** Hint to per-channel renderers (S5 owns the actual rendering). */
export interface RenderHint {
  kind: 'card' | 'form' | 'plain' | 'list' | 'image'
  /** Optional channel-specific template; renderer interprets. */
  template?: string
  /** Optional pre-render transform name; renderer must know it. */
  transform?: string
}

export interface ToolContext {
  caseId: string
  customerId: string
  signal: AbortSignal
  /** Caller decides what reader to expose; tools that don't need memory ignore it. */
  caseMemory?: CaseMemoryReader
  /** For tools that dispatch work (dispatch_subagent etc.). Undefined for leaf tools. */
  orchestrator?: OrchestratorRef
  /** For tools that hit external services with secrets. Resolves env-var refs. */
  secrets?: SecretResolver
}

export type ValidationResult =
  | { ok: true; parsed: unknown }
  | { ok: false; error: string }

export interface Tool<I = unknown, O = unknown> {
  // Identity
  readonly name: string
  readonly source: 'builtin' | 'business'

  // LLM-facing
  /**
   * Returns the description block the LLM sees. Dynamic so tools like
   * dispatch_subagent can interpolate the current sub-agent registry.
   */
  prompt(ctx: ToolContext): Promise<string>
  readonly inputSchema: ZodType<I>

  // Engine behavior
  isEnabled(): boolean
  isConcurrencySafe(input: I): boolean
  isReadOnly(input: I): boolean
  /** Optional pre-execute validation beyond Zod. Returns clear error for the LLM. */
  validateInput?(input: I, ctx: ToolContext): Promise<ValidationResult>

  // PolicyEngine integration
  readonly guardPhase: 'pre' | 'post' | null

  // The work
  call(input: I, ctx: ToolContext): Promise<O>

  // UI
  readonly displayVerb: { text: string; icon: SpinnerIcon }

  // S5 foundation — per-channel render hints. Renderer (S5) reads this.
  readonly renderHints?: Partial<Record<Channel, RenderHint>>
}
```

### 2.2 Built-in tools — one module per tool

**Location**: `apps/chat/lib/agent/tools/builtin/<tool_name>.ts`

Example — `create_case`:

```ts
// apps/chat/lib/agent/tools/builtin/create-case.ts
import { z } from 'zod'
import type { Tool, ToolContext } from '@intera/shared/tools/tool'

const inputSchema = z.object({
  caseType: z.string().describe('Case type slug (e.g. deposit_issue, account_issue)'),
  summary:  z.string().describe('Brief summary of what the customer reported'),
})

type Input = z.infer<typeof inputSchema>
type Output = { caseId: string; status: 'created' }

export const createCaseTool: Tool<Input, Output> = {
  name: 'create_case',
  source: 'builtin',
  inputSchema,
  guardPhase: 'post',
  displayVerb: { text: 'Creating your case', icon: 'dots' },

  async prompt(_ctx) {
    return 'Create a new Case when the customer reports an issue that needs investigation. IMPORTANT: Call create_case BEFORE any lookup tools. Only use lookup tools directly when the customer asks a simple informational question, NOT when they report a problem.'
  },

  isEnabled() { return true },
  isConcurrencySafe(_input) { return false }, // writes a case
  isReadOnly(_input)         { return false },

  async call(input, ctx): Promise<Output> {
    const { prisma } = await import('@intera/shared/prisma')
    const caseId = `case_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`
    await prisma.case.create({
      data: {
        id: caseId, customerId: ctx.customerId, userId: 'TODO',
        type: input.caseType, summary: input.summary, status: 'created',
      },
    })
    return { caseId, status: 'created' }
  },
}
```

Built-in tools to migrate (the 7 system skills from S1 + `dispatch_subagent`):

| Tool | guardPhase | concurrency | source for migration |
|---|---|---|---|
| `create_case` | post | false | seed entry, no engine logic today |
| `finalize_case` | post | false | seed entry, no engine logic |
| `read_case_history` | post | true | seed (read-only) |
| `create_human_task` | post | false | seed entry |
| `todo_write` | post | true | currently intercepted in [loop.ts:processTodoTools](apps/chat/lib/agent/loop.ts#L2198) — extract here |
| `todo_read` | post | true | same |
| `finalize_sub_agent` | post | false | currently intercepted by [ChecklistPolicy.handleTerminalTool](apps/chat/lib/agent/policies/checklist-policy.ts) — extract here |
| `kb_hybrid_retrieve` | post | true | extract from `streaming-tool-executor.ts:316-362` |
| `dispatch_subagent` | post | false | **new** — see §2.4 |

After migration, the `SYSTEM_SKILL_NAMES` set from S1 is replaced by `import { isBuiltIn } from '@intera/shared/tools/registry'` — derived from the registry, not a separate set.

### 2.3 Business tools — adapter over the existing DB row

Operators still need to add HTTP integrations through the console. The DB row stays. We add an adapter:

```ts
// apps/chat/lib/agent/tools/business/business-tool-adapter.ts
import { z } from 'zod'
import { jsonSchemaToZod } from '@intera/shared/tools/json-schema-to-zod'
import type { Tool, ToolContext } from '@intera/shared/tools/tool'
import type { SkillDefinition } from '@intera/shared/types'

export function adaptBusinessTool(def: SkillDefinition): Tool {
  const inputSchema = def.zodSchema ?? jsonSchemaToZod(def.inputSchema)
  return {
    name: def.name,
    source: 'business',
    inputSchema,
    guardPhase: (def as any).guardPhase ?? 'post',
    displayVerb: def.displayVerb ?? { text: `Calling ${def.name}`, icon: 'dots' },
    renderHints: (def as any).renderHints,  // new optional JSON column on Skill table

    async prompt() { return def.description },

    isEnabled() { return def.enabled },
    isConcurrencySafe() { return def.isConcurrencySafe },  // static today; v2 may parse expression
    isReadOnly() { return def.isConcurrencySafe },         // proxy until we have a real flag

    async call(input, ctx) {
      if (def.mode === 'mock') return executeMock(def)
      return executeHttp(def, input, ctx.secrets)
    },
  }
}
```

`executeMock` and `executeHttp` move from `streaming-tool-executor.ts` to `apps/chat/lib/agent/tools/business/exec-{mock,http}.ts` as pure functions. The kb_hybrid_retrieve special case **moves to a built-in tool** (it's not a business tool — operators don't configure it through the skills table).

### 2.4 The new `dispatch_subagent` built-in

```ts
// apps/chat/lib/agent/tools/builtin/dispatch-subagent.ts
import { z } from 'zod'
import type { Tool, ToolContext } from '@intera/shared/tools/tool'

const inputSchema = z.object({
  agentName: z.string().describe('Name of a registered sub-agent (see prompt for list)'),
  taskDescription: z.string().describe('One-line description of why this sub-agent is being dispatched'),
  taskPrompt: z.string().describe('The detailed task for the sub-agent. Include all context it needs.'),
})

type Input = z.infer<typeof inputSchema>

export const dispatchSubagentTool: Tool<Input, SubAgentResult> = {
  name: 'dispatch_subagent',
  source: 'builtin',
  inputSchema,
  guardPhase: 'pre', // policy can deny dispatch by agentName
  displayVerb: { text: 'Dispatching specialist', icon: 'pulse' },

  async prompt(ctx) {
    const registry = await loadSubAgentRegistry(ctx.customerId)
    if (registry.length === 0) return 'No sub-agents available in this deployment.'
    const lines = registry.map((a) => `  - ${a.name}: ${a.description}`).join('\n')
    return [
      'Dispatch a registered sub-agent to investigate when the situation calls for specialized work.',
      'Sub-agents return structured findings; their results merge into case memory.',
      '',
      'Available sub-agents:',
      lines,
    ].join('\n')
  },

  isEnabled() { return true },
  isConcurrencySafe()  { return false }, // serialise — main agent waits for findings
  isReadOnly()         { return false },

  async validateInput(input, ctx) {
    const registry = await loadSubAgentRegistry(ctx.customerId)
    if (!registry.some((a) => a.name === input.agentName)) {
      return { ok: false, error: `Unknown sub-agent "${input.agentName}". Available: ${registry.map((a) => a.name).join(', ')}` }
    }
    return { ok: true, parsed: input }
  },

  async call(input, ctx): Promise<SubAgentResult> {
    if (!ctx.orchestrator) throw new Error('dispatch_subagent requires orchestrator in ToolContext')
    return ctx.orchestrator.dispatch(input.agentName, {
      description: input.taskDescription,
      taskPrompt: input.taskPrompt,
      caseId: ctx.caseId,
    })
  },
}
```

Engine gates: `dispatch_subagent` is only added to the tool set when **the case type's `executionMode === 'cc'`**. Stage-mode case types don't get it (they dispatch sub-agents declaratively per stage).

### 2.5 Registry — one place to look up any tool

```ts
// apps/chat/lib/agent/tools/registry.ts
import { createCaseTool, finalizeCaseTool, /* ... */ } from './builtin'
import { adaptBusinessTool } from './business/business-tool-adapter'
import type { Tool } from '@intera/shared/tools/tool'

const BUILTINS: Tool[] = [
  createCaseTool, finalizeCaseTool, readCaseHistoryTool,
  createHumanTaskTool, todoWriteTool, todoReadTool,
  finalizeSubAgentTool, kbHybridRetrieveTool,
  dispatchSubagentTool,  // conditionally enabled — see resolveToolSet
]

export async function resolveToolSet(opts: {
  customerId: string
  caseType?: CaseType
  iteration: number
  isSubAgent: boolean
  policy?: ExecutionPolicy
}): Promise<Tool[]> {
  const businessDefs = await prisma.skill.findMany({ where: { customerId: opts.customerId, enabled: true } })
  const business = businessDefs.map(adaptBusinessTool)

  let all = [...BUILTINS, ...business]

  // dispatch_subagent gated by executionMode=cc and not-sub-agent
  if (opts.caseType?.executionMode !== 'cc' || opts.isSubAgent) {
    all = all.filter((t) => t.name !== 'dispatch_subagent')
  }

  // finalize_sub_agent gated by isSubAgent
  if (!opts.isSubAgent) {
    all = all.filter((t) => t.name !== 'finalize_sub_agent')
  }

  // Stage-mode tool filtering by policy (existing behavior)
  if (opts.policy) {
    const anthropic = all.map(toAnthropicTool)
    const filtered = opts.policy.filterTools(anthropic, opts.iteration)
    const allowedNames = new Set(filtered.map((t) => t.name))
    all = all.filter((t) => allowedNames.has(t.name))
  }

  return all.filter((t) => t.isEnabled())
}
```

The registry is the **single source of truth** for what tools exist. `SkillRouter` shrinks to a thin wrapper that calls `resolveToolSet`.

### 2.6 Executor changes

[`streaming-tool-executor.ts`](apps/chat/lib/agent/streaming-tool-executor.ts) becomes ~150 lines (down from 385):

```ts
class StreamingToolExecutor {
  enqueue(toolUse: ToolUse): void {
    const tool = this.toolsByName.get(toolUse.name)
    if (!tool) {
      this.recordSyntheticResult(toolUse, /* unknown_tool */)
      return
    }
    const parsed = tool.inputSchema.safeParse(toolUse.input)
    if (!parsed.success) {
      this.recordSyntheticResult(toolUse, /* schema_error */)
      return
    }
    const tracked: TrackedTool = {
      ...toolUse, parsedInput: parsed.data, tool,
      isConcurrencySafe: tool.isConcurrencySafe(parsed.data),  // ← dynamic now
    }
    // ... existing scheduling logic, unchanged
  }

  private async runTrackedTool(t: TrackedTool): Promise<void> {
    // ... validation via tool.validateInput?
    const startTime = Date.now()
    try {
      const output = await t.tool.call(t.parsedInput, this.toolContext)  // ← single path
      t.result = { ok: true, output, latencyMs: Date.now() - startTime }
    } catch (err) {
      t.result = { ok: false, output: null, error: errMsg(err), latencyMs: Date.now() - startTime }
    }
    // ... existing callback + push to results
  }
}
```

The `executeMock` / `executeHttp` methods are gone. The kb_hybrid special case is gone. Concurrency is now per-input. The whole `mode === 'mock' | 'http'` branch is replaced by `tool.call(...)`.

### 2.7 Sub-agent guardrails — inherit + override

**Decision (2026-05-26)**: sub-agents inherit the global guardrail set (`customer.policyHooks`) but can override per sub-agent.

**Data shape** — same field added to both storage locations so the engine treats them identically:

```ts
interface SubAgentGuardrailOverrides {
  /** Names of global guardrails this sub-agent opts out of. */
  disabled: string[]
  /** Sub-agent-specific rules. Same shape as global PolicyRule. */
  added: PolicyRule[]
}

// On SubAgentRegistry (cc-mode storage)
interface SubAgentRegistry {
  // ... 8 existing fields from case-type-subagent-ux §2.3 ...
  guardrailOverrides?: SubAgentGuardrailOverrides
}

// On StageConfig.subAgents[] entry (stage-mode storage)
interface StageSubAgentConfig {
  // ... existing model, prompt, allowedTools, maxIterations, taskChecklist ...
  guardrailOverrides?: SubAgentGuardrailOverrides
}
```

**Engine wiring** in Phase 4e:

```ts
// apps/chat/lib/agent/policy.ts — new helper
export function buildSubAgentPolicyEngine(
  globalRules: PolicyRule[],
  overrides?: SubAgentGuardrailOverrides,
): PolicyEngine {
  if (!overrides) return new PolicyEngine(globalRules)
  const remaining = globalRules.filter((r) => !overrides.disabled.includes(r.name))
  return new PolicyEngine([...remaining, ...overrides.added])
}
```

Called once when a sub-agent is dispatched (both cc-mode via `dispatch_subagent.call` and stage-mode via `case-agent-loop.startDedicatedAgents`). The resulting PolicyEngine is passed into the sub-agent's `runIteration` exactly as the main agent's PolicyEngine is.

**S3 implication**: `IterationDeps` already accepts a PolicyEngine; nothing new there. The override resolution is done by the *caller* before `runIteration` is invoked.

**Validation**: if `overrides.disabled` references a guardrail name that no longer exists in `customer.policyHooks`, the engine logs a `policy_override_stale` trace and treats it as a no-op (the disable was for a deleted rule — safe to ignore). UI surfaces these stale references as warnings on the sub-agent edit page.

### 2.8 SOP → CC rename

This is a small but engine-visible change:

1. Type union: `executionMode: 'stage' | 'cc'` (drop `'sop'`).
2. **Data migration**: Prisma migration updates existing rows: `UPDATE case_types SET executionMode = 'cc' WHERE executionMode = 'sop'`.
3. Engine code: every `executionMode !== 'sop'`, `executionMode === 'sop'` switched to `'cc'`. Roughly 8 sites; grep `'sop'` exhaustively.
4. Engine adds `dispatch_subagent` to the tool set when `executionMode === 'cc'` (see §2.5).
5. UI: Case Type editor's mode select shows "CC" (or "Adaptive" — operator-friendly label) instead of "SOP".
6. Prompts: anywhere `SOP` appears in `prompt-resolver.ts` defaults gets reworded. Off-topic handling text (the one from S3 §3.1 classifier removal) is added to the case prompt regardless of mode.

This rename is its own phase (4f) — small, low-risk, must land last.

---

## 3. Migration path & invariants

### 3.1 Migration is one-way per tool, not all-at-once

Each built-in tool migrates independently. While S4 is in flight:
- Migrated tools are looked up from `BUILTINS` first.
- Unmigrated tools fall through to `adaptBusinessTool` over the DB row (the `isSystem` flag from S1 still seeds them on first-run).

After all 9 built-ins are migrated, the seed step in [skills/route.ts:21-41](apps/console/app/api/admin/skills/route.ts#L21) **no longer seeds the 7 system + 1 special skills** — they exist only in code. Existing rows are deleted by a migration. The Skill table only holds *business* tools.

### 3.2 Engine-visible invariants the refactor must preserve

- [ ] Every tool call that succeeded pre-S4 succeeds post-S4 with the same output.
- [ ] S1's invariant assertions still hold — every `tool_use` block produces a `tool_result`.
- [ ] S2's retry policy still applies — `tool.call` exceptions surface through the wrapper.
- [ ] Policy guardrails still fire at the same phase (`preTool` / `postTool` / `preFinalize`).
- [ ] Trace events keep the same names: `tool_executing`, `skill_result`, `policy_hit`.
- [ ] SSE event shapes unchanged for chat-side consumers.
- [ ] Sub-agent flow (S3 unification) still passes its existing tests.

### 3.3 Backward-compat for ops

- The Skills page (Phase A of console-audit-v5) still shows System tools as read-only — now backed by `source: 'builtin'` instead of a name allowlist.
- The Special tier (`kb_hybrid_retrieve`) becomes a built-in in code; the Skills page still shows it as read-only with the "Configure in Knowledge Retrieval" link.
- Business tools (the operator's HTTP integrations) are unaffected — same CRUD page, same DB column shape (plus optional `renderHints` JSON column added in 4d).

---

## 4. Phasing

| Phase | What | Effort |
|---|---|---|
| **4a** | Define `Tool<I,O>` + `ToolContext` + `RenderHint` types in `packages/shared/tools/`. Write registry skeleton. No production code uses it yet. | 1 day |
| **4b** | Build `adaptBusinessTool` + extract `executeMock`/`executeHttp` to `apps/chat/lib/agent/tools/business/`. Wire executor to use **only the adapter** for ALL tools (built-ins still come from DB seed). Tests stay green. | 2 days |
| **4c** | Port 5 simple built-ins to code: `create_case`, `finalize_case`, `read_case_history`, `create_human_task`, `todo_write`, `todo_read`. One PR per pair. Each PR deletes the corresponding DB seed entries. | 3 days |
| **4d** | Port the special ones: `kb_hybrid_retrieve` (extracts the 50-line special case from executor), `finalize_sub_agent` (extracts from ChecklistPolicy). Add `renderHints` optional column to Skill table for business tools. | 3 days |
| **4e** | Add `dispatch_subagent` built-in. Wire `ctx.orchestrator` plumbing. Add registry resolver that conditionally includes it based on `executionMode === 'cc'`. The `/admin/sub-agents` registry page from the case-type-subagent-ux addendum gets engine-wired here. | 3 days |
| **4f** | Rename `'sop'` → `'cc'`. Prisma migration. Update prompts. UI label update. Delete the seed step's built-in rows from the DB on next deploy via a one-time migration. | 1 day |

**Total: ~13 working days (≈2.5 weeks).**

Each phase is its own PR, leaves tests green, is shippable on its own.

---

## 5. Acceptance criteria

### 5.1 Unit tests
- [ ] Each built-in tool has its own test file: schema validation, isConcurrencySafe across inputs, call() happy path, call() failure path.
- [ ] `adaptBusinessTool` produces a `Tool` whose `call` invokes `executeHttp` for `mode: 'http'` and `executeMock` for `mode: 'mock'`.
- [ ] Registry's `resolveToolSet` returns the right set per (customer, caseType, isSubAgent, iteration).

### 5.2 Integration tests
- [ ] **Built-in tool round-trip**: a chat session that triggers `create_case` produces the same final case row pre/post-S4.
- [ ] **Business tool round-trip**: a chat session that triggers `get_account_status` (HTTP) produces the same JSON output pre/post-S4.
- [ ] **kb_hybrid_retrieve**: same retrieved results pre/post-S4, including KnowledgeSource merging logic.
- [ ] **dispatch_subagent in cc mode**: a case with `executionMode: 'cc'` and a registered sub-agent — main agent calls `dispatch_subagent`, sub-agent runs through `runIteration` (S3), findings merge back into case memory.
- [ ] **dispatch_subagent NOT present in stage mode**: same case type with `executionMode: 'stage'` — `dispatch_subagent` is NOT in the tool list sent to the API.
- [ ] **Sub-agent doesn't see dispatch_subagent** (no recursion).

### 5.3 Migration test
- [ ] Database migration `'sop' → 'cc'` is idempotent and reversible.
- [ ] After running the migration, every case type's `executionMode` is either `'stage'` or `'cc'`. Zero `'sop'` rows.
- [ ] System skill rows are deleted from the Skill table after the final cleanup migration; only business skills remain.

### 5.4 Production smoke (1 week)
- [ ] Per-tool call-count traces match pre-S4 baseline within 5%.
- [ ] No regression in tool-result invariant violations (S1).
- [ ] Sub-agent dispatch latency in cc mode is comparable to stage-mode dispatch.

---

## 6. File map

### New
- `packages/shared/tools/tool.ts` — `Tool<I,O>`, `ToolContext`, `RenderHint`, `Channel`, `ValidationResult`.
- `packages/shared/tools/json-schema-to-zod.ts` — small helper (most business tools already have `zodSchema`, this is a fallback).
- `apps/chat/lib/agent/tools/builtin/*.ts` — 9 files, one per built-in tool.
- `apps/chat/lib/agent/tools/business/business-tool-adapter.ts` — the adapter.
- `apps/chat/lib/agent/tools/business/exec-mock.ts` — extracted from executor.
- `apps/chat/lib/agent/tools/business/exec-http.ts` — extracted from executor.
- `apps/chat/lib/agent/tools/registry.ts` — `resolveToolSet`, `isBuiltIn`, `loadSubAgentRegistry`.
- `apps/chat/lib/agent/tools/__tests__/*.test.ts` — one per built-in + adapter + registry tests.
- Prisma migrations:
  - `<ts>_skill_render_hints` — adds optional `renderHints` JSON column to Skill.
  - `<ts>_executionmode_sop_to_cc` — renames data.
  - `<ts>_remove_builtin_skills` — deletes system skill rows (run after 4e is verified).

### Modified
- `apps/chat/lib/agent/streaming-tool-executor.ts` — gut the mode branching, kb_hybrid special case; ~250 lines deleted.
- `apps/chat/lib/agent/skills.ts` — becomes a thin shim over `registry.resolveToolSet`.
- `apps/chat/lib/agent/sub-agent.ts` — accepts `Tool[]` instead of `SkillDefinition[]` (signature change in `SubAgent` constructor).
- `apps/chat/lib/agent/loop.ts` — `buildAnthropicTools` reads from registry; references to `SkillDefinition` swap to `Tool`.
- `apps/chat/lib/agent/policies/checklist-policy.ts` — `finalize_sub_agent` terminal-tool interception **moves** into the tool itself; policy's `handleTerminalTool` becomes a no-op for this tool (other terminal-tool semantics stay).
- `apps/console/app/api/admin/skills/route.ts` — seed step skips built-ins.
- `apps/console/lib/skill-classifications.ts` — `SYSTEM_SKILL_NAMES` derived from registry, not hardcoded.
- `packages/shared/types/index.ts` — `SkillDefinition` deprecated in favor of `Tool`; keep the type alias for backward-compat through 4d, delete in 4f.
- `packages/shared/defaults/index.ts` — `DEFAULT_SKILLS` shrinks to business-only; built-ins seed code-only.

### Untouched
- `apps/chat/lib/agent/iteration/*` (S3's modules) — they consume the registry, not internals.
- PolicyEngine (`policy.ts`) — still evaluates by tool name.
- All SSE event types and chat-side consumers.

---

## 7. Risk + rollback

**Risk 1**: a built-in tool's behavior changes subtly during the port (different DB write order, missing default, etc.). *Mitigation*: each per-tool PR includes a behavioral diff — before/after a representative case. Phase 4c PRs are deliberately small (one tool pair each).

**Risk 2**: `adaptBusinessTool` doesn't faithfully reproduce a quirk of the current executor (env-var resolution, header merging, kb_hybrid's KnowledgeSources logic). *Mitigation*: 4b lands the adapter with the executor still doing the work, then flip the switch. Until then, the adapter is double-checked against real traffic.

**Risk 3**: `dispatch_subagent` enables runaway recursion (main agent dispatches sub-agent that dispatches sub-agent that…). *Mitigation*: the registry gate excludes `dispatch_subagent` from sub-agent tool sets (§2.5). Add a depth-counter assertion in `ctx.orchestrator.dispatch` that throws if depth > 2.

**Risk 4**: the `'sop' → 'cc'` rename misses a code path that still checks for `'sop'`. *Mitigation*: 4f's PR description must include a grep diff: zero `'sop'` references in the codebase post-migration (excluding doc, changelog).

**Risk 5**: prompts that mentioned "SOP" mode are now wrong. *Mitigation*: 4f reviews `prompt-resolver.ts` defaults and any inline prompt strings. Where "SOP" referred to "step-by-step playbook", reword as "adaptive checklist" or just drop — the model doesn't need the mode name in the prompt.

**Rollback**: each phase is squash-revertable. The biggest risk is 4f's data migration, but it's a column-value rewrite — the reverse SQL is one line. Keep the reverse migration script in the same PR.

---

## 8. Open questions

### 8.1 Should `displayVerb` move to per-channel render hints?

Today `displayVerb` is the same across all channels. With S5 we might want different spinner text per channel ("正在分析" in widget, "Working…" in LiveChat). For S4, keep it global. S5 can extend to per-channel if needed.

### 8.2 Should `Tool.call` be allowed to return a stream?

CC's tool can yield progress events during execution. Useful for long-running tools (file uploads, big queries). Intera doesn't have any tools that need it today.

→ **Defer.** Add `Tool.callStreaming?(input, ctx): AsyncGenerator<Progress, Output>` as an optional method in a future phase if a real use case emerges.

### 8.3 How do we expose `ToolContext.orchestrator` cleanly?

The orchestrator is a circular dependency hub — it dispatches sub-agents that themselves use the registry. Easy to get cycles. Solution: pass a narrow `OrchestratorRef` interface with only `dispatch(name, task)` exposed. The full Orchestrator class lives behind it.

→ Locked in §2.1's `ToolContext.orchestrator?: OrchestratorRef`.

### 8.4 Render-hint schema validation

Operators editing business tools could write malformed `renderHints` JSON. We validate against a Zod schema on save. S5 owns the precise schema; S4 just adds the column with a generic JSON validator.

---

## 9. Hand-off to implementer

Order of work (strict):
1. **4a first.** Land the types. No production code uses them yet. CI green.
2. **4b second.** Adapter + extracted exec functions. Test against a few business tools that exercise mock + http paths. CI green.
3. **4c — port simple built-ins.** Land in pairs (todo_write+todo_read together; create+finalize_case together). Each PR includes the before/after behavioral diff.
4. **4d — port special tools.** kb_hybrid + finalize_sub_agent. The kb_hybrid port is the trickiest — it pulls KnowledgeSources from prisma at execution time. The built-in retains that lookup logic verbatim.
5. **4e — dispatch_subagent.** Requires the registry table from [case-type-subagent-ux.md](2026-05-26-case-type-subagent-ux.md) to exist. If that addendum's stage-mode editor has shipped but the registry table hasn't, ship the table migration as part of this PR.
6. **4f — rename + cleanup.** Last. Includes data migration, prompt review, dead-row deletion.

Do NOT do these in the same PR:
- S5's channel renderer wiring (the `renderHints` field is the seam; S5 builds the consumer).
- S6's console editor changes for built-in tool descriptions (they're now read from code, not DB).
- Adding new built-in tools beyond the 9 listed (each new one is its own PR after S4 lands).

Before starting:
- S1, S2, S3 must be merged.
- Capture a baseline of tool-call traces for one full day. Each phase compares against it.

Two product decisions resolved 2026-05-26:
- **Q1 — label for `executionMode: 'cc'`**: internal value stays `'cc'`; UI shows **"Adaptive"**. (Alternatives "Flexible" reads as less-reliable; "Auto" misleads on operator control; "Dynamic" is the fallback if Adaptive lands as marketing-y in practice.)
- **Q2 — sub-agent guardrails**: **inherit-with-override**. Sub-agents inherit the global `policyHooks` set; the sub-agent editor lets the operator disable specific inherited rules and add sub-agent-specific rules. See §2.8 (new) for the data shape and engine wiring.
