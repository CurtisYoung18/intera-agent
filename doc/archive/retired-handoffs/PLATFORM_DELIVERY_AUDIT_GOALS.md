# Platform Delivery Audit Goals

**Last updated:** 2026-06-10
**Audience:** founder, architect, delivery lead, QA lead, coding-team leads, zero-context coding agents
**Purpose:** turn the remaining Intera work into strict, evidence-backed delivery goals before the first commercial customer deployment.

---

## 0. Highest Bar

The acceptance bar is not "it compiles", "it is reachable", or "it basically works".

Every implementation and every fix must prove that the feature is:

- **Functionally correct:** the intended user workflow completes end to end with real persistence, real API behavior, and no hidden manual workaround.
- **User-friendly:** the next action is obvious, labels are clear, errors are understandable, empty/loading/success/failure states are handled, and a delivery person can operate it without code knowledge.
- **Visually polished:** layout, spacing, hierarchy, responsive behavior, iconography, motion, and screenshots meet the approved Quiet Agent Studio / UI2 standard.
- **Operationally truthful:** UI copy and receipts clearly distinguish Draft vs Live, fixture vs runtime-backed, mocked side effects vs live external actions, synthetic debug sessions vs customer-channel truth.
- **Regression-safe:** focused tests, full static gates, browser smoke, screenshots, and receipts prove the change did not break adjacent surfaces.

Reject any feature as incomplete if it is merely usable but awkward, visually rough, confusing, misleading, flaky, hard to recover from, or impossible to prove with screenshots and receipts.

Production is the acceptance environment. Local tests, local browser smoke, and local screenshots are required preflight evidence, but they do not count as final acceptance. Final acceptance must be performed on:

```text
https://demo.anytrans.ai
```

If production is unavailable, authentication is blocked, deploy is blocked, or the relevant production data cannot be prepared, the goal remains blocked. Do not downgrade the goal to "accepted locally".

Do not tunnel-vision on the named feature. If auditing one workflow exposes a broken adjacent workflow, stale copy, confusing UI, layout regression, bad error state, missing persistence, trace mismatch, or runtime inconsistency, classify and fix it in the same delivery loop unless the owner explicitly moves it to a later commercial-risk register. The target is whole-platform alignment, not isolated checkbox completion.

Quality wins over speed. Do not stop because the audit is long, the screenshots are tedious, or the fix crosses more files than expected. Stop only for a real external blocker, an ownership conflict, or an explicit owner decision.

---

## 1. Current Manual Coverage Baseline

Do not infer broad product readiness from the manual checks completed so far.

Current known manual coverage:

- `Playground`: manually tested and directionally useful, but still requires production retest, full runtime proof, copy cleanup, rich evidence review, and adjacent Operate/Release verification.
- `Knowledge`: manually tested and mostly acceptable, but still requires production retest, delivery-person UX review, error-state review, GPTBots/source/retrieval proof, and adjacent Tool/Procedure scope verification.
- `Hooks`: manually tested and mostly acceptable, but still requires production retest, all scope bindings, handler modes, error states, and missing simulation/test-surface decision.
- Everything else: not accepted until fully audited on production with screenshots, interaction proof, persistence proof, and fix closure.

High-priority unproven areas:

- `Procedures`: must be audited end to end, including list/detail creation, step editing, ProcedureStep Hook binding, runtime ProcedureRun behavior, stale copy, and whether the UI still feels like legacy CaseType administration.
- `LiveChat integration`: must be audited before first customer delivery. The LiveChat console side may wait until after this optimization pass for full joint configuration, but Intera's basic chain must be ready first: stored config, channel state, webhook ingress, `/api/messages` runtime handoff, response egress shape, and Tool rich-message/render-hint rendering.
- `Tools`: must prove not only CRUD/test behavior, but also the customer-visible rendering path for rich messages/cards that LiveChat will consume.
- `Pilot commercial readiness`: Gate A-D from `doc/strategy/2026-06-10-pilot-commercial-readiness-proposal.md` must be executed as part of the same delivery push, not treated as a detached future idea.
- `Release`, `Pilot`, `Operate`, `Settings`, `Integrations`, and auth/org flows: must not be treated as passing without production route-by-route audit.

LiveChat test configuration reference:

```text
/Users/curtis/Desktop/live chat config backup.md
```

Use that file as the local test configuration source when needed, but do not paste secrets or raw customer/channel credentials into repo docs or receipts. Receipts should state that the backup file was used and list only non-sensitive proof: route tested, config presence, webhook response, rendered message type, screenshots, and redacted IDs.

---

## 2. Subpage Completeness And Fix Closure

Every page, subpage, tab, panel, modal, drawer, sidebar, detail route, empty state, and action menu must be audited. A top-level route load does not count as page acceptance.

For each audited surface, test every meaningful function:

- create, read, update, delete, enable, disable, duplicate, import, export, publish, rollback, run, retry, restore, search, filter, save, cancel, dismiss, copy, test, and delete where present
- happy path, missing input, invalid input, network/API failure, empty data, long text, loading, success, warning, destructive confirmation, and permission/disabled states
- refresh persistence, route navigation away/back, selected Agent/version changes, and cross-surface evidence after mutation
- desktop and supported responsive states
- production behavior on `https://demo.anytrans.ai`

Fix closure means:

- reproduce the failure
- fix the actual product behavior, not only the visible symptom
- add or update focused tests where practical
- run universal gates
- redeploy or use the approved production path
- retest the original failure on `https://demo.anytrans.ai`
- capture before/after screenshots or trace/receipt proof
- verify adjacent workflows touched by the fix

Do not close a defect as "known issue" when it affects delivery confidence, user trust, UI polish, runtime truth, release safety, LiveChat readiness, Procedure correctness, or evidence quality.

### Pilot Commercial Readiness Gate Standards

The detailed construction guide is:

```text
doc/strategy/2026-06-10-pilot-commercial-readiness-proposal.md
```

That document's Gate A-D work must be accepted under this platform-level standard, not only under local unit tests.

| Gate | Delivery target | Acceptance standard |
|---|---|---|
| Gate A - Schema / Contracts | durable Pilot session, proposal, plan, handoff, audit, and permission contracts | migrations/contracts/tests pass; data is persisted in Postgres; operator/viewer/admin permissions are enforced; stale draft fingerprint protection is covered; production can create/read the new records without leaking into customer memory. |
| Gate B - Session / Planning | resumable Pilot operator thread and planning state | same draft opens the canonical Pilot session after refresh; a second authorized staff member can inspect or take over according to rules; todos/plan state survive reload; screenshots prove production resume, takeover/audit trail, and permission behavior. |
| Gate C - Proposal / Validation | clarification, proposal revision, receipt-driven fix loop, validation stale rules | ambiguous request asks clarification before patch; revised proposal creates a new record; apply is draft-only and fingerprint-guarded; every apply marks validation stale; runtime-backed receipt after apply can restore readiness; fixture-only evidence never claims release readiness. |
| Gate D - UI / Self-Audit | polished Pilot cockpit, release handoff, and self-audit receipt | UI is production-tested at desktop/1024/mobile-supported states; no publish/deploy action exists in Pilot; handoff summary links Release, receipts, relevant component surfaces, and risks; final `Pilot Commercial Readiness Receipt` includes screenshots, command gates, production proof, and remaining blockers. |

Pilot Gate acceptance also requires:

- all Gate A-D automated tests and migrations pass locally before deploy
- all Gate A-D user-facing workflows are repeated on `https://demo.anytrans.ai`
- every Gate has a receipt with production screenshots, interaction proof, persistence proof, and adjacent issue closure
- Pilot still respects the product boundary: Pilot owns draft authoring and guided validation, Playground owns runtime truth, Release owns publish/version/package truth
- no Gate may be marked complete if it only works in local state, local JSON, mock UI state, or hidden ephemeral scenarios
- Gate C/D must prove validation-native behavior with named durable Scenarios and runtime-backed receipts
- the final `Pilot Commercial Readiness Receipt` must be included in the broader platform delivery receipt pack

Execution order correction:

- Build Pilot Commercial Readiness Gate A-D before attempting final Pilot acceptance.
- Full Console UX Audit may still cover navigation, shell, Release, Components, Operate, Settings, and existing Playground while Pilot is under construction, but the `Pilot` cockpit itself cannot be marked accepted until Gate A-D passes.
- J1B Playground acceptance starts only after the J1B production Agent Draft has the required business Tools seeded/imported and test member ids are available.

---

## 3. Required Evidence Format

Every phase below must produce a receipt. A receipt can live in `.artifacts/delivery-audit/<date>/<phase>/summary.md` during execution, then be summarized into `doc/what's done/` after completion.

Minimum receipt fields:

| Field | Required proof |
|---|---|
| Scope | Exact routes, APIs, files, workflows, and data fixtures covered. |
| Commands | Exact command run, pass/fail result, and short failure explanation if blocked. |
| Production URL | The exact `https://demo.anytrans.ai` route tested for final acceptance. |
| Screenshots | Desktop screenshots for every changed or audited primary page; add 1024px screenshots for complex Console pages and mobile screenshots for supported mobile/light-action pages. |
| CRUD screenshots | Screenshots or screen recordings for every meaningful create/read/update/delete/enable/disable/test/import/export/publish/rollback action on UI-facing pages. |
| Interaction proof | Short step log showing what was clicked, typed, accepted, saved, published, imported, exported, or restored. |
| Persistence proof | Refresh, reopen, restore session, DB/API readback, exported package, or trace evidence proving the result survived beyond local component state. |
| UX/aesthetic proof | Notes confirming layout, spacing, labels, empty/loading/error states, focus states, hover/selected states, reduced-motion behavior where relevant, and no text overflow. |
| Runtime proof | Tool calls, Hook decisions, ProcedureRun state, Trace entries, Scenario receipt, or `ActionTrace` evidence where relevant. |
| Adjacent findings | Any unrelated issue found while testing, its severity, whether it was fixed immediately, and the evidence for the fix. |
| Residual risk | Anything not covered, intentionally mocked, blocked by environment, or deferred with owner approval. |

Screenshots should be named by route and state, for example:

```text
.artifacts/delivery-audit/2026-06-10/phase-2/build-pilot-lab-pilot-desktop.png
.artifacts/delivery-audit/2026-06-10/phase-3/playground-deposit-trace-sidebar.png
.artifacts/delivery-audit/2026-06-10/phase-4/release-import-dry-run.png
```

---

## 4. Universal Gates For Any Implementation Or Fix

Run these for every implementation/fix before it is allowed to reach production acceptance. A lane may add more tests, but it cannot remove these without explicit owner approval.

```bash
git diff --check
npx tsc --noEmit -p apps/console/tsconfig.json
env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npm test
rm -rf apps/console/.next && npm run build:console
```

For UI, route, runtime, release, package, auth, or admin workflow changes, also run:

```bash
npm run smoke:console
```

If local browser smoke is blocked, follow `BROWSER_SMOKE_RUNBOOK.md`: timebox, record the exact blocker, and provide screenshots or production smoke evidence through the approved path instead of inventing a one-off auth harness.

No feature can be accepted from tests alone when the user experience changed. UI changes need browser evidence.

No feature can be finally accepted from local evidence alone. After local gates pass, deploy or use the approved production path and repeat the relevant acceptance workflow on `https://demo.anytrans.ai`.

Production acceptance minimum for every user-facing implementation/fix:

- production route loads on `https://demo.anytrans.ai`
- the changed workflow completes in production
- production screenshot proves the final UI state
- production persistence or runtime evidence proves the data did not only live in local component state
- any adjacent production issue discovered during the workflow is fixed, retested, or explicitly owner-deferred

---

## 5. Phase 0 - Audit Harness And Baseline

**Goal:** establish the exact baseline that all later phases compare against.

Acceptance checklist:

- `git status --short --branch` captured.
- Current branch, local commit, and relationship to `origin/main` captured.
- Current active hotfix worktree status checked if deploy is in scope.
- Environment captured: Node version, npm version, local DB status, and whether `npm run smoke:console` can authenticate.
- `.artifacts/delivery-audit/<date>/` folder created for receipts and screenshots.
- Existing dirty files listed and classified as in-scope, out-of-scope, or user/parallel-lane owned.
- `git diff --check` run before any implementation begins.
- Known docs read and cited in the receipt:
  - `MASTER_BUILD_HANDOFF.md`
  - `FOUNDATION_RESET_ROADMAP_CURRENT.md`
  - `CONSOLE_FINAL_REGRESSION_CHECKLIST.md`
  - `BROWSER_SMOKE_RUNBOOK.md`
  - this file

Proof required:

- Baseline receipt.
- Screenshot of login or route smoke start state if browser is available.
- Exact blocker evidence if browser/auth/DB is not available.

---

## 6. Phase 1 - Command And Test Gate

**Goal:** prove the codebase is mechanically healthy before judging product behavior.

Acceptance checklist:

- `git diff --check` passes.
- `npx vitest run apps/console/app/__tests__/native-route-invariants.test.ts` passes.
- `npx tsc --noEmit -p apps/console/tsconfig.json` passes.
- `env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npm test` passes.
- `rm -rf apps/console/.next && npm run build:console` passes.
- `npm run smoke:console` passes, or an approved runbook blocker is recorded.
- Any focused test added or changed for the lane passes independently.

Proof required:

- Command transcript summary with pass/fail and timestamps.
- If a test is skipped, the receipt must explain why it is safe and who approved it.
- If `.next` contention or auth/DB blocks smoke, include the exact error and the substituted evidence.

---

## 7. Phase 2 - Full Console UX Audit

**Goal:** prove every Build / Operate / Settings surface is useful, clear, polished, and aligned with current product truth.

Audit every route below on `https://demo.anytrans.ai`. Local audit may be used for preflight, but the receipt must prove the production route and production interaction. For each route, verify desktop, 1024px where applicable, loading state, empty state, error state, primary action, destructive action if present, save/apply behavior, and refresh persistence.

Each row below means all subpages and controls under that surface, not a single happy-path click.

### Build

| Route | Must prove |
|---|---|
| `/build/pilot-lab` | `Pilot` loads, ConfigPilot context/propose/accept/apply flow is clear, no publish action appears, right-panel diff/review states are understandable, `Playground` tab remains accessible. |
| `/build/pilot-lab?tab=playground` | Manual runtime test works, session restore works, Trace Sidebar works, mocked side effects are clear, old legacy copy does not mislead users. |
| `/build/release` | Live/Draft/Historical state is understandable, version timeline is usable, validation freshness is visible, import/export/publish/rollback actions explain consequences before mutation. |
| `/build/components/brain` | Model, prompt, memory, profile, assembled prompt, and compact test are understandable and save correctly. |
| `/build/components/procedures` and `/build/components/procedures/[name]` | Procedure list/detail editing is clear, create/edit/delete/enable/disable flows work, steps are understandable, step Hook binding works, runtime-facing Procedure meaning is truthful, and the surface does not feel like old CaseType-only admin UI. |
| `/build/components/tools` | Custom Tool creation/edit/delete/test works, runtime-managed Tools are visibly locked, HTTP/static fixture modes are understandable, Tool errors are helpful, render hints/rich-message output can be previewed or proven, and Tool output shape is ready for LiveChat rendering. |
| `/build/components/hooks` | Hook create/edit/delete/binding works across scopes, handler modes are clear, missing simulation coverage is either implemented or explicitly marked as a residual risk. |
| `/build/components/knowledge` | GPTBots connection, source CRUD, Procedure scoping, retrieval test, and advanced knobs are understandable to a delivery person. |
| `/build/components/integrations` | API keys, LiveChat config/groups, Web Chat embed boundary, and channel state are clear and do not overpromise unavailable widget behavior. LiveChat basic chain readiness must be proven even if full LiveChat console joint configuration waits until after this optimization pass. |

### Operate

| Route | Must prove |
|---|---|
| `/operate/conversations` | Inbox loads, filters/search work, delete is safe, conversation detail opens, empty/error states are useful. |
| `/operate/conversations/[chatId]` | Transcript, ProcedureRun context, Memory, Trace, export, and delete states are usable and visually coherent. |
| `/operate/conversations/cases/[caseId]` | ProcedureRun detail, tool-call evidence, metrics, and trace timeline are readable and useful for debugging. |
| `/operate/handoff` | Waiting-human queue, status labels, and jump links work. |
| `/operate/handoff/[userId]` | User profile, edit/save/delete, linked chat history, and escalation context work. |

### Settings And Auth

| Route | Must prove |
|---|---|
| `/settings/organization` | Organization profile, members, invitations, role changes, permission copy, and save states work. |
| `/login` | Staff login is polished, responsive, and not visually broken. |
| `/org-picker` | Organization selection is clear and responsive. |

Proof required:

- Screenshot for every route above.
- Each screenshot must be from `https://demo.anytrans.ai` unless it is clearly labeled as local preflight only.
- For each route, at least one interaction proof beyond page load.
- For each subpage/tab/modal/detail route, at least one function-specific proof.
- UX notes confirming no text overflow, no broken responsive layout, no confusing stale terminology, no dead primary action, no misleading success state.
- A route matrix marking each route `pass`, `pass with residual risk`, or `fail`.

---

## 8. Phase 3 - Runtime Truth Audit

**Goal:** prove that the Agent runtime is real, observable, and safe enough for first customer delivery.

Acceptance checklist:

- Playground run uses selected Agent config, shared prompt assembly, `AgentLoop`, HookEngine, ProcedureRun overlay, memory tools, and trace persistence.
- `dryRun: true` is clearly understood: runtime logic is real; external operational side effects are mocked.
- At least one deposit-not-credited conversation runs across multiple turns.
- The flow collects missing facts without repeating already-provided facts.
- `start_procedure` or compatibility routing starts/continues the right ProcedureRun.
- Tool calls produce model-visible and trace-visible evidence.
- At least one Hook decision is observed and captured.
- Stale or interleaved input behavior is tested if a ProcedureRun is active.
- `remember(scope="chat")`, `read_chat_memory`, `remember(scope="user")`, and `read_user_profile` are tested where available.
- ProcedureRun state is not stored or displayed as public business memory.
- `Save to Chat` is verified as a synthetic debug bridge, not a live customer continuation.
- Operate surfaces can reopen the saved or generated conversation evidence.
- Procedure behavior is tested beyond Playground-only visible output: Procedure selection/start, step progression, Tool/Hook relationship, ProcedureRun evidence, and Operate detail must agree.

### J1B Playground Production Setup

All practical Playground runtime validation may run against the J1B scenario set.

Before J1B production Playground acceptance:

- Seed or import the previously working business Tools from `doc/tools-real/business-tools-backup.ts` into the production J1B Agent Draft.
- Use member ids from `doc/测试用户ID.md` when the Agent asks for `member_id`.
- Verify the Agent asks for member id when missing, then uses the provided id to call the correct HTTP Tool instead of inventing account data.
- Receipt must list the Tool names enabled and the tested Procedure/Scenario names, but must not paste secrets, raw API keys, or sensitive member data.
- If seeding is blocked, record the blocker in `DELIVERY_UNCERTAINTY_LOG.md` and do not mark J1B Playground acceptance complete.

### J1B P0 Procedure And Playground Scenario Matrix

The following 12 P0 scenarios are mandatory before first customer delivery:

| # | Scenario | Procedure must include |
|---|---|---|
| 1 | Deposit not credited / 存款未到账 | required facts, ask/form steps, Tool or static fixture reference, transfer template, 2-3 Scenarios |
| 2 | Duplicate deposit / 重复存款 | required facts, ask/form steps, Tool or static fixture reference, transfer template, 2-3 Scenarios |
| 3 | Deposit to old order / 存到旧订单 | required facts, ask/form steps, Tool or static fixture reference, transfer template, 2-3 Scenarios |
| 4 | Withdrawal not credited / 取款未到账 | required facts, ask/form steps, Tool or static fixture reference, transfer template, 2-3 Scenarios |
| 5 | Unable to withdraw / 无法取款 | required facts, ask/form steps, Tool or static fixture reference, transfer template, 2-3 Scenarios |
| 6 | Promotion cannot be claimed / Promotion 领取不了 | required facts, ask/form steps, Tool or static fixture reference, transfer template, 2-3 Scenarios |
| 7 | Promotion conditions asked then still cannot join / Promotion 条件咨询后仍无法参加 | required facts, ask/form steps, Tool or static fixture reference, transfer template, 2-3 Scenarios |
| 8 | Forgot login password / 忘记登录密码 | required facts, ask/form steps, Tool or static fixture reference, transfer template, 2-3 Scenarios |
| 9 | Forgot withdrawal password / 忘记取款密码 | required facts, ask/form steps, Tool or static fixture reference, transfer template, 2-3 Scenarios |
| 10 | Account or wallet frozen / 账号/钱包被冻结 | required facts, ask/form steps, Tool or static fixture reference, transfer template, 2-3 Scenarios |
| 11 | App download or reward not credited / App 下载/奖励未到账 | required facts, ask/form steps, Tool or static fixture reference, transfer template, 2-3 Scenarios |
| 12 | User actively requests human support / 用户主动要求转人工 | required facts, ask/form steps, Tool or static fixture reference when relevant, transfer template, 2-3 Scenarios |

For every scenario above:

- Run at least 3 different Playground conversation flows on `https://demo.anytrans.ai`.
- The 3 flows must vary the user's wording, the user's answers, and at least one edge condition or missing/partial fact path.
- At least one flow must include targeted Intera Agent system prompt tuning in Draft, then rerun the same scenario to prove the tuning improved behavior.
- Each flow must show the Agent asking for missing `member_id` where needed, using an id from `doc/测试用户ID.md`, calling the relevant Tool, and answering from Tool/Procedure evidence.
- Each flow must capture screenshots of user input, Agent response, Tool evidence, Hook/ProcedureRun evidence, and Trace Sidebar.
- Each flow must record whether it ended with answer, form/ask step, Tool-backed explanation, or human transfer.
- Any failure must produce a fix, rerun, and updated receipt. Do not count failed exploratory flows toward the 3 accepted flows.

Long-conversation stability is mandatory:

- At least one J1B Playground run must reach either an actual memory auto-compact event or at least 30 customer messages with 30 corresponding Agent responses.
- The long run must not crash, lose session state, duplicate old answers, stop responding, corrupt Tool results, or make ProcedureRun state leak into public business memory.
- The long run must include screenshots or transcript evidence at start, midpoint, end, restored session after refresh, and Trace/Memory evidence.
- If auto compact does not trigger naturally, record token/context conditions and complete the 30-customer-message fallback.

Proof required:

- Input transcript.
- Screenshot of Playground before/after the run.
- Screenshot of Trace Sidebar with Tool/Hook evidence.
- Screenshot or API proof of restored session.
- Screenshot of Operate detail or saved synthetic chat.
- J1B Tool seed/setup receipt.
- 12-scenario matrix with at least 3 accepted production flows per scenario.
- One long-conversation stability receipt.
- Receipt naming which side effects were mocked.

---

## 9. Phase 4 - Scenario And Receipt Audit

**Goal:** prove Scenario receipts are trustworthy commercial evidence, not decorative badges.

Acceptance checklist:

- Create or load representative Scenarios for:
  - deposit not credited
  - withdrawal status
  - KYC/account verification if available
  - promotion turnover if available
  - human transfer boundary
- Run fixture-only Scenario mode and confirm the UI labels it as fixture/harness validation.
- Run runtime-backed Scenario mode and confirm it routes through the real Playground runtime path.
- Receipt includes execution mode, inputs, expected behavior, observed response, Tool calls, Hook decisions, Trace evidence, pass/fail, and timestamp.
- Failed Scenario receipts are useful for debugging and can lead to ConfigPilot proposed fixes.
- Release shows validation freshness and changed-since-validation state correctly.
- Publish soft gate warns when no passing receipt exists and requires override reason when applicable.

Proof required:

- Scenario list screenshot.
- At least one passing receipt screenshot.
- At least one failing receipt screenshot or intentionally documented unavailable failure case.
- Release screenshot showing receipt/freshness state.
- Summary explaining fixture-only vs runtime-backed confidence.

---

## 10. Phase 5 - Package, Version, And Draft/Live Boundary Audit

**Goal:** prove the delivery package and release system cannot accidentally mutate Live or mislead the operator.

Acceptance checklist:

- Import `templates/gaming-support-starter.intera-agent.json`.
- Import dry-run explains what will be created, overwritten, missing, or blocked.
- Import creates/updates Draft only; Live remains unchanged until explicit Publish.
- ConfigPilot Apply mutates Draft only.
- Component saves mutate Draft only.
- Release owns Publish, Rollback Preview, Export, Import, Duplicate/Fork.
- Version timeline clearly marks Live, Draft, and Historical.
- Version cap behavior is tested at or near five versions.
- Export produces a valid `.intera-agent.json` with current top-level terms.
- Exported package omits raw secrets and includes required secret refs/placeholders.
- Re-import exported package succeeds or reports actionable conflicts.

Proof required:

- Import dry-run screenshot.
- Draft/Live before screenshot.
- Draft/Live after ConfigPilot or component save screenshot.
- Publish warning or override screenshot if applicable.
- Exported package path and validation summary.
- Re-import or dry-run proof.

---

## 11. Phase 6 - First Customer Delivery Rehearsal

**Goal:** prove a delivery person can use Intera to prepare a real Gaming / iGaming support Agent without engineering help.

Acceptance checklist:

- Start from Gaming Support Starter template.
- Configure at least two Procedure types end to end:
  - deposit not credited
  - withdrawal status
- Configure at least two Tools:
  - one static fixture Tool
  - one HTTP Tool or documented mocked replacement if no real API credential is available
- Bind at least two Hooks:
  - one `PreToolUse`
  - one `PostToolUse` or `Stop`
- Configure or verify Knowledge source behavior.
- Configure and verify LiveChat/API access boundary.
- Prove the LiveChat basic chain before joint LiveChat console setup:
  - Intera LiveChat config can be loaded/saved from Console.
  - The backup config at `/Users/curtis/Desktop/live chat config backup.md` can be used without copying secrets into repo docs.
  - A webhook-style message reaches Intera and is routed toward `/api/messages`.
  - The Agent response shape can be mapped back to LiveChat.
  - Tool render hints or rich-message payloads render as the intended customer-visible rich message/card format.
  - Failure states are understandable when LiveChat credentials, group IDs, or channel setup are incomplete.
- Use ConfigPilot to propose one meaningful improvement from natural language.
- Review diff, accept, apply, refresh, and prove persistence.
- Run Scenario validation and produce at least one passing runtime-backed receipt.
- Test manually in Playground.
- Review evidence in Operate.
- Export the customer-customized package.
- Write a delivery note that a non-engineer could use to repeat the flow.

Proof required:

- Screenshot sequence covering import, configure, propose, diff, apply, validate, manual test, operate evidence, export.
- LiveChat chain proof with redacted config identifiers and rich-message screenshot or payload evidence.
- Runtime-backed receipt.
- Exported `.intera-agent.json`.
- Delivery note with exact customer-facing boundaries: what is real, what is mocked, what requires human transfer.

---

## 12. Phase 7 - Production Smoke And Deployment Proof

**Goal:** prove the same workflow works on `https://demo.anytrans.ai`. This is mandatory final acceptance, not an optional smoke after local testing.

Acceptance checklist:

- Deploy path is explicitly chosen and approved.
- `git push deploy main` or approved deploy/cherry-pick path completes.
- `curl -s https://demo.anytrans.ai/api/health` returns healthy app and DB status.
- All final acceptance screenshots and interaction logs use `https://demo.anytrans.ai`.
- Production login works.
- Production `Build -> Pilot Lab` loads.
- Production ConfigPilot can load context and produce/apply a draft change, or a production-safe read-only substitute is documented.
- Production Playground runs a real runtime dry-run.
- Production Trace Sidebar shows evidence.
- Production Release shows version/package/receipt state.
- Production Knowledge or Tool test works without crashing.
- Production Operate can reopen a test/synthetic conversation.
- LiveChat basic chain is in scope for P0 readiness: a webhook-style message reaches `/api/messages`, returns through the same runtime, and rich-message/render-hint output is proven or a blocker is documented.

Proof required:

- Deploy command summary.
- Health response.
- Production screenshots for login, Pilot Lab, Playground trace, Release, Operate.
- Production run transcript.
- Any production-only blocker listed with owner decision.

If production acceptance reveals a different feature is broken, do not ignore it because it was outside the original target. Fix it immediately when it affects first customer delivery, operator trust, runtime truth, UI quality, release safety, or evidence quality. If it cannot be fixed in the same loop, the receipt must mark the broader goal blocked or owner-deferred.

---

## 13. Phase 8 - Every-Corner Regression Sweep

**Goal:** catch rough edges that individual feature lanes miss, on production.

Audit dimensions:

| Dimension | Required check |
|---|---|
| Responsive | Desktop 1440, desktop 1280, tablet 1024, and supported mobile/light-action routes. |
| Visual quality | Spacing, alignment, card nesting, button/icon states, active/selected states, typography scale, no one-off rough surfaces. |
| Copy | Current terminology only; no user-facing `Skill`, `Policy`, `Guardrail`, stale `Case` framing, or misleading publish/runtime language outside approved historical/compatibility contexts. |
| Accessibility | Keyboard reachability for primary actions, visible focus, usable contrast, no disabled action without explanation. |
| Loading/empty/error | Every fetch-heavy page has useful loading, empty, and error states. |
| Persistence | Save/apply/publish/import/export changes survive refresh and route changes. |
| Permissions | Staff/org/session assumptions are explicit; cross-org access does not leak. |
| Runtime | Tool, Hook, ProcedureRun, memory, trace, and handoff evidence is observable. |
| Procedure | Procedure list/detail, step editing, Hook binding, runtime start/continue/finalize, Operate evidence, and Scenario coverage agree. |
| LiveChat | Config load/save, webhook ingress, `/api/messages` routing, response mapping, rich-message rendering, and incomplete-credential failures are proven. |
| Recovery | Bad input, failed Tool call, failed Hook, failed import, failed Scenario, and failed publish show recoverable errors. |
| Performance feel | No page should feel frozen during AI generation, scenario run, import/export, or package diff. |
| Cross-feature drift | While testing one feature, adjacent navigation, state, copy, layout, and runtime evidence must still make sense. Broken neighboring behavior is an audit finding, not background noise. |

Proof required:

- One final route matrix.
- Production screenshot pack from `https://demo.anytrans.ai`.
- Command gate receipt.
- List of found defects with severity and owner.
- Explicit signoff statement:

```text
Intera is not merely reachable. The audited surfaces are functional, truthful, polished, and usable by a delivery person for first customer deployment.
```

---

## 14. Required Defect Policy

During these phases, defects must be classified like this:

| Severity | Meaning | Release rule |
|---|---|---|
| P0 Blocker | Prevents first customer delivery, corrupts data, breaks auth/runtime/publish, or materially misleads operator. | Must fix before deploy/customer delivery. |
| P1 Major | Workflow works only with confusing workaround, poor UX, missing proof, or fragile behavior. | Fix before claiming the relevant goal complete. |
| P2 Polish | Does not block the workflow but falls below UI/UX quality bar. | Track and fix unless owner explicitly accepts for first launch. |
| P3 Deferred | Valid post-P0 enhancement with no launch impact. | Document in residual risks. |

Any bug fix must include:

- reproduction steps
- focused test or explicit reason no automated test is practical
- browser proof if user-facing
- before/after screenshot when UI changed
- receipt entry proving the original failure no longer reproduces

Adjacent defects found during production acceptance are not optional notes. If they affect first customer delivery, operator confidence, visual quality, product truth, or runtime evidence, they inherit the same fix-and-proof requirement as the original target.

---

## 15. Completion Definition

The platform is ready for first customer delivery only when all are true:

- Phase 0 through Phase 7 have receipts.
- Phase 8 has a final route matrix with no P0/P1 open items.
- All universal gates pass.
- Production acceptance passes on `https://demo.anytrans.ai`.
- Gaming Support Starter can be imported, customized, validated, tested, and exported.
- Every Build / Operate / Settings subpage and function has a production receipt or an owner-approved blocker.
- Procedure and LiveChat have production evidence, not only local or manual notes.
- Runtime-backed receipts exist for at least the core first-customer workflow.
- UI/UX is polished enough that a delivery person can operate it confidently without engineering narration.
- Remaining deferred items are honestly documented, owner-approved, and do not undermine the first launch boundary.

Do not mark the platform as commercially ready with only command-line tests, only local screenshots, only fixture receipts, only partial route coverage, or production screenshots that cover only the narrow happy path.
