# Console Final Regression Checklist

**Last updated:** 2026-06-10  
**Scope:** final native-route verification for `Build / Operate / Settings` after the Console rebuild  
**Approved compatibility boundary:** legacy `/admin/*` and `/ops/*` may remain only as thin wrappers or redirects; target route implementation ownership must stay native
**Final acceptance environment:** `https://demo.anytrans.ai`

---

## 1. Native-route invariant

This must stay true before any broader smoke or deploy:

- `apps/console/app/build/**`
- `apps/console/app/operate/**`
- `apps/console/app/settings/**`

must not import or re-export old page components from:

- `@/app/admin/**`
- `@/app/ops/**`

Enforced by:

```bash
npx vitest run apps/console/app/__tests__/native-route-invariants.test.ts
```

That invariant now covers both:

- old `admin/ops` page imports or re-exports inside target routes
- direct user-navigation patterns that point primary Build / Operate / Settings surfaces back to `/admin/*` or `/ops/*`
- stale visible legacy product terminology on primary route trees and the directly relevant i18n dictionary values

---

## 2. Required command gates

Run in this order as local preflight:

```bash
git diff --check
npx vitest run apps/console/app/__tests__/native-route-invariants.test.ts
npx tsc --noEmit -p apps/console/tsconfig.json
env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npm test
rm -rf apps/console/.next && npm run build:console
npm run smoke:console
```

If any command fails, do not claim final regression is green.

These commands do not replace production acceptance. After they pass, repeat the route and workflow checks that matter on:

```text
https://demo.anytrans.ai
```

Final regression is not green until production screenshots, production interaction proof, and production persistence/runtime evidence are captured.

### Vocabulary scan

The invariant test already hard-fails obvious visible regressions, but an explicit grep is still useful when reviewing a larger diff:

```bash
rg -n "CaseType|case type|Guardrail|guardrail|Policy|policy|Skill|skill|Sub-Agent|sub-agent" \
  apps/console/app/build \
  apps/console/app/operate \
  apps/console/app/settings \
  apps/console/components/brain \
  apps/console/components/integrations \
  apps/console/components/operate \
  apps/console/components/settings \
  apps/console/components/memory
```

Allowlist only when the hit is:

- an internal type/interface name
- a backend/API contract detail
- the approved Playground compatibility surface
- an explicit historical note in docs

Current known internal-only examples that are acceptable until a dedicated contract rename lands:

- `CaseTypeItem`
- `CaseTypeOption`
- `lastCaseType`
- `showSkillStatus`

---

## 3. Functional route matrix

Route acceptance means all subpages, tabs, panels, modals, drawers, detail routes, action menus, empty/loading/error states, and CRUD/test actions under that route. A page-load screenshot or one happy-path click is not enough.

Current manual baseline:

- `Playground`, `Knowledge`, and `Hooks` have been manually exercised and are directionally close, but still need production retest, complete function coverage, and fix closure.
- `Procedures`, `LiveChat/Integrations`, `Tools` rich-message rendering, Release, Pilot, Operate, Settings, and auth/org flows must be treated as unaccepted until production evidence exists.
- LiveChat test configuration may use `/Users/curtis/Desktop/live chat config backup.md`, but secrets must stay out of repo docs and receipts.
- Every UI-facing CRUD/test/import/export/publish/rollback action must have screenshot or screen-recording proof.
- Pilot acceptance must wait for Pilot commercial Gate A-D implementation; do not mark the unfinished Pilot cockpit as failed or passed before it exists.

### Build

- `/build/pilot-lab`
  - `Pilot` tab loads
  - Pilot commercial Gate A-D acceptance is complete before final Pilot signoff
  - `Playground` tab still works
  - ConfigPilot can load context / propose / accept / apply-draft path
  - runtime-backed vs fixture-only receipts are visibly distinct
  - `Playground` still restores session/trace evidence and behaves as the runtime/manual-test surface
  - J1B Tools from `doc/tools-real/business-tools-backup.ts` are seeded/imported into the production J1B Agent Draft before J1B acceptance
  - member ids from `doc/测试用户ID.md` are used when the Agent asks for `member_id`
  - all 12 J1B P0 scenarios have at least 3 accepted production conversation flows each
  - at least one accepted flow includes targeted Intera Agent system prompt tuning and rerun proof
  - at least one long run reaches memory auto compact or 30 customer messages with 30 Agent responses
  - no publish action
- `/build/release`
  - version timeline
  - package import/export
  - validation status / latest receipt
- `/build/components/brain`
  - model save
  - prompt save / assembled prompt preview
  - memory strategy save
  - compact test
- `/build/components/procedures`
  - create Procedure type
  - open detail
  - create/edit/delete/enable/disable all work
  - edit Procedure steps
  - step Hook binding
  - refresh preserves saved steps and bindings
  - runtime ProcedureRun evidence agrees with configured Procedure where applicable
- `/build/components/hooks`
  - create Hook
  - add/remove binding
  - declarative/code/http modes visible
  - all scopes tested: agent, Procedure type, Procedure step, Tool
  - failure states are recoverable and understandable
- `/build/components/tools`
  - create business Tool
  - HTTP test / fixture preview
  - runtime-managed Tool row is visible and locked
  - render hints / rich-message output is previewed or proven for LiveChat readiness
  - failed Tool test shows actionable error
- `/build/components/knowledge`
  - GPTBots connect state
  - source CRUD
  - retrieval test
  - Procedure scoping and retrieval options survive refresh
- `/build/components/integrations`
  - API key CRUD
  - LiveChat config/group state
  - Web Chat embed surface
  - LiveChat config load/save path works
  - webhook-style ingress to `/api/messages` is proven or explicitly blocked
  - Tool rich-message/render-hint response shape is proven before LiveChat console joint debugging
  - incomplete LiveChat credentials/groups show clear recovery states

### Operate

- `/operate/conversations`
  - inbox load
  - search/filter
  - delete chat
  - open conversation detail
- `/operate/conversations/[chatId]`
  - transcript
  - ProcedureRun pills/jump links
  - Trace / Memory / export / delete
- `/operate/conversations/cases/[caseId]`
  - ProcedureRun detail
  - trace timeline
  - metrics/tool-call panels
- `/operate/handoff`
  - waiting queue
  - detail load
  - conversation + ProcedureRun jump links
- `/operate/handoff/[userId]`
  - profile load
  - edit/save
  - delete
  - linked chat history

### Settings

- `/settings/organization`
  - org profile save
  - members
  - invitations
  - permissions tabs

---

## 4. Browser smoke rule

Use the repo smoke script under the rules in:

- [BROWSER_SMOKE_RUNBOOK.md](./BROWSER_SMOKE_RUNBOOK.md)

If local auth/DB blocks the run:

- stop after the approved timebox
- record the exact blocker
- keep static gates as authoritative evidence for that lane

Do not invent a second local cookie/JWT/auth harness unless the lane explicitly owns QA infrastructure.

Local browser smoke is a preflight gate. The final browser acceptance must still happen on `https://demo.anytrans.ai`.

While performing production acceptance, do not inspect only the named route and ignore neighboring breakage. If a linked page, side panel, route transition, save state, trace panel, receipt, or adjacent workflow breaks while testing the target, classify it and fix it under the same final regression effort unless the owner explicitly defers it.

---

## 5. Receipt minimum

A final regression receipt must state:

1. native-route invariant result
2. `tsc` result
3. keyless full test result
4. clean `build:console` result
5. local browser smoke result or explicit blocker
6. production acceptance URL list under `https://demo.anytrans.ai`
7. production screenshot paths
8. production interaction/persistence/runtime proof
9. adjacent issues found during acceptance, and whether they were fixed or owner-deferred
10. whether any remaining non-Playground wrapper import still exists
11. whether legacy `/admin/*` and `/ops/*` entry points redirect into the native surfaces without exposing old UI

The correct final statement is:

```text
Build / Operate / Settings target routes are native.
Playground is the only approved compatibility reuse.
Final acceptance was completed on https://demo.anytrans.ai.
```
