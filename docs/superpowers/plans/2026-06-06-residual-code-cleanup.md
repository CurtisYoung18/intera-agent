# Residual Code Cleanup — Implementation Plan

> **Spec:** [`docs/superpowers/specs/2026-06-06-agent-scoped-architecture-design.md`](../specs/2026-06-06-agent-scoped-architecture-design.md)

**Goal:** Eliminate all 60 residual references to old naming (Skill→Tool, policyHooks, CapabilityBindings, orgId in agent contexts) found in the codebase audit.

**Architecture:** 10 sequential tasks, grouped by module to minimize conflicts. Each task self-contained — no file touched by more than one task.

---

### Task 1: CRITICAL — Runtime API Path Breakers

**Files:**
- `apps/console/app/admin/tools/page.tsx`
- `apps/console/components/admin/agent-human-interaction-panel.tsx`
- `apps/console/components/admin/sub-agent-form.tsx`
- `apps/console/components/admin/guardrail-summary-list.tsx`

- [ ] Fix `tools/page.tsx:176` — DELETE path:
```diff
- await apiClient(`/api/admin/skills/${encodeURIComponent(name)}`, { method: 'DELETE' })
+ await apiClient(`/api/admin/tools/${encodeURIComponent(name)}?agentConfigId=${encodeURIComponent(agentConfigId)}`, { method: 'DELETE' })
```

- [ ] Fix `agent-human-interaction-panel.tsx:33` — fetch path:
```diff
- fetch('/api/admin/skills').then(r => r.json()).then(d => d.data || d)
+ fetch(`/api/admin/tools?agentConfigId=${agentConfigId}`).then(r => r.json()).then(d => (d.data || d).tools || [])
```

- [ ] Fix `sub-agent-form.tsx:274` — add agentConfigId param:
Find the fetch call to `/api/admin/policies` and add `?agentConfigId=${agentConfigId}` query param. If `agentConfigId` is not available in scope, add it via `useSelectedAgentId()`.

- [ ] Fix `guardrail-summary-list.tsx:57` — same, add agentConfigId param.

- [ ] Fix `guardrail-summary-list.tsx:34-49` — `parseHookNames` reads deprecated `policyHooks` format. Rewrite to read from current agent's policies list fetched from `/api/admin/policies?agentConfigId=X`.

- [ ] Commit: `fix: CRITICAL — API path breakers (skills→tools, missing agentConfigId, dead policyHooks parsing)`

---

### Task 2: CRITICAL — Deprecated Field References

**Files:**
- `apps/console/components/admin/agent-flow.tsx`
- `apps/console/app/admin/agent/types.ts`
- `apps/console/app/api/admin/knowledge/gptbots/route.ts`
- `apps/console/app/admin/playground/page.tsx`

- [ ] Fix `agent-flow.tsx:134` — remove `policyHooks` textarea:
```diff
- <textarea value={config.policyHooks} onChange={e => update('policyHooks', e.target.value)} ... />
```
Delete the entire textarea block. Also remove any `policyHooks` references in the component's state/interface/props.

- [ ] Fix `agent/types.ts:57,61` — remove deprecated fields:
```diff
interface AgentConfigRow {
- policyHooks: string
- capabilityBindings?: string
  // ... keep all other fields
}
```

- [ ] Fix `gptbots/route.ts:51` — remove `policyHooks: '{}'` from the create data:
```diff
data: {
- policyHooks: '{}',
  // ... keep all other fields
}
```

- [ ] Fix `playground/page.tsx:337-352` — remove `policyHooks` parsing and `guardrailCount` from `policyHooks`:
```diff
- let policyHooks = '{}'
- try { policyHooks = typeof raw.policyHooks === 'string' ? raw.policyHooks : JSON.stringify(raw.policyHooks || {}, null, 2) } catch { policyHooks = '{}' }
```
Remove the `guardrailCount: countGuardrails(policyHooks)` line. Replace with fetching guardrail count from `/api/admin/policies?agentConfigId=X` or just show "—".

- [ ] Commit: `fix: remove deprecated policyHooks/capabilityBindings field references`

---

### Task 3: CRITICAL — Delete Dead Script

**Files:**
- Delete: `scripts/backfill-capability-bindings.ts`

- [ ] Delete the file:
```bash
rm scripts/backfill-capability-bindings.ts
```

- [ ] Commit: `chore: delete backfill-capability-bindings script (dead code)`

---

### Task 4: Types/Contracts Cleanup

**Files:**
- `packages/shared/contracts/tools.ts`
- `packages/shared/types/index.ts`

- [ ] Rename all types in `contracts/tools.ts`:
  - `skillItemSchema` → `toolItemSchema`
  - `SkillItem` → `ToolItem`
  - `skillsListResponseSchema` → `toolsListResponseSchema`
  - `SkillsListResponse` → `ToolsListResponse`
  - `skillCreateRequestSchema` → `toolCreateRequestSchema`
  - `SkillCreateRequest` → `ToolCreateRequest`
  - `skillCreateResponseSchema` → `toolCreateResponseSchema`
  - `SkillCreateResponse` → `ToolCreateResponse`
  - `skillGetResponseSchema` → `toolGetResponseSchema`
  - `SkillGetResponse` → `ToolGetResponse`
  - `skillUpdateRequestSchema` → `toolUpdateRequestSchema`
  - `SkillUpdateRequest` → `ToolUpdateRequest`
  - `skillUpdateResponseSchema` → `toolUpdateResponseSchema`
  - `SkillUpdateResponse` → `ToolUpdateResponse`
  - Update route comments in file header: `/api/admin/skills` → `/api/admin/tools`

- [ ] Update ALL consumers importing these types:
  - `apps/console/app/admin/tools/page.tsx:18` — `SkillsListResponse, SkillCreateResponse` → `ToolsListResponse, ToolCreateResponse`
  - `apps/console/app/api/admin/tools/route.ts` — import types
  - `apps/console/app/api/admin/tools/[name]/route.ts` — import types

- [ ] Fix `types/index.ts:254-256` — `denySkills`/`requireSkills`/`requireSkillsAny` → `denyTools`/`requireTools`/`requireToolsAny` in `GuardrailCheck`:
```diff
- denySkills?: string[]
- requireSkills?: string[]
- requireSkillsAny?: string[]
+ denyTools?: string[]
+ requireTools?: string[]
+ requireToolsAny?: string[]
```

- [ ] Fix `types/index.ts:245` — `GuardrailMatch.skills` → `GuardrailMatch.tools`:
```diff
interface GuardrailMatch {
- skills: string[]
+ tools: string[]
  ifPattern?: string
}
```

- [ ] Update ALL consumers of these renamed fields:
  - `apps/console/lib/agent/policy.ts` — `denySkills`→`denyTools`, `requireSkills`→`requireTools`, `requireSkillsAny`→`requireToolsAny`, `match.skills`→`match.tools`, `skillName`→`toolName`
  - `apps/console/app/admin/guardrails/page.tsx` — `denySkills`→`denyTools`, `requireSkills`→`requireTools`, `requireSkillsAny`→`requireToolsAny`, `match.skills`→`match.tools`, `HIGH_RISK_TOOLS` keep but dedup with policy.ts
  - `apps/console/lib/agent/__tests__/unit/guardrail-hook.test.ts` — update field names
  - `apps/console/lib/agent/__tests__/integration/playground-guardrail-trace.test.ts` — update field names

- [ ] Commit: `feat: rename contract types (Skill→Tool) + GuardrailCheck fields (Skills→Tools)`

---

### Task 5: File Renames

**Files to rename:**
- `apps/console/components/admin/skill-render-hints-editor.tsx` → `tool-render-hints-editor.tsx`
- `apps/console/components/admin/__tests__/skill-render-hints-editor.test.ts` → `tool-render-hints-editor.test.ts`
- `apps/console/lib/skill-classifications.ts` → `apps/console/lib/tool-classifications.ts`

- [ ] Rename files:
```bash
mv apps/console/components/admin/skill-render-hints-editor.tsx apps/console/components/admin/tool-render-hints-editor.tsx
mv apps/console/components/admin/__tests__/skill-render-hints-editor.test.ts apps/console/components/admin/__tests__/tool-render-hints-editor.test.ts
mv apps/console/lib/skill-classifications.ts apps/console/lib/tool-classifications.ts
```

- [ ] Rename exports in `tool-classifications.ts`:
  - `SYSTEM_SKILL_NAMES` → `SYSTEM_TOOL_NAMES`
  - `CHANNEL_SKILL_NAMES` → `CHANNEL_TOOL_NAMES`
  - `SPECIAL_SKILL_NAMES` → `SPECIAL_TOOL_NAMES`

- [ ] Rename component in `tool-render-hints-editor.tsx`:
  - `SkillRenderHintsEditor` → `ToolRenderHintsEditor`

- [ ] Update ALL imports:
  - `apps/console/app/admin/tools/page.tsx:14` — import path + component name
  - `apps/console/app/api/admin/tools/route.ts:12` — import path + export names
  - `apps/console/app/api/admin/tools/[name]/route.ts:12` — import path + export names

- [ ] Commit: `feat: rename files skill-*→tool-*, SKILL_NAMES→TOOL_NAMES`

---

### Task 6: Tools Page Internal Cleanup

**File:** `apps/console/app/admin/tools/page.tsx`

- [ ] Rename local types:
  - `interface SkillItem` → `interface ToolItem`
  - `SkillsPage` function → `ToolsPage`
  - `SkillsListResponse` → `ToolsListResponse`
  - `SkillCreateResponse` → `ToolCreateResponse`

- [ ] Rename all local variables:
  - `skill` → `tool` (throughout)
  - `skills` → `tools` (state array)
  - `viewSkill` → `viewTool`
  - `setSkills` → `setTools`
  - `allSkills` → `allTools`
  - `setViewSkill` → `setViewTool`

- [ ] Commit: `refactor: rename Skill→Tool in tools page internals`

---

### Task 7: Policy/Guidelines Runtime Naming

**Files:**
- `apps/console/lib/agent/policy.ts`
- `apps/console/app/admin/guardrails/page.tsx`

- [ ] Fix `policy.ts`:
  - `HIGH_RISK_SKILLS` → `HIGH_RISK_TOOLS` (consolidate with guardrails page)
  - `policy.skillName` in `PolicyContext` → `toolName`
  - `match.skills` → `match.tools` (from Task 4 types change)
  - `denySkills`→`denyTools`, `requireSkills`→`requireTools`, `requireSkillsAny`→`requireToolsAny`
  - `SAFE_TOOL_ALLOWLIST` is already correct ✅
  - Template placeholders in `evaluateAt`: `{{skill_name}}`→`{{tool_name}}`, `{{skill_output}}`→`{{tool_output}}`, `{{skills_called}}`→`{{tools_called}}`
  - `skillResults`→`toolResults`, `skillsCalled`→`toolsCalled` in context object

- [ ] Fix `guardrails/page.tsx`:
  - `PLACEHOLDERS` array: `{{skill_name}}`→`{{tool_name}}`, `{{skill_input}}`→`{{tool_input}}`, `{{skill_output}}`→`{{tool_output}}`, `{{skills_called}}`→`{{tools_called}}`
  - `legacyRule` in `handleSave`: `hook_skills`→`hook_tools`, `deny_skills`→`deny_tools`, `require_skills`→`require_tools`, `require_skills_any`→`require_tools_any`
  - Remove `deny_skills` etc. from guardrail-summary-list.tsx if still present

- [ ] Commit: `refactor: rename Skill→Tool in policy engine + guardrails page`

---

### Task 8: Leftover Dead Code Removal

**Files:**
- `apps/console/lib/livechat/channel-health.ts`
- `apps/console/app/api/ops/dashboard/route.ts`
- `apps/console/app/ops/dashboards/page.tsx`
- `apps/console/app/ops/guide/page.tsx`
- `apps/console/lib/agent/__tests__/integration/capability-bindings-e2e.test.ts` (if exists)

- [ ] Delete `channel-health.ts` and its import in `bridge.ts`:
```bash
rm apps/console/lib/livechat/channel-health.ts
```
Remove `import { markChannelUnhealthy, markChannelHealthy } from './channel-health'` from `bridge.ts`. If bridge.ts has `.catch(() => {})` guards, just delete the calls.

- [ ] Clean `ops/dashboard/route.ts` — remove `channelHealth` Promise.resolve and response key:
```diff
- // channelHealth model removed — channel health now tracked via channel_bindings
- Promise.resolve([]),
```
```diff
- channelHealth: (channelHealth as Array<{...}>).map(...)
```

- [ ] Clean `ops/dashboards/page.tsx` — remove `channelHealth` from state, fetch, and UI rendering.

- [ ] Fix `ops/guide/page.tsx:544` — `Skills (Tools)` → `Tools`. Fix lines 537, 545-574 documenting old API paths.

- [ ] Delete any remaining `capability-bindings-e2e.test.ts` or similar test files.

- [ ] Commit: `chore: remove dead code (channel-health stub, ops dashboard channelHealth, guide stale docs)`

---

### Task 9: Livechat Webhook Path Update

**Files:**
- `apps/console/app/api/livechat/webhook/[orgId]/[agentName]/route.ts`
- `apps/console/app/admin/channels/livechat/page.tsx`

- [ ] Rename directory:
```bash
mv apps/console/app/api/livechat/webhook/\[orgId\]/\[agentName\] apps/console/app/api/livechat/webhook/\[agentConfigId\]
```

- [ ] Update route handler — change parameter from `{ orgId, agentName }` to `{ agentConfigId }`:
```diff
- export async function POST(request: NextRequest, ctx: { params: Promise<{ orgId: string; agentName: string }> }) {
-   const { orgId, agentName } = await ctx.params
+ export async function POST(request: NextRequest, ctx: { params: Promise<{ agentConfigId: string }> }) {
+   const { agentConfigId } = await ctx.params
```

- [ ] Update `livechat/page.tsx:212,213,394` — webhook URL references from `[orgId]/[agentName]` to `[agentConfigId]`.

- [ ] Commit: `feat: update livechat webhook path to use agentConfigId`

---

### Task 10: i18n Text/Copy Cleanup

**File:** `apps/console/lib/i18n/dictionaries.ts`

- [ ] Fix English copy strings containing "skill" (not key names — key names are already correct):
  - `tools.mockPreviewEmpty`: "for this skill" → "for this tool"
  - `tools.criticalLocked`: "system skills" → "system tools"
  - `policies.llmDisabledHint`: "skill" references → "tool"
  - `policies.matchTools` description: "skills" → "tools"
  - `memory.skillResults`: key stays but EN copy should reference "tool results"
  - `agent.tokensSkill`: "Tokens/Skill" → "Tokens/Tool"

- [ ] Fix Chinese (zh) copy strings:
  - `tools.systemSkills` → "系统工具" (already correct? check)
  - `policies.denyTools`: "禁止的技能" → "禁止的工具"
  - `policies.matchTools`: "匹配技能" → "匹配工具"
  - `memory.skillResults`: "技能结果" → "工具结果"
  - Any other "技能" references → "工具"

- [ ] Fix `ops/guide/page.tsx:763` — `todo_write` reference (already deleted, update text)

- [ ] Commit: `chore: fix i18n copy — skill→tool in EN/ZH display text`

---

### Task 11: Final Verification

- [ ] Run tsc:
```bash
npx tsc --noEmit -p apps/console/tsconfig.json
```
Expected: 0 errors.

- [ ] Run tests:
```bash
env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npm test
```
Expected: all pass.

- [ ] Build:
```bash
npm run build:console
```
Expected: success.

- [ ] Deploy + re-seed + verify in production.

---

## File Change Audit

| Task | Modify | Delete | Rename |
|---|---|---|---|
| Task 1 | 4 | 0 | 0 |
| Task 2 | 4 | 0 | 0 |
| Task 3 | 0 | 1 | 0 |
| Task 4 | 12 | 0 | 0 |
| Task 5 | 2 | 0 | 3 |
| Task 6 | 1 | 0 | 0 |
| Task 7 | 2 | 0 | 0 |
| Task 8 | 4 | 2 | 0 |
| Task 9 | 2 | 0 | 1 |
| Task 10 | 1 | 0 | 0 |
| Task 11 | 0 | 0 | 0 |
| **Total** | **32** | **3** | **4** |
