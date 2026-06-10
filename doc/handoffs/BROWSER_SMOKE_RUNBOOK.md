# Browser Smoke Runbook

**Purpose:** make authenticated local Console smoke reproducible instead of rediscovering auth and DB quirks every lane.

## The Local Auth Trap

Console login currently issues `intera_session` with `secure: true` in:

- `apps/console/app/api/auth/login/route.ts`
- `apps/console/app/api/auth/register/route.ts`
- `apps/console/app/api/auth/switch-org/route.ts`
- Google auth callback routes

That is correct for production HTTPS, but it means a normal `http://localhost:3001` browser session may not send the session cookie. When this happens, authenticated pages redirect to `/login` or API calls return `401` even though `/api/auth/login` returned `ok: true`.

Do not waste time on random variants with no runbook:

- guessing ports or DB URLs
- switching between unrelated `.env.local` files blindly
- repeatedly restarting `next dev` without checking `/api/health`
- inventing one-off browser flows that are not written down

## Decision Rule

Use this gate:

```text
UI route changed?
  yes -> attempt browser smoke once using the approved path below.
  no  -> do not require browser smoke; use focused tests + tsc + keyless tests + build.

Browser smoke blocked by local DB/auth setup for >15 minutes?
  stop.
  report the exact blocker with evidence.
  do not invent a second local auth path.
```

## Approved Local Smoke Attempts

For a local UI lane, use the repo script:

1. Make sure local DB is actually reachable on the expected port:

```bash
curl http://127.0.0.1:3001/api/health
```

If it is not `{"status":"ok","db":"connected"}`, fix DB/dev-server first. Typical known local path is:

```bash
open -a Docker
DATABASE_URL='postgresql://intera:intera@localhost:5434/intera' \
  npm run dev -w apps/console -- --hostname 127.0.0.1 --port 3001
```

2. Run the authenticated smoke script:

```bash
npm run smoke:console
```

What it does:

- checks `/api/health`
- logs in through `/api/auth/login`
- captures the real `intera_session` from `Set-Cookie`
- injects that session into Playwright for `127.0.0.1`
- verifies the current Build / Operate / Settings route matrix
- writes screenshots + `summary.json` to `.artifacts/final-smoke/`

3. If `npm run smoke:console` fails:

- record the exact error
- keep the static gates authoritative
- do not create a second auth harness in the feature lane

4. Only fall back to unauthenticated/public screenshots when DB or login is genuinely unavailable and already evidenced.

## What To Put In The Receipt

Use this wording when blocked:

```text
Browser smoke attempted with `npm run smoke:console`.
Blocked before authenticated route verification because local DB/auth was unavailable.
Evidence: include `/api/health`, login failure, or container/port status.
Covered this lane with focused tests, tsc, keyless full tests, and build.
```

## Current Proven Local Path

This repo now has a known-good local path:

- local Postgres on `localhost:5434`
- local dev server on `127.0.0.1:3001`
- root `.env.local` carrying `STAFF_PASSWORD`
- `npm run smoke:console` as the single approved authenticated smoke path

The cookie is still issued with `secure: true` in app code. The script does not change product behavior; it only turns the real session cookie into a reproducible local Playwright fixture for verification.
