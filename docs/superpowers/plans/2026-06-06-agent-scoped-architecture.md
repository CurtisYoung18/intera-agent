# Agent-Scoped Architecture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate org-level shared pools; every sub-module (Tool, Policy, CaseType, KnowledgeSource, ChannelBinding) is owned directly by an AgentConfig version. Skill renamed to Tool.

**Architecture:** Remove CapabilityBindings binding layer. Each sub-module table gets `agentConfigId` FK. Runtime (PolicyEngine, ToolRouter) loads by agent. Fork deep-copies sub-modules. Frontend pages show only current agent's items.

**Tech Stack:** Prisma 6 (PostgreSQL), Next.js 15, TypeScript, Vitest

**Spec:** [`docs/superpowers/specs/2026-06-06-agent-scoped-architecture-design.md`](../specs/2026-06-06-agent-scoped-architecture-design.md)

---

## Lane Map

```
Task 0: Schema Foundation (sequential gate)
  │
  ├── Task 1: Types + Contracts + Delete (parallel)
  ├── Task 2: Runtime Engine (parallel)
  ├── Task 3: API Routes (parallel, can start after Task 0)
  ├── Task 4: Frontend Pages + Components (parallel)
  └── Task 5: Seed + i18n (parallel)
        │
        └── Task 6: Tests (after Tasks 1-5)
              │
              └── Task 7: Verification
```

---

### Task 0: Schema Foundation

**Files:**
- Modify: `packages/shared/prisma/schema.prisma`
- Create: `packages/shared/prisma/migrations/<timestamp>_agent_scoped/migration.sql`

- [ ] **Step 1: Rename Skill model to Tool, add agentConfigId to all sub-module models**

Edit `packages/shared/prisma/schema.prisma`:

Rename `model Skill` → `model Tool`, `@@map("skills")` → `@@map("tools")`.

Change `model Policy`:
```diff
model Policy {
  id             String   @id @default(cuid())
- orgId          String   @map("org_id")
+ agentConfigId  String   @map("agent_config_id")
  name           String
  // ... rest unchanged
  agentConfig    AgentConfig @relation(fields: [agentConfigId], references: [id], onDelete: Cascade)

- @@unique([orgId, name])
+ @@unique([agentConfigId, name])
  @@map("policies")
}
```

Change `model Tool` (was Skill):
```diff
- model Skill {
+ model Tool {
  id             String   @id @default(cuid())
- orgId          String   @map("org_id")
+ agentConfigId  String   @map("agent_config_id")
  name           String
  // ... inputSchema, outputSchema, mode, endpoint, headers, timeoutMs,
  //     mockFixture, displayVerb, renderHints, guardPhase, toolCategory,
  //     isConcurrencySafe, enabled fields unchanged
  agentConfig    AgentConfig @relation(fields: [agentConfigId], references: [id], onDelete: Cascade)

- @@unique([orgId, name])
+ @@unique([agentConfigId, name])
- @@map("skills")
+ @@map("tools")
}
```

Change `model CaseType`:
```diff
model CaseType {
  id             String   @id @default(cuid())
- orgId          String   @map("org_id")
+ agentConfigId  String   @map("agent_config_id")
  type           String
  // ... rest unchanged
  agentConfig    AgentConfig @relation(fields: [agentConfigId], references: [id], onDelete: Cascade)

- @@unique([orgId, type])
+ @@unique([agentConfigId, type])
  @@map("case_types")
}
```

Change `model KnowledgeSource`:
```diff
model KnowledgeSource {
  id             String   @id @default(cuid())
- orgId          String   @map("org_id")
+ agentConfigId  String   @map("agent_config_id")
  name           String
  // ... rest unchanged
  agentConfig    AgentConfig @relation(fields: [agentConfigId], references: [id], onDelete: Cascade)

- @@unique([orgId, name])
- @@index([orgId, enabled])
+ @@unique([agentConfigId, name])
+ @@index([agentConfigId, enabled])
  @@map("knowledge_sources")
}
```

Change `model ChannelBinding`:
```diff
model ChannelBinding {
  id             String   @id @default(cuid())
- orgId          String   @map("org_id")
- agentName      String?  @map("agent_name")
+ agentConfigId  String   @map("agent_config_id")
  channel        String
  // ... rest unchanged
  agentConfig    AgentConfig @relation(fields: [agentConfigId], references: [id], onDelete: Cascade)

- @@unique([orgId, agentName, channel])
+ @@unique([agentConfigId, channel])
  @@map("channel_bindings")
}
```

Remove from `model AgentConfig`:
```diff
model AgentConfig {
  // ... keep all other fields
- policyHooks        String  // @deprecated — remove
- capabilityBindings String? // JSON — remove
}
```

Delete `model ChannelHealth` entirely (dead table, no runtime consumers).

- [ ] **Step 2: Write migration SQL**

Create `packages/shared/prisma/migrations/20260606000000_agent_scoped_architecture/migration.sql`:

```sql
-- Drop dead tables
DROP TABLE IF EXISTS "channel_health";

-- Drop deprecated columns from agent_configs
ALTER TABLE "agent_configs" DROP COLUMN IF EXISTS "policyHooks";
ALTER TABLE "agent_configs" DROP COLUMN IF EXISTS "capabilityBindings";

-- Drop old unique constraints
ALTER TABLE "policies" DROP CONSTRAINT IF EXISTS "policies_org_id_name_key";
ALTER TABLE "skills" DROP CONSTRAINT IF EXISTS "skills_org_id_name_key";
ALTER TABLE "case_types" DROP CONSTRAINT IF EXISTS "case_types_org_id_type_key";
ALTER TABLE "knowledge_sources" DROP CONSTRAINT IF EXISTS "knowledge_sources_org_id_name_key";
ALTER TABLE "channel_bindings" DROP CONSTRAINT IF EXISTS "channel_bindings_org_id_agent_name_channel_key";

-- Add agentConfigId columns
ALTER TABLE "policies" ADD COLUMN "agent_config_id" TEXT;
ALTER TABLE "skills" ADD COLUMN "agent_config_id" TEXT;
ALTER TABLE "case_types" ADD COLUMN "agent_config_id" TEXT;
ALTER TABLE "knowledge_sources" ADD COLUMN "agent_config_id" TEXT;
ALTER TABLE "channel_bindings" ADD COLUMN "agent_config_id" TEXT;

-- Drop old orgId columns
ALTER TABLE "policies" DROP COLUMN IF EXISTS "org_id";
ALTER TABLE "skills" DROP COLUMN IF EXISTS "org_id";
ALTER TABLE "case_types" DROP COLUMN IF EXISTS "org_id";
ALTER TABLE "knowledge_sources" DROP COLUMN IF EXISTS "org_id";
ALTER TABLE "channel_bindings" DROP COLUMN IF EXISTS "org_id";
ALTER TABLE "channel_bindings" DROP COLUMN IF EXISTS "agent_name";

-- Add new unique constraints
ALTER TABLE "policies" ADD CONSTRAINT "policies_agent_config_id_name_key" UNIQUE ("agent_config_id", "name");
ALTER TABLE "skills" ADD CONSTRAINT "skills_agent_config_id_name_key" UNIQUE ("agent_config_id", "name");
ALTER TABLE "case_types" ADD CONSTRAINT "case_types_agent_config_id_type_key" UNIQUE ("agent_config_id", "type");
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_agent_config_id_name_key" UNIQUE ("agent_config_id", "name");
ALTER TABLE "channel_bindings" ADD CONSTRAINT "channel_bindings_agent_config_id_channel_key" UNIQUE ("agent_config_id", "channel");

-- Create indexes
CREATE INDEX IF NOT EXISTS "idx_policies_agent_config_id" ON "policies" ("agent_config_id");
CREATE INDEX IF NOT EXISTS "idx_tools_agent_config_id" ON "skills" ("agent_config_id");
CREATE INDEX IF NOT EXISTS "idx_case_types_agent_config_id" ON "case_types" ("agent_config_id");
CREATE INDEX IF NOT EXISTS "idx_knowledge_sources_agent_config_id" ON "knowledge_sources" ("agent_config_id");
CREATE INDEX IF NOT EXISTS "idx_channel_bindings_agent_config_id" ON "channel_bindings" ("agent_config_id");

-- Rename skills table to tools
ALTER TABLE "skills" RENAME TO "tools";
```

- [ ] **Step 3: Generate Prisma client**

```bash
npm run db:generate
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/prisma/schema.prisma packages/shared/prisma/migrations/
git commit -m "feat: agent-scoped schema — add agentConfigId FK to sub-modules, drop org pools, rename skills->tools"
```

---

### Task 1: Types + Contracts + Delete Dead Files

**Files:**
- Modify: `packages/shared/types/index.ts`
- Rename: `packages/shared/contracts/skills.ts` → `packages/shared/contracts/tools.ts`
- Modify: `packages/shared/index.ts`
- Modify: `packages/shared/defaults/index.ts`
- Modify: `packages/shared/memory/contract.ts` (if Skill references exist)
- Delete: `apps/console/lib/agent/resolve-bindings.ts`
- Delete: `apps/console/components/admin/binding-column.tsx`

- [ ] **Step 1: Rename contracts/skills.ts → contracts/tools.ts**

```bash
mv packages/shared/contracts/skills.ts packages/shared/contracts/tools.ts
```

- [ ] **Step 2: Rewrite types/index.ts — remove CapabilityBindings, rename Skill→Tool**

Edit `packages/shared/types/index.ts`:

Remove entirely (lines covering `CapabilityBindings`, `EMPTY_BINDINGS`, `PolicyHooks`, `BindingsStats`):
```diff
- export interface CapabilityBindings {
-   guardrails: { preTool: string[]; postTool: string[]; preFinalize: string[] }
-   tools: string[]
-   caseTypes: string[]
-   knowledge: string[]
- }
- 
- export const EMPTY_BINDINGS: CapabilityBindings = {
-   guardrails: { preTool: [], postTool: [], preFinalize: [] },
-   tools: [],
-   caseTypes: [],
-   knowledge: [],
- }
- 
- export interface PolicyHooks {
-   preTool: string[]
-   postTool: string[]
-   preFinalize: string[]
- }
```

Rename `SkillDefinition` → `ToolDefinition`:
```diff
- export interface SkillDefinition {
+ export interface ToolDefinition {
    name: string
    description: string
    inputSchema: Tool['input_schema']
    outputSchema?: Record<string, unknown>
    mode: 'static' | 'http' | 'engine_managed' | 'channel'
    // ... rest unchanged
  }
```

Remove `capabilityBindings` and `policyHooks` from `AgentConfigData`:
```diff
export interface AgentConfigData {
  model: string
  // ... other fields
- policyHooks: PolicyHooks
- capabilityBindings?: CapabilityBindings
  debugMode?: boolean
  // ...
}
```

- [ ] **Step 3: Update packages/shared/index.ts**

```diff
- export * from './types/index'
+ export * from './types/index'
  export { prisma } from './prisma/index'
- // contracts are imported directly by consumers
```

Also export the renamed contract:
```diff
+ export * from './contracts/tools'
```

- [ ] **Step 4: Update defaults/index.ts — remove policyHooks defaults**

Edit `packages/shared/defaults/index.ts`. Remove `DEFAULT_POLICY_HOOKS` if present. Remove CapabilityBindings default. Remove any Skill seed defaults.

- [ ] **Step 5: Delete resolve-bindings.ts**

```bash
rm apps/console/lib/agent/resolve-bindings.ts
```

- [ ] **Step 6: Delete binding-column.tsx**

```bash
rm apps/console/components/admin/binding-column.tsx
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: remove CapabilityBindings types, rename SkillDefinition->ToolDefinition, delete binding UI + resolve-bindings"
```

---

### Task 2: Runtime Engine

**Files:**
- Rename: `apps/console/lib/agent/skills.ts` → `apps/console/lib/agent/tools.ts`
- Modify: `apps/console/lib/agent/tools.ts` (rewrite SkillRouter→ToolRouter)
- Modify: `apps/console/lib/agent/policy.ts` (rewrite PolicyEngine)
- Modify: `apps/console/lib/agent/loop.ts`
- Modify: `apps/console/lib/agent/config-loader.ts`
- Modify: `apps/console/lib/agent/config-cache.ts`
- Modify: `apps/console/lib/agent/sub-agent.ts`
- Modify: `apps/console/lib/agent/buildModePrompt.ts`
- Modify: `apps/console/lib/agent/prompt-selector.ts`
- Modify: `apps/console/lib/agent/react-loop.ts`
- Modify: `apps/console/lib/agent/streaming-tool-executor.ts`
- Modify: `apps/console/lib/agent/tool-interceptor.ts`
- Modify: `apps/console/lib/agent/todo-processor.ts`
- Modify: `apps/console/lib/agent/dry-run-executor.ts`
- Modify: `apps/console/lib/agent/case-agent-loop.ts`
- Modify: `apps/console/lib/agent/tools/builtin/finalize-sub-agent.ts`
- Modify: `apps/console/lib/agent/tools/business/business-tool-adapter.ts`

- [ ] **Step 1: Rename skills.ts → tools.ts**

```bash
mv apps/console/lib/agent/skills.ts apps/console/lib/agent/tools.ts
```

- [ ] **Step 2: Rewrite ToolRouter (was SkillRouter)**

Edit `apps/console/lib/agent/tools.ts`. Full rewrite of the `ToolRouter` class.

Key changes:
- Rename class `SkillRouter` → `ToolRouter`
- Change `static async create(orgId, dryRun, bindings)` → `static async create(agentConfigId: string, dryRun = false)`
- Remove all `bindings` filtering logic
- Remove `orgId` parameter
- Load tools directly: `prisma.tool.findMany({ where: { agentConfigId, enabled: true } })`
- System built-in tools (`read_chat_memory`, `read_user_profile`, `todo_read`, `todo_write`) hardcoded in constructor — not in DB
- All `prisma.skill` → `prisma.tool`
- All `SkillDefinition` → `ToolDefinition`
- All `skillRouter` → `toolRouter` in method names
- Remove `SOP_INTERNAL_SKILLS` if it referenced org-level skills
- Remove `caseTypeWhere` orgId-based queries — replace with agentConfigId
- Remove `kbWhere` orgId-based queries — replace with agentConfigId

```typescript
// System tools — always available, not stored in DB
const SYSTEM_TOOLS: ToolDefinition[] = [
  {
    name: 'read_chat_memory',
    description: 'Read the current chat memory (confirmed facts, skill results, key events)',
    inputSchema: { type: 'object', properties: {}, required: [] },
    mode: 'engine_managed',
    isConcurrencySafe: true,
    enabled: true,
    toolCategory: 'system_info',
  },
  {
    name: 'read_user_profile',
    description: 'Read the user profile (cross-chat portrait, preferences, history)',
    inputSchema: { type: 'object', properties: {}, required: [] },
    mode: 'engine_managed',
    isConcurrencySafe: true,
    enabled: true,
    toolCategory: 'system_info',
  },
  {
    name: 'todo_read',
    description: 'Read the current todo list',
    inputSchema: { type: 'object', properties: {}, required: [] },
    mode: 'engine_managed',
    isConcurrencySafe: true,
    enabled: true,
    toolCategory: 'system_info',
  },
  {
    name: 'todo_write',
    description: 'Write to the todo list (add, update, complete, cancel items)',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'update', 'complete', 'cancel'] },
        id: { type: 'string' },
        text: { type: 'string' },
        notes: { type: 'string' },
        status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
      },
      required: ['action'],
    },
    mode: 'engine_managed',
    isConcurrencySafe: false,
    enabled: true,
    toolCategory: 'system_info',
  },
]
```

```typescript
export class ToolRouter {
  private tools: Map<string, ToolDefinition> = new Map()
  private agentConfigId: string

  constructor(agentConfigId: string) {
    this.agentConfigId = agentConfigId
    // Register system tools immediately
    for (const tool of SYSTEM_TOOLS) {
      this.tools.set(tool.name, tool)
    }
  }

  static async create(agentConfigId: string, dryRun = false): Promise<ToolRouter> {
    const router = new ToolRouter(agentConfigId)
    try {
      const { prisma } = await import('@intera/shared/prisma')
      const dbTools = await prisma.tool.findMany({
        where: { agentConfigId, enabled: true },
      })
      for (const t of dbTools) {
        const def: ToolDefinition = {
          name: t.name,
          description: t.description,
          inputSchema: JSON.parse(t.inputSchema),
          outputSchema: t.outputSchema ? JSON.parse(t.outputSchema) : undefined,
          mode: t.mode as ToolDefinition['mode'],
          endpoint: t.endpoint || undefined,
          httpMethod: t.httpMethod as 'GET' | 'POST' | undefined,
          headers: t.headers ? JSON.parse(t.headers) : undefined,
          timeoutMs: t.timeoutMs,
          mockFixture: t.mockFixture ? JSON.parse(t.mockFixture) : undefined,
          isConcurrencySafe: t.isConcurrencySafe,
          enabled: t.enabled,
          toolCategory: t.toolCategory as 'system_info' | 'operational' | undefined,
          displayVerb: t.displayVerb ? JSON.parse(t.displayVerb) : undefined,
          renderHints: t.renderHints ? JSON.parse(t.renderHints) : undefined,
        }
        router.tools.set(def.name, def)
      }
    } catch (err) {
      console.warn('[ToolRouter] Failed to load agent tools from DB:', err)
    }
    return router
  }

  // ... get, getAll, resolveTool, etc. methods unchanged in signature
}
```

- [ ] **Step 3: Rewrite PolicyEngine**

Edit `apps/console/lib/agent/policy.ts`.

Key changes:
- Change `static async create(orgId, guardrails?)` → `static async create(agentConfigId: string)`
- Remove `guardrails` parameter entirely
- Remove `loadBuiltInHooks()` method
- Remove `legacyRuleToHook()` function (no more legacy rules)
- Load directly: `prisma.policy.findMany({ where: { agentConfigId, enabled: true } })`
- Remove the filtering logic at lines 177-182
- Remove `orgId` field from `PolicyEngine` class — replace with `agentConfigId`
- Remove built-in hooks (no_high_risk_account_change, investigate_before_escalation) — they become seed data instead

```typescript
export class PolicyEngine {
  private hooks: Array<GuardrailHook & { __name?: string }> = []
  private llmClient: ReturnType<typeof createAgentClient>
  private policyModel: string
  private agentConfigId: string

  constructor(agentConfigId: string) {
    this.agentConfigId = agentConfigId
    this.policyModel = process.env.POLICY_EVAL_MODEL || DEFAULT_MEMORY_MODEL
    this.llmClient = createAgentClient(this.policyModel)
  }

  static async create(agentConfigId: string): Promise<PolicyEngine> {
    const engine = new PolicyEngine(agentConfigId)

    try {
      const { prisma } = await import('@intera/shared/prisma')
      const dbPolicies = await prisma.policy.findMany({
        where: { agentConfigId, enabled: true },
      })

      for (const p of dbPolicies) {
        if (p.guardrailConfig) {
          try {
            const hook: GuardrailHook = JSON.parse(p.guardrailConfig)
            const errors = validateGuardrailHook(hook)
            if (errors.length > 0) {
              console.warn(`[PolicyEngine] Hook "${p.name}" has config errors:`, errors)
            }
            (hook as any).__name = p.name
            engine.hooks.push(hook)
          } catch (err) {
            console.warn(`[PolicyEngine] Failed to parse guardrailConfig for "${p.name}":`, err)
          }
        }
      }
    } catch (err) {
      console.warn('[PolicyEngine] Failed to load policies from DB:', err)
    }

    return engine
  }

  // evaluate, evaluateAt, summarizeResults methods unchanged
}
```

Delete `loadBuiltInHooks()` method (entire block from ~line 189 to ~260).

Delete `legacyRuleToHook()` function (entire block from ~line 61 to ~123).

- [ ] **Step 4: Update loop.ts**

Edit `apps/console/lib/agent/loop.ts`.

Changes:
```diff
- import { SkillRouter, SOP_INTERNAL_SKILLS } from './skills'
+ import { ToolRouter } from './tools'
  import { PolicyEngine } from './policy'

  // In AgentLoop constructor:
- this.skillRouter = new SkillRouter(deps.orgId)
+ this.toolRouter = new ToolRouter(deps.configId)

  // In AgentLoop.init():
- loop.skillRouter = await SkillRouter.create(deps.orgId, deps.dryRun ?? false, deps.config.capabilityBindings)
+ loop.toolRouter = await ToolRouter.create(deps.configId)

- loop.policyEngine = await PolicyEngine.create(deps.orgId, deps.config.capabilityBindings?.guardrails)
+ loop.policyEngine = await PolicyEngine.create(deps.configId)
```

All `this.skillRouter` → `this.toolRouter` throughout the file.

Add `configId` to `AgentLoopDeps`:
```typescript
export interface AgentLoopDeps {
  config: AgentConfigData
  configId: string   // <-- ADD
  caseId: string
  orgId: string       // keep — still needed for Case/ChatMemory/UserProfile queries
  userId: string
  // ...
}
```

The `orgId` field stays in `AgentLoopDeps` — it's still needed for case management (Case, ChatMemory, UserProfile, Messages are NOT agent-scoped).

- [ ] **Step 5: Update config-loader.ts**

Edit `apps/console/lib/agent/config-loader.ts`.

```typescript
// Before
export async function loadAgentConfig(
  orgId: string,
  agentConfigId?: string,
): Promise<{ config: AgentConfigData; id: string; name: string; version: number; isActive: boolean }> {
  const cached = getCachedConfig(orgId, agentConfigId ?? undefined)
  if (cached) return cached

  const row = agentConfigId
    ? await prisma.agentConfig.findUnique({ where: { id: agentConfigId } })
    : await prisma.agentConfig.findFirst({ where: { orgId, name: 'Default', isActive: true } })

  // ...
  setCachedConfig(orgId, config, agentConfigId ?? undefined)
}
```

```typescript
// After
export async function loadAgentConfig(
  agentConfigId?: string,
): Promise<{ config: AgentConfigData; id: string; name: string; version: number; isActive: boolean }> {
  const cached = getCachedConfig(agentConfigId ?? 'default')
  if (cached) return cached

  const row = agentConfigId
    ? await prisma.agentConfig.findUnique({ where: { id: agentConfigId } })
    : await prisma.agentConfig.findFirst({ where: { name: 'Default', isActive: true } })

  // ... parse config (remove policyHooks/capabilityBindings from parsed fields)

  setCachedConfig(row.id, config)
  return { config, id: row.id, name: row.name, version: row.version, isActive: row.isActive }
}
```

Remove `policyHooks` and `capabilityBindings` from the config parsing block.

- [ ] **Step 6: Update config-cache.ts**

Edit `apps/console/lib/agent/config-cache.ts`.

```typescript
// Before
function cacheKey(orgId: string, agentId?: string): string {
  return agentId ? `${orgId}::${agentId}` : orgId
}

// After
const cache = new Map<string, { data: AgentConfigData & { id: string; name: string; version: number; isActive: boolean }; ts: number }>()

export function getCachedConfig(agentId: string): AgentConfigData & { id: string; name: string; version: number; isActive: boolean } | null {
  const entry = cache.get(agentId)
  if (!entry) return null
  if (Date.now() - entry.ts > 60_000) { cache.delete(agentId); return null }
  return entry.data
}

export function setCachedConfig(agentId: string, data: AgentConfigData & { id: string; name: string; version: number; isActive: boolean }): void {
  cache.set(agentId, { data, ts: Date.now() })
}

export function clearConfigCache(agentId?: string): void {
  if (agentId) {
    cache.delete(agentId)
    clearCaseTypeCache(agentId)
  } else {
    cache.clear()
    caseTypeCache.clear()
  }
}
```

Change `getCachedCaseTypes`/`setCachedCaseTypes`/`clearCaseTypeCache` to key on `agentConfigId` instead of `orgId`:
```typescript
const caseTypeCache = new Map<string, { types: CachedCaseType[]; timestamp: number }>()

export function getCachedCaseTypes(agentConfigId: string): CachedCaseType[] | null {
  const entry = caseTypeCache.get(agentConfigId)
  // ...
}

export function setCachedCaseTypes(agentConfigId: string, types: CachedCaseType[]): void {
  caseTypeCache.set(agentConfigId, { types, timestamp: Date.now() })
}

export function clearCaseTypeCache(agentConfigId?: string): void {
  if (agentConfigId) caseTypeCache.delete(agentConfigId)
  else caseTypeCache.clear()
}
```

- [ ] **Step 7: Update sub-agent.ts, buildModePrompt.ts, prompt-selector.ts, react-loop.ts, streaming-tool-executor.ts, tool-interceptor.ts, todo-processor.ts, dry-run-executor.ts, case-agent-loop.ts**

In each file:
- Replace all `import { SkillRouter, ... } from './skills'` → `import { ToolRouter } from './tools'`
- Replace all `SkillRouter` → `ToolRouter`
- Replace all `skillRouter` → `toolRouter`
- Replace all `SkillDefinition` → `ToolDefinition`
- Remove any `bindings` / `capabilityBindings` parameter passing
- Update `PolicyEngine.create()` calls to not pass guardrails

- [ ] **Step 8: Update tools/builtin/finalize-sub-agent.ts and tools/business/business-tool-adapter.ts**

Replace `SkillDefinition` → `ToolDefinition`. Replace `prisma.skill` → `prisma.tool`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: rewrite runtime engine — ToolRouter + PolicyEngine scoped to agentConfigId, remove org fallback, hardcode system tools"
```

---

### Task 3: API Routes

**Files:**
- Rename: `apps/console/app/api/admin/skills/` → `apps/console/app/api/admin/tools/`
- Modify: `apps/console/app/api/admin/tools/route.ts` (was skills/route.ts)
- Modify: `apps/console/app/api/admin/tools/[name]/route.ts` (was skills/[name]/route.ts)
- Delete: `apps/console/app/api/admin/tools/test/route.ts` (was skills/test/route.ts — if not needed)
- Modify: `apps/console/app/api/admin/policies/route.ts`
- Modify: `apps/console/app/api/admin/policies/[name]/route.ts`
- Delete: `apps/console/app/api/admin/policies/stats/route.ts`
- Modify: `apps/console/app/api/admin/case-types/route.ts`
- Modify: `apps/console/app/api/admin/case-types/[name]/route.ts`
- Modify: `apps/console/app/api/admin/knowledge/sources/route.ts`
- Modify: `apps/console/app/api/admin/knowledge/sources/[id]/route.ts`
- Modify: `apps/console/app/api/admin/agent/route.ts`
- Modify: `apps/console/app/api/admin/agent-configs/route.ts`
- Modify: `apps/console/app/api/admin/agent-configs/[id]/fork/route.ts`
- Modify: `apps/console/app/api/admin/agent-configs/[id]/activate/route.ts`
- Modify: `apps/console/app/api/admin/livechat/config/route.ts`
- Modify: `apps/console/app/api/admin/livechat/groups/route.ts`
- Modify: `apps/console/app/api/messages/route.ts`
- Modify: `apps/console/app/api/admin/playground/run/route.ts`

- [ ] **Step 1: Rename skills API directory → tools**

```bash
mv apps/console/app/api/admin/skills apps/console/app/api/admin/tools
```

- [ ] **Step 2: Rewrite tools/route.ts (GET all, POST new)**

Edit `apps/console/app/api/admin/tools/route.ts`. Replace `orgId` with `agentConfigId`. All `prisma.skill` → `prisma.tool`.

```typescript
// GET: list tools for an agent
// Query param: ?agentConfigId=xxx
export async function GET(request: NextRequest) {
  const agentConfigId = request.nextUrl.searchParams.get('agentConfigId')
  if (!agentConfigId) {
    return NextResponse.json({ error: 'agentConfigId required' }, { status: 400 })
  }
  const tools = await prisma.tool.findMany({
    where: { agentConfigId },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json({ tools })
}

// POST: create new tool
export async function POST(request: NextRequest) {
  const body = await request.json()
  const tool = await prisma.tool.create({
    data: {
      agentConfigId: body.agentConfigId,
      name: body.name,
      description: body.description || '',
      inputSchema: JSON.stringify(body.inputSchema || {}),
      outputSchema: body.outputSchema ? JSON.stringify(body.outputSchema) : '{}',
      mode: body.mode || 'static',
      endpoint: body.endpoint || null,
      httpMethod: body.httpMethod || 'POST',
      headers: body.headers ? JSON.stringify(body.headers) : null,
      timeoutMs: body.timeoutMs || 8000,
      mockFixture: body.mockFixture ? JSON.stringify(body.mockFixture) : null,
      displayVerb: body.displayVerb ? JSON.stringify(body.displayVerb) : null,
      renderHints: body.renderHints ? JSON.stringify(body.renderHints) : null,
      guardPhase: body.guardPhase || 'post',
      toolCategory: body.toolCategory || null,
      isConcurrencySafe: body.isConcurrencySafe !== false,
      enabled: body.enabled !== false,
    },
  })
  return NextResponse.json({ tool }, { status: 201 })
}
```

- [ ] **Step 3: Rewrite tools/[name]/route.ts (PUT, DELETE)**

Edit `apps/console/app/api/admin/tools/[name]/route.ts`. Scope by `agentConfigId + name`. All `prisma.skill` → `prisma.tool`.

```typescript
// PUT: update tool by agentConfigId + name
export async function PUT(request: NextRequest, { params }: { params: { name: string } }) {
  const body = await request.json()
  const { agentConfigId } = body
  const tool = await prisma.tool.update({
    where: { agentConfigId_name: { agentConfigId, name: params.name } },
    data: { /* same fields as POST */ },
  })
  return NextResponse.json({ tool })
}

// DELETE: remove tool
export async function DELETE(request: NextRequest, { params }: { params: { name: string } }) {
  const agentConfigId = request.nextUrl.searchParams.get('agentConfigId')
  await prisma.tool.delete({
    where: { agentConfigId_name: { agentConfigId: agentConfigId!, name: params.name } },
  })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Rewrite policies/route.ts and policies/[name]/route.ts**

Same pattern: replace `orgId` with `agentConfigId`. Remove `policyHooks` legacy field from create/update.

Edit `apps/console/app/api/admin/policies/route.ts`:
```typescript
// GET: list policies for an agent
export async function GET(request: NextRequest) {
  const agentConfigId = request.nextUrl.searchParams.get('agentConfigId')
  const policies = await prisma.policy.findMany({
    where: { agentConfigId: agentConfigId! },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json({ policies })
}

// POST: create new policy
export async function POST(request: NextRequest) {
  const body = await request.json()
  const policy = await prisma.policy.create({
    data: {
      agentConfigId: body.agentConfigId,
      name: body.name,
      description: body.description || null,
      hook: body.hook || 'preTool',
      rule: body.rule || '{}',
      guardrailConfig: body.guardrailConfig || null,
      enabled: body.enabled !== false,
    },
  })
  return NextResponse.json({ policy }, { status: 201 })
}
```

- [ ] **Step 5: Delete policies/stats/route.ts**

```bash
rm -rf apps/console/app/api/admin/policies/stats
```

- [ ] **Step 6: Rewrite case-types/route.ts and case-types/[name]/route.ts**

Same pattern: replace `orgId` with `agentConfigId`.

- [ ] **Step 7: Rewrite knowledge/sources/route.ts and knowledge/sources/[id]/route.ts**

Same pattern: replace `orgId` with `agentConfigId`.

- [ ] **Step 8: Rewrite agent/route.ts (GET + PUT)**

Edit `apps/console/app/api/admin/agent/route.ts`. Remove `policyHooks` and `capabilityBindings` from all queries and responses.

The `PUT` handler: remove `capabilityBindings` from accepted body fields.

The `GET` handler: stop parsing and returning `policyHooks` and `capabilityBindings`.

- [ ] **Step 9: Rewrite Fork route — add deep copy**

Edit `apps/console/app/api/admin/agent-configs/[id]/fork/route.ts`. Add deep-copy logic for all sub-modules.

```typescript
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const sourceId = params.id

  // 1. Fork the AgentConfig row (existing logic)
  const source = await prisma.agentConfig.findUnique({ where: { id: sourceId } })
  if (!source) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const forked = await prisma.agentConfig.create({
    data: {
      orgId: source.orgId,
      name: source.name,
      version: /* next version number */,
      parentId: source.id,
      isActive: false,
      model: source.model,
      temperature: source.temperature,
      thinkingBudget: source.thinkingBudget,
      maxIterations: source.maxIterations,
      maxOutputTokens: source.maxOutputTokens,
      systemPrompt: source.systemPrompt,
      coreSystemPrompt: source.coreSystemPrompt,
      caseAddendum: source.caseAddendum,
      showThinking: source.showThinking,
      memoryStrategy: source.memoryStrategy,
      resumePrompt: source.resumePrompt,
      debugMode: source.debugMode,
      invariantCheck: source.invariantCheck,
      gptbotsApiKey: source.gptbotsApiKey,
    },
  })

  // 2. Deep-copy sub-modules in a transaction
  await prisma.$transaction(async (tx) => {
    // Copy tools
    const tools = await tx.tool.findMany({ where: { agentConfigId: sourceId } })
    for (const t of tools) {
      await tx.tool.create({
        data: {
          agentConfigId: forked.id,
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          outputSchema: t.outputSchema,
          mode: t.mode,
          endpoint: t.endpoint,
          httpMethod: t.httpMethod,
          headers: t.headers,
          timeoutMs: t.timeoutMs,
          mockFixture: t.mockFixture,
          displayVerb: t.displayVerb,
          renderHints: t.renderHints,
          guardPhase: t.guardPhase,
          toolCategory: t.toolCategory,
          isConcurrencySafe: t.isConcurrencySafe,
          enabled: t.enabled,
        },
      })
    }

    // Copy policies
    const policies = await tx.policy.findMany({ where: { agentConfigId: sourceId } })
    for (const p of policies) {
      await tx.policy.create({
        data: {
          agentConfigId: forked.id,
          name: p.name,
          description: p.description,
          hook: p.hook,
          rule: p.rule,
          guardrailConfig: p.guardrailConfig,
          enabled: p.enabled,
        },
      })
    }

    // Copy case types
    const caseTypes = await tx.caseType.findMany({ where: { agentConfigId: sourceId } })
    for (const ct of caseTypes) {
      await tx.caseType.create({
        data: {
          agentConfigId: forked.id,
          type: ct.type,
          displayName: ct.displayName,
          description: ct.description,
          icon: ct.icon,
          requiredFacts: ct.requiredFacts,
          stages: ct.stages,
          stageConfigs: ct.stageConfigs,
          orchestratorConfig: ct.orchestratorConfig,
          defaultGoal: ct.defaultGoal,
          escalateOn: ct.escalateOn,
          autoCloseConditions: ct.autoCloseConditions,
          enabled: ct.enabled,
          requireHumanReview: ct.requireHumanReview,
          executionMode: ct.executionMode,
          sop: ct.sop,
          sopMaxAutoTurns: ct.sopMaxAutoTurns,
        },
      })
    }

    // Copy knowledge sources
    const sources = await tx.knowledgeSource.findMany({ where: { agentConfigId: sourceId } })
    for (const ks of sources) {
      await tx.knowledgeSource.create({
        data: {
          agentConfigId: forked.id,
          name: ks.name,
          description: ks.description,
          groupIds: ks.groupIds,
          dataIds: ks.dataIds,
          embeddingRate: ks.embeddingRate,
          topK: ks.topK,
          rerankVersion: ks.rerankVersion,
          docCorrelation: ks.docCorrelation,
          modelControlTopK: ks.modelControlTopK,
          caseTypeTag: ks.caseTypeTag,
          enabled: ks.enabled,
        },
      })
    }

    // Copy channel bindings
    const bindings = await tx.channelBinding.findMany({ where: { agentConfigId: sourceId } })
    for (const cb of bindings) {
      await tx.channelBinding.create({
        data: {
          agentConfigId: forked.id,
          channel: cb.channel,
          enabled: cb.enabled,
          credentials: cb.credentials,
          botAccessToken: cb.botAccessToken,
          licenseId: cb.licenseId,
          toolOverrides: cb.toolOverrides,
          defaults: cb.defaults,
          channelSkillBinding: cb.channelSkillBinding,
          transferStrategy: cb.transferStrategy,
          transferTarget: cb.transferTarget,
        },
      })
    }
  })

  return NextResponse.json({ config: forked }, { status: 201 })
}
```

- [ ] **Step 10: Rewrite livechat config + groups routes**

Edit `apps/console/app/api/admin/livechat/config/route.ts` and `groups/route.ts`. Replace `agentName` + `orgId` with `agentConfigId`.

```typescript
// config/route.ts
// Replace query param: ?agentName=X → ?agentConfigId=X
// Replace: ChannelBinding lookup by agentName+orgId → agentConfigId
const agentConfigId = request.nextUrl.searchParams.get('agentConfigId')

// Lookup ChannelBinding by agentConfigId
const binding = await prisma.channelBinding.findFirst({
  where: { agentConfigId, channel: 'livechat' },
})
```

- [ ] **Step 11: Update messages/route.ts and playground/run/route.ts**

Update any `SkillRouter` → `ToolRouter` imports. Update `PolicyEngine.create()` calls. Remove `capabilityBindings` references.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: rewrite API routes — agentConfigId scoping, fork deep-copy, delete policy stats endpoint"
```

---

### Task 4: Frontend Pages + Components

**Files:**
- Modify: `apps/console/app/admin/guardrails/page.tsx`
- Modify: `apps/console/app/admin/tools/page.tsx` (was skills page — the config page)
- Modify: `apps/console/app/admin/case-types/page.tsx`
- Modify: `apps/console/app/admin/case-types/[name]/page.tsx`
- Modify: `apps/console/app/admin/knowledge/page.tsx`
- Modify: `apps/console/app/admin/integrations/page.tsx`
- Modify: `apps/console/app/admin/agent/page.tsx`
- Modify: `apps/console/app/admin/model/page.tsx`
- Modify: `apps/console/app/admin/memory/page.tsx`
- Modify: `apps/console/app/admin/playground/page.tsx`
- Modify: `apps/console/components/admin/version-context-bar.tsx`
- Modify: `apps/console/components/admin/agent-blueprint.tsx`
- Modify: `apps/console/components/admin/agent-config-drawer-ui.tsx`
- Modify: `apps/console/components/admin/agent-version-picker.tsx`
- Modify: `apps/console/components/console-sidebar.tsx`
- Modify: `apps/console/components/admin/sub-agent-form.tsx` (if it has skill references)
- Modify: `apps/console/components/admin/stage-config-editor.tsx` (if it has skill references)

- [ ] **Step 1: Rewrite guardrails/page.tsx**

Edit `apps/console/app/admin/guardrails/page.tsx`.

Changes:
- Remove `import { useCapabilityBindings, checkItemBinding, toggleItemBinding, BindingIndicator }` — DELETE
- Remove `import type { CapabilityBindings }` — DELETE
- Remove `agentId = useSelectedAgentId()` line — keep VersionContextBar but simplify
- Remove `{ bindings, saveBindings } = useCapabilityBindings(agentId)` — DELETE
- Remove `usedByAgent` state + effect (lines 116, 130-147) — DELETE
- Remove `hitStats` state + effect (lines 115, 149-158) — DELETE (stats endpoint removed)
- Fetch policies by agentConfigId:

```typescript
const load = useCallback(async () => {
  if (!agentConfigId) { setItems([]); setLoading(false); return }
  const res = await fetch(`/api/admin/policies?agentConfigId=${agentConfigId}`)
  const data = await res.json()
  setItems((data.data || data).policies || [])
  setLoading(false)
}, [agentConfigId])
```

- Save passes `agentConfigId`:
```typescript
const payload = {
  agentConfigId,
  ...editing,
  guardrailConfig,
}
```

- Delete the Hit Statistics section entirely (lines 359-384)
- Delete the `BindingIndicator` from each card (lines 327-339) — replace with nothing (each item on the page already belongs to this agent)
- Delete the "Assigned to agent" badge (line 324-326)
- Keep: VersionContextBar at top, list of cards, Edit/New modal, Delete confirm dialog

- [ ] **Step 2: Update tools/page.tsx (the tools config page)**

Edit `apps/console/app/admin/tools/page.tsx`. This page was already about managing tools/skills.

Changes:
- Remove all CapabilityBindings / binding-column imports
- Replace `skill` → `tool` in all variable names, i18n keys
- Fetch by `agentConfigId`
- Remove binding toggle UI
- Use `useSelectedAgentId()` to get `agentConfigId`

- [ ] **Step 3: Update case-types/page.tsx**

Edit `apps/console/app/admin/case-types/page.tsx`.

Changes:
- Remove CapabilityBindings / binding-column imports
- Fetch by `agentConfigId`
- Remove binding toggle UI
- Remove `import { useCapabilityBindings, checkItemBinding, toggleItemBinding, BindingIndicator }` (lines 11, 13)

- [ ] **Step 4: Update case-types/[name]/page.tsx**

Edit `apps/console/app/admin/case-types/[name]/page.tsx`.

Changes:
- Fetch case type by `agentConfigId`
- `allSkills` → `allTools` (fetch from `/api/admin/tools?agentConfigId=X`)
- Replace `skill` → `tool` in stage config editor references

- [ ] **Step 5: Update knowledge/page.tsx**

Edit `apps/console/app/admin/knowledge/page.tsx`.

Changes:
- Remove CapabilityBindings / binding-column imports
- Fetch by `agentConfigId`
- Remove binding toggle UI

- [ ] **Step 6: Update integrations/page.tsx**

Edit `apps/console/app/admin/integrations/page.tsx`.

Changes:
- Fetch ChannelBinding by `agentConfigId` (was `orgId + agentName`)

- [ ] **Step 7: Update agent/page.tsx (agent blueprint)**

Edit `apps/console/app/admin/agent/page.tsx`.

Changes:
- Remove `policyHooks` / `capabilityBindings` references
- Show sub-module counts directly (query counts from each sub-table by `agentConfigId`)

- [ ] **Step 8: Update model/page.tsx and memory/page.tsx**

These already use `useSelectedAgentId()` and `PUT /api/admin/agent?agentId=X`. Just remove any `capabilityBindings` / binding references if present. Mostly no change needed — these pages are already agent-level.

- [ ] **Step 9: Update playground/page.tsx**

Remove any CapabilityBindings references. Remove `resolveBindings` imports. Remove `binding-column` imports if any.

- [ ] **Step 10: Update version-context-bar.tsx**

Edit `apps/console/components/admin/version-context-bar.tsx`.

Remove `useCapabilityBindings` import. The component provides `useSelectedAgentId()` — this stays. Remove any binding-related props or display.

- [ ] **Step 11: Update agent-blueprint.tsx**

Edit `apps/console/components/admin/agent-blueprint.tsx`.

Replace binding counts with direct item counts:
```typescript
// Before: showed CapabilityBindings stats
// After: fetch count from each sub-table
const stats = {
  tools: await prisma.tool.count({ where: { agentConfigId } }),
  policies: await prisma.policy.count({ where: { agentConfigId } }),
  caseTypes: await prisma.caseType.count({ where: { agentConfigId } }),
  knowledge: await prisma.knowledgeSource.count({ where: { agentConfigId } }),
}
```

- [ ] **Step 12: Update agent-config-drawer-ui.tsx**

Remove `policyHooks` / `capabilityBindings` fields from edit form.

- [ ] **Step 13: Update console-sidebar.tsx**

Any `skill` → `tool` in labels. Add i18n key changes.

- [ ] **Step 14: Update sub-agent-form.tsx and stage-config-editor.tsx**

Replace `skill` → `tool` in field labels, variable names, API calls. Fetch tools from `GET /api/admin/tools?agentConfigId=X`.

- [ ] **Step 15: Commit**

```bash
git add -A
git commit -m "feat: rewrite frontend — agent-scoped pages, remove binding UI, skill->tool rename in components"
```

---

### Task 5: i18n + Seed

**Files:**
- Modify: `apps/console/lib/i18n/dictionaries.ts`
- Modify: `packages/shared/prisma/seed.ts`
- Modify: `packages/shared/prisma/seed-render-hints.ts`

- [ ] **Step 1: Rewrite dictionaries.ts — skill → tool**

Edit `apps/console/lib/i18n/dictionaries.ts`.

Replace all `skill.*` keys with `tool.*` keys (~80 keys). Merge any `tools.*` namespace that overlaps.

Key mapping examples:
| Old en key | New en key |
|---|---|
| `skill.title` | `tool.title` |
| `skill.newSkill` | `tool.newTool` |
| `skill.noSkills` | `tool.noTools` |
| `skill.subtitle` | `tool.subtitle` |
| `skill.name` | `tool.name` |
| `skill.description` | `tool.description` |
| `skill.inputSchema` | `tool.inputSchema` |
| `skill.outputSchema` | `tool.outputSchema` |
| `skill.mode` | `tool.mode` |
| `skill.endpoint` | `tool.endpoint` |
| `skill.httpMethod` | `tool.httpMethod` |
| `skill.headers` | `tool.headers` |
| `skill.timeoutMs` | `tool.timeoutMs` |
| `skill.mockFixture` | `tool.mockFixture` |
| `skill.displayVerb` | `tool.displayVerb` |
| `skill.renderHints` | `tool.renderHints` |
| `skill.guardPhase` | `tool.guardPhase` |
| `skill.toolCategory` | `tool.toolCategory` |
| `skill.isConcurrencySafe` | `tool.isConcurrencySafe` |
| `skill.deleteConfirm` | `tool.deleteConfirm` |
| ... (all ~80 skill.* keys) | ... (all ~80 tool.* keys) |

Remove keys that no longer apply:
- `binding.bound`, `binding.unbound`, `binding.drift`, `binding.boundTitle`, `binding.unboundTitle`, `binding.driftTitle`
- `policies.hitStats`, `policies.hitStatsDesc`, `policies.hits`
- Any `policyHooks` related keys

- [ ] **Step 2: Rewrite seed.ts**

Edit `packages/shared/prisma/seed.ts`.

Create a default AgentConfig, then seed sub-modules belonging to it:

```typescript
async function main() {
  // 1. Create default org
  const org = await prisma.organization.upsert({
    where: { id: 'default' },
    update: {},
    create: { id: 'default', name: 'Default' },
  })

  // 2. Create default agent
  const agent = await prisma.agentConfig.upsert({
    where: { id: 'agent_default_v1' },
    update: {},
    create: {
      id: 'agent_default_v1',
      orgId: 'default',
      name: 'Default',
      version: 1,
      isActive: true,
      model: process.env.ANTHROPIC_MODEL || 'MiniMax-M2.7-highspeed',
      temperature: 0.5,
      thinkingBudget: 4096,
      maxIterations: 20,
      systemPrompt: '',
      coreSystemPrompt: '',
      showThinking: false,
      memoryStrategy: JSON.stringify(DEFAULT_MEMORY_STRATEGY),
      invariantCheck: false,
    },
  })

  // 3. Seed tools for this agent
  const tools = [
    {
      name: 'search_knowledge_base',
      description: 'Search the knowledge base for relevant articles',
      inputSchema: JSON.stringify({
        type: 'object',
        properties: { query: { type: 'string', description: 'Search query' } },
        required: ['query'],
      }),
      outputSchema: JSON.stringify({}),
      mode: 'engine_managed',
      toolCategory: 'operational',
      isConcurrencySafe: true,
      enabled: true,
    },
    {
      name: 'create_human_task',
      description: 'Escalate to human operator',
      inputSchema: JSON.stringify({
        type: 'object',
        properties: {
          queue: { type: 'string' },
          question: { type: 'string' },
          priority: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
        required: ['queue', 'question'],
      }),
      outputSchema: JSON.stringify({}),
      mode: 'engine_managed',
      toolCategory: 'operational',
      isConcurrencySafe: true,
      enabled: true,
    },
    {
      name: 'request_user_input',
      description: 'Request additional information from the user',
      inputSchema: JSON.stringify({
        type: 'object',
        properties: {
          question: { type: 'string' },
          fields: { type: 'array' },
        },
        required: ['question'],
      }),
      outputSchema: JSON.stringify({}),
      mode: 'engine_managed',
      toolCategory: 'operational',
      isConcurrencySafe: true,
      enabled: true,
    },
  ]

  for (const t of tools) {
    await prisma.tool.upsert({
      where: { agentConfigId_name: { agentConfigId: agent.id, name: t.name } },
      update: t,
      create: { agentConfigId: agent.id, ...t },
    })
  }

  // 4. Seed policies for this agent
  const policies = [
    {
      name: 'no_high_risk_account_change',
      description: 'Block high-risk account mutations',
      hook: 'preTool',
      rule: JSON.stringify({}),
      guardrailConfig: JSON.stringify({
        when: 'preTool',
        match: { skills: ['refund_money', 'change_ban_status', 'delete_account'] },
        check: { kind: 'rule', denySkills: ['refund_money', 'change_ban_status', 'delete_account'] },
        onViolation: { action: 'block', guidance: 'High-risk account changes blocked. Escalate if needed.' },
        onUnavailable: { action: 'closed' },
        guidance: 'This action is blocked by platform policy. Use create_human_task to escalate.',
      }),
      enabled: true,
    },
    {
      name: 'investigate_before_resolve',
      description: 'Require investigation before case resolution',
      hook: 'preFinalize',
      rule: JSON.stringify({}),
      guardrailConfig: JSON.stringify({
        when: 'preFinalize',
        match: { skills: [] },
        check: { kind: 'ai', evaluationPrompt: 'Has the agent investigated the issue thoroughly? Check if all required facts are gathered and relevant tools were called.' },
        onViolation: { action: 'block', guidance: 'Complete investigation before resolving the case.' },
        onUnavailable: { action: 'open' },
      }),
      enabled: true,
    },
  ]

  for (const p of policies) {
    await prisma.policy.upsert({
      where: { agentConfigId_name: { agentConfigId: agent.id, name: p.name } },
      update: p,
      create: { agentConfigId: agent.id, ...p },
    })
  }

  // 5. Seed case types for this agent
  const caseTypes: Array<{
    type: string
    displayName: string
    description: string
    icon: string
    defaultGoal: string
    stages: string
    requiredFacts: string
    escalateOn: string
    autoCloseConditions: string
    stageConfigs: string
    orchestratorConfig: string
    enabled: boolean
  }> = [
    {
      type: 'general_inquiry',
      displayName: 'General Inquiry',
      description: 'General customer questions and requests',
      icon: '💬',
      defaultGoal: 'Answer the customer question or fulfill the request',
      stages: JSON.stringify(['created', 'investigating', 'resolved']),
      requiredFacts: JSON.stringify(['customer_intent']),
      escalateOn: JSON.stringify([]),
      autoCloseConditions: JSON.stringify({}),
      stageConfigs: JSON.stringify({}),
      orchestratorConfig: JSON.stringify({ enabled: false, maxParallelAgents: 3 }),
      enabled: true,
    },
    {
      type: 'deposit_issue',
      displayName: 'Deposit Issue',
      description: 'Customer deposit not credited',
      icon: '💰',
      defaultGoal: 'Verify deposit status and resolve',
      stages: JSON.stringify(['created', 'collecting', 'investigating', 'resolved']),
      requiredFacts: JSON.stringify(['order_id', 'amount', 'deposit_method']),
      escalateOn: JSON.stringify(['refund_required', 'third_party_issue']),
      autoCloseConditions: JSON.stringify({}),
      stageConfigs: JSON.stringify({}),
      orchestratorConfig: JSON.stringify({ enabled: false, maxParallelAgents: 3 }),
      enabled: true,
    },
  ]

  for (const ct of caseTypes) {
    await prisma.caseType.upsert({
      where: { agentConfigId_type: { agentConfigId: agent.id, type: ct.type } },
      update: ct,
      create: { agentConfigId: agent.id, ...ct },
    })
  }

  console.log('Seed complete.')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
```

- [ ] **Step 3: Update seed-render-hints.ts**

Edit `packages/shared/prisma/seed-render-hints.ts`. Replace `orgId` → `agentConfigId`. Replace `skill` → `tool`.

- [ ] **Step 4: Run db:seed to verify**

```bash
npm run db:seed
```

Expected: seed completes without errors, data appears in DB.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: i18n skill->tool rename + agent-scoped seed data"
```

---

### Task 6: Tests

**Files:** ~15 test files that reference `Skill`, `skillRouter`, `policyHooks`, `capabilityBindings`, `orgId` in policy/tool/case-type/knowledge contexts.

- [ ] **Step 1: Update skills-route.test.ts → tools-route.test.ts**

```bash
mv apps/console/app/api/admin/tools/__tests__/skills-route.test.ts apps/console/app/api/admin/tools/__tests__/tools-route.test.ts
```

Replace all `skill` → `tool`, `orgId` → `agentConfigId`, mock data to use `agentConfigId`.

- [ ] **Step 2: Update policies-route.test.ts and policy-stats-route.test.ts**

Edit policy tests. Replace `orgId` → `agentConfigId` in test fixtures. Delete stats test file.

- [ ] **Step 3: Update case-types-route.test.ts**

Replace `orgId` → `agentConfigId` in test fixtures.

- [ ] **Step 4: Update knowledge test files**

Replace `orgId` → `agentConfigId` in test fixtures.

- [ ] **Step 5: Update capability-bindings-e2e.test.ts → DELETE**

```bash
rm apps/console/lib/agent/__tests__/integration/capability-bindings-e2e.test.ts
```

This test validates the old CapabilityBindings system which no longer exists.

- [ ] **Step 6: Update agent-loop-integration.test.ts**

Replace `SkillRouter` → `ToolRouter`, `PolicyEngine.create(orgId, ...)` → `PolicyEngine.create(agentConfigId)`, remove `capabilityBindings` from test setup.

- [ ] **Step 7: Update playground-isolation.test.ts and playground-safety.test.ts**

Replace `SkillRouter` → `ToolRouter`. Remove binding references.

- [ ] **Step 8: Update remaining test files**

Grepped files that reference Skill/skill/capabilityBindings:
- `apps/console/lib/agent/__tests__/smoke/smoke.test.ts`
- `apps/console/lib/agent/__tests__/regression/p0-regression.test.ts`
- `apps/console/lib/agent/__tests__/unit/tool-result-invariant.test.ts`
- `apps/console/lib/livechat/__tests__/unit/render-skill-by-hint.test.ts` → rename to `render-tool-by-hint.test.ts`
- `apps/console/lib/livechat/__tests__/integration/skill-rendering-end-to-end.test.ts` → rename

Update all. Replace `Skill` → `Tool`, `skill` → `tool`, `orgId` → `agentConfigId`.

- [ ] **Step 9: Run test suite**

```bash
env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npm test
```

Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "test: update tests for agent-scoped architecture, delete capability-bindings e2e tests"
```

---

### Task 7: Verification

- [ ] **Step 1: TypeScript check**

```bash
npx tsc --noEmit -p apps/console/tsconfig.json
```

Expected: 0 errors.

- [ ] **Step 2: Run keyless test suite**

```bash
env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npm test
```

Expected: all passing.

- [ ] **Step 3: Build**

```bash
npm run build:console
```

Expected: success.

- [ ] **Step 4: Deploy**

```bash
git push deploy main
curl -s https://demo.anytrans.ai/api/health
```

Expected: `{"status":"ok","db":"connected"}`.

- [ ] **Step 5: Production verification via Playwright**

1. Navigate to `https://demo.anytrans.ai/`
2. Login as staff: `test@intera.dev` / `intera123`
3. Verify sidebar renders
4. Navigate to each admin page:
   - `/admin/agent` — agent list visible, no binding references
   - `/admin/model` — model config loads
   - `/admin/memory` — memory config loads
   - `/admin/tools` — tools list for current agent
   - `/admin/guardrails` — policies list for current agent
   - `/admin/case-types` — case types list
   - `/admin/knowledge` — knowledge sources list
   - `/admin/integrations` — channel bindings
   - `/admin/playground` — send test message, verify agent runs
5. Create new agent → verify no tools/guardrails carried over
6. Fork agent → verify sub-modules deep-copied
7. Verify agent isolation: agent A's tools not visible for agent B

- [ ] **Step 6: Commit final fixups if any**

---

## File Change Audit

| Task | Files Changed | Deleted |
|---|---|---|
| Task 0 | 2 | 0 |
| Task 1 | 5 | 2 |
| Task 2 | 17 | 0 |
| Task 3 | 18 | 1 |
| Task 4 | 16 | 0 |
| Task 5 | 3 | 0 |
| Task 6 | ~15 | 1 |
| Task 7 | 0 | 0 |
| **Total** | **~76** | **4** |
