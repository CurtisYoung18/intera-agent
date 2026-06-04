# Console ↔ Backend Migration — Complete the Foundation

**Author:** Architect | **Date:** 2026-06-04 | **Status:** Ready for coding agent dispatch

> **Goal:** finish migrating ALL routes to `defineRoute` and ALL pages to `useApi`/`apiClient`. Today 28/59 routes (47%) and 0 pages are fully migrated — the codebase has two competing paradigms coexisting in the same files. This program makes the Wave 1 seams the **only** pattern.

**Source context:**
- [`doc/handoffs/MASTER_BUILD_HANDOFF.md`](../MASTER_BUILD_HANDOFF.md) — project status + priority banner
- [`doc/handoffs/GENERIC_HANDOFF.md`](../GENERIC_HANDOFF.md) — project context + work rules (§0 = 铁律)
- [`doc/handoffs/2026-06-04-arch-review-console-backend.md`](../2026-06-04-arch-review-console-backend.md) — architecture review that produced this program
- [`doc/to-do/2026-06-04-enterprise-saas-readiness.md`](../../doc/to-do/2026-06-04-enterprise-saas-readiness.md) — G1–G11 enterprise program (Wave 1 seams were built here)

---

## Program structure

```
Phase 1 — Quick wins (3 independent tasks, no foundation changes)
  → 🛑 CHECKPOINT 1: Architect reviews new shared files

Phase 2a — Task 0: Extend defineRoute with auth modes (SERIAL, architect-gated)
  → 🛑 CHECKPOINT 2: Architect reviews extended defineRoute

Phase 2b — Route migration (3 parallel lanes, disjoint route ownership)
  → 🛑 CHECKPOINT 3: Architect reviews each lane's receipt

Phase 3 — Frontend migration (2 parallel lanes, disjoint page ownership)
  → 🛑 CHECKPOINT 4: Architect reviews full migration
```

**Iron rule:** The coding agent STOPS at each checkpoint, posts the receipt, and WAITS for architect approval before proceeding. No skipping gates.

---

## Phase 1 — Quick Wins (low risk, independent files)

Three tasks that eliminate duplicated patterns BEFORE the mass migration. Each creates a shared file that the later phases consume.

### Task 1.1 — `useSession()` hook

**File:** NEW `apps/console/lib/hooks/use-session.ts`

**Why:** 8 pages independently `fetch('/api/auth/session').then(r => r.json()).then(d => setOrgId(d.orgId))`. This is the same call on every admin page.

**Spec:**
```typescript
// useSession hook — fetches /api/auth/session once, caches in the SWR store.
// Returns { orgId, role, userId, loading, error }.
// Uses the existing useApi cache key 'session' so it deduplicates across components.
import { useApi } from '@/lib/api/client'

interface SessionInfo {
  orgId: string
  role: string
  userId?: string
}

export function useSession() {
  const { data, error, loading } = useApi<SessionInfo>(
    'session',
    () => fetch('/api/auth/session').then(r => r.json())
  )
  return {
    orgId: data?.orgId ?? 'default',
    role: data?.role,
    userId: data?.userId,
    loading,
    error,
  }
}
```

**Acceptance:** Replaces session fetch in ONE page (recommend `model/page.tsx`) to prove the hook works. The old `useEffect` + `fetch` + `orgIdRef` pattern is deleted from that page.

### Task 1.2 — `bustConfigCache()` helper

**File:** Add to `apps/console/lib/api/client.ts`

**Why:** 6 files POST to `/api/admin/config-changed` with `orgId` as fire-and-forget. No error handling, no await.

**Spec:**
```typescript
// In client.ts, add:
export async function bustConfigCache(orgId: string): Promise<void> {
  const res = await fetch('/api/admin/config-changed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orgId }),
  })
  if (!res.ok) {
    console.error('Config cache bust failed:', res.status)
    throw new Error('Failed to invalidate config cache')
  }
}
```

**Acceptance:** Replaces config-changed calls in ONE page to prove it works. The old fire-and-forget pattern is deleted from that page.

### Task 1.3 — `<PageLoader>` shared component

**File:** NEW `apps/console/components/ui/page-loader.tsx`

**Why:** Every admin page hand-rolls loading skeleton + error card + retry button. The `model/page.tsx` pattern is the intended standard but isn't reusable.

**Spec:**
```typescript
// PageLoader — standard data-state wrapper for admin pages.
// Usage: <PageLoader loading={loading} error={error} onRetry={revalidate}>
//   <YourContent />
// </PageLoader>

interface PageLoaderProps {
  loading: boolean
  error: string | null
  onRetry: () => void
  empty?: boolean
  emptyMessage?: string
  children: React.ReactNode
}
```

States:
- **loading** → `<Skeleton>` (reuse existing `@/components/ui/skeleton`)
- **error** → error card with message + Retry button (copy `model/page.tsx:132-144` pattern)
- **empty** → centered muted text (use i18n key or `emptyMessage` prop)
- **data** → `children`

**Acceptance:** Used in ONE page to prove it works. The hand-rolled loading/error/retry JSX is deleted from that page.

### Phase 1 receipt (per task)

```
Changed files: [list]
npx tsc --noEmit -p apps/console/tsconfig.json   # 0 errors
env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npm test   # green
npm run build:console   # success
```

### 🛑 CHECKPOINT 1 — Architect reviews Phase 1

**Stop here.** Post all three receipts. Architect reviews the new shared files (`use-session.ts`, extended `client.ts`, `page-loader.tsx`) before Phase 2 uses them.

---

## Phase 2a — Task 0: Extend `defineRoute` with auth modes (SERIAL)

**File:** `apps/console/lib/api/define-route.ts` (read-only since Wave 1 — this is the first modification)

**Why:** `defineRoute` currently hardcodes session auth (`resolveSession()` throws if no cookie). 13 unmigrated routes use non-session auth (API key, webhook secret, or no auth). Without extending `defineRoute`, those routes can never be migrated.

### Design

Add an `auth` option to `RouteDef`:

```typescript
type AuthMode = 'session' | 'apiKey' | 'webhook' | 'none'

interface RouteDef<Input, Params> {
  // ... existing fields ...
  auth?: AuthMode  // default: 'session'
}
```

**Auth mode behavior:**

| Mode | OrgId from | Role from | No-credential behavior |
|---|---|---|---|
| `session` (default) | `getSession().orgId` | `getSession().role` | 401 (current behavior, unchanged) |
| `apiKey` | `resolveOrgFromApiKey(req)` | `'admin'` (API key = full org access) | 401 `invalid_api_key` |
| `webhook` | URL params `[orgId]` | `'admin'` | 401 `invalid_webhook_secret` |
| `none` | `searchParams.orgId` or `'default'` | `undefined` | Public — no auth required |

**`RouteSession` extension:**

```typescript
export interface RouteSession {
  orgId: string
  role?: 'owner' | 'admin' | 'operator' | 'viewer'
  userId?: string
  authMode: AuthMode
}
```

**API key resolution:** Import `resolveOrgFromApiKey` from `@/lib/api-auth`. Extract Bearer token from `Authorization` header. Fail 401 if token missing/invalid.

**Webhook resolution:** Extract `orgId` from route params. Validate `x-intera-internal` header + timing-safe webhook secret comparison (reuse existing logic from the webhook routes). Fail 401 if invalid.

**`requireRole` interaction:** `requireRole` only takes effect when `auth: 'session'`. For `apiKey`/`webhook`, the resolved role is `'admin'` (full access). For `none`, `requireRole` is ignored (no role to check).

**Important — backwards compatibility:** All existing routes using `defineRoute` (28 route files) must continue to work without changes. The `auth` option defaults to `'session'`.

### Acceptance

- Existing 28 `defineRoute` routes unchanged — tsc 0 errors, all existing tests green
- A **new test** (`define-route-auth.test.ts`) proves each auth mode resolves the correct orgId:
  - `session`: orgId from cookie → handler receives correct orgId
  - `apiKey`: orgId from Bearer token → handler receives correct orgId
  - `webhook`: orgId from URL params → handler receives correct orgId
  - `none`: public access → handler receives orgId (from query or default)
  - `session` without cookie → 401
  - `apiKey` with invalid token → 401
  - `session` with `requireRole` → 403 when role doesn't match
- Define and export `AuthMode` type so Lane agents can reference it

### Files owned

| File | Action |
|---|---|
| `apps/console/lib/api/define-route.ts` | MODIFY — add `auth` option, extend `resolveSession`, add `RouteSession.authMode` |
| `apps/console/lib/api/__tests__/define-route-auth.test.ts` | NEW — auth mode tests |

### 🛑 CHECKPOINT 2 — Architect reviews extended defineRoute

**Stop here.** Post receipt + the diff of `define-route.ts` + the new test output. Architect must approve the auth mode design before lanes fan out. This is the highest-risk change in the program — a wrong foundation breaks every migrated route.

---

## Phase 2b — Route Migration (3 parallel lanes)

After CHECKPOINT 2 approval, spawn 3 sub-agents in git worktrees. Disjoint route ownership, zero merge conflicts.

### Lane A — Session-based admin routes (12 routes, 13 route files)

**All use `auth: 'session'` — straightforward defineRoute wrapping.**

| # | Route file | Methods | Notes |
|---|---|---|---|
| 1 | `admin/agent/route.ts` | GET | Returns agent config by agentId query param |
| 2 | `admin/api-keys/route.ts` | GET, POST | Full CRUD |
| 3 | `admin/api-keys/[id]/route.ts` | DELETE | Single key |
| 4 | `admin/customers/route.ts` | GET | List customers/orgs |
| 5 | `admin/knowledge/gptbots/route.ts` | GET, PUT | GptBots config |
| 6 | `admin/knowledge/test/route.ts` | POST | Test knowledge search |
| 7 | `admin/skills/test/route.ts` | POST | Test skill execution |
| 8 | `admin/policies/stats/route.ts` | GET | Policy usage stats |
| 9 | `admin/organizations/[id]/route.ts` | GET, PUT | Org settings |

**Also — ops sub-routes (session-based, simple):**

| 10 | `cases/[id]/export/route.ts` | GET | Case markdown export |
| 11 | `cases/[id]/messages/route.ts` | GET | Case messages |
| 12 | `cases/[id]/traces/route.ts` | GET | Case action traces |
| 13 | `chats/[chatId]/compact/route.ts` | POST | Trigger compaction |
| 14 | `chats/[chatId]/memory/route.ts` | GET | Chat memory |
| 15 | `chats/[chatId]/traces/route.ts` | GET | Chat traces |
| 16 | `chats/[chatId]/update-profile/route.ts` | POST | Update user profile |
| 17 | `users/[userId]/chats/route.ts` | GET | User chat history |
| 18 | `users/[userId]/profile/route.ts` | GET | User profile |

**For each route:**
1. Read existing handler — understand what it does
2. Wrap with `defineRoute({ method, inputSchema?, handler })` 
3. Replace manual `getSession()` / `getActiveOrgId()` with `ctx.session`
4. Replace raw `prisma.*` with `ctx.repo.*`
5. Replace manual error responses with `throw new RouteError(...)` or `throw new NotFoundError()`
6. Add `requireRole: ['admin', 'owner']` for mutation routes
7. Write a route-level test in `__tests__/` (follow existing pattern from `skills-route.test.ts`)
8. Add zod input schema for POST/PUT routes

### Lane B — Auth routes (8 routes, special auth modes)

| # | Route file | Methods | Auth mode | Notes |
|---|---|---|---|---|
| 1 | `auth/session/route.ts` | GET | `session` | Already uses getSession — simple wrap |
| 2 | `auth/memberships/route.ts` | GET | `session` | List user's org memberships |
| 3 | `auth/switch-org/route.ts` | POST | `session` | Switch active org — needs membership check |
| 4 | `auth/logout/route.ts` | POST | `session` | Clear cookie |
| 5 | `auth/login/route.ts` | POST | `none` | STAFF_PASSWORD or bcrypt. Issues session cookie. |
| 6 | `auth/register/route.ts` | POST | `none` | Invite-token gated. Creates user+membership. |
| 7 | `auth/google/route.ts` | GET | `none` | OAuth redirect. No body, no envelope. |
| 8 | `auth/google/callback/route.ts` | GET | `none` | OAuth callback. Issues session cookie. |

**Special handling:**
- Login, register, google, google/callback: these create sessions rather than consume them. `auth: 'none'` with `defineRoute` provides zod validation + error envelope. Cookie setting happens inside the handler.
- Google redirect: the handler returns a `NextResponse.redirect()`, not JSON. `defineRoute` handler can return any `NextResponse` — the envelope is only applied when the handler returns `ApiEnvelope`.

### Lane C — Messages + LiveChat routes (5 routes, special auth modes)

| # | Route file | Methods | Auth mode | Notes |
|---|---|---|---|---|
| 1 | `messages/route.ts` | POST | `apiKey` | Main SSE entry. ~1040 lines. **Highest risk.** |
| 2 | `livechat/webhook/[orgId]/route.ts` | POST | `webhook` | Per-org webhook |
| 3 | `livechat/webhook/[orgId]/[agentName]/route.ts` | POST | `webhook` | Per-agent webhook |
| 4 | `livechat/webhook/route.ts` | POST | `webhook` | Legacy webhook (no orgId in URL) |
| 5 | `livechat/config/route.ts` | GET | `none` | Anonymous widget config (non-sensitive fields only) |
| 6 | `livechat/form-submit/route.ts` | POST | `none` | Anonymous form submission |

**Special handling:**
- **`messages/route.ts`**: This is SSE streaming — incompatible with `ApiEnvelope`. Use `defineRoute` for the **setup phase** (auth resolution, orgId, input validation), but the handler returns an SSE `Response`, not JSON. The `defineRoute` catch block must NOT wrap SSE responses — check `response instanceof Response` before wrapping.
- **Webhook routes**: `auth: 'webhook'` resolves orgId from URL params + validates webhook secret. The existing `isTrustedInternalCall()` + timing-safe comparison logic moves INTO `defineRoute`'s webhook resolver.
- **Legacy webhook** (`livechat/webhook/route.ts`): No orgId in URL. Needs special handling — `auth: 'webhook'` with orgId from `x-intera-org` header.

### Phase 2b acceptance (per lane)

```
Changed files: [list]
npx tsc --noEmit -p apps/console/tsconfig.json   # 0 errors
env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npm test   # green
npm run build:console   # success
```

**Additional for each lane:**
- **Every migrated route** gets a route-level test (follow existing `__tests__/` patterns)
- **Lane B**: RBAC + invite isolation tests must stay green
- **Lane C**: SSE streaming still works (manual curl test for `/api/messages`); webhook signature validation still works

### 🛑 CHECKPOINT 3 — Architect reviews each lane

**Stop after each lane reports.** Architect reviews changed files + test output. Lanes A and B are mechanical — review can be fast. Lane C (messages + webhooks) needs careful review because of SSE/webhook complexity.

---

## Phase 3 — Frontend Migration (2 parallel lanes)

After CHECKPOINT 3 approval. Goal: eliminate raw `fetch()` from page components.

### Pre-requisites (from Phase 1 — already landed)
- `useSession()` hook available
- `bustConfigCache()` helper available
- `<PageLoader>` component available

### Migration pattern (apply to each page)

**Before (current anti-pattern):**
```typescript
const orgIdRef = useRef('default')
useEffect(() => {
  fetch('/api/auth/session').then(r => r.json()).then(d => { if (d.orgId) orgIdRef.current = d.orgId }).catch(() => {})
}, [])

useEffect(() => {
  fetch(`/api/admin/something?agentId=${agentId}`).then(r => r.json()).then(d => setData(d.data)).catch(() => {}).finally(() => setLoading(false))
}, [agentId])

const save = async () => {
  await fetch('/api/admin/something', { method: 'POST', body: JSON.stringify(data) })
  fetch('/api/admin/config-changed', { method: 'POST', body: JSON.stringify({ orgId: orgIdRef.current }) })
}
```

**After (migrated):**
```typescript
const { orgId } = useSession()

const { data, error, loading, revalidate } = useApi(
  agentId ? `something-${agentId}` : null,
  () => apiClient(`/api/admin/something?agentId=${agentId}`)
)

const save = async () => {
  await apiClient('/api/admin/something', { method: 'POST', body: data })
  await bustConfigCache(orgId)
}
```

### Lane A — Admin config pages (6 pages)

| # | Page | Raw fetches | Notes |
|---|---|---|---|
| 1 | `admin/model/page.tsx` | 3 | Session + 2 config-changed. Already uses apiClient for main data. |
| 2 | `admin/memory/page.tsx` | 7 | Session + agent + models + 3 config-changed + save. Mix of raw + apiClient. |
| 3 | `admin/tools/page.tsx` | 6 | Session + knowledge sources + delete + 2 config-changed + test. Mix of raw + apiClient. |
| 4 | `admin/knowledge/page.tsx` | 7 | All raw fetch. No apiClient. |
| 5 | `admin/api-keys/page.tsx` | 4 | All raw fetch. No apiClient. |
| 6 | `admin/case-types/page.tsx` | 7 | Session + 2 config-changed + CRUD. Has one apiClient call. |
| 7 | `admin/case-types/[name]/page.tsx` | 8 | Session + 2 config-changed + detail + skills + models + save + delete. Worst offender. |
| 8 | `admin/channels/web-chat/page.tsx` | 1 | Session fetch only. |

### Lane B — Channels + auth pages (3 pages)

| # | Page | Raw fetches | Notes |
|---|---|---|---|
| 1 | `admin/channels/livechat/page.tsx` | 2 | Session + agent-configs. Uses apiClient for config CRUD. |
| 2 | `login/page.tsx` | 2 | Health check + login POST. Auth page — special case. Keep raw fetch for login POST but use apiClient for health. |
| 3 | `org-picker/page.tsx` | 3 | Session + memberships + switch-org. Auth page — special case. |

### Excluded (owned by other agents or intentionally skipped)

| Page | Reason |
|---|---|
| `admin/guardrails/page.tsx` | G11 owns — do NOT touch |
| `admin/agent/page.tsx` | Already clean (3 apiClient, 0 raw fetch) |
| `admin/members/page.tsx` | Already clean (6 apiClient, 0 raw fetch) |
| `admin/playground/page.tsx` | Uses apiClient for main data. 4 raw fetches are for SSE run (special case — SSE can't use apiClient). Keep SSE fetch as-is. |
| `ops/*` pages | Already clean (all apiClient, 0 raw fetch) |

### Phase 3 acceptance (per lane)

```
Changed files: [list]
npx tsc --noEmit -p apps/console/tsconfig.json   # 0 errors
env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npm test   # green
npm run build:console   # success
```

**Additional:**
- **Manual click-through of every modified page:** load → edit → save (watch auto-save chip) → navigate away → come back (verify persistence). Error path: devtools offline → try save → verify error chip appears. **Screenshots required.**
- Verify `useSession()` is used instead of raw session fetch
- Verify `bustConfigCache()` is used instead of raw config-changed POST
- Verify `<PageLoader>` is used instead of hand-rolled loading/error/retry

### 🛑 CHECKPOINT 4 — Architect reviews full migration

**Final stop.** Architect reviews all changed files, test output, and screenshots. Verifies:
- Zero regression on existing functionality
- All pages use consistent patterns
- No raw `fetch()` remaining (except intentional exceptions: SSE, auth)

---

## Conflict rules (must hold across all phases)

1. **`define-route.ts`** — modified ONLY in Phase 2a (Task 0). Read-only to all lanes.
2. **`client.ts`** — modified in Phase 1 (Task 1.2) + Phase 2a (apiClient may need apiKey auth header support for Lane C). Coordinate: Task 1.2 adds `bustConfigCache`; Phase 2a adds `apiKey` auth header if needed.
3. **Route files** — each route belongs to exactly ONE lane. No overlap.
4. **Page files** — each page belongs to exactly ONE lane. No overlap.
5. **New shared files** (`use-session.ts`, `page-loader.tsx`) — created in Phase 1, read-only to all lanes.
6. **`dictionaries.ts`** — lanes APPEND i18n keys only (en + zh). Expect trivial merge.
7. **`guardrails/page.tsx`** — G11 owns it. Do NOT touch.
8. **Use git worktrees** per lane for isolation.

---

## Verification gates (every phase, every lane)

```
npx tsc --noEmit -p apps/console/tsconfig.json   # 0 errors
env -u ANTHROPIC_API_KEY -u MINIMAX_API_KEY -u DEEPSEEK_API_KEY npm test   # ALL GREEN, KEYLESS
npm run build:console   # success
```

**No deployment.** Local only. Do NOT touch SSH creds, DB password, or server config.

---

## Summary — file ownership map

| Phase | Task | Files owned |
|---|---|---|
| P1.1 | useSession hook | NEW `lib/hooks/use-session.ts` |
| P1.2 | bustConfigCache | MODIFY `lib/api/client.ts` |
| P1.3 | PageLoader | NEW `components/ui/page-loader.tsx` |
| P2a | Extend defineRoute | MODIFY `lib/api/define-route.ts`, NEW `lib/api/__tests__/define-route-auth.test.ts` |
| P2b-A | Admin routes | 18 route files (see Lane A table) + their `__tests__/` |
| P2b-B | Auth routes | 8 route files (see Lane B table) |
| P2b-C | Messages + livechat | 6 route files (see Lane C table) |
| P3-A | Admin pages | 8 page files (see Lane A table) |
| P3-B | Channels + auth pages | 3 page files (see Lane B table) |
