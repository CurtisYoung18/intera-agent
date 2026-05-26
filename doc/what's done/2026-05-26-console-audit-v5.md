# Console Audit v5 — Implementation Plan

> **Source**: 2026-05-26 architecture audit conversation. Decisions locked via brainstorming.
> **Predecessor**: `doc/what's done/console-config-scope.md` (v4 — Skills tiers, Memory slider, Guardrails builder)
> **Status**: Ready for AI implementation.

---

## 0. Audit summary (what changes & why)

| # | Concern | Decision |
|---|---|---|
| 1 | Agent-config 6 satellites are not optimal | **Merge** prompt + model → "Brain". **Add** Sub-Agents satellite. **Rename** Policy → Guardrails, Templates → Human Ops. Per-card behavior split (drawer-edit vs read-only-summary). |
| 2 | Sidebar routes purpose & whether Human Ops needs its own page | **Add** `/admin/human-ops` (8th admin item). Document each existing route's purpose in code. |
| 3 | System skills are mis-classified | **Strict 7-skill system set**; everything else moves to Business. `kb_hybrid_retrieve` is a Special skill (toggle-only in Skills page, config in `/admin/knowledge`). |
| 4 | Integrations page UX (low density + invisible save button) | **Channels landing grid** with active LiveChat detail panel. **Fix save button** by replacing `bg-indigo-500` Tailwind-palette class with project token `bg-indigo`. |
| 5 | Policy → Guardrail rename and visualization | **Rename UI labels** (engine field stays `policyHooks` for compat). **Drawer becomes read-only chip summary**; full edit lives only on `/admin/policies`. Build sentence-style guardrail builder on the page. |

**Engine compatibility rule for the whole plan:** UI labels change; DB column names, Prisma fields, API contracts, and `intera-shared` types do NOT change. Renames are presentation-only via i18n keys.

---

## Phase A — Skill classification fix (lowest risk, unblocks everything else)

### A.1 Tighten the System skill set

**File**: [`apps/console/lib/skill-classifications.ts`](apps/console/lib/skill-classifications.ts)

Replace the current 23-name `BUILT_IN_SKILL_NAMES` set with the strict 7:

```ts
/** System Skills — engine-owned contracts. READ-ONLY in all fields. */
export const SYSTEM_SKILL_NAMES = new Set([
  'create_case',
  'finalize_case',
  'create_human_task',
  'finalize_sub_agent',
  'todo_write',
  'todo_read',
  'read_case_history',
])

/** Special Skill — appears in Skills page as toggle-only; configured in /admin/knowledge. */
export const SPECIAL_SKILL_NAMES = new Set(['kb_hybrid_retrieve'])
```

Remove `CRITICAL_SKILL_NAMES` (subsumed — every system skill is now critical).
Remove the old `BUILT_IN_SKILL_NAMES` alias.

### A.2 Update the Skills API to emit new flags

**File**: [`apps/console/app/api/admin/skills/route.ts`](apps/console/app/api/admin/skills/route.ts) — `GET` handler

```ts
const enriched = skills.map((s) => ({
  ...s,
  isSystem: SYSTEM_SKILL_NAMES.has(s.name),
  isSpecial: SPECIAL_SKILL_NAMES.has(s.name),
}))
```

Drop `isCritical` everywhere it appears.

### A.3 Update the Skills page UI

**File**: [`apps/console/app/admin/skills/page.tsx`](apps/console/app/admin/skills/page.tsx)

- Split filtered skills into three sections in this order: **System (7)** → **Special (1)** → **Business (rest)**.
- For System skills: lock the edit modal to read-only (`disabled` on every input). Only `enabled` toggle remains active.
- For Special (`kb_hybrid_retrieve`): show a "Configure in Knowledge Retrieval" CTA card. Disable the edit modal entirely. Only `enabled` toggle is interactive.
- For Business: unchanged (fully editable).

**Section headers** (i18n keys to add — see Phase F):
- `skills.systemSkills` → "System Skills" / "系统技能"
- `skills.specialSkills` → "Special" / "特殊技能"
- `skills.businessSkills` → existing

### A.4 Enforce read-only on the API side

**File**: [`apps/console/app/api/admin/skills/[name]/route.ts`](apps/console/app/api/admin/skills/[name]/route.ts) — `PUT`/`DELETE`

- If `SYSTEM_SKILL_NAMES.has(name)`: reject any mutation except `enabled` toggle. Return 403.
- If `SPECIAL_SKILL_NAMES.has(name)`: reject all mutations except `enabled` toggle. Return 403.
- `DELETE` on either set: return 403.

### A.5 Acceptance criteria for Phase A
- [ ] Skills page renders three labeled sections in correct order.
- [ ] System skill edit modal fields are all `disabled` except enabled toggle.
- [ ] `kb_hybrid_retrieve` shows "Configure in Knowledge Retrieval" link card; modal does not open or only opens read-only.
- [ ] Business skill (e.g. `get_account_status`) opens fully editable (this is the bug fix — it was incorrectly System before).
- [ ] PUT to `/api/admin/skills/create_case` with body changing `description` returns 403.
- [ ] PUT toggling `enabled` on a System skill succeeds.

---

## Phase B — Agent Config blueprint: 6-satellite recomposition

### B.1 Satellite definition table

**File**: [`apps/console/components/admin/agent-blueprint.tsx`](apps/console/components/admin/agent-blueprint.tsx)

Replace the current `satellites` array with these six (60° apart, same geometry):

| Order | id | Label key | Angle | Drawer behavior | On click |
|---|---|---|---|---|---|
| 1 | `brain` | `blueprint.nodeBrain` | -90 | Full editor | Open drawer |
| 2 | `memory` | `blueprint.nodeMemory` | -30 | Full editor | Open drawer |
| 3 | `guardrails` | `blueprint.nodeGuardrails` | 30 | **Read-only chip list** | Open drawer (read-only) |
| 4 | `subAgents` | `blueprint.nodeSubAgents` | 90 | **Read-only summary** | Open drawer (read-only) |
| 5 | `humanOps` | `blueprint.nodeHumanOps` | 150 | Full editor | Open drawer |
| 6 | `knowledge` | `blueprint.nodeKnowledge` | 210 | Full editor | Open drawer |

Type alias:
```ts
type Section = 'brain' | 'memory' | 'guardrails' | 'subAgents' | 'humanOps' | 'knowledge'
```

**Preview strings** (each card's one-liner under the label):
- `brain`: `${model} · T=${temperature} · prompt ${systemPromptLen} chars`
- `memory`: existing autocompact threshold
- `guardrails`: `${activeGuardrailCount} rules active` (parse `policyHooks` JSON, count top-level keys)
- `subAgents`: `${totalSubAgentCount} configured across ${caseTypeCount} case types` (fetched from `/api/admin/case-types`)
- `humanOps`: existing `humanOpsReady` / `notConfigured`
- `knowledge`: existing mode summary

### B.2 Drawer sections in agent page

**File**: [`apps/console/app/admin/agent/page.tsx`](apps/console/app/admin/agent/page.tsx)

Update `Section` type and `sectionMeta` to match the 6 ids above.

**Drawer body changes:**

- **`brain`** — new section, merges current `prompt` + `model` content. Layout: three labeled `DrawerSection` blocks inside the same drawer scroll:
  1. *Prompt* — `HighlightedTextarea` + placeholder chips + reset button (lifted from current `prompt` section).
  2. *Model* — model select + evaluationModel select (lifted from current `model` section).
  3. *Generation* — temperature slider + thinkingBudget / maxIterations / maxOutputTokens + `showThinking` checkbox.

- **`memory`** — unchanged.

- **`guardrails`** — **read-only**. Replace `AgentPolicyHooksPicker` with a `GuardrailSummaryList` component (see B.3). Add a "Edit on Policies page →" link button that navigates to `/admin/policies`.

- **`subAgents`** — **new, read-only**. Show a list grouped by case-type:
  ```
  withdrawal_issue
    └ withdrawal_verifier   (model: M2.7 · skills: 3)
    └ account_history_policy (model: M2.7 · skills: 2)
  deposit_issue
    └ order_verifier        (model: M2.7 · skills: 4)
  ```
  Data source: `GET /api/admin/case-types` already returns stages with `subAgents[]`.
  "Configure on Case Types page →" link to `/admin/case-types`.

- **`humanOps`** — unchanged content (the `AgentHumanInteractionPanel`). Just renamed from `templates`.

- **`knowledge`** — unchanged content. The drawer stays editable AND mirrors `/admin/knowledge`. Both surfaces write to the same `knowledgeRetrieval` JSON field via the existing PUT endpoint.

### B.3 New components

- **`apps/console/components/admin/guardrail-summary-list.tsx`** — parse `policyHooks` JSON and render plain-English chips for each rule. Each chip is non-interactive (no edit). Example chips:
  - `deny_skills:["refund_money","change_ban_status"]` → "Never allow: refund_money, change_ban_status"
  - `require_skills_any` + `hook_skills:["create_human_task"]` → "Before escalation: at least one of [query_order_status, get_account_status]"
  - Free-form `evaluationPrompt` → "AI evaluation: \"<first 80 chars>…\""
  Color: amber for `deny_*`, malachite for `require_*`, lavender for `evaluation*`.

- **`apps/console/components/admin/sub-agent-summary-list.tsx`** — fetches `/api/admin/case-types`, renders the tree shown above. Read-only.

### B.4 Removals (apply Phase A's "engine-internal becomes HARDCODE" rule)

In the agent-config drawer, remove these checkboxes/fields (they remain in DB but no UI):
- `prefixContinuationEnabled` + all `prefixContinuation*` fields. Delete the entire "Composer Assist (Beta)" `DrawerSection`.
- `enableLlmSanitization` (always-on, hardcoded).
- `debugMode` checkbox (developer-only, set via env var).

Keep `showThinking` — it moves into the new Brain → Generation sub-section.

### B.5 Acceptance criteria for Phase B
- [ ] Blueprint shows 6 labeled satellites at 60° intervals: Brain | Memory | Guardrails | Sub-Agents | Human Ops | Knowledge.
- [ ] Clicking Brain opens a drawer with three labeled sub-sections (Prompt / Model / Generation).
- [ ] Clicking Guardrails opens a drawer that lists chips, has no editable input, and shows "Edit on Policies page →".
- [ ] Clicking Sub-Agents opens a drawer that shows the per-case-type tree, has no editable input, and links to Case Types.
- [ ] The "templates" satellite is gone — replaced by "Human Ops" with identical content.
- [ ] Composer Assist section is gone from the Brain drawer.
- [ ] Saving a prompt change from the Brain drawer still hits the same `PUT /api/admin/agent` endpoint and the field is `systemPrompt`.

---

## Phase C — Sidebar IA + Human Ops page

### C.1 Add `/admin/human-ops` sidebar item

**File**: [`apps/console/components/console-sidebar.tsx`](apps/console/components/console-sidebar.tsx)

Insert into `ADMIN_ITEMS` between `policies` and `caseTypes`:

```ts
{ href: '/admin/human-ops', slug: 'humanOps', icon: HandPlatter /* lucide */, color: '#5bb8f7' },
```

Add `'humanOps'` to the `NavSlug` union.

i18n: add `sidebar.humanOps` → "Human Ops" / "人工配置".

### C.2 New page `/admin/human-ops`

**File**: `apps/console/app/admin/human-ops/page.tsx` (new)

Hosts the same two fields as the agent-config drawer:
- `consultationPrompt` (textarea with placeholder chips)
- `humanSkills` (comma-separated input, or chip-editor)

Reuses [`apps/console/components/admin/agent-human-interaction-panel.tsx`](apps/console/components/admin/agent-human-interaction-panel.tsx) — just embed it on a full-width page with header.

Both this page and the drawer write to the same `PUT /api/admin/agent` endpoint; mirroring is by virtue of using the same backing fields.

### C.3 Sidebar route purpose documentation

**File**: top of `apps/console/components/console-sidebar.tsx` (header comment)

Add a comment block above `OPS_ITEMS` documenting what each route is for, so AI implementers / future maintainers don't repeat this audit:

```
/**
 * Console route map (purpose, not just label):
 *
 * OPS — day-to-day:
 *   /ops/chats         Live conversation viewer + per-case trace.
 *   /ops/human-tasks   Queue of escalations awaiting human action.
 *   /ops/guide         Operator onboarding / runbook.
 *
 * ADMIN — configuration:
 *   /admin/agent           Agent blueprint (prompt, model, memory, guardrail-summary,
 *                          sub-agent-summary, human-ops, knowledge). Single-customer scope.
 *   /admin/skills          System (read-only 7) + Special (kb_hybrid_retrieve) + Business skills.
 *   /admin/policies        Guardrails canonical editor (sentence-builder + advanced JSON).
 *                          Agent-config "Guardrails" satellite is a read-only mirror.
 *   /admin/case-types      Stage / SOP definitions, sub-agent configuration.
 *                          Agent-config "Sub-Agents" satellite is a read-only mirror.
 *   /admin/routing         Channel → case-type routing rules.
 *   /admin/knowledge       Knowledge sources + GPTBots API key + retrieval params.
 *                          Mirrored from agent-config "Knowledge" satellite.
 *   /admin/human-ops       Consultation prompt + human skills allowed list.
 *                          Mirrored from agent-config "Human Ops" satellite.
 *   /admin/integrations    Channel integrations (LiveChat active; Slack/Discord placeholders).
 */
```

### C.4 Acceptance criteria for Phase C
- [ ] Sidebar shows 8 admin items, with Human Ops between Policies and Case Types.
- [ ] Navigating to `/admin/human-ops` shows the form, prefilled from the current agent config.
- [ ] Editing on `/admin/human-ops` and saving updates the same field a Brain-drawer edit would.
- [ ] Sidebar header comment present.

---

## Phase D — Guardrails (rename + read-only mirror + canonical editor)

### D.1 UI rename only

**Files**: i18n dictionaries.

- Add `sidebar.guardrails` → "Guardrails" / "护栏" (keep old `sidebar.policies` key as alias for one cycle to avoid breaking deep links).
- Add `blueprint.nodeGuardrails` → "Guardrails" / "护栏".
- Update `agent.section.policy` → renamed key `agent.section.guardrails`.

**No DB or API field rename.** `policyHooks` stays. Engine code untouched.

### D.2 `/admin/policies` becomes the canonical Guardrails editor

**File**: [`apps/console/app/admin/policies/page.tsx`](apps/console/app/admin/policies/page.tsx)

Add a "Guardrail Builder" section above the existing list. Builder has three sentence templates that compile to `policyHooks` JSON entries:

1. **"Must call [skills] before [trigger skill]"** → emits
   `{ hook: 'preTool', rule: { hook_skills:[trigger], require_skills_any:[skills] } }`
2. **"Never allow [skills]"** → emits
   `{ hook: 'preTool', rule: { deny_skills:[skills] } }`
3. **"AI evaluates: [evaluationPrompt]"** → emits
   `{ hook: 'preFinalize', rule: { enableLlm: true, evaluationPrompt: '...' } }`

Each sentence-builder row has skill multi-select pickers (sourced from `/api/admin/skills`) and inline preview of the generated JSON for transparency. Save commits to the existing `policyHooks` field.

The existing raw JSON editor remains below as "Advanced".

### D.3 Agent-config Guardrails drawer (read-only chip viewer)

Already specified in B.2 / B.3 — chip list + jump link.

### D.4 Acceptance criteria for Phase D
- [ ] All user-facing labels say "Guardrails" / "护栏"; engine field unchanged.
- [ ] `/admin/policies` shows sentence-builder above the JSON editor.
- [ ] Creating a rule via sentence-builder produces a valid `policyHooks` entry recognized by the engine.
- [ ] Agent-config drawer shows that same rule as a chip immediately after page reload.

---

## Phase E — Integrations page UX overhaul

### E.1 Fix the invisible save button (token mismatch)

**File**: [`apps/console/app/admin/integrations/page.tsx`](apps/console/app/admin/integrations/page.tsx)

Replace `bg-indigo-500` and `hover:bg-indigo-600` with project tokens used elsewhere in the console. Reference: the Agent retry button uses `bg-indigo/[0.08] border border-indigo/20 text-indigo`. For a primary action button, use:

```tsx
className="flex items-center gap-2 px-5 py-2.5 bg-indigo text-white text-[13px] font-semibold rounded-xl hover:bg-indigo/90 disabled:opacity-40 transition-colors"
```

Same fix for `bg-indigo-500` on the password modal's submit (sidebar).

### E.2 Channels landing layout

Restructure the page from "single 576px form" to "two-region layout":

```
┌──────────────────────────────────────────────────────────┐
│ Header (icon + title + subtitle)                         │
├──────────────────────────────────────────────────────────┤
│ Channels                                                 │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐     │
│ │ LiveChat │ │ Slack    │ │ Discord  │ │ WhatsApp │     │
│ │ ✓ Active │ │ Coming…  │ │ Coming…  │ │ Coming…  │     │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘     │
├──────────────────────────────────────────────────────────┤
│ LiveChat detail panel (expanded when LiveChat selected)  │
│ ┌─────────────────────────┬──────────────────────────┐   │
│ │ Connection              │ Behavior                 │   │
│ │  · Enable               │  · Show skill status     │   │
│ │  · License ID           │  · (future: channel→     │   │
│ │  · Bot Access Token     │     skill binding)       │   │
│ │  · Webhook URL (RO)     │                          │   │
│ └─────────────────────────┴──────────────────────────┘   │
│                                              [Save ↻]    │
└──────────────────────────────────────────────────────────┘
```

- Channel cards: `bg-white/60 backdrop-blur-xl border border-black/[0.05] rounded-2xl p-5`, with status pill.
- Inactive channels: greyed out + "Coming soon" pill. Tooltip "Available in a future release".
- LiveChat card is selected by default. Selection state is local (no URL param needed).
- Detail panel: `max-w-4xl`, two-column grid (`md:grid-cols-2 gap-6`).
- Save button: sticky-bottom inside the detail panel, with `Save | Saved ✓ | Error` states (existing logic).

### E.3 Acceptance criteria for Phase E
- [ ] Page no longer leaves ~2/3 of the screen empty on a 1440px display.
- [ ] LiveChat channel card shows "Active" pill in lavender or malachite; other three show "Coming soon" in grey.
- [ ] Save button is clearly visible (indigo background, white text) before, during, and after click.
- [ ] All existing functionality (load config → edit → save → toast) works unchanged.

---

## Phase F — i18n / cleanup

### F.1 i18n keys to add (en + zh)

```
blueprint.nodeBrain      = "Brain"             / "大脑"
blueprint.nodeGuardrails = "Guardrails"        / "护栏"
blueprint.nodeSubAgents  = "Sub-Agents"        / "子代理"
blueprint.nodeHumanOps   = "Human Ops"         / "人工"   (already exists)
sidebar.humanOps         = "Human Ops"         / "人工"
sidebar.guardrails       = "Guardrails"        / "护栏"   (alias of sidebar.policies during deprecation)
skills.systemSkills      = "System Skills"     / "系统技能"  (already exists)
skills.specialSkills     = "Special"           / "特殊技能"
skills.configureInKnowledge = "Configure in Knowledge"  / "在知识检索中配置"   (already exists)
agent.section.guardrails = "Guardrails"        / "护栏"  (replaces agent.section.policy)
agent.section.brain      = "Brain"             / "大脑"  (replaces agent.section.prompt + agent.section.model)
agent.section.subAgents  = "Sub-Agents"        / "子代理"
guardrails.builder.title = "Guardrail Builder" / "护栏构建器"
guardrails.builder.must  = "Must call … before …"  / "调用 … 之前必须调用 …"
guardrails.builder.deny  = "Never allow …"     / "禁止 …"
guardrails.builder.llm   = "AI evaluates …"    / "AI 评估 …"
```

### F.2 Files to delete

- `apps/console/components/admin/agent-policy-hooks-picker.tsx` — replaced by `guardrail-summary-list.tsx` (read-only) + sentence-builder on policies page.
- `apps/console/components/admin/agent-synthetic-templates-panel.tsx` — only referenced by old "templates" satellite (verify with grep before delete).

### F.3 Engine code that does NOT change

For clarity to the implementer:
- `packages/shared/defaults/index.ts` — DEFAULT_SKILLS array untouched.
- `apps/chat/src/loop/*` — case loop untouched.
- DB schema — no migration. `policyHooks` column stays `policyHooks`.
- `/api/admin/agent` PUT contract — same JSON body shape.

---

## Phase ordering & risk

| Phase | Risk | Order |
|---|---|---|
| A — Skills classification | Low (data-classification + UI gating) | First — landmines for everything else |
| C — Sidebar + human-ops page | Low (additive) | 2nd |
| E — Integrations UX | Low (presentation only) | Can run in parallel with C |
| D — Guardrails rename + builder | Medium (sentence→JSON compiler) | 3rd |
| B — Blueprint recompose | Medium (touches drawer + adds 2 components) | 4th — depends on D's chip viewer + C's human-ops page |
| F — i18n + cleanup | Low | Last sweep |

---

## Open follow-ups (NOT in this plan — for a later cycle)

1. **Per-case-type sub-agent editor** on `/admin/case-types` (v4 P2). Currently sub-agent satellite only displays; editing is JSON.
2. **`channelSkillBinding`** on integrations (v4 P3). Reserved slot in the right column of the LiveChat detail.
3. **Composer Assist** standalone page if you want to keep that feature (currently slated for removal in B.4 — confirm before deleting code).

---

## Hand-off note for the implementer

- Touch only what each phase lists. Do not refactor adjacent files.
- Run `pnpm -F console typecheck` after each phase before moving to the next.
- For Phase A, write a quick integration test hitting `PUT /api/admin/skills/create_case` with a non-`enabled` field change to confirm the 403.
- For Phase B, the angles in [`agent-blueprint.tsx`](apps/console/components/admin/agent-blueprint.tsx) must stay multiples of 60° to preserve geometry.
- Use the project color tokens (`indigo`, `lavender`, `malachite`, `amber`, `vermillion`, `sky`, `teal-500`, `--mist`, `--fog`, `--smoke`). Avoid Tailwind palette values like `indigo-500` — they are not in the project palette and render unstyled (this is the integrations save-button bug root cause).
