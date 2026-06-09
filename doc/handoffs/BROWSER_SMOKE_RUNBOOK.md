# Browser Smoke Runbook

**Purpose:** prevent coding sessions from spending an hour rediscovering local Console authentication quirks.

## The Local Auth Trap

Console login currently issues `intera_session` with `secure: true` in:

- `apps/console/app/api/auth/login/route.ts`
- `apps/console/app/api/auth/register/route.ts`
- `apps/console/app/api/auth/switch-org/route.ts`
- Google auth callback routes

That is correct for production HTTPS, but it means a normal `http://localhost:3001` browser session may not send the session cookie. When this happens, authenticated pages redirect to `/login` or API calls return `401` even though `/api/auth/login` returned `ok: true`.

Do not burn time trying variations of:

- manually forging `intera_session`
- switching `localhost` vs `127.0.0.1`
- injecting cookies through Playwright
- copying `SESSION_SECRET`
- repeatedly restarting dev server without a new signal
- debugging Browser plugin discovery

Those attempts are not product verification. They are local auth plumbing.

## Decision Rule

Use this gate:

```text
UI route changed?
  yes -> attempt browser smoke once using the approved path below.
  no  -> do not require browser smoke; use focused tests + tsc + keyless tests + build.

Browser smoke blocked by auth/session/cookie/dev-server setup for >10 minutes?
  stop.
  report "browser smoke blocked by local secure-cookie auth" with evidence.
  do not keep trying custom token/cookie/HTTPS experiments unless this lane owns QA infrastructure.
```

## Approved Local Smoke Attempts

For a local UI lane:

1. Start clean:

```bash
pkill -f "next dev" || true
rm -rf apps/console/.next
npm run dev -w apps/console -- --hostname 127.0.0.1 --port 3001
```

2. Try normal login through the page once.
3. If the page redirects back to login or API returns `401`, stop and mark local browser smoke blocked by secure-cookie auth.
4. Fall back to:
   - component tests for the changed surface
   - route/API tests for the changed endpoints
   - screenshot of any unauthenticated/public render if useful
   - production/staging HTTPS verification only after deploy is explicitly in scope

## What To Put In The Receipt

Use this wording when blocked:

```text
Browser smoke attempted on local Console.
Blocked by known local auth limitation: Console session cookie is issued with secure=true, so HTTP localhost browser sessions do not retain/send it reliably.
I did not spend time forging cookies or custom JWTs.
Covered this lane with focused tests, tsc, keyless full tests, and build.
```

## Future QA0 Fix

When someone owns QA infrastructure, add one of these:

1. A shared `sessionCookieOptions()` helper that uses `secure: process.env.NODE_ENV === "production"` or an explicit `FORCE_SECURE_COOKIES` flag.
2. A single `npm run smoke:console` script that starts HTTPS dev server with a repo-ignored self-signed cert and writes Playwright storage state.
3. A test-only authenticated storage-state fixture for Playwright.

Until QA0 exists, do not let feature lanes invent local authentication harnesses.
