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
- Status: open
- Severity: P1
- Uncertainty: The production console has runtime Scenario execution and receipt review in Pilot Lab, but no separate manual Scenario authoring surface for a config operator. Navigating to `/admin/scenarios` redirects straight to `/build/pilot-lab`, and the resulting UI exposes Scenario selection and validation controls but no `New Scenario` / `Create Scenario` / save editor workflow.
- Default action taken: Used the available typed admin API to create and update J1B production scenarios while preserving UI-based manual validation for Procedure authoring and Scenario execution. Logged the gap instead of pretending the manual authoring path exists.
- Why this default: The owner explicitly asked for step-by-step console-UI validation that simulates a real config person. Scenario runtime proof can continue through the typed API, but the missing authoring surface is a real product gap that should stay visible.
- Evidence: `.artifacts/delivery-audit/2026-06-11/scenario-ui-gap/summary.json`; screenshot `.artifacts/delivery-audit/2026-06-11/scenario-ui-gap/admin-scenarios-redirected.png`
- Production URL / screenshot / receipt: `https://demo.anytrans.ai/admin/scenarios` redirects to `https://demo.anytrans.ai/build/pilot-lab`; the captured page shows Scenario picker, runtime execution, fixture validation, and receipt controls only.
- Owner decision needed: Decide whether Scenario authoring must exist in the console before pilot signoff, or whether typed-admin/API authoring is acceptable for the first pilot window.
- Follow-up owner: owner / product / coding-team lead

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
- Owner decision needed: None for tool/procedure seeding. The remaining J1B work is the full 12-scenario matrix, not production setup.
- Follow-up owner: delivery lead / coding-team lead
