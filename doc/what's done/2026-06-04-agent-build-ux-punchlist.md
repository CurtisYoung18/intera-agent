> **Historical receipt note (2026-06-08):** This file is preserved as past-work evidence. It may contain old terms such as `Skill`, `Policy`, `Guardrail`, `stage`, or `sub-agent`, and some files still read like implementation plans. Do not dispatch new work from this file. Current work starts at [../README.md](../README.md), [../handoffs/MASTER_BUILD_HANDOFF.md](../handoffs/MASTER_BUILD_HANDOFF.md), and [../to-do/2026-06-08-foundation-reset-domain-model.md](../to-do/2026-06-08-foundation-reset-domain-model.md).

# Agent-Building UX Punch-List — Internal-Test Smoothness

**Author:** Architect (code-audit walkthrough) | **Date:** 2026-06-04 | **Status:** ready for a coding agent

> **Priority context (owner, 2026-06-04):** the near-term goal is a **minimal, fully-functional, smooth** version
> for **internal testers to build agents without getting stuck**. No external threat model (internal only).
> **Bar for this work = "works · smooth · no regressions," NOT enterprise-grade.** Everything below is a pragmatic
> quick-fix, not a rewrite. Enterprise hardening (G1–G11) is a separate background track.
>
> **Method:** code audit of `apps/console/app/admin/**` + `components/admin/**` against the three symptoms the owner
> reported: (A) buttons do nothing, (B) "configured but doesn't take effect," (C) UI defects. File:line evidence below.
>
> **Severity:** **P0** = blocks/stuck (卡壳) · **P1** = looks broken / silently wrong · **P2** = polish.

---

## A — Buttons do nothing / pages get stuck (卡壳)

### A1 — [P0] Pages stick on the loading skeleton forever if any initial fetch fails
`load()` functions that `await fetch(...)` then `setLoading(false)` **with no `try/catch/finally`** never clear the
spinner when the API errors → the page is stuck on a skeleton with no error, no retry.
- **Confirmed:** `app/admin/guardrails/page.tsx:121-126` (`load()` — no finally; `/api/admin/policies` failure = infinite skeleton).
- **Correct pattern already exists:** `app/admin/model/page.tsx:71-72` uses `.catch(setError) / .finally(setLoading(false))` + an error card with a Retry button (lines 132-144).
- **Fix:** every admin page's initial loader gets `try { … } catch { setError(…) } finally { setLoading(false) }` + an
  error/retry state. Copy the `model` page pattern. Audit all 14 admin pages.

### A2 — [P1] ~25 silent `.catch(() => {})` swallow load/save failures (no error shown anywhere)
When a fetch fails it's swallowed → the user sees nothing. On a **user-initiated action** (save/toggle/delete) this is
"I clicked and nothing happened." Representative hits:
- `guardrails/page.tsx:143,145,156,163` · `model/page.tsx:89` · `tools/page.tsx:103,168` · `memory/page.tsx:93,120`
- `case-types/page.tsx:52` · `case-types/[name]/page.tsx:107,111,119` · `agent/page.tsx:58` · `members/page.tsx:57`
- `components/admin/{agent-blueprint,binding-column,version-context-bar,guardrail-summary-list,sub-agent-*}.tsx`
- **Fix (scoped, not boil-the-ocean):** for **user-initiated** writes, surface a visible error (a small toast or inline
  message). Background/passive loads may stay quiet but should still not leave the UI in a half-state. Prioritise
  save/toggle/delete handlers.

### A3 — [P1] `guardrails` toggle has no failure feedback
`toggleEnabled` (`guardrails/page.tsx:181-187`) doesn't check `res.ok`; on failure it just `load()`s and the toggle
silently snaps back with no message. **Fix:** check `res.ok`, show an error on failure.

---

## B — "明明配置了但似乎不生效" (configured but no effect) — this one is structural

### B1 — [P0] Save model is inconsistent *within the same build flow*
- **Auto-save (no Save button, 800ms debounce):** `model`, `memory`.
- **Explicit Save click required:** `tools`, `guardrails`, `knowledge`.
- **Consequence:** a tester edits `tools`/`guardrails`/`knowledge` and navigates away **without clicking Save → edit
  lost → "I configured it but it didn't apply."** And on the auto-save pages there's no Save button, so testers aren't
  sure it persisted. The two halves of the flow behave oppositely.
- **✅ DECIDED (owner 2026-06-04): auto-save + a persistent save-state chip everywhere.**
  - *Page-level config* (`model`, `memory`, `case-types/[name]` detail, `channels/livechat`, agent prompt fields):
    debounced auto-save + a **persistent** chip (`未保存 / 保存中… / 已保存 ✓ / 失败 ✗`). Reuse `model/page.tsx`'s chip
    (lines 174-185) as the standard; remove ambiguous manual "Save" buttons on page-level config.
  - *Modal/form entity editors* (creating/editing a skill, policy, knowledge source): keep an explicit **Save** inside
    the modal (per-keystroke auto-save of a half-made entity is wrong) — but show a clear save result and
    **confirm-if-dirty on cancel/close** so nothing is lost silently.
  - Net goal: no page leaves the user wondering "did it save?", and no edit is ever lost without warning.

### B2 — [P1] Cache-bust hardcodes `orgId:'default'` → non-default orgs serve stale config
After a config edit the page POSTs `/api/admin/config-changed` to invalidate the runtime config cache — but with a
**hardcoded** org:
- `model/page.tsx:88` · `memory/page.tsx:119` · `tools/page.tsx:164` · `case-types/page.tsx:48` all send `orgId:'default'`.
- **Consequence:** if a tester works in any org other than `default`, their edits **do not bust the cache** → the live
  agent keeps serving the old config until TTL → textbook "configured but not taking effect."
- **Fix:** send the **session's** orgId (the session carries it after G3), not the literal `'default'`. One-liner per site.

### B3 — [P1] Draft / Active / Live confusion
- Playground runs the **selected** version (`playground/page.tsx:185` `body.configId = selectedAgentId`) — fine for testing.
- But the **live channels** (livechat / web-chat / `/api/messages`) run the **active** version.
- **Consequence:** edit a non-active draft → playground reflects it, the live bot doesn't → "playground works but the
  real agent ignores my config."
- **✅ DECIDED (owner 2026-06-04): KEEP the draft/active version switching, AND add a release-note ("commit message")
  per published version** so colleagues can see what changed between versions.
  - *Clarity fixes:* (a) make the active-vs-draft badge in `VersionContextBar` glaring (today it just prints the
    version name); (b) in `playground`, if `selected ≠ active`, show a "测试草稿 vN（未上线）" note; (c) make
    **Activate/Publish** prominent on the agent page.
  - *NEW feature — version release notes:*
    - **Schema:** add to `AgentConfig` → `releaseNote String?`, `publishedAt DateTime?`, `publishedBy String?` (userId).
      New migration with a **fresh numeric prefix** (never rename applied migrations — see enterprise spec §3.4).
    - **On Activate/Publish:** show a small dialog asking for a short release note ("what changed"); save it on that
      version + stamp `publishedAt` + `publishedBy` (current user from session). Note may be optional but prompt for it.
    - **Version history:** in `AgentVersionPicker` (or a small panel on the agent page) list versions with their
      `releaseNote` + who + when + the active badge — a readable changelog of version changes.
    - Keep it minimal/pragmatic — this is the internal-test version, not a full git.

### B4 — [P1] `guardrails` "used by agent" marker reads a deprecated field
`guardrails/page.tsx:130-146` computes `usedByAgent` from `d.config?.policyHooks` — but `policyHooks` was deprecated in
v1.3 in favour of `capabilityBindings.guardrails`. It also fetches `/api/admin/agent` **without** `agentId` (line 131),
so it reads the default agent, not the selected version. → the "this guardrail is active" indicator is wrong/empty,
so testers can't tell which guardrails are live.
- **Fix:** read `capabilityBindings.guardrails` for the **selected** version (`?agentId=${selectedAgentId}`).

### B5 — [P2] Save→run race on the auto-save pages
`model`/`memory` debounce the save by 800ms. Edit → immediately switch to Playground → Run can fire before the save
flushes → playground runs stale config. **Fix:** flush the pending save on blur/route-change, or await it before Run.

---

## C — UI defects / dead-ends

### C1 — [P1] `knowledge` still uses native `alert()` / `confirm()`
`knowledge/page.tsx:153,159,166,171` — jarring browser dialogs, inconsistent with the shared `ConfirmDialog`
(introduced v1.3, used by guardrails/tools/case-types). **Fix:** swap to `ConfirmDialog` + inline error text.

### C2 — [P2] "Coming soon" dead entries
`channels/page.tsx:50` and `channels/web-chat/page.tsx:31` render "Coming soon" — if these are clickable nav cards,
testers land on a dead page. **Fix:** disable (with tooltip) or hide until real.

### C3 — [P2] Mislabeled checkbox on `model`
`model/page.tsx:150` maps the **Debug Mode** checkbox to the i18n key `'agent.showThinking'` (comment admits it has no
label); line 264 then hardcodes the literal `"Debug Mode"`. Minor, but it's a visibly wrong/untranslated label.

---

## Suggested fix order for the 2-day version (quick wins first)

1. **A1** (stuck skeletons) + **A2** (silent failures on save/toggle/delete) — these are the worst "卡壳/无反应".
2. **B2** (hardcoded `orgId` cache-bust) — near one-liner, removes a whole class of "not taking effect".
3. **C1** (knowledge alert/confirm) — fast, visible polish.
4. **B1** (unify save model + persistent save chip) — biggest "did it save?" relief; needs the owner's auto-vs-explicit pick.
5. **B4** (guardrails active-marker) , **B3** (draft/active clarity) — needs the owner's draft/active decision.
6. **B5, A3, C2, C3** — polish.

## Dispatch notes
- One coding agent is enough; **no sub-agents needed**. Light bar: fix + **manually click through each page** (load,
  edit, save, error path) — screenshots over formal tests. A keyless `npm test` + `build:console` green is plenty;
  no red→green guard-test ceremony for this UX pass.
- **✅ Owner decisions RESOLVED (2026-06-04):** (1) **auto-save + persistent chip everywhere** (B1); (2) **keep
  draft/active switching + add per-version release notes** (B3). Both specced inline above.
- **⚠️ Concurrency:** `guardrails/page.tsx` is currently owned by the in-flight **G11/policy agent** (its new
  configurable-hook UI is already there). **Skip the guardrails-page items (A3, B4, and guardrails' A2 catches) in
  this pass** to avoid a clobber — the architect folds those into the G11 review. `dictionaries.ts` is also touched by
  G11; append your keys (trivial merge).
- Items here are deliberately **pragmatic** — no enterprise/security scope. That lives in `2026-06-04-enterprise-saas-readiness.md`.

---

## Dispatch prompt (zero-context coding agent)

```text
You are a coding agent for Intera — a multi-tenant AI customer-service SaaS (Next.js 15 monorepo: apps/console +
packages/shared; Prisma 6 + PostgreSQL). Solo is fine; spawn sub-agents only if you want.

GOAL: make the agent-building console SMOOTH for internal testers — no dead buttons, no stuck pages, no "I configured
it but it didn't take effect." This is a pragmatic UX/bug pass for a minimal internal-test version.
BAR = works · smooth · no regressions. NOT enterprise-grade — do not add security or heavy test ceremony.

READ FIRST:
  1) doc/handoffs/2026-06-04-agent-build-ux-punchlist.md — THIS is your task list, file:line evidence per item.
  2) doc/handoffs/MASTER_BUILD_HANDOFF.md — the priority banner at the top.
  3) doc/handoffs/GENERIC_HANDOFF.md — project context (skim §0; the LIGHT bar below overrides its heavy test ceremony
     for this UX pass).

⚠️ COORDINATION: guardrails/page.tsx + parts of dictionaries.ts are being modified by another in-flight agent (G11).
  SKIP the guardrails-page items (A3, B4, and guardrails' A2 silent-catches). Append i18n keys to dictionaries.ts
  (expect a trivial merge). Touch everything else.

SCOPE — fix the punch-list. Two product decisions are RESOLVED; apply them:

  DECISION 1 — AUTO-SAVE + a persistent save-state chip everywhere (B1):
    • Page-level config (model, memory, case-types/[name] detail, channels/livechat, agent prompt fields): debounced
      auto-save + a PERSISTENT chip (未保存 / 保存中… / 已保存 ✓ / 失败 ✗). Reuse model/page.tsx's chip (lines 174-185)
      as the standard; remove ambiguous manual Save buttons on page-level config.
    • Modal/form entity editors (creating/editing a skill, policy, knowledge source): keep an explicit Save inside the
      modal, but show a clear save result and confirm-if-dirty on cancel/close so nothing is lost silently.
    • Net goal: no page leaves the user wondering "did it save?", and no edit is lost without warning.

  DECISION 2 — KEEP draft/active version switching + ADD per-version release notes ("commit message") (B3):
    • Schema: add to AgentConfig → releaseNote String?, publishedAt DateTime?, publishedBy String? (userId). New
      migration with a FRESH numeric prefix (never rename applied migrations).
    • On Activate/Publish a version: show a small dialog for a short release note ("what changed"); save it on that
      version + stamp publishedAt + publishedBy (current user from session).
    • Version history: in AgentVersionPicker (or a small panel on the agent page) list versions with releaseNote +
      who + when + the active badge — a readable changelog.
    • Clarity fixes: glaring active-vs-draft badge in VersionContextBar; in playground, if selected ≠ active, show a
      "测试草稿 vN（未上线）" note.

  REMAINING PUNCH-LIST ITEMS:
    A1 wrap every admin page's initial load in try/catch/finally(setLoading(false)) + an error+retry state (copy
       model/page.tsx) — no more infinite skeletons. Confirmed broken example: guardrails load() 121-126 (but that
       file is G11's — fix the SAME pattern on the other pages: agent, tools, memory, case-types, knowledge, members,
       channels, api-keys, playground).
    A2 user-initiated writes (save/toggle/delete) surface a visible error instead of silent .catch(()=>{}) — except
       guardrails (G11 owns it).
    B2 replace hardcoded orgId:'default' in the /api/admin/config-changed cache-bust with the SESSION's orgId
       (model:88, memory:119, tools:164, case-types:48).
    B5 flush pending auto-save on navigation/blur so playground never runs stale config.
    C1 knowledge: replace native alert()/confirm() (153,159,166,171) with the shared ConfirmDialog + inline errors.
    C2 channels/web-chat "Coming soon": disable (tooltip) or hide the dead entry (channels/page.tsx:50, web-chat:31).
    C3 model: fix the mislabeled Debug Mode checkbox (model:150 maps to 'agent.showThinking'; 264 hardcodes "Debug Mode").

SUGGESTED ORDER: A1, A2 → B2 → C1 → Decision-1 (auto-save) → Decision-2 (versions/release notes) → B5, C2, C3.

LIGHT BAR (UX pass, not hardening):
  - Verify by MANUALLY clicking through each page: load, edit, watch the auto-save chip, error path (e.g. devtools
    offline), activate-a-version-with-a-note, switch versions. Capture screenshots.
  - npx tsc --noEmit -p apps/console/tsconfig.json   → 0 errors
  - env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npm test   → green (keyless)
  - npm run build:console   → success
  - No red→green guard-test ceremony required. Just don't break existing tests.
  - Do NOT deploy. Local only. Do NOT touch SSH creds, the DB password, or rotate anything.

WHEN DONE: paste changed files + the three gates + screenshots; update MASTER_BUILD_HANDOFF.md (mark punch-list items
done); note anything deferred. If a punch-list item turns out wrong or risky, STOP and flag it rather than forcing it.
```
