# Error Log

## [ERR-20260610-001] parallel_tsc_build_next_types

**Logged**: 2026-06-10T22:38:00+08:00
**Priority**: medium
**Status**: pending
**Area**: tests

### Summary
Running `npx tsc --noEmit -p apps/console/tsconfig.json` in parallel with `rm -rf apps/console/.next && npm run build:console` can fail because the build deletes `.next/types` while TypeScript is reading those generated files.

### Error
```text
error TS6053: File 'apps/console/.next/types/...' not found.
The file is in the program because:
Matched by include pattern '.next/types/**/*.ts' in 'apps/console/tsconfig.json'
```

### Context
- Command attempted in parallel with clean `build:console`.
- The code was not at fault; this was verification command ordering.
- Rerun `tsc` after `build:console` regenerates `.next/types`.

### Suggested Fix
Do not parallelize `tsc` with commands that delete or regenerate `apps/console/.next`. Run `tsc` before cleanup or after the build completes.

### Metadata
- Reproducible: yes
- Related Files: `apps/console/tsconfig.json`

---

## [ERR-20260611-003] production_smoke_invalid_credentials

**Logged**: 2026-06-11T10:03:00+08:00
**Priority**: high
**Status**: pending
**Area**: production-smoke

### Summary
Post-deploy production smoke against `https://demo.anytrans.ai` failed at login because the local smoke credentials are not valid for production.

### Error
```text
SMOKE_BASE_URL=https://demo.anytrans.ai SMOKE_OUTPUT_DIR=.artifacts/production-smoke/2026-06-11-post-deploy npm run smoke:console

Error: Login failed: status=401 body={"ok":false,"error":{"code":"unauthorized","message":"Invalid email or password"}}
```

### Context
- The deploy itself succeeded and the production health endpoint returned DB connected.
- The smoke harness reached `/api/auth/login` after a successful health check.
- No screenshots or summary were produced in the timestamped output directory because authentication failed before route capture.

### Suggested Fix
Use valid production `SMOKE_EMAIL` / `SMOKE_PASSWORD`, an approved logged-in browser session, or an approved temporary production staff account before claiming production UI acceptance.

### Metadata
- Reproducible: yes
- Related Files: `scripts/smoke-console-auth.mjs`, `.artifacts/delivery-audit/2026-06-11/production-post-deploy/summary.md`

---

## [ERR-20260611-002] staged_untracked_markdown_whitespace

**Logged**: 2026-06-11T10:00:00+08:00
**Priority**: medium
**Status**: fixed
**Area**: docs

### Summary
`git diff --check` can miss trailing whitespace in new untracked markdown receipts until those files are staged.

### Error
```text
git diff --cached --check
.artifacts/delivery-audit/2026-06-10/phase-1-pilot-gate-a/summary.md:3: trailing whitespace.
doc/handoffs/CODEX_GOAL_DISPATCH.md:3: trailing whitespace.
doc/handoffs/DELIVERY_UNCERTAINTY_LOG.md:3: trailing whitespace.
doc/handoffs/PLATFORM_DELIVERY_AUDIT_GOALS.md:3: trailing whitespace.
doc/strategy/2026-06-10-pilot-commercial-readiness-proposal.md:3: trailing whitespace.
```

### Context
- The affected files were newly tracked docs/receipts in the Gate A-D deployment allowlist.
- Earlier unstaged `git diff --check` passed because untracked files are invisible to that check.
- The failure appeared only after exact-path staging and before commit.

### Fix
Trimmed trailing whitespace in the staged markdown files and reran the staged diff check. For future lanes with untracked docs or receipts, run `git diff --cached --check` after staging and before commit.

### Metadata
- Reproducible: yes
- Related Files: `doc/handoffs/CODEX_GOAL_DISPATCH.md`, `doc/handoffs/DELIVERY_UNCERTAINTY_LOG.md`, `doc/handoffs/PLATFORM_DELIVERY_AUDIT_GOALS.md`, `doc/strategy/2026-06-10-pilot-commercial-readiness-proposal.md`, `.artifacts/delivery-audit/2026-06-10/phase-1-pilot-gate-a/summary.md`

---

## [ERR-20260611-001] smoke_networkidle_hydrated_pages

**Logged**: 2026-06-11T00:19:00+08:00
**Priority**: medium
**Status**: fixed
**Area**: local-smoke

### Summary
`npm run smoke:console` can falsely fail in local Next dev mode when route smoke waits for `networkidle` on hydrated pages such as Pilot Lab, Release, Build Components, and Operate detail routes.

### Error
```text
page.goto: Timeout 30000ms exceeded.
- navigating to ".../build/release", waiting until "networkidle"
```

Detail routes can also log `Failed to fetch` when the smoke script screenshots and navigates away before client-side fetches finish.

### Context
- Pilot Lab, Release, and Operate detail pages keep enough dev-mode network activity that `networkidle` is not a reliable readiness signal.
- Cold local compilation can exceed the default 30s navigation timeout by a small margin.
- Navigating away too early can abort still-running detail-page fetches and create false console-error failures.

### Fix
`scripts/smoke-console-auth.mjs` now uses `domcontentloaded`, route-specific visible readiness markers, and a 60s navigation timeout. Detail routes wait for hydrated content markers before screenshots.

### Metadata
- Reproducible: yes
- Related Files: `scripts/smoke-console-auth.mjs`

---
