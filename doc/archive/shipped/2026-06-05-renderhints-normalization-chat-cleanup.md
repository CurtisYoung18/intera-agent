> **Historical receipt note (2026-06-08):** This file is preserved as past-work evidence. It may contain old terms such as `Skill`, `Policy`, `Guardrail`, `stage`, or `sub-agent`, and some files still read like implementation plans. Do not dispatch new work from this file. Current work starts at [../README.md](../README.md), [../handoffs/MASTER_BUILD_HANDOFF.md](../handoffs/MASTER_BUILD_HANDOFF.md), and [../to-do/2026-06-08-foundation-reset-domain-model.md](../to-do/2026-06-08-foundation-reset-domain-model.md).

# Playground renderHints Channel Key + Chat Residual Cleanup Plan

> **For the coding agent team:** Architect hand-off. Three tasks — Tasks 1+2 are disjoint files (parallel); Task 3 touches the same file as Task 1 (serialize or single-owner). TDD where applicable. The architect wrote the plan — you write the code.

**Goal:** Make `renderHints` work per the correct architecture: **Tool is the center; `renderHints` is keyed by channel** (`livechat` / `web-chat` / `playground`). Each integration reads its own key. The Playground reads `playground` (fallback `web-chat`). Currently **all 11 tools only have a `livechat` key** — the `web-chat` key is missing, so the Playground (which uses `RenderHintCard` in web-chat format) renders nothing. Fix: add the missing channel keys + wire the Playground to read the right one. Separately, finish migrating ops/chats memory sections to the shared `MessageContent` component.

**Architecture (corrected):**

```
Tool: get_kyc_status
  renderHints: {
    livechat:   { kind: "card", titleField: "$.kyc_status", buttons: [...] }  ← LiveChat 客服 App
    "web-chat": { kind: "card", titleOverride: "KYC Status" }                  ← Web-chat widget + Playground
  }
```

The Playground is the admin testing surface — it renders hints in **web-chat format** via `RenderHintCard`. It reads `renderHints.playground` (if present) or `renderHints["web-chat"]` (fallback). If neither key exists, the tool renders without hints (raw result only) — we do **not** coerce livechat format into web-chat.

**Tech stack:** React/Next.js · TypeScript · Prisma · `@intera/shared/channels/render-hints`

---

## Current state (verified by architect, 2026-06-05)

| Area | State |
|---|---|
| RenderHintCard | ✅ Handles web-chat format: `card` / `form` / `plain` / `list` / `image` (+ `quick_replies` for livechat compat). **No change needed.** |
| Seed data (`seed-render-hints.ts`) | 10 tools, **all only have `"livechat"` key**. 0 have `"web-chat"` or `"playground"`. |
| `request_user_input` (built-in) | `skills.ts:1014` — **only has `"livechat"` key** (`carousel` kind). No `"web-chat"` key. |
| Playground page.tsx | Passes raw `t.renderHints` (the full channel-keyed object) to `RenderHintCard` — which expects a single `RenderHint`, not a channel-keyed map. **Does not select a channel key.** |
| Chat memory rendering | ops/chats lines 437, 457: raw `<ReactMarkdown>` — not using shared `MessageContent`. |
| OrganicLoader | Already shared. No migration needed. |

---

## Task 0 — Playground reads channel key (FE, 1-line fix + test)

**Why:** The Playground receives the full `renderHints` object `{livechat:{...}, "web-chat":{...}}` from the SSE event. It must pick the right channel key before passing to `RenderHintCard`.

**Owns file:** `apps/console/app/admin/playground/page.tsx` (the single call site).

- [ ] **Step 1 — Extract channel key.** Before `<RenderHintCard hint={...}>` (`page.tsx` ~line 957), extract:
  ```ts
  const hint = t.renderHints?.playground || t.renderHints?.["web-chat"] || null
  ```
  If `hint === null`, skip rendering `RenderHintCard` for that tool (raw result only — no crash).

- [ ] **Step 2 — Pass only the extracted hint** (not the full channel-keyed object) to `<RenderHintCard hint={hint} result={...} />`.

- [ ] **Commit:** `fix(playground): read renderHints by channel key (playground || web-chat)`

**Acceptance:** when a tool result includes `renderHints: {livechat:{...}, "web-chat":{kind:"card",...}}`, the Playground renders the card from the `web-chat` key. When `web-chat` key is absent, no hint renders (no crash).

---

## Task 1 — Add `web-chat` renderHints to seed data (DB/seed, independent)

**Why:** All 10 business tools in `seed-render-hints.ts` only have a `livechat` key. The Playground can't render them. Add a parallel `"web-chat"` key for each.

**Owns file:** `packages/shared/prisma/seed-render-hints.ts`

For each of the 10 tools, add a `"web-chat"` entry alongside `"livechat"`:

| Tool | livechat kind | web-chat kind |
|---|---|---|
| `get_account_status` | card | card |
| `get_kyc_status` | card | card |
| `get_active_promotions` | carousel | list (carousel has no web-chat equivalent → best-effort: list of cards) |
| `get_withdraw_conditions` | carousel | list |
| `get_eligible_promotions` | carousel | list |
| `get_latest_withdrawal` | card | card |
| `get_latest_deposit` | card | card |
| `get_transaction_history` | carousel | list |
| `get_recommended_games` | carousel | list |
| `get_bet_history` | card | card |

**web-chat format for `card`:**
```json
{"kind":"card","titleOverride":"Account Status"}
```
(static title — Playground doesn't resolve JSONPath `$.status`; a static label is clear enough for testing.)

**web-chat format for carousel→list fallback:**
```json
{"kind":"list","bulleted":false,"showIndex":true}
```
(list of items, each shown as a card-like entry with index — the closest web-chat equivalent to a carousel.)

- [ ] **Step 1 — Write the seed update.** Each tool's JSON gains a `"web-chat"` key. Example before/after:
  ```json
  // Before
  "get_account_status": "{\"livechat\":{\"kind\":\"card\",\"titleField\":\"$.status\",\"buttons\":[]}}"
  // After
  "get_account_status": "{\"livechat\":{\"kind\":\"card\",\"titleField\":\"$.status\",\"buttons\":[]},\"web-chat\":{\"kind\":\"card\",\"titleOverride\":\"Account Status\"}}"
  ```
- [ ] **Step 2 — Re-run seed** against the target org(s): `npx tsx packages/shared/prisma/seed-render-hints.ts <orgId>`.
- [ ] **Commit:** `feat(seed): add web-chat renderHints to all 10 business tools`

**Acceptance:** `SELECT renderHints FROM skills WHERE name='get_account_status'` → JSON contains both `livechat` and `web-chat` keys.

---

## Task 2 — `request_user_input` web-chat renderHint (BE, independent of Task 1)

**Why:** The built-in `request_user_input` tool (`skills.ts:1014`) only defines a `livechat` renderHint with `kind: "carousel"` — which is wrong for the Playground (it's a form tool, not a carousel). Add a `"web-chat"` key with a `form` hint so the Playground can render the interactive form.

**Owns file:** `apps/console/lib/agent/skills.ts` (the `request_user_input` definition block, ~line 1010-1025).

- [ ] **Step 1 — Add `"web-chat"` key.** Current:
  ```ts
  renderHints: {
    livechat: {
      kind: 'carousel',
      itemsField: '$.list',
      ...
    },
  },
  ```
  Add:
  ```ts
  renderHints: {
    livechat: { ... },  // unchanged
    "web-chat": {
      kind: 'form',
      layout: 'single',
      submitLabel: 'Submit',
    },
  },
  ```
- [ ] **Step 2 — Verify:** the web-chat form hint is `{kind:"form", layout:"single", submitLabel:"Submit"}` — which matches the `FormHint` type in `channels/render-hints.ts` and `RenderHintCard`'s form handler.
- [ ] **Commit:** `fix(skills): add web-chat form renderHint to request_user_input`

**Acceptance:** Playground receives `request_user_input` result → `renderHints["web-chat"]` = `{kind:"form",...}` → `RenderHintCard` renders an interactive form (matching the form handler at `render-hint-card.tsx:222`). Keyless test bar green.

---

## Task 3 — Chat memory → MessageContent (FE, independent of Tasks 0-2)

**Owns file:** `apps/console/app/ops/chats/[chatId]/page.tsx`

- [ ] **Step 1 — Replace raw ReactMarkdown:**
  - Line 437: `<ReactMarkdown>{mem.summary.slice(0, 3000)}</ReactMarkdown>` → `<MessageContent content={mem.summary.slice(0, 3000)} />`
  - Line 457: `<ReactMarkdown>{memoryData.profile.profile.slice(0, 1500)}</ReactMarkdown>` → `<MessageContent content={memoryData.profile.profile.slice(0, 1500)} />`
- [ ] **Step 2 — Remove direct `ReactMarkdown` import** (line 20) if no other call sites remain.
- [ ] **Step 3 — Verify:** memory panel renders markdown identically (`MessageContent` already uses `ReactMarkdown + remarkGfm`).
- [ ] **Commit:** `refactor(ops): migrate memory/profile markdown to shared MessageContent`

**Acceptance:** ops/chats memory panel gfm-renders correctly; `import ReactMarkdown` removed; keyless bar green.

---

## Final verification

```bash
npx tsc --noEmit -p apps/console/tsconfig.json
env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npm test
```
Manual: Playground — run `get_account_status` (after seed re-run) → live-activity panel shows a card with "Account Status" title. Run `get_active_promotions` → shows a list. Run `request_user_input` → shows an interactive form.

---

## Self-review (architect)

- **Architecture corrected:** Tool-centered, channel-keyed. Playground reads its key. No livechat→web-chat coercion. ✅
- **Coverage:** Task 0 (channel key in playground) → 1 file. Task 1 (seed data) → 1 file. Task 2 (request_user_input) → 1 file. Task 3 (chat memory) → 1 file. All disjoint — parallel-safe. ✅
- **Ordering:** Tasks 0, 1, 2, 3 are all independent files → can dispatch in parallel. Task 0 and Task 1+2 are complementary (Task 0 reads the key, Tasks 1+2 ensure the key exists).
- **Out of scope:** `RenderHintCard` adding `carousel` handler — not needed with this architecture. Carousel is a livechat concept; the Playground renders web-chat format, so carousel tools get a `list` fallback in the seed data.
