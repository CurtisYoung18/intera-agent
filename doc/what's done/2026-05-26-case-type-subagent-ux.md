# Case Type & Sub-Agent UX — Mode-Aware Redesign

> **Addendum to** [`doc/what's done/2026-05-26-console-audit-v5.md`](../what's%20done/2026-05-26-console-audit-v5.md).
> **Triggered by**: dual-mode design decision (2026-05-26) — `executionMode: 'stage' | 'cc'`.
> **Status**: ready for impl. Can land in parallel with console-audit-v5's other phases.

---

## 0. Why this exists

The original console-audit-v5 plan added a Sub-Agents satellite to Agent Config but left the editor question unresolved. That was OK when stage mode was the only design. Now that we're committing to two execution modes, the case-type UX has to clarify *where* sub-agents are configured per mode:

| Mode | Sub-agent definitions live in | Editor location |
|---|---|---|
| `'stage'` | `StageConfig.subAgents[]` inside the case type | **Case Type detail page**, per-stage panel |
| `'cc'` | A new global registry | **`/admin/sub-agents`** page |

Today the Sub-Agents satellite *displays* per-stage sub-agents (read from `StageConfig.subAgents`), but operators can't actually edit them anywhere with a real UI — config is JSON-only. This addendum fixes that gap and prepares the cc-mode editor.

---

## 1. Case Type detail page redesign

### 1.1 Page sections (top to bottom)

```
┌─ Case Type: withdrawal_issue ─────────────────────────────┐
│ Display name: 提现问题      Execution mode: [Stage ▾]     │
│ Required facts: [chip-editor: amount, txnId, channel]     │
│ Escalate on:    [chip-editor: max_nudges, missing_facts]  │
│ Resolution template: [textarea]                           │
│ Blocker prompt:      [textarea]                           │
├───────────────────────────────────────────────────────────┤
│ Lifecycle                                                 │
│ Stages: created → collecting → investigating → resolved  │
│ (drag to reorder; click a stage to expand its panel)     │
├───────────────────────────────────────────────────────────┤
│ Per-stage panel (one per stage, collapsible)             │
│  ┌─ Stage: investigating ──────────────────────────────┐ │
│  │ Stage prompt: [textarea]                            │ │
│  │ Required tools to advance: [skill multi-select]     │ │
│  │ Nudge prompt: [textarea]                            │ │
│  │                                                     │ │
│  │ ── Sub-agents on entry (mode = stage only) ─────── │ │
│  │  ┌──────────────────────────────────────────────┐ │ │
│  │  │ withdrawal_verifier                          │ │ │
│  │  │   model:            [MiniMax-M2.7 ▾]         │ │ │
│  │  │   max iterations:   [3]    ☑ parallel        │ │ │
│  │  │   allowed skills:   [chip-editor]            │ │ │
│  │  │   system prompt:    [textarea]               │ │ │
│  │  │   task checklist:   [structured editor*]     │ │ │
│  │  │   [Remove from stage]                        │ │ │
│  │  └──────────────────────────────────────────────┘ │ │
│  │  ┌──────────────────────────────────────────────┐ │ │
│  │  │ history_reviewer …                            │ │ │
│  │  └──────────────────────────────────────────────┘ │ │
│  │  [+ Add inline] [+ Pick from registry…]           │ │
│  │  (the second option appears only after /admin/    │ │
│  │   sub-agents has ≥1 entry — see §2)               │ │
│  └─────────────────────────────────────────────────────┘ │
├───────────────────────────────────────────────────────────┤
│ Sub-agent suggestions (mode = cc only)                   │
│   ☑ withdrawal_verifier                                   │
│   ☑ history_reviewer                                      │
│   ☐ order_verifier                                        │
│   Edit registry → /admin/sub-agents                      │
│   Suggestions appear in the main agent's prompt as       │
│   preferred candidates; model can still pick any         │
│   registered agent.                                       │
└───────────────────────────────────────────────────────────┘
```

`* task checklist structured editor`: three sub-fields — `requiredChecks: string[]`, `outputFormat: string`, `rules: string[]`. Same shape as [`ChecklistPolicy`'s constructor](apps/chat/lib/agent/policies/checklist-policy.ts) expects today.

### 1.2 Mode toggle behavior

When the operator switches `executionMode` between `'stage'` and `'cc'`:

- Switch `stage → cc`: warn modal — *"Stage-mode sub-agent configs will be archived to the case type's JSON metadata but no longer dispatched. Switch?"*. Do **not** auto-delete the `StageConfig.subAgents[]` data; copy it to a `_archivedSubAgents` field for rollback.
- Switch `cc → stage`: warn modal — *"You'll need to assign sub-agents per stage. Existing sub-agent suggestions will be saved to the case type's metadata for reference."*. Same archive-don't-delete pattern.

### 1.3 Data shape (no schema change yet)

Both modes reuse the existing `CaseType.stages` + `CaseType.stageConfigs` JSON. Mode toggle controls UI; the engine reads `executionMode` to decide dispatch behavior.

```
CaseType {
  id, type, displayName, ...
  executionMode: 'stage' | 'cc'           // existing field, used today
  stages: string[]
  stageConfigs: {
    [stageName]: {
      prompt, requiredTools, nudgePrompt, ...
      subAgents: SubAgentConfig[]         // populated when mode = stage
    }
  }
  // NEW (cc mode only)
  ccSuggestedSubAgents?: string[]         // names from /admin/sub-agents registry
}
```

When mode = `cc`, `stageConfigs.*.subAgents` is ignored by the engine (but preserved for rollback). When mode = `stage`, `ccSuggestedSubAgents` is ignored.

---

## 2. `/admin/sub-agents` registry page (cc-mode)

### 2.1 When does this page appear in the sidebar?

The sidebar item is hidden until at least one case type has `executionMode = 'cc'`. Once visible, it shows the list of registered sub-agents and an editor.

Rationale: avoid adding a 9th sidebar admin item that's empty for stage-only deployments. Keeps the IA clean for compliance-heavy customers who never use cc mode.

Implementation: `console-sidebar.tsx` reads a customer-scoped flag derived from `prisma.caseType.findMany({ where: { executionMode: 'cc' }, take: 1 })` cached for the session.

### 2.2 List page

```
┌─ Sub-agent registry ──────────────────────────────────────┐
│ [+ New sub-agent]                                          │
│                                                            │
│ ┌─ withdrawal_verifier ────────────────────────────────┐  │
│ │ Description: Verifies withdrawal status against …    │  │
│ │ Model: M2.7  · Tools: 2  · Max iter: 3                │  │
│ │ Used by: withdrawal_issue (suggested)                 │  │
│ │ [Edit] [Duplicate] [Delete]                           │  │
│ └───────────────────────────────────────────────────────┘  │
│ ┌─ history_reviewer …                                  ┐  │
│ └───────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

### 2.3 Edit page — nine fields (matches what S4's `dispatch_subagent` tool will consume)

| Field | Type | Notes |
|---|---|---|
| `name` | text, slug | Unique. Used as the `agentName` argument to the dispatch tool. |
| `description` | one-line text | One line. Shown in the main agent's prompt — model uses this to decide dispatch. Keep under 120 chars. |
| `model` | model select | Per-agent override; defaults to main agent's `model`. |
| `allowedTools` | skill multi-select | Subset of customer's skills. High-risk skills (refund_money etc.) are pre-disabled in the picker. |
| `maxIterations` | number, default 5 | Hard cap. |
| `systemPrompt` | textarea | The behavior spec. Bulk of the editing time. |
| `taskChecklist` | optional structured editor | `{ requiredChecks: string[]; outputFormat: string; rules: string[] }`. Optional — leave blank for free-form sub-agents. |
| `outputContract` | radio | `'standard'` (returns `{ findings, evidence, recommendation }` matching today's `SubAgentResult`) or `'custom'` (provide JSON schema; reserved for future). For v1, `standard` only — `custom` greyed out with "coming soon". |
| `guardrailOverrides` | structured editor | Inherit-with-override. See §2.5 below. |

### 2.4 Sub-agent edit page — Guardrails section (new)

Sub-agents inherit the customer's global guardrail set (`policyHooks`). The Guardrails section on the sub-agent edit page lets operators disable specific inherited rules and add sub-agent-specific rules.

**UI layout** (lives below `outputContract` in the form):

```
── Guardrails for this sub-agent ─────────────────────────────
Inherited from global (5):
  ☑ no_high_risk_account_change         [Disable for this sub-agent]
  ☑ investigate_before_escalation       [Disable for this sub-agent]
  ☐ must_cite_basis                     (disabled here)  [Re-enable]
  ☑ evidence_required_before_resolution [Disable for this sub-agent]
  ☑ conflict_requires_human             [Disable for this sub-agent]

Sub-agent-specific rules (1):
  • no_call_main_lifecycle_tools        [Edit] [Delete]
  [+ Add guardrail]   ← opens the same sentence-builder used on /admin/policies
```

**Data shape** persisted as JSON on the registry row:

```ts
guardrailOverrides?: {
  disabled: string[]      // global guardrail names this sub-agent opts out of
  added:    PolicyRule[]  // sub-agent-specific rules — same shape as global PolicyRule
}
```

**Stale-reference handling**: when a global guardrail is renamed or deleted in `/admin/policies`, any sub-agent whose `disabled[]` referenced it shows a yellow "stale: <name>" chip with a one-click "remove from disabled list" affordance. The engine treats stale disabled-references as no-ops.

**Reuse**: the "+ Add guardrail" button opens the sentence-builder component from console-audit-v5 Phase D (`/admin/policies` page's guardrail builder). Same component, embedded inline. The "Edit" / "Delete" controls on added rules use the same sentence-builder for editing.

### 2.5 The same pattern applies in stage mode

Stage-mode sub-agents (defined inline in `StageConfig.subAgents[]`) get the same `guardrailOverrides` field. The §1.1 stage-mode editor's sub-agent panel includes a collapsible "Guardrails" section identical in shape to §2.4 above.

This guarantees: regardless of where a sub-agent is configured (registry for cc mode, StageConfig for stage mode), the operator's mental model and the engine's behavior are the same.

### 2.6 Data shape (new table)

```
SubAgentRegistry {
  id                  String  @id
  customerId          String
  name                String
  description         String
  model               String
  allowedTools        String  // JSON: string[]
  maxIterations       Int     @default(5)
  systemPrompt        String  // Text
  taskChecklist       String? // JSON: { requiredChecks, outputFormat, rules } | null
  outputContract      String  @default("standard")
  guardrailOverrides  String? // JSON: { disabled: string[]; added: PolicyRule[] } | null
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  @@unique([customerId, name])
}
```

Migration: one new table, no changes to existing tables. Safe to land before any case type adopts cc mode.

---

## 3. Agent Config Sub-Agents satellite — mode-aware summary

Per console-audit-v5 Phase B, the satellite is read-only. This addendum specifies its behavior across both modes:

### 3.1 Summary content

- For each case type, group by `executionMode`.
- Stage-mode case types: show "case_type → stage → [sub-agent list]" tree.
- CC-mode case types: show "case_type → [suggested registry sub-agents]" list.
- If the customer has ≥1 cc-mode case type: also show "Registry" section with a count of registered sub-agents.

```
Sub-Agents
├ withdrawal_issue (stage)
│ └ investigating
│   ├ withdrawal_verifier   [M2.7 · 3 turns · parallel]
│   └ history_reviewer      [M2.7 · 2 turns · parallel]
├ refund_issue (cc)
│ └ Suggested: refund_validator, kyc_checker
└ Registry: 5 sub-agents → /admin/sub-agents
```

### 3.2 Click behavior

- Click a stage-mode sub-agent chip → navigate to `/admin/case-types/<id>`, scroll to and expand that stage panel.
- Click a cc-mode suggestion chip → navigate to `/admin/sub-agents/<name>` edit page.
- Click "Registry: N sub-agents" → navigate to `/admin/sub-agents` list.

The satellite is purely a dashboard — no edit affordances.

---

## 4. Acceptance criteria

### 4.1 Stage-mode (most urgent — fixes the existing UX confusion)
- [ ] Case Type detail page shows the per-stage editor block when `executionMode === 'stage'`.
- [ ] Operator can add/edit/remove sub-agents on a stage; persists to `StageConfig.subAgents[]`.
- [ ] Sub-agent edits round-trip through `/api/admin/case-types` PUT (existing endpoint).
- [ ] Sub-Agents satellite in Agent Config navigates to the right case type + stage on click.

### 4.2 CC-mode (gated on S4 introducing `executionMode: 'cc'`)
- [ ] `/admin/sub-agents` page renders for customers with ≥1 cc-mode case type; hidden otherwise.
- [ ] Create/edit/duplicate/delete sub-agent in the registry persists to the new `SubAgentRegistry` table.
- [ ] Case Type detail page shows the suggestions checkbox panel when `executionMode === 'cc'`.
- [ ] Switching mode warns about archive behavior; data is preserved, not deleted.

### 4.3 Both
- [ ] Sub-agent edits trigger config-cache invalidation so the engine picks them up without restart (existing `config-changed` POST pattern).
- [ ] Switching `executionMode` doesn't lose any data — the unused side's config is archived in a `_archived` field.

---

## 5. File map

### New
- `apps/console/app/admin/sub-agents/page.tsx` — registry list.
- `apps/console/app/admin/sub-agents/[name]/page.tsx` — registry edit.
- `apps/console/app/api/admin/sub-agents/route.ts` — list + create.
- `apps/console/app/api/admin/sub-agents/[name]/route.ts` — get + update + delete.
- `apps/console/components/admin/case-type-stage-panel.tsx` — per-stage editor (stage mode).
- `apps/console/components/admin/case-type-cc-panel.tsx` — suggestions picker (cc mode).
- `apps/console/components/admin/sub-agent-form.tsx` — shared 8-field form, used by both inline (stage) and registry (cc) editors.
- `packages/shared/prisma/migrations/<timestamp>_subagent_registry/` — new table.

### Modified
- `apps/console/app/admin/case-types/[id]/page.tsx` — wraps the existing detail page with the mode-aware sections.
- `apps/console/components/admin/sub-agent-summary-list.tsx` (planned in console-audit-v5 B.3) — implements the §3.1 grouped view.
- `apps/console/components/console-sidebar.tsx` — conditional show of "Sub-Agents" admin item.

### Untouched
- Engine code (`apps/chat/lib/agent/*`) — engine doesn't read the registry until S4 lands the `dispatch_subagent` tool. Until then the registry is a no-op for cc mode.
- `prisma.schema` for case types — `executionMode` already exists.

---

## 6. Ordering

| Sub-phase | Depends on | Effort |
|---|---|---|
| Stage-mode editor (§1.1 stage parts + §3 satellite click-through) | console-audit-v5 Phase B (blueprint recompose) | 1 week |
| Registry table + page skeleton (§2 list + edit, no engine wiring) | nothing | 1 week |
| CC-mode case-type panel (§1.1 cc parts, suggestions picker) | Registry table exists | 0.5 week |
| Engine wires registry into `dispatch_subagent` tool | **S4** | (deferred) |

The stage-mode editor is the highest-priority piece because it fixes today's "sub-agents appear but I can't edit them" UX. The cc-mode parts are scaffolding that's safe to ship dark.

---

## 7. Risk + rollback

**Risk 1**: operators switch mode and lose configs. *Mitigation*: archive, never delete. Add a "Restore archived config" affordance on each detail page.

**Risk 2**: the new `SubAgentRegistry` table sits empty for stage-only customers and looks like dead schema. *Mitigation*: it's tiny and additive. No cost to keeping it migrated.

**Risk 3**: the Sub-Agents satellite click-through tries to navigate to a stage that no longer exists (stage renamed). *Mitigation*: graceful fallback to case-type root + a "couldn't find stage X" inline message.

**Rollback**: stage-mode editor changes are UI-only; revert the PR. Registry table migration is non-destructive; column rollback unnecessary.

---

## 8. Hand-off to implementer

Order of work:
1. **Stage-mode editor first.** It's the immediate UX fix. Read [`apps/console/app/admin/case-types/page.tsx`](apps/console/app/admin/case-types/page.tsx) (or whichever the current detail page is) and embed the per-stage editor. Use the shared `sub-agent-form.tsx` from the outset so the registry editor reuses it.
2. **Registry table + page** can land in parallel since it touches no shared code with #1.
3. **Mode toggle warnings** ship with #1 (the data archive logic is small).
4. **CC suggestions panel** ships with #2.
5. **Satellite click-through** ships bundled with console-audit-v5 Phase B (the blueprint recompose).

Do NOT do these in the same PR:
- Wire engine to read the registry (that's S4 — `dispatch_subagent` tool).
- Add new sub-agent abilities (output schema customization etc.) — keep v1 scope tight.
