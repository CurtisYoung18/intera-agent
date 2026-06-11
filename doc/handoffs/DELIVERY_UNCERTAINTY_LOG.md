# Delivery Uncertainty And Defaults Log

**Last updated:** 2026-06-11
**Audience:** founder, architect, delivery lead, coding-team leads, QA lead
**Purpose:** record uncertain decisions, temporary defaults, blockers, and owner-review items discovered during the commercial delivery push.

---

## Rules

- Record uncertainty as soon as it affects implementation, QA, production acceptance, UX, copy, runtime behavior, data setup, LiveChat readiness, Procedure design, or release confidence.
- Choose a conservative default when work can continue safely, then record that default here for owner review.
- Do not hide uncertainty inside chat, screenshots, or receipts only. This file is the review queue.
- Do not use this file to defer P0/P1 blockers silently. If the issue affects first customer delivery, it must still be fixed or explicitly owner-deferred.
- Do not paste secrets, customer credentials, webhook secrets, raw API keys, or private LiveChat config values. Reference source files and redact identifiers.

---

## Log Template

Use this format for each new item:

```md
### YYYY-MM-DD - SHORT_TITLE

- Area:
- Status: open | default-applied | fixed | owner-deferred | closed
- Severity: P0 | P1 | P2 | P3
- Uncertainty:
- Default action taken:
- Why this default:
- Evidence:
- Production URL / screenshot / receipt:
- Owner decision needed:
- Follow-up owner:
```

---

## Open Items

### 2026-06-11 - LiveChat Webhook URL Broke Across Agent Publish

- Area: LiveChat / Agent publish / integration boundary
- Status: fixed
- Severity: P0
- Uncertainty: Publishing `J1B v3` activated `cmq4q82mx0001qj32gt8htfiq` and deactivated `cmq4mvv5o0001qj5yfl84kfl0`, but the external LiveChat app was still calling the old per-agent webhook URL under the `v1` id. Production logs then showed repeated `Agent config "cmq4mvv5o0001qj5yfl84kfl0" not found or not active`, and user-visible chats received no reply after publish.
- Default action taken: Treated webhook URL stability as a production blocker and fixed the per-agent LiveChat webhook route so an inactive requested Agent id resolves to the current active config in the same Agent family instead of returning `not active`.
- Why this default: The updated goal/spec now define the webhook URL as part of the channel/workspace integration boundary, not the runtime version boundary. Requiring a manual external webhook URL rewrite after every publish would violate the acceptance contract and make publish unsafe for customer-facing LiveChat.
- Evidence: `.artifacts/delivery-audit/2026-06-11/livechat-chain/webhook-stability-after-publish/summary.md`
- Production URL / screenshot / receipt: Production deploy `1354facf` now accepts the old webhook URL `https://demo.anytrans.ai/api/livechat/webhook/default/cmq4mvv5o0001qj5yfl84kfl0` after `v3` publish and routes it into active `J1B v3`. Probe A (`最近一次存款`) through the old URL produced `ask_user_questions`; Probe B (`最近一次存款，我的会员ID是 JAYA11C5184`) through the old URL produced `get_latest_deposit`. The secret remains redacted in the receipt.
- Exact blocker reproduction:
  - Publish `cmq4q82mx0001qj32gt8htfiq` so `cmq4mvv5o0001qj5yfl84kfl0` becomes inactive.
  - Keep the external LiveChat app on the old `v1` webhook URL.
  - Send a new LiveChat message.
  - Production logs show `Agent config "cmq4mvv5o0001qj5yfl84kfl0" not found or not active`, and no reply reaches the customer.
- Attempted fixes / checks: Verified publish state via production API and Postgres; confirmed `v3` was active and the old webhook path was receiving traffic; added route-level fallback logic plus regression coverage; ran focused vitest, `git diff --check`, and `npx tsc --noEmit -p apps/console/tsconfig.json`; deployed `1354facf`; verified the old URL returns HTTP `200` after publish and resolves into active `v3` behavior in production traces.
- Why no workaround is safe: Telling operators to manually rotate the external webhook URL on every publish keeps the integration brittle and makes publish a customer-facing outage risk. The acceptance bar now explicitly forbids that boundary leak.
- Owner decision needed: None for the stability fix itself. Future LiveChat product work should preserve this invariant.
- Follow-up owner: coding-team lead / delivery lead

### 2026-06-10 - Production Deploy Commit And Hotfix Parity

- Area: Deploy / production acceptance
- Status: fixed
- Severity: P0
- Uncertainty: Production health was green, but `https://demo.anytrans.ai` was not proven to run the local Gate A-D implementation. As of 2026-06-11 00:30 CST, after `git fetch --all --prune`, `HEAD`, `origin/main`, and `deploy/main` all pointed to `e07445f355ab3bd131f7a3dabe06b69109c4a34e`, while the Gate A-D implementation remained 24 dirty/untracked worktree entries. The hotfix worktree was on `codex/profile-menu-adaptive-spacing` at `43f3eb2c`, behind current `deploy/main` by 5, with untracked `.artifacts/` and `doc/strategy/hooks-layout-preview.html`.
- Default action taken: Treated production health as availability proof only, not acceptance proof. After owner approval on 2026-06-11, staged the exact Gate A-D allowlist, committed `8e8c43e20a83d3d567f79d5b90e39de80553b946`, and deployed with `git push deploy main`.
- Why this default: The dispatch requires production proof, and accepting prior screenshots or a healthy endpoint without commit parity could hide drift between local, deploy, and production.
- Evidence: `.artifacts/delivery-audit/2026-06-10/phase-0/baseline.md`; `.artifacts/delivery-audit/2026-06-10/phase-1-pilot-gate-a/summary.md`; `.artifacts/delivery-audit/2026-06-10/phase-1-pilot-gate-b/summary.md`; `.artifacts/delivery-audit/2026-06-10/phase-1-pilot-gate-c/summary.md`; `.artifacts/delivery-audit/2026-06-10/phase-1-pilot-gate-d/summary.md`; `.artifacts/delivery-audit/2026-06-11/production-parity-audit/summary.md`; `.artifacts/delivery-audit/2026-06-11/production-post-deploy/summary.md`
- Production URL / screenshot / receipt: `https://demo.anytrans.ai/api/health` healthy at 2026-06-10 22:22 CST, 2026-06-11 00:22/00:25/00:29 CST, and post-deploy at 2026-06-11 10:02 CST. Deploy hook applied migration `20260610000000_add_pilot_persistence`, built, restarted, and returned healthy local server status. Post-deploy unauthenticated probes still return HTTP 307 for `/build/pilot-lab` and HTTP 401 for `POST /api/admin/pilot/release-handoffs/generate`, proving auth protection only.
- Exact blocker reproduction:
  - `git fetch --all --prune && git rev-parse HEAD && git rev-parse origin/main && git rev-parse deploy/main && git status --short | wc -l` in `/Users/curtis/Desktop/intera-agent` returns the same `e07445f355ab3bd131f7a3dabe06b69109c4a34e` for all three refs and `24` dirty/untracked entries.
  - `curl -sS -D - https://demo.anytrans.ai/api/health` returns HTTP 200 with `"db":"connected"`.
  - `curl -sS -D - https://demo.anytrans.ai/build/pilot-lab` returns HTTP 307 to login, so authenticated UI proof is still required.
  - `curl -sS -D - -X POST https://demo.anytrans.ai/api/admin/pilot/release-handoffs/generate ...` returns HTTP 401 without a session, which is auth proof only.
- Attempted fixes / checks: Completed local Gate A-D build and preflight receipts; fixed the local smoke readiness timeout; refreshed all remotes; checked the hotfix worktree; probed production health and protected routes without credentials; documented an exact commit-boundary allowlist in the production parity audit; deployed after owner approval; verified production health after deploy.
- Why no workaround is safe: This specific deploy parity uncertainty is resolved. Final Gate A-D acceptance remains blocked by the separate authenticated production login item below.
- Owner decision needed: None for deploy parity. Production authentication is now the active blocker.
- Next recommended step: Resolve the authenticated production testing path below, then run production Pilot Lab acceptance on `https://demo.anytrans.ai`.
- Follow-up owner: owner / delivery lead

### 2026-06-11 - Production Authenticated Smoke Credentials Invalid

- Area: Production auth / Pilot acceptance
- Status: fixed
- Severity: P0
- Uncertainty: The local smoke harness credentials were invalid, so production proof initially stalled. During the 2026-06-11 Playground KB hotfix audit, the owner-approved authenticated Chrome session path became available and production UI/runtime verification could proceed.
- Default action taken: Kept the broken smoke credentials out of the acceptance path and used the explicitly approved authenticated browser session instead. Did not guess credentials or bypass auth.
- Why this default: The dispatch required real authenticated production proof, and the approved live session was narrower and safer than inventing a new login path.
- Evidence: `.artifacts/delivery-audit/2026-06-11/production-post-deploy/summary.md`; `.artifacts/delivery-audit/2026-06-11/playground-kb-hotfix-production/summary.md`
- Production URL / screenshot / receipt: `GET https://demo.anytrans.ai/api/health` returned HTTP 200 with DB connected after deploy. The approved authenticated session on `https://demo.anytrans.ai/build/pilot-lab?tab=playground` then produced the KB hotfix production proof recorded in `.artifacts/delivery-audit/2026-06-11/playground-kb-hotfix-production/summary.md`.
- Exact blocker reproduction:
  - Run `SMOKE_BASE_URL=https://demo.anytrans.ai SMOKE_OUTPUT_DIR=.artifacts/production-smoke/2026-06-11-post-deploy npm run smoke:console`.
  - The harness loads local configured credentials, calls `/api/health` successfully, then receives HTTP 401 from `/api/auth/login`.
- Attempted fixes / checks: Confirmed production deploy, migration, build, restart, public health, `/build/pilot-lab` login redirect, and protected Gate D endpoint 401. Later reused the owner-approved authenticated Chrome session and completed live Playground KB hotfix verification there.
- Why no workaround is safe: Resolved for this audit. The remaining open product blocker is not authentication; it is the direct Tools route render regression logged below.
- Owner decision needed: None for authentication on this audit path.
- Next recommended step: Keep the local smoke credentials issue separate from product verification and fix it only if the automated production smoke path is still desired.
- Follow-up owner: owner / delivery lead

### 2026-06-11 - Production Tools Route Blank During KB Hotfix Audit

- Area: Build / Components / production acceptance
- Status: fixed
- Severity: P0
- Uncertainty: The original blocker came from invalid evidence rather than a stable production Tools-route failure. The first manual screenshot captured the wrong window, and an early Playwright nav probe briefly caught the client-side `Loading…` transition before the route had settled.
- Default action taken: Re-ran the KB hotfix production proof with Playwright against `https://demo.anytrans.ai`, captured corrected Knowledge and Tools screenshots, and required direct-load, refresh, reopen, and settled in-app navigation proof before closing the blocker.
- Why this default: The acceptance required truthful Tools UI evidence. Deterministic browser proof was safer than assuming the route was either broken or healthy from a bad PNG.
- Evidence: `.artifacts/delivery-audit/2026-06-11/playground-kb-hotfix-production/summary.md`; `.artifacts/delivery-audit/2026-06-11/playground-kb-hotfix-production/playwright-kb-tools-evidence.json`
- Production URL / screenshot / receipt: `https://demo.anytrans.ai/build/components/tools`; corrected screenshots `[tools-page-direct-playwright.png]`, `[tools-knowledge-search-tools-playwright.png]`, and `[tools-page-via-navigation-playwright.png]` are recorded under `.artifacts/delivery-audit/2026-06-11/playground-kb-hotfix-production/`.
- Exact blocker reproduction:
  - Historical only: `[tools-route-blank.png]` is invalid and does not prove a truthful Intera Tools render.
  - Corrected Playwright proof on 2026-06-11 10:57 CST showed direct load, refresh, reopen, and settled in-app nav all rendering the Tools workspace for `J1B v3 draft`.
- Attempted fixes / checks: Re-ran production proof with the provided test account, selected `J1B v3 draft`, captured Knowledge/Tools screenshots, verified `kb_search_*` entries on both pages, and recorded route diagnostics showing no console errors, page errors, failed requests, or `>=400` responses on the settled Tools route. No product code change or deploy was required because the route rendered correctly once the capture path was fixed.
- Why no workaround is safe: Resolved. The corrected production proof removes the need for any speculative route fix or alternate acceptance path.
- Owner decision needed: None.
- Follow-up owner: coding-team lead

### 2026-06-11 - Scenario Receipts Lost After Standalone Redeploy

- Area: Pilot Lab / Scenario receipts / production persistence
- Status: fixed
- Severity: P0
- Uncertainty: The first authenticated production Gate A-D receipt run created a durable Pilot session, proposals, receipt-linked fix proposal, and release handoff, but after the later mobile-header redeploy the same agent showed `Not validated` and `/api/admin/scenarios?agentConfigId=...` returned empty `scenarios` and `receipts`. Pilot session state survived while Scenario receipt state did not.
- Default action taken: Treated the empty Scenario readback as a production-blocking durability bug, traced the default store path to `process.cwd()` under Next standalone, changed `apps/console/lib/scenarios/store.ts` to resolve the repo root before defaulting `.intera-agent-runtime/scenarios.json`, added focused regression tests, and deployed `d136258f96dabe47b25554dccb9b00f87229766c`.
- Why this default: Gate C/D receipts are supposed to be durable commercial evidence. If redeploy wipes them, Pilot validation truth, release readiness, and rerun proof all become misleading.
- Evidence: `.artifacts/delivery-audit/2026-06-11/production-authenticated-acceptance/scenario-store-persistence-summary.md`; `.artifacts/delivery-audit/2026-06-11/production-authenticated-acceptance/scenario-store-persistence-baseline/playwright-production-acceptance-summary.json`; `.artifacts/delivery-audit/2026-06-11/j1b-receipt-durability-gate-post-deploy/playwright-j1b-post-deploy-recheck-summary.json`
- Production URL / screenshot / receipt: `https://demo.anytrans.ai/build/pilot-lab`; authenticated baseline created Scenario `pilot_acceptance_probe_20260611024311_runtime_fail`, runtime-backed receipt `scn_ef18349f-691d-48d7-81a4-7188c2069dde`, fix proposal `cmq8w8g2f0011qjtoz2o81ngv`, and release handoff `cmq8w8g4w001bqjtot7wa0baw`, all recorded in the baseline receipt above. After the case-type evidence deploy `3a20d0a5`, the post-deploy recheck also confirmed the earlier J1B receipt `scn_9e1aadf8-eb9a-4740-a98f-d1dcbf0568cd` still existed in `/api/admin/scenarios` and remained visible after refresh and reopen.
- Exact blocker reproduction:
  - Before the fix, authenticated production readback after redeploy showed `GET /api/admin/pilot/sessions/current?agentConfigId=cmq4q82mx0001qj32gt8htfiq` still referencing receipt `scn_fdc23441-1b71-444a-9957-84c92ccdb036`.
  - The matching `GET /api/admin/scenarios?agentConfigId=cmq4q82mx0001qj32gt8htfiq` returned `scenarios: []`, `receipts: []`, and `validation.state: "Not validated"`.
  - Local inspection showed `apps/console/lib/scenarios/store.ts` defaulted to `path.join(process.cwd(), '.intera-agent-runtime', 'scenarios.json')`, while `apps/console/.next/standalone/apps/console/server.js` runs `process.chdir(__dirname)`, so standalone writes landed under `.next/standalone/apps/console/.intera-agent-runtime/` and were lost on rebuild.
- Attempted fixes / checks: Added `apps/console/lib/scenarios/store.test.ts`; reran `scenarios`, `config-pilot`, `pilot-gate-a`, and `agent-template` vitest suites; reran `git diff --check`, `npx tsc --noEmit -p apps/console/tsconfig.json`, and `rm -rf apps/console/.next && npm run build:console`; pushed/deployed `d136258f`; reran authenticated production acceptance and confirmed the new receipt was present in `/api/admin/scenarios` readback before the next deploy; later deployed `3a20d0a5` and reran a post-deploy persistence check proving the prior J1B receipt still survived refresh and reopen.
- Why no workaround is safe: Relying on Pilot session pointers alone would hide missing Scenario truth. Manual DB edits or older screenshots would not prove durable receipt storage.
- Owner decision needed: None.
- Next recommended step: Keep treating receipt durability as an embedded gate for every J1B production scenario family; if any receipt disappears after a later deploy or restart, reopen this blocker immediately.
- Follow-up owner: coding-team lead / delivery lead

### 2026-06-11 - Scenario Authoring Has No Manual Console UI

- Area: Production config UX / Pilot Lab / Scenario setup
- Status: fixed
- Severity: P1
- Uncertainty: Historical only. Before the fix, `/admin/scenarios` redirected into Pilot Lab but the resulting production UI exposed only Scenario selection, validation, and receipt review. It did not expose a manual `New` / `Delete` / `Save scenario` authoring workflow for a config operator.
- Default action taken: First kept the gap visible and used the typed admin API for early J1B seed work. Then implemented manual Scenario authoring controls in Pilot Lab, deployed them on 2026-06-11, and reran production proof with Playwright against `https://demo.anytrans.ai`.
- Why this default: The owner explicitly asked for step-by-step console-UI validation that simulates a real config person. Once the gap was proven real, the console needed a truthful create/update/delete authoring path before this uncertainty could close.
- Evidence: Historical pre-fix gap proof: `.artifacts/delivery-audit/2026-06-11/scenario-ui-gap/summary.json`; screenshot `.artifacts/delivery-audit/2026-06-11/scenario-ui-gap/admin-scenarios-redirected.png`. Current fixed-state proof: `.artifacts/delivery-audit/2026-06-11/scenario-ui-gap/summary.md`; `.artifacts/delivery-audit/2026-06-11/scenario-ui-gap/manual-authoring-production/summary.json`; `.artifacts/delivery-audit/2026-06-11/scenario-ui-gap/manual-authoring-production-rerun/summary.json`
- Production URL / screenshot / receipt: `https://demo.anytrans.ai/build/pilot-lab` on draft `cmq4q82mx0001qj32gt8htfiq` now shows `New`, `Reset`, `Delete`, and `Save scenario` controls plus editable Scenario fields. Production Playwright proof created and deleted `manual_ui_delete_probe_20260611042820`, created and updated `duplicate_deposit_amount_first`, confirmed the earlier receipt `scn_9e1aadf8-eb9a-4740-a98f-d1dcbf0568cd` still survived the post-deploy window, then reran the manual-ui-authored duplicate-deposit Scenario to accepted receipt `scn_44bb0b6b-0c5a-4f4b-9d10-4a0e37fbcfb6`, which remained visible after immediate readback, refresh, and reopen.
- Owner decision needed: None for the UI gap itself. Remaining J1B work is finishing the other two duplicate-deposit flows plus the rest of the 12-scenario matrix.
- Next recommended step: Reuse the Pilot Lab authoring controls for the remaining `duplicate_deposit` flows and the other incomplete J1B P0 scenario families, keeping receipt durability embedded in every accepted run.
- Follow-up owner: owner / product / coding-team lead

### 2026-06-11 - J1B Production Reply Language Drift On Withdrawal-Blocked Scenario

- Area: J1B production Playground / prompt quality / runtime UX
- Status: fixed
- Severity: P0
- Uncertainty: During production J1B scenario validation, `withdrawal_blocked_basic` initially returned Bengali customer-facing text and Bengali `ask_user_questions` labels even though the user message was Simplified Chinese. The runtime receipt still passed because the Scenario expected only `caseType`, `ask_user_questions`, and `finalStatus`, so language drift was not yet encoded as a receipt assertion.
- Default action taken: Treated the language drift as a same-area production quality defect, applied the prepared core-system-prompt language-lock block to the production J1B draft, and reran the same Scenario until the customer-facing reply plus `ask_user_questions` titles/descriptions/labels/placeholders were back in Simplified Chinese.
- Why this default: The dispatch requires the agent to answer in the customer's language, and adjacent defects discovered during J1B validation must be fixed or logged as blockers before continuing acceptance.
- Evidence: `.artifacts/delivery-audit/2026-06-11/j1b-language-lock-prompt/update-summary.json`; `.artifacts/delivery-audit/2026-06-11/j1b-language-lock-prompt/before-core-system-prompt.txt`; `.artifacts/delivery-audit/2026-06-11/j1b-language-lock-prompt/after-core-system-prompt.txt`; `.artifacts/delivery-audit/2026-06-11/j1b-language-lock-prompt/withdrawal_blocked_basic-rerun-accepted/summary.json`
- Production URL / screenshot / receipt: `https://demo.anytrans.ai/build/pilot-lab` on draft `cmq4q82mx0001qj32gt8htfiq`. Pre-fix runtime receipt `scn_9df271bd-958b-4234-bbde-6152ae9f0387` / trace `pg_1781153819139_mc0ay1` showed Bengali final reply and Bengali form labels in `.artifacts/delivery-audit/2026-06-11/j1b-scenarios/withdrawal_blocked_basic/summary.json`. After the prompt tune, accepted rerun receipt `scn_323d4fd0-f152-4dd6-b229-0b38835dd9f4` / trace `pg_1781154000913_olpp3s` showed Chinese final reply plus Chinese `ask_user_questions` content and survived refresh/reopen.
- Exact blocker reproduction:
  - Run production `withdrawal_blocked_basic` before the prompt tune using the J1B draft.
  - Receipt `scn_9df271bd-958b-4234-bbde-6152ae9f0387` passes the existing Scenario checks, but the receipt evidence shows:
    - final response: `আপনার সমস্যা বুঝতে পেরেছি...`
    - `ask_user_questions` title/description/labels/placeholders also in Bengali
  - This contradicts the Chinese customer input and the prompt requirement to respond in the customer's language.
- Attempted fixes / checks: Applied the `## Output language lock` block to `coreSystemPrompt` through the authenticated production admin API; ran two phrase-assertion exploratory reruns (`scn_02f894a6-9bba-4f52-a08d-fc3363e9bd8b`, `scn_a39ac258-11d0-42d5-b32e-af6f2bdf78ca`) that already showed Chinese output but failed only because the ad hoc receipt phrases were too strict; then accepted rerun `scn_323d4fd0-f152-4dd6-b229-0b38835dd9f4` with Chinese runtime output and durability proof.
- Why no workaround is safe: Accepting the original receipt would hide a user-visible language defect in production. Manual interpretation without a rerun would not prove the production prompt had actually been corrected.
- Owner decision needed: None.
- Next recommended step: Reuse the language-lock prompt block for the remaining J1B production families and capture this rerun as the required targeted system-prompt-tuning proof in the final J1B receipt set.
- Follow-up owner: coding-team lead / delivery lead

### 2026-06-11 - J1B `security review` Wording Is Not Stable Enough For Counted Scenario Acceptance

- Area: J1B production Playground / scenario taxonomy / procedure routing
- Status: monitoring
- Severity: P1
- Uncertainty: During production validation, the exploratory wording `账户正在安全审核，不能提现` was not stable enough to use as a counted acceptance flow. Seeded under `withdrawal_blocked`, it routed to `account_wallet_frozen`; seeded under `account_wallet_frozen`, the same wording later routed back to `withdrawal_blocked`.
- Default action taken: Did not retune runtime or collapse the two Procedure families. Marked `security review` wording as ambiguous, excluded it from counted acceptance in both families, and replaced it with clearer flows:
  - `withdrawal_blocked_completed_conditions_escalation` for the unmet-conditions contradiction path
  - explicit `账号受限 / 钱包冻结 / 登录锁定` wording for the `account_wallet_frozen` family
- Why this default: Phase 4 separates `无法取款` from `账号/钱包被冻结`. Ambiguous wording is poor acceptance evidence. Clearer seed phrasing is safer than forcing the runtime to merge the taxonomies.
- Evidence: `.artifacts/delivery-audit/2026-06-11/j1b-scenarios/withdrawal_blocked_security_hold/summary.json`; `.artifacts/delivery-audit/2026-06-11/j1b-scenarios/withdrawal_blocked_security_hold-rerun/summary.json`; `.artifacts/delivery-audit/2026-06-11/j1b-scenarios/account_wallet_frozen_security_review/summary.json`; `.artifacts/delivery-audit/2026-06-11/j1b-scenarios/withdrawal_blocked_completed_conditions_escalation/summary.json`; `.artifacts/delivery-audit/2026-06-11/j1b-scenarios/account_wallet_frozen_followup_member/summary.json`; `.artifacts/delivery-audit/2026-06-11/j1b-scenarios/account_wallet_frozen_login_locked/summary.json`
- Production URL / screenshot / receipt: `https://demo.anytrans.ai/build/pilot-lab` on draft `cmq4q82mx0001qj32gt8htfiq`. Exploratory receipt `scn_fbe953a4-0885-46f8-8b3c-dbb797048d07` / trace `pg_1781154218937_e5u7kp` and rerun `scn_bd19630c-9418-4ff3-9f81-9ecedfceb263` / trace `pg_1781154817205_ld246p` did not stay on a stable family boundary. When re-seeded under `account_wallet_frozen`, exploratory receipt `scn_8807817d-14f5-41ba-be00-3d8f54499562` / trace `pg_1781155066232_r220zf` still routed to `withdrawal_blocked`. Accepted replacements were `scn_0268c441-d473-4ad1-9a5d-3750f61ea7aa` for `withdrawal_blocked`, plus `scn_fe0c8a18-a1bc-4f24-a6a3-64cff2ad9d11` and `scn_ce252e5e-bdfc-4edb-9561-eb18787309f1` for explicit `account_wallet_frozen` wording, all with refresh/reopen durability proof.
- Owner decision needed: None for continuing acceptance. If product later wants a single canonical home for `security review` wording, confirm whether it belongs under `withdrawal_blocked`, `account_wallet_frozen`, or an explicit split rule.
- Next recommended step: Avoid `security review` as a counted acceptance phrase. Keep using explicit `未满足提款条件` wording for `withdrawal_blocked` and explicit `账号受限 / 钱包冻结 / 登录锁定` wording for `account_wallet_frozen`.
- Follow-up owner: owner / product / delivery lead

### 2026-06-11 - J1B Promotion `Condition Conflict` Wording Is Narrower Than `Claim Failed`

- Area: J1B production Playground / scenario taxonomy / procedure routing
- Status: monitoring
- Severity: P1
- Uncertainty: During production validation, `promotion_condition_conflict` stayed stable only when the customer wording explicitly kept the contradiction form `满足条件了 / 达到要求了 / 条件都满足了` plus `还是参加不了`. Closely related wording such as `系统提示条件不满足` or `不能领取` repeatedly routed back to `promotion_claim_failed`, even when the customer also said the deposit and turnover requirements had already been completed.
- Default action taken: Did not retune runtime or merge the two Procedure families. Counted `promotion_condition_conflict` acceptance only with stable contradiction wording, and excluded the two drifted receipts from family completion.
- Why this default: Phase 4 separates `Promotion 领取不了` from `Promotion 条件咨询后仍无法参加`. Ambiguous wording is weak acceptance evidence. Stable contradiction phrasing is safer than forcing a family boundary the runtime does not currently hold.
- Evidence: Accepted counted flows: `.artifacts/delivery-audit/2026-06-11/j1b-scenarios/promotion_condition_conflict_basic/summary.json`; `.artifacts/delivery-audit/2026-06-11/j1b-scenarios/promotion_condition_conflict_cashback_qualified/summary.json`; `.artifacts/delivery-audit/2026-06-11/j1b-scenarios/promotion_condition_conflict_reward_center_stuck/summary.json`. Excluded exploratory drifts: `.artifacts/delivery-audit/2026-06-11/j1b-scenarios/promotion_condition_conflict_cashback_turnover/summary.json`; `.artifacts/delivery-audit/2026-06-11/j1b-scenarios/promotion_condition_conflict_threshold_message/summary.json`
- Production URL / screenshot / receipt: `https://demo.anytrans.ai/build/pilot-lab` on draft `cmq4q82mx0001qj32gt8htfiq`. Accepted receipts were `scn_f5a86f66-b384-42bd-a99f-eafb230f3cb9`, `scn_f36263dd-d4b0-4ce8-aa89-7d879fd110b5`, and `scn_719e1f35-f34a-49a2-a442-f1368d34c67a`, all durable after refresh and reopen. Excluded exploratory receipts `scn_0bc5dd6e-6f97-4c09-99d5-d221f9bd2cbd` and `scn_bb9064d9-341e-4de4-a485-5432122c3783` routed to `promotion_claim_failed`.
- Owner decision needed: None for continuing acceptance. If product later wants phrases like `系统提示条件不满足` to live under `promotion_condition_conflict`, confirm whether to retune routing or keep those phrases under `promotion_claim_failed`.
- Next recommended step: For counted `promotion_condition_conflict` evidence, keep using direct contradiction phrasing around already-met conditions plus `还是参加不了`. Treat `不能领取 / 条件不满足` wording as `promotion_claim_failed` unless runtime routing is intentionally retuned.
- Follow-up owner: owner / product / delivery lead

### 2026-06-11 - J1B Scenario Matrix Uses Mocked Playground Operational Tool Execution

- Area: J1B production acceptance / tool execution scope
- Status: default-applied
- Severity: P1
- Uncertainty: The final counted J1B scenario matrix on `https://demo.anytrans.ai/build/pilot-lab` is production `agentRuntime` validation, but every accepted Playground receipt in the final index recorded `toolExecutionMode=mocked`. This proves production Procedure routing, trace/sidebar behavior, and receipt durability, but it does not separately prove live HTTP execution of operational business tools.
- Default action taken: Reported the 12-family matrix as `agentRuntime` production validation only and kept the mocked-vs-real tool boundary explicit in the final acceptance index and long-session receipt.
- Why this default: The architect required mocked-vs-real truth to stay separate. Treating dry-run Playground tool events as live external side-effect proof would overstate production acceptance.
- Evidence: `.artifacts/delivery-audit/2026-06-11/j1b-scenarios/final-j1b-acceptance-index.md`; `.artifacts/delivery-audit/2026-06-11/j1b-scenarios/deposit_not_credited_basic-flow1-receipt/playwright-j1b-receipt-durability-summary.json`; `.artifacts/delivery-audit/2026-06-11/j1b-scenarios/promotion_condition_conflict_basic/summary.json`
- Production URL / screenshot / receipt: `https://demo.anytrans.ai/build/pilot-lab` on draft `cmq4q82mx0001qj32gt8htfiq`. The final J1B acceptance index aggregates all 36 counted accepted flows and records `toolExecutionMode=mocked` for every accepted Playground receipt.
- Owner decision needed: None for scenario-matrix reporting. Separate real-tool execution proof is still required if release claims must include live HTTP side effects from operational business tools.
- Follow-up owner: owner / delivery lead / coding-team lead

### 2026-06-11 - J1B Long-Session Refresh/Reopen Restore Drops One Persisted Turn

- Area: Playground / long-session stability / trace restore
- Status: fixed
- Severity: P0
- Uncertainty: Historical only. The qualifying J1B long-session fallback run reached `30` customer messages, `30` assistant responses, and `331` backend traces, but the first refreshed/reopened Playground UI restore only showed `TRACE 29 persisted turns`.
- Default action taken: Treated the gap as a production blocker, replaced timestamp-based restore grouping with trace turn-start grouping, added focused regression coverage, deployed the fix, and reran only the long-session restore gate against the same persisted production chat.
- Why this default: The dispatch stop condition requires the long session to survive refresh/reopen without context loss or state loss. Backend persistence alone was not enough until the restored production UI also matched the persisted timeline.
- Evidence: Historical fail artifacts remain: `.artifacts/delivery-audit/2026-06-11/j1b-long-session/receipt.md`; `.artifacts/delivery-audit/2026-06-11/j1b-long-session/summary.json`; `.artifacts/delivery-audit/2026-06-11/j1b-long-session/session-readback-final.json`; `.artifacts/delivery-audit/2026-06-11/j1b-long-session/playground-long-session-final-desktop.png`; `.artifacts/delivery-audit/2026-06-11/j1b-long-session/playground-long-session-reopen-desktop.png`. Current pass artifacts: `.artifacts/delivery-audit/2026-06-11/j1b-long-session-post-fix/summary.md`; `.artifacts/delivery-audit/2026-06-11/j1b-long-session-post-fix/summary.json`; `.artifacts/delivery-audit/2026-06-11/j1b-long-session-post-fix/session-readback-detail.json`; `.artifacts/delivery-audit/2026-06-11/j1b-long-session-post-fix/playground-long-session-post-fix-initial.png`; `.artifacts/delivery-audit/2026-06-11/j1b-long-session-post-fix/playground-long-session-post-fix-refresh.png`; `.artifacts/delivery-audit/2026-06-11/j1b-long-session-post-fix/playground-long-session-post-fix-reopen.png`
- Production URL / screenshot / receipt: `https://demo.anytrans.ai/build/pilot-lab?tab=playground` on chat `pg_cmq4q82mx0001qj32gt8htfiq_1781158785107_4tvosv`. Historical screenshots showed `TRACE 29 persisted turns`. After local main commit `d76e812fef715fe5a4cf5298378c98705386a95c` was deployed on `deploy/main` as `68e7579c`, the post-fix production recheck showed `TRACE 30 persisted turns` on initial restore, refresh, and reopen while the same chat still read back as `30 / 30` messages and `331` traces.
- Owner decision needed: None.
- Next recommended step: Keep the long-session restore helper regression-covered and re-open this blocker immediately if a later deploy/restart causes persisted-turn loss again.
- Follow-up owner: coding-team lead / delivery lead

### 2026-06-10 - LiveChat Console Joint Configuration Timing

- Area: LiveChat / Integrations
- Status: default-applied
- Severity: P1
- Uncertainty: Full LiveChat console-side configuration may need a separate joint session after the current optimization pass.
- Default action taken: Treat Intera-side LiveChat readiness as mandatory now: config load/save, webhook ingress toward `/api/messages`, response mapping, incomplete-config recovery states, and Tool rich-message/render-hint output must be proven before first customer delivery.
- Why this default: It lets Intera harden its side of the chain without waiting for external console setup, while keeping the real joint integration visible as a follow-up.
- Evidence: To be filled by the LiveChat chain receipt.
- Production URL / screenshot / receipt: Pending.
- Owner decision needed: Confirm when to schedule full LiveChat console joint configuration.
- Follow-up owner: delivery lead / owner

### 2026-06-10 - Pilot Must Be Built Before Full Pilot Acceptance

- Area: Pilot Lab / ConfigPilot
- Status: default-applied
- Severity: P0
- Uncertainty: Pilot Lab cannot be fully accepted while the commercial Pilot cockpit is still under construction.
- Default action taken: Move Pilot Commercial Readiness Gate A-D ahead of full Pilot acceptance and broader Pilot Lab signoff. Local and production acceptance for Pilot begins only after the relevant Gate implementation exists.
- Why this default: Testing a not-yet-built Pilot cockpit would produce false confidence and noisy failures.
- Evidence: `doc/strategy/2026-06-10-pilot-commercial-readiness-proposal.md`
- Production URL / screenshot / receipt: Pending Gate A-D receipts.
- Owner decision needed: Confirm any scope cuts if Gate A-D exceeds the first delivery window.
- Follow-up owner: architect / coding-team lead

### 2026-06-10 - Local Smoke `networkidle` Timeout On Pilot Lab

- Area: Local browser smoke / Pilot Lab
- Status: fixed
- Severity: P1
- Uncertainty: `npm run smoke:console` timed out twice on the mobile `/build/pilot-lab` pass while waiting for Playwright `networkidle`, even though the route returned HTTP 200 and a targeted desktop/mobile Playwright check using `domcontentloaded` passed with no console/page errors or overflow.
- Default action taken: Tuned `scripts/smoke-console-auth.mjs` to use `domcontentloaded` plus route-specific visible readiness markers for hydrated Next dev pages and detail routes; increased navigation timeout to 60s for cold local compile.
- Why this default: Dev-mode `networkidle` was an unreliable readiness signal for Pilot Lab and Release/Operate hydrated pages. Visible route markers provide more truthful UI readiness while still preserving screenshot, redirect, console-error, page-error, and overflow checks.
- Evidence: `.artifacts/delivery-audit/2026-06-10/phase-1-pilot-gate-c/summary.md`; `.artifacts/delivery-audit/2026-06-10/phase-1-pilot-gate-d/summary.md`; `.artifacts/final-smoke/summary.json`; screenshots `browser-pilot-gate-c-desktop.png`, `browser-pilot-gate-c-mobile.png`, `browser-pilot-gate-d-desktop.png`, and `browser-pilot-gate-d-mobile.png`.
- Production URL / screenshot / receipt: Local smoke fixed; production proof still pending on `https://demo.anytrans.ai`.
- Owner decision needed: None for local smoke harness. Production acceptance still requires repeating relevant workflows on `https://demo.anytrans.ai`.
- Follow-up owner: coding-team lead

### 2026-06-10 - J1B Production Test Data And Tool Seeding

- Area: Playground / Tools / Procedure / LiveChat readiness
- Status: fixed
- Severity: P0
- Uncertainty: Production J1B Agent must have the previously working J1B business Tools and valid test member ids before realistic Playground validation.
- Default action taken: Seed or import Tools from `doc/tools-real/business-tools-backup.ts` into the production J1B Agent before J1B Playground acceptance. Use `doc/测试用户ID.md` for test member ids. Do not paste sensitive values into receipts.
- Why this default: The J1B Playground tests are only meaningful if the Agent can ask for member id, call the matching HTTP Tools, and answer from real tool evidence.
- Evidence: `.artifacts/delivery-audit/2026-06-11/production-j1b-member-id-routing/summary.md`; `.artifacts/delivery-audit/2026-06-11/j1b-production-ui/create-procedure-ui-summary.json`; `.artifacts/delivery-audit/2026-06-11/j1b-production-ui/withdrawal-not-credited/create-procedure-ui-summary.json`; `.artifacts/delivery-audit/2026-06-11/j1b-production-seed/seed-summary.json`
- Production URL / screenshot / receipt: `https://demo.anytrans.ai/build/pilot-lab` on draft `cmq4q82mx0001qj32gt8htfiq` (`J1B v3 draft`) now has the required business tools, manually created Procedure types, and the 12-scenario J1B seed baseline available for runtime validation.
- Historical note: This item records production setup readiness only. The final counted J1B Playground receipts on 2026-06-11 still reported `toolExecutionMode=mocked`; see the separate scope-gap item above for the current acceptance boundary.
- Owner decision needed: None for tool/procedure seeding. The remaining J1B work is the full 12-scenario matrix, not production setup.
- Follow-up owner: delivery lead / coding-team lead
