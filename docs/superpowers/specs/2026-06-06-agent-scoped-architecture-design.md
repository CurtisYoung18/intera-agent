# Agent-Scoped Architecture — Design Spec

**Date:** 2026-06-06 | **Status:** draft | **Author:** architect

## Summary

Eliminate the org-level shared-pool pattern. Every sub-module (Tool, Policy, CaseType,
KnowledgeSource, ChannelBinding) is owned directly by an AgentConfig version. No more
CapabilityBindings, no org fallback, no "bind from pool" UX. Each agent's sub-modules
are private and isolated.

Skill is renamed to Tool throughout the codebase.

---

## Scope

### In scope

1. Schema migration: add `agentConfigId` FK to Policy, Tool (Skill), CaseType, KnowledgeSource, ChannelBinding
2. Skill → Tool rename (Prisma model, types, API routes, pages, i18n, file names)
3. Remove CapabilityBindings: type, interface, EMPTY_BINDINGS, resolve-bindings.ts, binding-column.tsx
4. Remove `AgentConfig.policyHooks` (already @deprecated) and `AgentConfig.capabilityBindings`
5. Rewrite PolicyEngine, ToolRouter to load by `agentConfigId` — no org fallback, no filtering
6. Rewrite all sub-module API routes: `orgId` → `agentConfigId` scoping
7. Rewrite all sub-module admin pages: delete binding UI, show only current agent's items
8. ChannelBinding: `agentName` → `agentConfigId` FK, remove org-default (NULL) fallback
9. Fork: deep-copy all sub-modules when forking an AgentConfig version
10. Seed: restructure to seed per-agent sub-modules
11. i18n: `skill.*` → `tool.*`, merge duplicate `tools.*` namespace
12. System built-in tools hardcoded in ToolRouter (not in DB)

### Out of scope

- Model API keys remain org level (env var injected)
- Organization, User, Membership, AuditLog, ApiKey models unchanged
- Case, Message, ChatMemory, ActionTrace models unchanged
- LiveChat bridge runtime unchanged
- `/api/messages` SSE entry point unchanged

---

## Schema Migration

### Policy

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
- @@index([orgId])
+ @@index([agentConfigId])
  @@map("policies")
}
```

### Skill → Tool

```diff
- model Skill {
+ model Tool {
  id             String   @id @default(cuid())
- orgId          String   @map("org_id")
+ agentConfigId  String   @map("agent_config_id")
  name           String
  // ... inputSchema, outputSchema, mode, endpoint, headers, timeoutMs,
  //     mockFixture, displayVerb, renderHints, guardPhase, toolCategory,
  //     isConcurrencySafe, enabled — unchanged

  agentConfig    AgentConfig @relation(fields: [agentConfigId], references: [id], onDelete: Cascade)

- @@unique([orgId, name])
+ @@unique([agentConfigId, name])
- @@map("skills")
+ @@map("tools")
}
```

### CaseType

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

### KnowledgeSource

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

### ChannelBinding

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

### AgentConfig — removed columns

```diff
model AgentConfig {
  // ... all other fields unchanged
- policyHooks        String  // @deprecated — remove
- capabilityBindings String? // JSON — remove
}
```

### Deleted models (unused)

- `ChannelHealth` — dead table, no runtime consumers. Remove if confirmed unused.

---

## Type System

### Delete

- `CapabilityBindings` interface
- `EMPTY_BINDINGS` constant
- `PolicyHooks` interface
- `BindingsStats` interface (binding-column.tsx)
- All `Skill*` prefixed types renamed to `Tool*`

### Rename

| Old | New |
|---|---|
| `SkillDefinition` | `ToolDefinition` |
| `SkillRouter` | `ToolRouter` |
| `skillNames` | `toolNames` |

### AgentConfigData — remove fields

```diff
interface AgentConfigData {
- policyHooks: PolicyHooks
- capabilityBindings?: CapabilityBindings
}
```

---

## Runtime Changes

### PolicyEngine (`lib/agent/policy.ts`)

```ts
// Before
static async create(orgId: string, guardrails?: CapabilityBindings['guardrails'])
  → prisma.policy.findMany({ where: { orgId, enabled: true } })
  → if (guardrails && names.size > 0) filter
  → else keep all

// After
static async create(agentConfigId: string)
  → prisma.policy.findMany({ where: { agentConfigId, enabled: true } })
  → no filter, no fallback, no builtInHooks
```

Deleted: `legacyRuleToHook()`, `loadBuiltInHooks()`, `PolicyContext` guardrails filtering.

### ToolRouter (renamed from SkillRouter, `lib/agent/tools.ts`)

```ts
// Before
static async create(orgId: string, dryRun: boolean, bindings?: CapabilityBindings)
  → prisma.skill.findMany({ where: { orgId } })
  → filter by bindings

// After
static async create(agentConfigId: string, dryRun: boolean)
  → prisma.tool.findMany({ where: { agentConfigId } })
  → registerSystemTools() // hardcoded: read_chat_memory, read_user_profile, todo_read, todo_write
  → no binding filter
```

System built-in tools (`toolCategory: 'system_info'`) are **not stored in DB**.
Hardcoded in `ToolRouter` constructor and always available.

### loop.ts

```diff
- loop.policyEngine = await PolicyEngine.create(deps.orgId, deps.config.capabilityBindings?.guardrails)
+ loop.policyEngine = await PolicyEngine.create(deps.configId)

- loop.skillRouter = await SkillRouter.create(deps.orgId, deps.dryRun ?? false, deps.config.capabilityBindings)
+ loop.toolRouter = await ToolRouter.create(deps.configId)
```

`AgentLoopDeps` needs `configId` (agentConfigId) added.

### config-loader.ts

```diff
- loadAgentConfig(orgId, agentConfigId?)
+ loadAgentConfig(agentConfigId)
```

`config-cache.ts` cache keys: remove orgId prefix, key on `agentConfigId` alone.

### Delete files

- `lib/agent/resolve-bindings.ts`
- `components/admin/binding-column.tsx`

---

## API Routes

All sub-module routes change from org-scoped to agent-scoped. The `agentConfigId`
comes from the selected agent version (sent by the frontend via query param or body).

| Route | Old WHERE | New WHERE |
|---|---|---|
| `GET /api/admin/tools` | `{ orgId }` | `{ agentConfigId }` |
| `POST /api/admin/tools` | `{ orgId, ... }` | `{ agentConfigId, ... }` |
| `PUT /api/admin/tools/[name]` | `{ orgId, name }` | `{ agentConfigId, name }` |
| `DELETE /api/admin/tools/[name]` | `{ orgId, name }` | `{ agentConfigId, name }` |
| `GET /api/admin/policies` | `{ orgId }` | `{ agentConfigId }` |
| `POST /api/admin/policies` | `{ orgId, ... }` | `{ agentConfigId, ... }` |
| `PUT /api/admin/policies/[name]` | `{ orgId, name }` | `{ agentConfigId, name }` |
| `DELETE /api/admin/policies/[name]` | `{ orgId, name }` | `{ agentConfigId, name }` |
| `GET /api/admin/case-types` | `{ orgId }` | `{ agentConfigId }` |
| `POST /api/admin/case-types` | `{ orgId, ... }` | `{ agentConfigId, ... }` |
| `PUT /api/admin/case-types/[name]` | `{ orgId, type }` | `{ agentConfigId, type }` |
| `DELETE /api/admin/case-types/[name]` | `{ orgId, type }` | `{ agentConfigId, type }` |
| `GET /api/admin/knowledge/sources` | `{ orgId }` | `{ agentConfigId }` |
| `POST /api/admin/knowledge/sources` | `{ orgId, ... }` | `{ agentConfigId, ... }` |
| `PUT /api/admin/knowledge/sources/[id]` | `{ orgId }` | `{ agentConfigId }` |
| `DELETE /api/admin/knowledge/sources/[id]` | `{ orgId }` | `{ agentConfigId }` |

### Delete routes

- `GET /api/admin/policies/stats` — hit stats per policy; no longer meaningful when scoped to agent

### Route URL changes (Skill → Tool)

| Old | New |
|---|---|
| `/api/admin/skills` | `/api/admin/tools` |
| `/api/admin/skills/[name]` | `/api/admin/tools/[name]` |
| `/api/admin/skills/test` | `/api/admin/tools/test` |

### ChannelBinding routes

| Old | New |
|---|---|
| Livechat config scoped by `orgId + agentName` | Scoped by `agentConfigId` |
| Web Chat config scoped by `orgId + agentName` | Scoped by `agentConfigId` |

---

## Fork — Deep Copy

`POST /api/admin/agent-configs/[id]/fork` must deep-copy all sub-modules:

```
for each sub-table (Tool, Policy, CaseType, KnowledgeSource, ChannelBinding):
  SELECT * WHERE agentConfigId = sourceId
  INSERT with new agentConfigId = forkedId, new cuid() for each row
```

Transaction-wrapped. If any sub-table copy fails, roll back entire fork.

---

## Frontend

### Deleted

- `binding-column.tsx` — entire file
- All `useCapabilityBindings`, `toggleItemBinding`, `checkItemBinding`, `BindingIndicator` imports and usage
- `CapabilityBindings` references in `version-context-bar.tsx`

### Page behavior change

Each sub-module page loads items for the **currently selected agent version** only.
No "bind from pool" interaction. CRUD is direct:

| Page | Route | Data source |
|---|---|---|
| Tools | `/admin/tools` | `GET /api/admin/tools?agentConfigId=X` |
| Guardrails | `/admin/guardrails` | `GET /api/admin/policies?agentConfigId=X` |
| Case Types | `/admin/case-types` | `GET /api/admin/case-types?agentConfigId=X` |
| Knowledge | `/admin/knowledge` | `GET /api/admin/knowledge/sources?agentConfigId=X` |
| Integrations | `/admin/integrations` | ChannelBinding by `agentConfigId` |

`useSelectedAgentId()` from `version-context-bar` supplies the `agentConfigId`.

### VersionContextBar

- Remove `useCapabilityBindings` integration
- Keep version picker (select agent config version to view/edit its sub-modules)
- Active version warning + fork-to-draft preserved

### `usedByAgent` removal

The `usedByAgent` state and the "Assigned to agent" badge (guardrails/page.tsx:324-326)
are dead code — every item on the page already belongs to the current agent.
Remove entirely.

### Agent blueprint page

`agent-blueprint.tsx` no longer needs to show binding counts. Show sub-module item
counts directly (e.g. "3 Tools · 2 Guardrails · 1 Case Type").

---

## i18n: Skill → Tool

`dictionaries.ts` (en + zh, ~1090 keys each):

- `skill.*` namespace → `tool.*` (~80 keys)
- Merge `tools.*` (config page) into `tool.*`
- Key examples: `skill.name` → `tool.name`, `skill.newSkill` → `tool.newTool`, `skill.noSkills` → `tool.noTools`

---

## Seed Data

`packages/shared/prisma/seed.ts`:

- Create a default AgentConfig (`agent_1`)
- Seed its Tools (2-3 business tools)
- Seed its Policies (2-3 guardrails)
- Seed its CaseTypes (2-3 case types)
- Seed its KnowledgeSources (1-2 sources)
- Remove all org-level seed for these tables

`packages/shared/prisma/seed-render-hints.ts`:

- Tool renderHints keyed by agent, not org

---

## Data Migration

**Decision: A — discard old data, re-seed.**

Production is internal-test only with zero real customers. Drop old rows from
Policy/Skill/CaseType/KnowledgeSource/ChannelBinding tables, apply migration,
re-seed with agent-scoped demo data.

Pre-migration step in `deploy.sh`: `prisma migrate deploy` handles schema changes.
Post-migration: `npm run db:seed` for fresh demo data.

---

## File Change Manifest

### Schema & migrations (2)
- `packages/shared/prisma/schema.prisma`
- `packages/shared/prisma/migrations/<timestamp>_agent_scoped/migration.sql`

### Types & defaults (3)
- `packages/shared/types/index.ts`
- `packages/shared/contracts/skills.ts` → `packages/shared/contracts/tools.ts`
- `packages/shared/defaults/index.ts`

### Runtime (8)
- `apps/console/lib/agent/loop.ts`
- `apps/console/lib/agent/policy.ts`
- `apps/console/lib/agent/skills.ts` → `apps/console/lib/agent/tools.ts`
- `apps/console/lib/agent/config-loader.ts`
- `apps/console/lib/agent/config-cache.ts`
- `apps/console/lib/agent/sub-agent.ts`
- `apps/console/lib/agent/buildModePrompt.ts`
- `apps/console/lib/agent/prompt-selector.ts`

### API routes (16)
- `apps/console/app/api/admin/tools/route.ts` (renamed from skills)
- `apps/console/app/api/admin/tools/[name]/route.ts`
- `apps/console/app/api/admin/tools/test/route.ts`
- `apps/console/app/api/admin/policies/route.ts`
- `apps/console/app/api/admin/policies/[name]/route.ts`
- `apps/console/app/api/admin/case-types/route.ts`
- `apps/console/app/api/admin/case-types/[name]/route.ts`
- `apps/console/app/api/admin/knowledge/sources/route.ts`
- `apps/console/app/api/admin/knowledge/sources/[id]/route.ts`
- `apps/console/app/api/admin/agent-configs/[id]/fork/route.ts`
- `apps/console/app/api/admin/agent-configs/route.ts`
- `apps/console/app/api/admin/agent/route.ts`
- `apps/console/app/api/admin/livechat/config/route.ts`
- `apps/console/app/api/admin/livechat/groups/route.ts`
- `apps/console/app/api/messages/route.ts`
- `apps/console/app/api/admin/playground/run/route.ts`

### Frontend pages (10)
- `apps/console/app/admin/tools/page.tsx` (renamed from guardrails—no, renamed from skills—actual tools page)
- `apps/console/app/admin/guardrails/page.tsx`
- `apps/console/app/admin/case-types/page.tsx`
- `apps/console/app/admin/case-types/[name]/page.tsx`
- `apps/console/app/admin/knowledge/page.tsx`
- `apps/console/app/admin/integrations/page.tsx`
- `apps/console/app/admin/agent/page.tsx`
- `apps/console/app/admin/model/page.tsx`
- `apps/console/app/admin/memory/page.tsx`
- `apps/console/app/admin/playground/page.tsx`

### Frontend components (4)
- `apps/console/components/admin/version-context-bar.tsx`
- `apps/console/components/admin/agent-blueprint.tsx`
- `apps/console/components/admin/agent-config-drawer-ui.tsx`
- `apps/console/components/console-sidebar.tsx`

### i18n (1)
- `apps/console/lib/i18n/dictionaries.ts`

### Seed (2)
- `packages/shared/prisma/seed.ts`
- `packages/shared/prisma/seed-render-hints.ts`

### Deleted files (2)
- `apps/console/lib/agent/resolve-bindings.ts`
- `apps/console/components/admin/binding-column.tsx`

### Tests (~15)
- All `__tests__/` files for changed routes and pages

**Total: ~63 files**

---

## Verification Gate

### Phase 1 — Local
```
npx tsc --noEmit -p apps/console/tsconfig.json   # 0 errors
env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npm test   # all green
npm run build:console                             # success
```

### Phase 2 — Production
1. Deploy: `git push deploy main`
2. Health: `curl -s https://demo.anytrans.ai/api/health` → `{"status":"ok"}`
3. Login → verify all admin pages render
4. Create new agent → add tools/guardrails/case-types → verify isolated
5. Fork agent → verify sub-modules deep-copied
6. Playground → send message → verify agent uses only its own tools/policies

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| loop.ts ~1900 lines, touching it is fragile | Minimize changes to loop.ts — only change create() calls and deps |
| Skill → Tool rename is wide | Use grep-assisted systematic rename, verify with tsc |
| Fork deep-copy can fail partially | Wrap in Prisma transaction |
| Old CapabilityBindings remove breaks config-loader for in-flight agents | Config-loader reads by agentConfigId directly; no fallback needed |
| `agentConfigId` from `useSelectedAgentId()` may be null on first load | Guard: empty state with "Select an agent" prompt (matching model/memory pattern) |
| ChannelBinding migration: NULL agentName → agentConfigId | Migrate existing rows to the default agent for that org |
