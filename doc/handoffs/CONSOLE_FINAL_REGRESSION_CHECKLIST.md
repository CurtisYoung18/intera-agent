# Console Final Regression Checklist

**Last updated:** 2026-06-10  
**Scope:** final native-route verification for `Build / Operate / Settings` after the Console rebuild  
**Approved compatibility boundary:** legacy `/admin/*` and `/ops/*` may remain only as thin wrappers or redirects; target route implementation ownership must stay native

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

Run in this order:

```bash
git diff --check
npx vitest run apps/console/app/__tests__/native-route-invariants.test.ts
npx tsc --noEmit -p apps/console/tsconfig.json
env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npm test
rm -rf apps/console/.next && npm run build:console
npm run smoke:console
```

If any command fails, do not claim final regression is green.

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

### Build

- `/build/pilot-lab`
  - `Pilot` tab loads
  - `Playground` tab still works
  - ConfigPilot can load context / propose / accept / apply-draft path
  - runtime-backed vs fixture-only receipts are visibly distinct
  - `Playground` still restores session/trace evidence and behaves as the runtime/manual-test surface
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
  - edit Procedure steps
  - step Hook binding
- `/build/components/hooks`
  - create Hook
  - add/remove binding
  - declarative/code/http modes visible
- `/build/components/tools`
  - create business Tool
  - HTTP test / fixture preview
  - runtime-managed Tool row is visible and locked
- `/build/components/knowledge`
  - GPTBots connect state
  - source CRUD
  - retrieval test
- `/build/components/integrations`
  - API key CRUD
  - LiveChat config/group state
  - Web Chat embed surface

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

---

## 5. Receipt minimum

A final regression receipt must state:

1. native-route invariant result
2. `tsc` result
3. keyless full test result
4. clean `build:console` result
5. browser smoke result or explicit blocker
6. whether any remaining non-Playground wrapper import still exists
7. whether legacy `/admin/*` and `/ops/*` entry points redirect into the native surfaces without exposing old UI

The correct final statement is:

```text
Build / Operate / Settings target routes are native.
Playground is the only approved compatibility reuse.
```
