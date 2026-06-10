# Console Native Rebuild And Regression Plan

**Last updated:** 2026-06-10  
**Audience:** architect, coding-team leads, zero-context implementation lanes  
**Objective:** rebuild all target Console pages as native Build / Operate / Settings workspaces, align them to the approved spec and current backend, and stop satisfying new routes by wrapping old `admin` or `ops` page components.  
**Allowed compatibility exception:** `Playground` only.

---

## 1. Hard rules

1. Target routes under `apps/console/app/build/**`, `apps/console/app/operate/**`, and `apps/console/app/settings/**` must not import page components from `@/app/admin/**` or `@/app/ops/**`.
2. Old routes may stay as redirects or compatibility entry points, but they are not the source of truth for the new IA.
3. Backend reuse is allowed. Page reuse is not. A native page may call current endpoints such as `/api/admin/case-types` until a backend rename lane is approved.
4. Visible product language must stay on `Brain`, `Procedure`, `Tool`, `Hook`, `Knowledge`, `Integration`, `Conversation`, `Human Handoff`, `Trace`, `Memory`, and `ProcedureRun`.
5. `Playground` is the only approved compatibility reuse in P0 because it is already the Runtime Truth Desk + Manual Test Bench, and dry-run plus Trace Sidebar parity is high-risk to rewrite casually.

---

## 2. Current gap inventory

| Route family | Current state | Status |
|---|---|---|
| `/build/release` | Native `ReleaseCommandCenter` page | acceptable |
| `/build/pilot-lab` | Native Pilot Lab workspace; may embed existing Playground implementation | acceptable with ongoing polish |
| `/build/components/brain` | native Brain workspace now owns model, memory, profile, and compact-test sections | acceptable with browser verification follow-up |
| `/build/components/procedures` | native list/detail pages now exist against current `/api/admin/case-types` contracts, but visible UX still says `Procedure Type` | acceptable with explicit vocabulary follow-up |
| `/build/components/tools` | native page now exists against current tool/test/knowledge-source endpoints, but Tool-scope Hook binding is not surfaced here | acceptable with scope caveat |
| `/build/components/hooks` | native route shell now mounts the shared HookBuilder directly against current Hook endpoints; no simulation panel ships | acceptable with scope caveat |
| `/build/components/knowledge` | native page now exists against current knowledge/GPTBots/test endpoints and remains contract-first in some retrieval controls | acceptable with browser verification follow-up |
| `/build/components/integrations` | native Build workspace now owns channels and API key surfaces; Web Chat is still embed-script-first | acceptable with scope caveat |
| `/operate/conversations` | native Operate route family now mounts shared conversation/chat-detail/ProcedureRun-detail workspaces directly | acceptable with browser verification follow-up |
| `/operate/handoff` | queue page and user-profile detail route are both native Operate workspaces | acceptable with browser verification follow-up |
| `/settings/organization` | native Settings workspace now mounts the organization workspace directly | acceptable with browser verification follow-up |

---

## 3. Backend contract matrix

Use these backend surfaces as the current integration baseline while rebuilding native pages.

| Page | Backend/API truth | Notes |
|---|---|---|
| Release | agent config/version endpoints, package import/export endpoints, scenario validation metadata, config-changed state | native already; keep package and validation truth |
| Pilot Lab | `/api/admin/config-pilot/context`, `/propose`, `/apply`; `/api/admin/scenarios`, `/run` | no publish/deploy/rollback inside Pilot; Scenario `fixture` and `agentRuntime` truth must stay visibly distinct |
| Playground | `/api/admin/playground/run`, `/api/admin/playground/sessions*`, shared prompt/runtime path | native Pilot Lab workspace over the proven runtime path; `/admin/playground` remains a compatibility wrapper while selected Agent version runs through real prompt/runtime with `dryRun` side-effect mocking and persisted trace/message restore |
| Brain | `/api/admin/agent?agentId=...`, `/api/admin/models`, `/api/admin/agent/assembled-prompt` | one native Brain workspace; no old model page reuse |
| Procedures | `/api/admin/case-types`, `/api/admin/case-types/[name]`, Hook data needed for step bindings | UI now says Procedure Type even if backend still says case type |
| Hooks | `/api/admin/hooks`, `/api/admin/hooks/[name]`, bindings routes | native route exists; Hook simulation still needs explicit native UI |
| Tools | `/api/admin/tools`, `/api/admin/tools/test`, knowledge source toggle data where needed | system-managed tools stay locked and visible; Tool-scope Hook binding currently lives on Hooks, not Tools |
| Knowledge | `/api/admin/knowledge/sources`, `/api/admin/knowledge/gptbots`, `/api/admin/knowledge/test` | UI should keep Procedure scope wording only; backend `caseTypeTag` remains an implementation detail |
| Integrations | `/api/admin/api-keys`, `/api/admin/agent-configs`, `/api/admin/livechat/config`, `/api/admin/livechat/groups` | new IA now stays inside Build; current shipped truth is Channels + API Keys with embed-first Web Chat |
| Conversations | `/api/chats`, `/api/chats/[chatId]`, linked chat/user/case detail APIs | native Operate workspaces now exist for list and detail routes; browser QA still needs real-data confirmation |
| Handoff | `/api/cases?status=waiting_human`, `/api/cases/[id]`, `/api/users/[userId]/profile`, `/api/users/[userId]/chats` | queue and user-profile detail are native; dedicated HumanTask backend remains a later product lane |
| Organization | `/api/admin/organizations/[orgId]`, `/api/admin/members`, `/api/admin/invitations` | new route must stop exporting old admin page |

---

## 4. Regression verification matrix

Every native page rebuild must satisfy all four categories before the lane is considered complete.

| Page | Functional verification | Vocabulary verification | Route/source verification | Browser verification |
|---|---|---|---|---|
| Release | package actions, validation state, version timeline | no old Blueprint/Policy/Guardrail/Skill language | no route-level import from old pages | desktop + mobile no overflow |
| Pilot Lab | context load, propose, accept, apply, scenario run | no publish wording, no old drawer wording | only Playground may reuse old implementation | desktop + mobile + reduced motion |
| Brain | model save, prompt save, assembled preview, memory save, compact test | no old agent-config drawer/product language | native Brain page tree | desktop + mobile sections usable |
| Procedures | create/edit/delete Procedure type, step editing, Hook step binding | Procedure-first copy preferred; current audited exception is visible `Procedure Type` wording while Legacy runtime authoring stays hidden | native pages, no `/admin/case-types` imports | desktop + mobile read-only behavior if editing is desktop-only |
| Hooks | create/edit/delete Hook, add/remove binding, code/HTTP/declarative modes | no Guardrail/Policy language | native route shell; current editor still uses shared `components/admin/hook-builder.tsx` | desktop + mobile states |
| Tools | create HTTP/static tool, endpoint test, system tool read-only, knowledge-tool awareness | no Skill language | native page, no `/admin/tools` import; Tool-scope Hook binding is still not exposed here | desktop + mobile states |
| Knowledge | GPTBots connect, source CRUD, retrieval test | Procedure Type language only | native page, no `/admin/knowledge` import | desktop + mobile states |
| Integrations | API key CRUD, LiveChat connection/rendering/escalation, Web Chat embed | no stale `/api/cases` tutorial truth | native page, no `/admin/integrations` import | desktop + mobile states |
| Conversations | list load, delete, open detail, linked ProcedureRun/user/trace context | no old ops copy | native route family, no `/app/ops/chats/*` or `/app/ops/cases/[caseId]` exports | desktop + mobile states |
| Handoff | queue load, detail load, jump links, profile edit/delete | current language only | queue and detail routes native | desktop + mobile states |
| Organization | org name save, member role change, invite, share link, revoke | no old admin shell truth | native page, no `/app/admin/organization/page.tsx` export | desktop + mobile states |

Common gates per lane:

1. `git diff --check`
2. focused tests for changed surface
3. `npx tsc --noEmit -p apps/console/tsconfig.json`
4. `env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npm test`
5. `rm -rf apps/console/.next && npm run build:console`
6. `npm run smoke:console` for authenticated local route verification, with `BROWSER_SMOKE_RUNBOOK.md` as the authoritative setup/runbook

Final cross-route signoff checklist lives in:

- [`CONSOLE_FINAL_REGRESSION_CHECKLIST.md`](./CONSOLE_FINAL_REGRESSION_CHECKLIST.md)

---

## 5. Recommended implementation order

1. Final verification sweep
   Why: all target native pages now exist; the next risk is regression and browser truth, not route-wrapper drift.

---

## 6. Lane boundaries

If parallelizing:

- Lane A: final regression sweep and browser screenshots

Keep `apps/console/lib/i18n/dictionaries.ts` and high-collision shell files for a late vocabulary sweep unless a lane truly needs visible new copy.
