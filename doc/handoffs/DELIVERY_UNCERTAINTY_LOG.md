# Delivery Uncertainty And Defaults Log

**Last updated:** 2026-06-10
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
- Status: open
- Severity: P0
- Uncertainty: Gate A-D is deployed to production test, but the available local smoke credentials cannot log into `https://demo.anytrans.ai`, so authenticated production screenshots, workflow proof, and DB/API persistence readback are still missing.
- Default action taken: Treat deployment as complete but Gate A-D production acceptance as unproven. Do not reuse older production-smoke screenshots or local receipts as acceptance for commit `8e8c43e20a83d3d567f79d5b90e39de80553b946`.
- Why this default: The dispatch requires current production proof from `https://demo.anytrans.ai`; a healthy deploy and unauthenticated route probes cannot prove staff-only Pilot workflows.
- Evidence: `.artifacts/delivery-audit/2026-06-11/production-post-deploy/summary.md`
- Production URL / screenshot / receipt: `GET https://demo.anytrans.ai/api/health` returned HTTP 200 with DB connected after deploy. `SMOKE_BASE_URL=https://demo.anytrans.ai SMOKE_OUTPUT_DIR=.artifacts/production-smoke/2026-06-11-post-deploy npm run smoke:console` failed before screenshots with `Login failed: status=401 ... Invalid email or password`.
- Exact blocker reproduction:
  - Run `SMOKE_BASE_URL=https://demo.anytrans.ai SMOKE_OUTPUT_DIR=.artifacts/production-smoke/2026-06-11-post-deploy npm run smoke:console`.
  - The harness loads local configured credentials, calls `/api/health` successfully, then receives HTTP 401 from `/api/auth/login`.
- Attempted fixes / checks: Confirmed production deploy, migration, build, restart, public health, `/build/pilot-lab` login redirect, and protected Gate D endpoint 401. Confirmed the timestamped post-deploy smoke output directory has no screenshots because login failed before route capture.
- Why no workaround is safe: Guessing credentials, bypassing auth, seeding a production user, or using a browser session without owner approval would violate the production proof and access boundary. Older screenshots are not proof for the deployed commit.
- Owner decision needed: Provide valid production `SMOKE_EMAIL` / `SMOKE_PASSWORD`, approve use of an already logged-in browser session, or create/approve a temporary production test staff account.
- Next recommended step: Rerun production smoke and complete Gate A-D Pilot Lab workflow receipts after authenticated access is available.
- Follow-up owner: owner / delivery lead

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
- Status: default-applied
- Severity: P0
- Uncertainty: Production J1B Agent must have the previously working J1B business Tools and valid test member ids before realistic Playground validation.
- Default action taken: Seed or import Tools from `doc/tools-real/business-tools-backup.ts` into the production J1B Agent before J1B Playground acceptance. Use `doc/测试用户ID.md` for test member ids. Do not paste sensitive values into receipts.
- Why this default: The J1B Playground tests are only meaningful if the Agent can ask for member id, call the matching HTTP Tools, and answer from real tool evidence.
- Evidence: To be filled by the J1B seed/setup receipt.
- Production URL / screenshot / receipt: Pending.
- Owner decision needed: Confirm target production J1B Agent/version and whether seeding should create a Draft only or update the current test Draft.
- Follow-up owner: delivery lead / coding-team lead
