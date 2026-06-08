> **Historical receipt note (2026-06-08):** This file is preserved as past-work evidence. It may contain old terms such as `Skill`, `Policy`, `Guardrail`, `stage`, or `sub-agent`, and some files still read like implementation plans. Do not dispatch new work from this file. Current work starts at [../README.md](../README.md), [../handoffs/MASTER_BUILD_HANDOFF.md](../handoffs/MASTER_BUILD_HANDOFF.md), and [../to-do/2026-06-08-foundation-reset-domain-model.md](../to-do/2026-06-08-foundation-reset-domain-model.md).

# Memory / Compact Three-Layer Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Lanes A–D are independent and may be dispatched in parallel; the **Contract** section below is the shared interface all lanes import — implement it first (Task 0) and do not let any lane redefine it.

**Goal:** Rebuild Intera's conversation memory into three cleanly-separated layers (working context / case memory / cross-chat user profile) so that each layer's summary shape matches its purpose, compaction actually fires, and the cross-chat user profile is a reliable, structured, auto-injected long-term memory.

**Architecture:** Today one prompt (`COMPACT_SYSTEM_PROMPT`) and one function (`compactConversation`) serve both the intra-case L2 summary and the cross-chat L3 profile, with a regex merger (`mergeProfile`) that parses a format the prompt never emits. We split into two purpose-built prompts behind one shared format contract, fix the threshold model so autocompaction triggers at realistic conversation lengths, store the L3 profile as structured sections (not free-form Markdown), auto-inject the profile at case open, and stabilize the identity key so anonymous visitors accumulate across chats. The dead `apps/chat` proxy is removed.

**Tech Stack:** TypeScript, Next.js (App Router, Node runtime), Prisma + Postgres (SQLite dev), Anthropic SDK (multi-provider: MiniMax / DeepSeek), Vitest.

---

## Why this plan exists (defect summary — verify, don't trust)

| ID | Defect | Evidence |
|---|---|---|
| P0-1 | Autocompaction effectively never fires: `autocompact` needs `used ≥ 140K` tokens, unreachable with `l1MaxMessages=12`. | [memory.ts:290](../../apps/console/lib/agent/memory.ts) `assessCompaction`; defaults `autocompactThresholdTokens:40000`, `contextWindow:200000` |
| P0-2 | The compaction prompt is a *user portrait* but used for *intra-case* compression; it explicitly de-prioritizes the case state the agent needs. | [compact.ts:21-40](../../apps/console/lib/agent/compact.ts); used by `performCompaction` [loop.ts:1626](../../apps/console/lib/agent/loop.ts) |
| P0-3 | `mergeProfile` parses `## Identity / ## Activity` but the prompt emits `1. Who / 4. This Session`; structured merge silently degrades to a 500-char dump; no dedup; truncation drops the section it claims to protect. | [mergeProfile.ts](../../packages/shared/memory/mergeProfile.ts) |
| P1-1 | "Compact Chat" ops button is broken: relative `fetch('/api/internal/compact-chat')` throws in Node → 502. Vestige of deleted `apps/chat`. | [compact/route.ts:16](../../apps/console/app/api/chats/[chatId]/compact/route.ts) |
| P1-2 | L3 profile is written on every terminal/escalation but only read when the model calls `read_user_profile`; no auto-priming. | [loop.ts:1289](../../apps/console/lib/agent/loop.ts) |
| P1-3 | Anonymous/UUID visitors fall back to `chat:<chatId>` → never accumulate across chats (the main web scenario). | [identity.ts](../../apps/console/lib/agent/identity.ts) |
| P2 | Model-name drift: `deepseek-v4-flash` (default) vs `MiniMax-M2.5-highspeed` (compact fallback) vs `MiniMax-M2.7-highspeed` (extraction). | defaults + [compact.ts:71](../../apps/console/lib/agent/compact.ts) + [memory.ts:136](../../apps/console/lib/agent/memory.ts) |

**Baseline reality:** the memory/compact subsystem currently has **zero tests** — every lane writes tests first. `lastCompactedAt` is in-memory only and resets per HTTP turn. `UserProfile.profile` is free-form Markdown (no structure column).

---

## Decisions locked by the architect (do not re-litigate during build)

1. **Two prompts, one contract.** `CASE_COMPACT_PROMPT` (working-state) feeds L2. `PROFILE_COMPACT_PROMPT` (portrait) feeds L3. Both, plus the merger and the prompt-injection, import the **`PROFILE_SECTIONS`** contract (below). The portrait prompt is instructed to emit *exactly* the `## ` section headers the merger parses.
2. **Threshold model is percentage-of-window**, not absolute remaining tokens. Autocompact fires when `used / effectiveWindow ≥ ratio`. Keep absolute fields for backward-compat reads but stop using them for the trigger.
3. **Cadence-driven L2** (`compactEveryNMessages?: number`) is a configurable option. Default = `undefined` (disabled). Admin can set e.g. `10` to get a running summary every N user messages regardless of token threshold.
4. **L3 is structured storage.** New `sections` JSON column on `UserProfile`; `profile` Markdown stays as rendered/derived view. `DEFAULT_MEMORY_MODEL = 'deepseek-v4-flash'` — used for ALL three defaults: `compactModel`, `profileModel`, `factExtractionModel`. No more MiniMax hardcodes in memory code.
5. **Identity: anonymous visitor key deferred.** `chat:<chatId>` fallback stays for now. Task C5 (visitor key) is **removed from this build scope**; tracked separately.
6. **Delete the proxy.** `/api/chats/[chatId]/compact` calls `compactConversation` directly. `/api/internal/compact-chat` is removed.
7. **One model source of truth.** All memory-subsystem model names resolve from `memoryStrategy`; no hardcoded fallbacks except `DEFAULT_MEMORY_MODEL` in `contract.ts`.

### ⛔ STOP before implementing Task C4 (memory injection)

Before wiring *how* L2 case summary + L3 user profile reach the agent, **pause and confirm with the user**. Two fundamentally different approaches:

- **System-inject:** summary + profile auto-prepended to system prompt / first user message at case open. Agent always has context, zero agent choice.
- **System tools (agent-decides):** `read_chat_memory` / `read_user_profile` as built-in tools. Agent calls when it judges relevant — costs a tool-call turn but gives agent control.
- **Hybrid:** system-inject a short snippet (e.g. 200 chars) so agent is aware; tools available for full detail on-demand.

The choice affects agent behavior, response quality, token cost, and what's configurable per agent version. **Implement everything up to C4, then stop and message the user for the injection model decision before proceeding.**

---

## Shared Contract (Task 0 — build first, all lanes import)

**Files:**
- Create: `packages/shared/memory/contract.ts`
- Test: `packages/shared/memory/__tests__/contract.test.ts`

```typescript
// packages/shared/memory/contract.ts
// Single source of truth for the L3 profile format. The PROFILE_COMPACT_PROMPT
// is instructed to emit these exact headers; mergeProfile parses them; the
// prompt-injector renders them. Producer and consumer share THIS file.

export const PROFILE_SECTIONS = ['Identity', 'Contact', 'Preferences', 'Activity', 'History'] as const
export type ProfileSection = typeof PROFILE_SECTIONS[number]

/** Structured profile — persisted as JSON in UserProfile.sections. */
export type ProfileSections = Record<ProfileSection, string[]>

export function emptyProfileSections(): ProfileSections {
  return { Identity: [], Contact: [], Preferences: [], Activity: [], History: [] }
}

/** Markdown header a section is emitted/parsed under, e.g. "## Identity". */
export function sectionHeader(s: ProfileSection): string {
  return `## ${s}`
}

/** Default model for every memory-subsystem LLM call when strategy omits one. */
export const DEFAULT_MEMORY_MODEL = 'deepseek-v4-flash'
// Routes via DEEPSEEK_API_KEY (prefix 'deepseek-' → provider-config.ts DeepSeek branch).
// All three memory defaults (compactModel, profileModel, factExtractionModel) use this.
```

- [ ] **Step 1:** Write `contract.test.ts` asserting `PROFILE_SECTIONS` order, `emptyProfileSections()` returns 5 empty arrays, `sectionHeader('Identity') === '## Identity'`, `DEFAULT_MEMORY_MODEL === 'deepseek-v4-flash'`.
- [ ] **Step 2:** Run `npx vitest run packages/shared/memory/__tests__/contract.test.ts` → expect FAIL (module missing).
- [ ] **Step 3:** Create `contract.ts` as above.
- [ ] **Step 4:** Run the test → expect PASS.
- [ ] **Step 5:** Commit `feat(memory): shared profile format contract (Task 0)`.

---

## File Structure (what each lane owns)

| Lane | Owns (modify) | Creates |
|---|---|---|
| **A — Prompts & contract** | `compact.ts`, `defaults/index.ts`, `types/index.ts` | `case-compact-prompt.ts`, `profile-compact-prompt.ts` |
| **B — Trigger model** | `memory.ts` (`assessCompaction`, `estimateTokens`), `defaults/index.ts` | `__tests__/assess-compaction.test.ts` |
| **C — L3 strong** | `mergeProfile.ts`, `identity.ts`, `loop.ts` (inject + key), `schema.prisma`, `update-profile/route.ts`, `memory/route.ts` | migration, `__tests__/merge-profile.test.ts`, `__tests__/identity.test.ts` |
| **D — Cleanup** | `compact/route.ts` (delete proxy), `memory.ts`/`compact.ts` (model names), ops UI labels | — (deletes `internal/compact-chat/route.ts`) |

Lanes A/B/D touch disjoint files. Lane C touches `loop.ts` (shared with nobody else's writes here) + schema. **Merge order if conflicts arise:** A → B → C → D. In practice only `defaults/index.ts` is touched by both A and B — split by section (A edits prompt fields, B edits threshold fields); review that file's diff jointly.

---

## Lane A — Two purpose-built prompts behind the contract

Fixes **P0-2** and the producer side of **P0-3**.

### Task A1: Case-compact prompt (working-state summary for L2)

**Files:**
- Create: `apps/console/lib/agent/case-compact-prompt.ts`
- Test: `apps/console/lib/agent/__tests__/case-compact-prompt.test.ts`

- [ ] **Step 1: Write the failing test** — assert the prompt prioritizes case state and forbids portrait framing.

```typescript
import { describe, it, expect } from 'vitest'
import { CASE_COMPACT_PROMPT } from '../case-compact-prompt'

describe('CASE_COMPACT_PROMPT', () => {
  it('prioritizes working state, not a user portrait', () => {
    const p = CASE_COMPACT_PROMPT.toLowerCase()
    expect(p).toContain('confirmed facts')
    expect(p).toContain('tool')          // tools run / results
    expect(p).toContain('open')          // open items / next step
    expect(p).toContain('verbatim')      // recent user messages kept verbatim
    expect(p).not.toContain('portrait')  // this is NOT the profile prompt
  })
})
```

- [ ] **Step 2:** Run `npx vitest run apps/console/lib/agent/__tests__/case-compact-prompt.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** the prompt. Shape (working-state, recency-first — the inverse of the old portrait prompt):

```typescript
// apps/console/lib/agent/case-compact-prompt.ts
// Intra-case context compression. Output is injected mid-case as
// "[Case context from previous turns]" to keep the agent oriented.
// Priority is the OPPOSITE of the profile prompt: keep task-critical state,
// compress stable identity (the profile layer already owns identity).

export const CASE_COMPACT_PROMPT = `Summarize this support conversation so an agent can continue mid-case without re-reading it. Keep what is needed to ACT; drop pleasantries.

Output these sections in order:

1. Open Question / Goal: what the customer is trying to resolve right now (one line).
2. Confirmed Facts: every fact established this case — IDs, amounts, statuses, dates. One per line.
3. Tools Run: each tool called and its key result. One per line.
4. Open Items: what is still missing, blocked, or pending. One per line.
5. Recent Messages: the last few customer messages verbatim or near-verbatim.
6. Next Step: one short recommendation.

CRITICAL: TEXT ONLY — no tool calls, no analysis or thinking tags. Be concise.
Do NOT build a long-term user portrait here — stable identity/preferences are handled elsewhere. If the budget is tight, compress sections 1 and 6 but NEVER drop sections 2–4 (the case state).`
```

- [ ] **Step 4:** Run the test → PASS.
- [ ] **Step 5:** Commit `feat(memory): case-compact prompt for L2 working state (A1)`.

### Task A2: Profile-compact prompt (portrait, emitting the contract headers)

**Files:**
- Create: `apps/console/lib/agent/profile-compact-prompt.ts`
- Test: `apps/console/lib/agent/__tests__/profile-compact-prompt.test.ts`

- [ ] **Step 1: Write the failing test** — the prompt must instruct the model to emit the *exact* `## ` headers from the contract.

```typescript
import { describe, it, expect } from 'vitest'
import { PROFILE_COMPACT_PROMPT } from '../profile-compact-prompt'
import { PROFILE_SECTIONS, sectionHeader } from '@intera/shared/memory/contract'

describe('PROFILE_COMPACT_PROMPT', () => {
  it('instructs the model to emit every contract section header', () => {
    for (const s of PROFILE_SECTIONS) {
      expect(PROFILE_COMPACT_PROMPT).toContain(sectionHeader(s)) // e.g. "## Identity"
    }
  })
})
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** — build the prompt by interpolating the contract so it can never drift:

```typescript
// apps/console/lib/agent/profile-compact-prompt.ts
import { PROFILE_SECTIONS, sectionHeader } from '@intera/shared/memory/contract'

const SECTION_GUIDE: Record<string, string> = {
  Identity: 'Stable identifiers, roles, affiliations, account/member status. Facts that persist across chats.',
  Contact: 'Phone, email, channels, handles — only if stated or confirmed.',
  Preferences: 'Tone, language, recurring requests, behavioral patterns. Accumulate over time.',
  Activity: 'The current state across recent cases — what they are dealing with now.',
  History: 'One compressed line per past case/topic, newest first.',
}

export const PROFILE_COMPACT_PROMPT = [
  'Update this person\'s long-term profile from the conversation. Output ONLY the sections below, each under its exact Markdown header. Omit a section entirely if you have nothing for it.',
  '',
  ...PROFILE_SECTIONS.map((s) => `${sectionHeader(s)}\n${SECTION_GUIDE[s]}`),
  '',
  'CRITICAL: TEXT ONLY. Use bullet lines ("- ") under each header. Do not invent facts. Prefer the newest value when a fact changed. Keep Identity/Contact short and stable; let Activity reflect the present and roll older state into History.',
].join('\n')
```

- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(memory): profile-compact prompt emitting contract headers (A2)`.

### Task A3: Route each compaction caller to the right prompt

**Files:**
- Modify: `apps/console/lib/agent/compact.ts` (add `purpose` param), `apps/console/lib/agent/loop.ts` (`performCompaction` → case; `compactUserProfile` → profile)
- Modify: `packages/shared/types/index.ts` (add `profileModel?: string` to `MemoryStrategy`), `packages/shared/defaults/index.ts`
- Test: `apps/console/lib/agent/__tests__/compact-routing.test.ts`

- [ ] **Step 1: Write the failing test** — `compactConversation(msgs, strategy, { purpose: 'case' })` uses `CASE_COMPACT_PROMPT`; `{ purpose: 'profile' }` uses `PROFILE_COMPACT_PROMPT`. Inject a fake client (see "Test seam" below) and assert the `system` string passed to `messages.create`.

```typescript
import { describe, it, expect, vi } from 'vitest'
import { compactConversation } from '../compact'
import { CASE_COMPACT_PROMPT } from '../case-compact-prompt'
import { PROFILE_COMPACT_PROMPT } from '../profile-compact-prompt'
import { DEFAULT_MEMORY_STRATEGY } from '@intera/shared/defaults'

it('routes purpose=case to CASE_COMPACT_PROMPT', async () => {
  const create = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'x'.repeat(50) }], usage: {} })
  const msgs = [{ role: 'user', content: 'hi', createdAt: new Date() }] as never
  await compactConversation(msgs, DEFAULT_MEMORY_STRATEGY as never, { purpose: 'case', __clientFactory: () => ({ messages: { create } }) } as never)
  expect(create.mock.calls[0][0].system).toBe(CASE_COMPACT_PROMPT)
})
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.** Extend the signature: `compactConversation(messages, strategy, opts?: { purpose?: 'case' | 'profile'; __clientFactory?: () => any })`. Default `purpose: 'case'`. Select prompt: `strategy.compactPrompt` override (if set) else `purpose === 'profile' ? PROFILE_COMPACT_PROMPT : CASE_COMPACT_PROMPT`. Select model: `purpose === 'profile' ? (strategy.profileModel || strategy.compactModel || DEFAULT_MEMORY_MODEL) : (strategy.compactModel || DEFAULT_MEMORY_MODEL)`. Use `__clientFactory ?? (() => createAgentClient(model))` so tests can inject. Update the two callers in `loop.ts`: `performCompaction` passes `{ purpose: 'case' }`, `compactUserProfile` passes `{ purpose: 'profile' }`. Add `profileModel?: string` to `MemoryStrategy` and `profileModel: '<same as compactModel>'` to `DEFAULT_MEMORY_STRATEGY`.
- [ ] **Step 4:** Run → PASS; then `npx tsc --noEmit -p apps/console/tsconfig.json` → 0 errors.
- [ ] **Step 5:** Commit `feat(memory): route case vs profile compaction to dedicated prompts (A3)`.

> **Test seam note for the team:** `compact.ts` currently builds its client via `createAgentClient(model)` inside `withRetry`. Add the optional `__clientFactory` hook (one line) so all memory tests run without network/keys. If you prefer `vi.mock('./api/provider-config')`, that's acceptable too — pick one and use it consistently across lanes.

---

## Lane B — Make compaction actually fire (percentage-of-window)

Fixes **P0-1**.

### Task B1: Percentage-based `assessCompaction`

**Files:**
- Modify: `apps/console/lib/agent/memory.ts` (`assessCompaction`)
- Modify: `packages/shared/types/index.ts` + `defaults/index.ts` (add ratio fields)
- Test: `apps/console/lib/agent/__tests__/assess-compaction.test.ts`

- [ ] **Step 1: Write the failing test:**

```typescript
import { describe, it, expect } from 'vitest'
import { ChatMemoryManager } from '../memory'
import { DEFAULT_MEMORY_STRATEGY } from '@intera/shared/defaults'

const mgr = (over = {}) => new ChatMemoryManager('c1', { ...DEFAULT_MEMORY_STRATEGY, ...over } as never)

describe('assessCompaction (percentage model)', () => {
  it('does NOT compact a short conversation', () => {
    const r = mgr().assessCompaction(2_000, 10)   // 2K used in a 200K window
    expect(r.shouldCompact).toBe(false)
  })
  it('compacts once used crosses the autocompact ratio', () => {
    // effectiveWindow ≈ 180K; autocompactRatio 0.70 → fires at ~126K used
    const r = mgr().assessCompaction(140_000, 60)
    expect(r.shouldCompact).toBe(true)
  })
  it('blocks near the ceiling', () => {
    const r = mgr().assessCompaction(175_000, 80)
    expect(r.isBlocking).toBe(true)
  })
})
```

- [ ] **Step 2:** Run → the "short conversation" test passes today (good), but the ratio fields don't exist → the other assertions are computed against absolute thresholds. Confirm the test FAILS on the intended new behavior before editing (it will fail to find the new fields once you reference them; write the test to assert behavior, then implement).
- [ ] **Step 3: Implement.** Add to `MemoryStrategy` + defaults: `autocompactRatio: 0.70`, `warningRatio: 0.60`, `blockingRatio: 0.92`. Rewrite the trigger in `assessCompaction`:

```typescript
const ctxWindow = this.strategy.contextWindow ?? 200000
const outReserved = this.strategy.outputTokensReserved ?? 20000
const effectiveWindow = Math.max(1, ctxWindow - outReserved)
const usedRatio = estimatedMessageTokens / effectiveWindow
let percentLeft = Math.max(0, (1 - usedRatio) * 100)
if (!Number.isFinite(percentLeft)) percentLeft = 0

const isBlocking  = usedRatio >= (this.strategy.blockingRatio  ?? 0.92)
const shouldRaw   = usedRatio >= (this.strategy.autocompactRatio ?? 0.70)
const isWarning   = usedRatio >= (this.strategy.warningRatio    ?? 0.60)
const collapseEnabled = this.strategy.enableContextCollapse !== false
return {
  shouldCompact: collapseEnabled ? shouldRaw : false,
  isWarning,
  isBlocking: collapseEnabled ? isBlocking : false,
  percentLeft,
  messagesToKeep: Math.max(4, Math.floor(messageCount * 0.4)),
}
```

Keep the old absolute `*ThresholdTokens` fields in the type (do not delete — other reads/UI may reference them) but stop using them here. Leave a `// superseded by *Ratio` comment.

- [ ] **Step 4:** Run → PASS; `npx tsc --noEmit` → 0 errors.
- [ ] **Step 5:** Commit `fix(memory): percentage-of-window compaction trigger (B1)`.

### Task B2: Cadence-driven L2 compact (configurable, default off) ✅ CONFIRMED

**Rationale:** A 200K-window model rarely hits 70% in short customer-service conversations, so window-ratio alone keeps L2 dormant for most cases. `compactEveryNMessages` lets admins get a warm running summary regardless of token usage — useful for long-running consultations.

**Files:**
- Modify: `packages/shared/types/index.ts` (add `compactEveryNMessages?: number` to `MemoryStrategy`)
- Modify: `packages/shared/defaults/index.ts` (add `compactEveryNMessages: undefined`)
- Modify: `apps/console/lib/agent/loop.ts` (`checkAndCompact` — add cadence check)
- Test: `apps/console/lib/agent/__tests__/assess-compaction.test.ts` (extend)

- [ ] **Step 1:** Add failing test:

```typescript
it('compacts on cadence when compactEveryNMessages is set', async () => {
  // 10 messages, cadence=5 → should compact (messageCount % cadence === 0)
  const r = mgr({ compactEveryNMessages: 5 }).assessCompaction(1_000, 10)
  // Token usage is low, but cadence triggers
  // NOTE: cadence check lives in checkAndCompact not assessCompaction — 
  // test the full checkAndCompact path via a lightweight integration test instead:
  // mock performCompaction and confirm it's called when messageCount=10, cadence=5.
})
```

- [ ] **Step 2:** Add `compactEveryNMessages?: number` to `MemoryStrategy` type; default `undefined`. In `checkAndCompact` (loop.ts:1478), **after** the session-memory-still-fresh early return, add:

```typescript
const cadence = this.deps.config.memoryStrategy.compactEveryNMessages
const userMsgCount = this.messages.filter(m => m.role === 'user').length
if (cadence && userMsgCount > 0 && userMsgCount % cadence === 0) {
  if (!this.chatMemory.isCompactCircuitBroken()) {
    try {
      await this.performCompaction()
      await this.traceWriter.write('loop_decision', 'Compacted', { reason: 'cadence', userMsgCount, cadence })
      return { shouldCompact: true, reason: 'cadence' }
    } catch {
      this.chatMemory.recordCompactionFailure()
    }
  }
}
```

- [ ] **Step 3:** Run tests → PASS; `npx tsc --noEmit` → 0.
- [ ] **Step 4:** Commit `feat(memory): cadence-driven L2 compact via compactEveryNMessages (B2)`.

---

## Lane C — Strong, structured, auto-injected L3 profile

Fixes **P0-3** (consumer side), **P1-2**, **P1-3**.

### Task C1: Structured profile storage (schema + migration)

**Files:**
- Modify: `packages/shared/prisma/schema.prisma` (`UserProfile`)
- Create: migration under `packages/shared/prisma/migrations/`
- Test: covered by C2/C3 round-trip

- [ ] **Step 1:** Add to `UserProfile`: `sections String @default("{}") // JSON: ProfileSections`. Keep `profile String` as a derived/rendered Markdown view (operators still read it).
- [ ] **Step 2:** Generate migration: `npx prisma migrate dev --name add_user_profile_sections --schema packages/shared/prisma/schema.prisma` (dev SQLite). Verify the prod-style SQL `ALTER TABLE "user_profiles" ADD COLUMN "sections"` is emitted.
- [ ] **Step 3:** Run `npx prisma generate --schema packages/shared/prisma/schema.prisma`; `npx tsc --noEmit` → 0 errors.
- [ ] **Step 4:** Commit `feat(memory): structured sections column on UserProfile (C1)`.

### Task C2: Rewrite `mergeProfile` against the contract (structured, dedup, safe truncation)

**Files:**
- Modify: `packages/shared/memory/mergeProfile.ts`
- Test: `packages/shared/memory/__tests__/merge-profile.test.ts`

- [ ] **Step 1: Write failing tests** capturing the three defects:

```typescript
import { describe, it, expect } from 'vitest'
import { mergeProfileSections, renderProfile } from '../mergeProfile'
import { emptyProfileSections } from '../contract'

describe('mergeProfileSections', () => {
  it('parses the contract headers the profile prompt emits', () => {
    const summary = '## Identity\n- VIP member #4471\n## Activity\n- Disputing a 500 deposit'
    const out = mergeProfileSections(emptyProfileSections(), summary, 4000)
    expect(out.Identity).toContain('VIP member #4471')
    expect(out.Activity).toContain('Disputing a 500 deposit')
  })
  it('dedups repeated identity lines across merges', () => {
    let s = mergeProfileSections(emptyProfileSections(), '## Identity\n- VIP member #4471', 4000)
    s = mergeProfileSections(s, '## Identity\n- VIP member #4471', 4000)
    expect(s.Identity.filter(l => l.includes('#4471')).length).toBe(1)
  })
  it('rolls superseded Activity into History instead of losing it', () => {
    let s = mergeProfileSections(emptyProfileSections(), '## Activity\n- Case A open', 4000)
    s = mergeProfileSections(s, '## Activity\n- Case B open', 4000)
    expect(s.Activity.join(' ')).toContain('Case B')
    expect(s.History.join(' ')).toContain('Case A')
  })
  it('truncation drops History first, never Identity', () => {
    const big = emptyProfileSections()
    big.Identity = ['- core id']
    big.History = Array.from({ length: 200 }, (_, i) => `- old case ${i}`)
    const s = mergeProfileSections(big, '', 50) // tiny budget
    expect(s.Identity).toContain('- core id')
    expect(s.History.length).toBeLessThan(200)
  })
})

describe('renderProfile', () => {
  it('renders sections to Markdown with headers in contract order', () => {
    const md = renderProfile({ ...emptyProfileSections(), Identity: ['- a'] })
    expect(md).toContain('## Identity')
  })
})
```

- [ ] **Step 2:** Run → FAIL (functions don't exist).
- [ ] **Step 3: Implement** `mergeProfileSections(old: ProfileSections, summary: string, maxTokens: number): ProfileSections` and `renderProfile(s: ProfileSections): string`:
  - Parse `summary` by scanning lines; a `## <Section>` line (matching `PROFILE_SECTIONS`) switches the current bucket; `- ` lines append to it.
  - Merge rules: `Identity`/`Contact`/`Preferences` accumulate with case-insensitive trimmed **dedup**. `Activity` is **replaced**, and the previous Activity lines are appended to `History` (newest-first) before replacement. `History` accumulates with dedup.
  - Truncation: enforce `maxTokens` (chars/4 estimate) by trimming **History oldest-first**, then `Activity` oldest, never touching `Identity`/`Contact`.
  - Keep a thin back-compat wrapper `mergeProfile(oldMarkdown, summary, maxTokens)` that parses old Markdown into sections, calls `mergeProfileSections`, and returns `renderProfile(...)` — so callers not yet migrated keep working.
- [ ] **Step 4:** Run → PASS; `npx tsc --noEmit` (run from `packages/shared` and console).
- [ ] **Step 5:** Commit `feat(memory): structured mergeProfile aligned to contract (C2)`.

### Task C3: Persist + render sections in both write paths

**Files:**
- Modify: `apps/console/lib/agent/loop.ts` (`compactUserProfile`), `apps/console/app/api/chats/[chatId]/update-profile/route.ts`
- Test: `apps/console/lib/agent/__tests__/profile-write.test.ts` (use Prisma test client or mock)

- [ ] **Step 1: Write failing test** — after `compactUserProfile`, the persisted row has both `sections` (parsed) and `profile` (rendered) consistent with each other. Mock `compactConversation` to return a fixed `## Identity\n- x` summary and a fake prisma upsert; assert `sections` JSON parses to `{Identity:['- x'], ...}` and `profile` contains `## Identity`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.** In both write paths: load `existing.sections` (parse JSON; fall back to parsing `existing.profile` if `sections` empty — handles pre-migration rows), call `mergeProfileSections`, write `sections: JSON.stringify(merged)` **and** `profile: renderProfile(merged)`. Keep `recomputeProfileStats` as-is.
- [ ] **Step 4:** Run → PASS; `npx tsc --noEmit` → 0.
- [ ] **Step 5:** Commit `feat(memory): dual-write sections + rendered profile (C3)`.

### Task C4: Memory injection at case open — ⛔ STOP FOR ARCHITECT CONFIRMATION

**Do not implement this task until you have confirmed the injection model with the user.**

Implement C1 → C2 → C3 in order, then pause here and message the user:

> "C4 ready to build. How should the agent receive L2 case summary + L3 user profile?
> A) System-inject: auto-prepend to system prompt at case open (agent always has context, no cost)
> B) System tools only: agent calls `read_chat_memory` / `read_user_profile` when needed (agent controls, costs a tool-call turn)
> C) Hybrid: short snippet (e.g. 200 chars) auto-injected at open; tools available for full detail on-demand"

The choice affects agent behavior, token cost, and per-agent-version configurability. **Do not pick a default and proceed — the user has explicitly flagged this as a decision point.**

### Task C5: Stabilize identity key for anonymous visitors — 🚫 OUT OF SCOPE (deferred)

Deferred pending a separate exploration of the anonymous visitor identity strategy. The current `chat:<chatId>` fallback in `identity.ts` stays unchanged. Track in a future TODO. **Do not implement in this build.**

---

## Lane D — Delete dead architecture, converge model names

Fixes **P1-1**, **P2**.

### Task D1: Inline the manual compact, delete the proxy

**Files:**
- Modify: `apps/console/app/api/chats/[chatId]/compact/route.ts` (inline the logic)
- Delete: `apps/console/app/api/internal/compact-chat/route.ts`
- Test: `apps/console/app/api/chats/[chatId]/__tests__/compact-route.test.ts` (or a route-level integration test)

- [ ] **Step 1: Write failing test** — POST to the compact route with a chat that has messages produces a 200 with a `summary` (mock `compactConversation` + prisma). Today it returns 502.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.** Move the body of `internal/compact-chat/route.ts` (resolve cases → load messages → `compactConversation(msgs, strategy, { purpose: 'case' })` → upsert `ChatMemory.summary`) **directly into** `compact/route.ts`. Remove the `fetch(...)` proxy entirely. Delete `internal/compact-chat/route.ts`. Confirm no other caller references it (`grep -rn "internal/compact-chat" apps`).
- [ ] **Step 4:** Run → PASS; `npm run build:console` succeeds.
- [ ] **Step 5:** Commit `fix(memory): inline manual compact, remove dead apps/chat proxy (D1)`.

### Task D2: Converge model names to strategy

**Files:**
- Modify: `apps/console/lib/agent/compact.ts` (line 71 fallback), `apps/console/lib/agent/memory.ts` (lines 136/189/196 extraction model)
- Modify: `packages/shared/defaults/index.ts` (`factExtractionModel`), `types/index.ts`
- Test: `apps/console/lib/agent/__tests__/model-resolution.test.ts`

- [ ] **Step 1: Write failing test** — `compactConversation` with `strategy.compactModel` unset uses `DEFAULT_MEMORY_MODEL`; with it set uses the configured value. Fact extraction reads `strategy.factExtractionModel ?? process.env.FACT_EXTRACTION_MODEL ?? DEFAULT_MEMORY_MODEL` (no hardcoded `MiniMax-M2.7-highspeed`).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.** Add `factExtractionModel?: string` to `MemoryStrategy` + defaults. Replace the three hardcoded names: `compact.ts:71` fallback → `DEFAULT_MEMORY_MODEL`; `memory.ts` extraction → `this.strategy.factExtractionModel ?? process.env.FACT_EXTRACTION_MODEL ?? DEFAULT_MEMORY_MODEL`. Set defaults `compactModel`, `profileModel`, `factExtractionModel` to one confirmed-deployed model.
- [ ] **Step 4:** Run → PASS; `npx tsc --noEmit` → 0.
- [ ] **Step 5:** Commit `refactor(memory): single model source of truth for memory subsystem (D2)`.

### Task D3: Fix ops UI copy

**Files:**
- Modify: `apps/console/app/ops/chats/[chatId]/page.tsx` (button labels/help reference the now-direct compact), `lib/i18n/dictionaries.ts` if strings are keyed
- [ ] **Step 1:** Verify the "Compact Chat" / "Update Profile" buttons call the corrected endpoints and the help text no longer implies a separate chat app. Update any stale copy (en + zh).
- [ ] **Step 2:** `npm run build:console` succeeds.
- [ ] **Step 3:** Commit `chore(memory): ops copy for direct compact (D3)`.

---

## Cross-lane verification (run after all lanes merge)

- [ ] `npx tsc --noEmit -p apps/console/tsconfig.json` → 0 errors
- [ ] `npm test` → all green (memory subsystem went from 0 → ~25+ new tests)
- [ ] `npm run build:console` → success
- [ ] Manual: in ops, open a chat with messages → "Compact Chat" returns a working-state summary (not a portrait) → "Update Profile" merges into a structured profile with real `## Identity/Activity` sections → reopen as a new case for the same visitor → agent's system prompt shows the auto-injected `[Known about this customer]` block (verify via debug-logs).
- [ ] Regression: run an end-to-end case long enough to cross `autocompactRatio`; confirm a `loop_decision: Compacted` trace appears (proves P0-1 fixed).

---

## Self-review (architect)

- **Spec coverage:** P0-1→B1; P0-2→A1/A3; P0-3→A2(producer)+C2(consumer); P1-1→D1; P1-2→C4; P1-3→C5; P2→D2. All mapped. ✅
- **Contract consistency:** `PROFILE_SECTIONS`/`sectionHeader`/`emptyProfileSections`/`ProfileSections`/`mergeProfileSections`/`renderProfile`/`DEFAULT_MEMORY_MODEL` are defined once (Task 0 / C2) and referenced consistently. ✅
- **Open items requiring architect confirmation before build:** (1) `DEFAULT_MEMORY_MODEL` actual value vs deployed roster; (2) B2 cadence-driven L2 — yes/no; (3) C5 historical backfill — deferred. These are flagged inline, not silent placeholders.
- **Known latitude left to the team:** exact test seam (`__clientFactory` vs `vi.mock`), exact system-prompt injection point in C4 (depends on `prompt-resolver` structure), and whether `mergeProfile` back-compat wrapper is retained long-term.
