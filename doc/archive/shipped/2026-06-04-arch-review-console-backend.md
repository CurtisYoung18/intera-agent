> **Historical receipt note (2026-06-08):** This file is preserved as past-work evidence. It may contain old terms such as `Skill`, `Policy`, `Guardrail`, `stage`, or `sub-agent`, and some files still read like implementation plans. Do not dispatch new work from this file. Current work starts at [../README.md](../README.md), [../handoffs/MASTER_BUILD_HANDOFF.md](../handoffs/MASTER_BUILD_HANDOFF.md), and [../to-do/2026-06-08-foundation-reset-domain-model.md](../to-do/2026-06-08-foundation-reset-domain-model.md).

# Architecture Review — Console ↔ Backend for Enterprise SaaS

**Author:** Architect | **Date:** 2026-06-04 | **Status:** Review complete, pending owner approval

> **Scope:** long-term review of console ↔ backend cooperation against an enterprise commercial-SaaS bar. Not a patch list — a prioritized program. The existing G1–G11 program ([`doc/to-do/2026-06-04-enterprise-saas-readiness.md`](../to-do/2026-06-04-enterprise-saas-readiness.md)) is the source plan; this review assesses current state against it and identifies what's changed.

---

## 0. Executive summary

Intera is a **working product** with a **solid foundation** — the Wave 1 seams (`defineRoute`, `repoForOrg`, `apiClient`/`useApi`, identity/RBAC/audit, contracts) are well-designed and correctly implemented. The team's engineering discipline (keyless test bar, red→green guard tests, receipt culture) is strong.

The gap to **enterprise commercial SaaS** is not a missing feature — it's that the foundation was laid but **only ~45% of the house is built on it**. The remaining gaps fall into three tiers:

| Tier | What | Impact |
|---|---|---|
| **Tier 1 — Complete the migration** | Finish moving all routes to `defineRoute` + all pages to `useApi` | Today: two competing data-fetching paradigms coexist in the same file. Every new page copies the wrong pattern. |
| **Tier 2 — Runtime hardening** | Observability (G5), stateless runtime (G4), durable async (G6) | Today: single-process, unobservable. Can't scale horizontally, can't debug prod without SSH. |
| **Tier 3 — Deep correctness** | RLS (G2-DB), jsonb+optimistic-concurrency (G7), loop decomposition (G10), guardrail coverage (G11-P2) | Today: app-layer-only tenant safety, JSON-in-String on Postgres, 1815-line monolith. |

**Bottom line:** the seams are correct. The priority now is **adoption** (Tier 1) before **extension** (Tier 2/3). A half-migrated codebase is worse than an unmigrated one — it teaches the wrong pattern to every new contributor.

---

## 1. What's solid (keep doing this)

### 1.1 The seam architecture is correct

The four foundation files are well-designed and deletion-tested:

| Seam | Verdict | Notes |
|---|---|---|
| `defineRoute` | Deep module. 95 lines of pipeline replace ~29 routes × N lines of hand-rolled session/validation/error. | `requireRole` declarative authZ, `RouteError` typed throws, `__status` strip for 201. Clean. |
| `repoForOrg` | Correct deny-by-default Proxy. 17 models scoped. | `whereHasOrgId` preserves explicit where clauses for findUnique/update/delete. `raw` escape hatch documented. |
| `apiClient`/`useApi` | SWR-style cache with `useSyncExternalStore`. Correct dedup. | In-memory cache survives re-renders but not page reloads — acceptable for now, needs Redis for multi-instance. |
| `contracts/` | 11 domain files. Clean `ApiEnvelope` type. | `apiCreated()` for 201 is a minor hack (`__status` strip in defineRoute) but contained. |

### 1.2 Engineering discipline

- **Keyless test bar** (497 passed / 0 failed / 26 skipped) — enforced by global provider mock in `vitest-setup.ts`. This is the right bar.
- **Red→green guard tests** for safety changes (cross-org isolation, livechat B1 guard, G11 F2 fail-closed).
- **Receipt culture** — tsc + test + build output per deliverable.

### 1.3 Identity/RBAC/audit (G3/D2)

Well-implemented. Google SSO with proper JWKS verification, invite-only membership, RBAC four-tier, last-owner protection, switch-org without IDOR, `AuditLog` model. The `Membership` (not `UserOrgMembership`) schema is the right call.

---

## 2. Tier 1 — Complete the migration (highest leverage)

### 2.1 Route migration is ~45% complete

**Evidence:** 27 route files use `defineRoute` out of ~60 total route files.

**Unmigrated critical routes:**

| Route | Risk of staying unmigrated |
|---|---|
| `app/api/messages/route.ts` (~1040 lines) | Main SSE entry. No zod validation, no envelope, manual org resolution. Highest-traffic route. |
| `app/api/auth/login/route.ts` | No `defineRoute`, manual session creation. |
| `app/api/auth/google/route.ts` + `callback/route.ts` | Manual cookie handling, no envelope. |
| `app/api/auth/register/route.ts` | Manual validation. |
| `app/api/livechat/webhook/*` (3 routes) | Manual org resolution from URL params. Already had one cross-tenant leak (G2 gotcha #7). |
| `app/api/livechat/config/route.ts` | Anonymous route with manual org resolution. |
| `app/api/admin/api-keys/*` (2 routes) | No `defineRoute`. |
| `app/api/admin/knowledge/gptbots/route.ts` | No `defineRoute`. |
| `app/api/admin/knowledge/test/route.ts` | No `defineRoute`. |
| `app/api/admin/skills/test/route.ts` | No `defineRoute`. |
| `app/api/admin/organizations/[id]/route.ts` | No `defineRoute`. |
| `app/api/admin/policies/stats/route.ts` | No `defineRoute`. |
| `app/api/admin/agent/route.ts` | No `defineRoute`. |
| `app/api/cases/[id]/export/route.ts` | No `defineRoute`. |
| `app/api/cases/[id]/messages/route.ts` | No `defineRoute`. |
| `app/api/cases/[id]/traces/route.ts` | No `defineRoute`. |
| `app/api/chats/[chatId]/compact/route.ts` | No `defineRoute`. |
| `app/api/chats/[chatId]/memory/route.ts` | No `defineRoute`. |
| `app/api/chats/[chatId]/traces/route.ts` | No `defineRoute`. |
| `app/api/chats/[chatId]/update-profile/route.ts` | No `defineRoute`. |
| `app/api/users/[userId]/chats/route.ts` | No `defineRoute`. |
| `app/api/users/[userId]/profile/route.ts` | No `defineRoute`. |
| `app/api/health/route.ts` | OK unmigrated — public health check, no session needed. |

**Recommendation:** Batch-migrate remaining routes in 3 lanes (auth, messages/livechat, admin-crud) with the same parallel-agent pattern used for Wave 1. The `defineRoute` pattern is proven; this is mechanical work.

### 2.2 Frontend still has 61 raw `fetch()` calls

**Evidence:** Pages that use `useApi`/`apiClient` (16 files) still contain raw `fetch()` calls alongside them. The worst example is `model/page.tsx` which uses `apiClient` for the main data fetch but raw `fetch()` for session lookup and config-changed cache busting.

**The pattern problem:** When a new developer copies an existing page, they see both patterns and copy the wrong one. Each new raw `fetch()` is technical debt.

**Specific issues:**

| File | Raw fetch count | Notes |
|---|---|---|
| `model/page.tsx` | 3 | Session lookup + 2 config-changed calls. Uses apiClient for main fetch. |
| `memory/page.tsx` | 5 | Same pattern as model. |
| `tools/page.tsx` | 4 | Session + config-changed + knowledge sources. Uses apiClient for skill CRUD. |
| `case-types/[name]/page.tsx` | 5 | Session + config-changed + skills + models. |
| `case-types/page.tsx` | 4 | Session + config-changed + CRUD. |
| `guardrails/page.tsx` | 6 | All raw fetch. G11 owns this file — coordinate. |
| `playground/page.tsx` | 4 | Configs + models + agent + run. Uses apiClient for main. |
| `knowledge/page.tsx` | 6 | All raw fetch. |
| `api-keys/page.tsx` | 4 | All raw fetch. |
| `channels/livechat/page.tsx` | 3 | Session + agent-configs. |
| `login/page.tsx` | 2 | Health check + login POST. |

**Recommendation:**
1. Create a `useSession()` hook (or a context) so 8+ pages don't independently `fetch('/api/auth/session')`.
2. Create a `bustConfigCache(orgId)` helper so 6+ files don't hand-roll the config-changed POST.
3. Migrate remaining pages to `useApi` for data fetching. Target: zero raw `fetch()` in page components (auth pages and SSE/streaming endpoints exempt).

### 2.3 No shared UI primitives for data states

Every page implements its own loading skeleton, error card, and empty state. The `model/page.tsx` pattern (try/catch/finally + error state + Retry button) is the intended standard but isn't extracted as a reusable component.

**Recommendation:** Extract `<PageLoader>` (skeleton + error + retry + empty) as a shared component. One standard pattern, used by every admin page.

---

## 3. Tier 2 — Runtime hardening

### 3.1 Observability (G5) — still at zero

**Evidence:** `lib/logger.ts` is a 35-line `console.*` wrapper. No Sentry, no structured logging transport, no metrics, no request-id correlation.

**Enterprise SaaS requirement:** When a customer reports "the agent gave a wrong answer at 3pm," you need to trace that single interaction through: HTTP request → agent loop → LLM calls → tool executions → guardrail decisions → response. Today this requires SSH + journalctl grep.

G5 was scheduled for Wave 2 "safe three" dispatch (§9 of the enterprise spec) but hasn't been executed yet. The `defineRoute` already carries `log` context with `orgId`/`userId` — the correlation substrate exists, it just doesn't write anywhere useful.

**Recommendation:** Execute G5 as the next priority after Tier 1 migration. Minimum:
- Structured JSON logging in prod (keep console in dev)
- `requestId` on every response header + in every log line
- Sentry for error tracking (scrub PII — emails, API keys, message content)
- Per-org token/cost metrics (billing substrate)

### 3.2 In-memory everything (G4) — can't run 2 instances

**Evidence:**
- `lib/rate-limit.ts`: in-memory Map, self-admits "replace with Redis"
- `lib/agent/config-cache.ts`: in-process Map, invalidated by `/api/admin/config-changed` fire-and-forget POST
- `lib/livechat/session-store.ts`: in-process
- `lib/api/client.ts`: SWR cache is in-memory (survives re-renders, not page reloads)

**Config cache invalidation is especially fragile:** 6 files POST to `/api/admin/config-changed` and don't await the response. If the POST fails (network blip, server restart), the cache stays stale for the full TTL. There's no confirmation, no retry, no visibility.

**Recommendation:** G4 (Redis-backed rate-limit/session/config-cache + pub/sub invalidation) moves to Wave 2 must-do. Until then, at minimum:
- Await the config-changed POST response and surface failures
- Add a `?ts=` cache-bust on the next data fetch after a write (belt and suspenders)

### 3.3 No durable async (G6) — background work lost on restart

**Evidence:** `lib/agent/orchestrator.ts:429` background dispatch `.catch(console.error)`. LiveChat pending events are the only retried async work. Process death = lost orchestrator work.

**Recommendation:** G6 (generalize `LiveChatPendingEvent` into a job-queue seam) in Wave 3. Not urgent for internal-test version but blocks production reliability.

---

## 4. Tier 3 — Deep correctness

### 4.1 RLS (G2 DB-layer) — tenant isolation is app-only

**Evidence:** `repoForOrg` is the only tenant safety mechanism. A raw `prisma.skill.findMany({})` (no where clause) returns cross-org data. The Proxy denies unknown methods, but `repo.raw` exposes the raw Prisma client.

**Recommendation:** G2-RLS as a gated follow-up per the existing spec (§5.3). The rollout risk (RLS can break the live bot if GUC isn't set everywhere) means this needs careful sequencing. Do NOT rush this — the app-layer isolation is working.

### 4.2 Data model debt (G7) — JSON-in-String on Postgres

**Evidence:** Several `String` columns in the schema store JSON (stage configs, capability bindings, policy config). Postgres has `Json`/`Jsonb` types — use them.

**Also missing:** "Exactly one active version per agent" is enforced in app code (`schema.prisma` comment line 66), not the database. A partial unique index `WHERE "isActive" = true` would make this a DB guarantee.

**Recommendation:** G7 in Wave 3. Low immediate risk but accumulates migration debt.

### 4.3 loop.ts decomposition (G10) — 1815 lines

**Evidence:** `loop.ts` is 1815 lines, `skills.ts` 1071, `case-agent-loop.ts` 883, `policy.ts` 677, `orchestrator.ts` 609. Total: ~5000 lines of tightly coupled agent runtime.

The seam architecture (G1–G3) is now correct. Decomposition can happen along those seams rather than being recut later. This is correctly sequenced last in the G-program.

**Recommendation:** G10 after G4/G6/G7 land. Don't decompose before the runtime seams (Redis, job queue) are in place — you'd cut the wrong boundaries.

### 4.4 Guardrail coverage gaps (G11 Phase 2)

Two known live gaps:
- **No `preReply` checkpoint:** Customer-visible replies are emitted mid-loop with zero policy inspection. A conversational "sure I'll refund you" is never checked.
- **`preFinalize` only in case-agent-loop:** The main `loop.ts` never calls `preFinalize`. Any finalization that bypasses the case-agent path runs no finalization guardrail.

**Recommendation:** G11 Phase 2 rides with G10 (loop decomposition). Don't add checkpoints before restructuring the loop — you'd be adding complexity to a file about to be decomposed.

---

## 5. UI/UX observations

### 5.1 The design system is a reference, not a constraint

The Intera Design System README correctly notes: *"This design system is a reference/spec, not the per-page build target."* This matches the user's guidance. The design system describes an ideal "iOS Liquid Glass" aesthetic; the actual console pages use a simpler `bg-white/60 backdrop-blur-xl` card style. **This is fine** — the console is a data-dense operational tool, not a marketing page. Don't force glass morphism onto tables and forms.

### 5.2 Current console UX — adequate for internal test, not for enterprise

| Area | Current state | Enterprise bar |
|---|---|---|
| Loading states | Per-page skeletons, inconsistent | Shared `<PageLoader>` with skeleton → error+retry → empty → data |
| Error visibility | A1/A2 fixed — errors now surface | Good enough |
| Save feedback | Persistent chip (未保存/保存中…/已保存✓/失败✗) | Good — the right pattern |
| Empty states | Inconsistent — some show "No data", some show nothing | Shared `<EmptyState>` with contextual message + CTA |
| Confirm dialogs | Shared `ConfirmDialog` (danger + warning variants) | Good — C1 fixed |
| Navigation | Sidebar with agent picker, org switcher | Good |
| Responsive | Unknown — likely desktop-only | Enterprise SaaS needs responsive (ops check on mobile) |
| Accessibility | Not assessed | Needs audit — focus management, screen reader labels, keyboard navigation |
| Bilingual | i18n system exists, en=1090, zh=1090 keys | Good coverage |

### 5.3 Specific UI paper cuts

1. **Config cache busting is invisible.** After saving a config change, there's no indication whether the runtime cache was invalidated. A failed cache bust → stale agent behavior → "I configured it but it didn't take effect." The auto-save chip shows "Saved" but that only means the DB write succeeded, not that the runtime picked it up.

2. **No breadcrumb or back navigation.** Deep pages (case-types/[name], ops/cases/[caseId]) have no breadcrumb. Users rely on browser back.

3. **Version context bar is subtle.** The active-vs-draft badge in `VersionContextBar` is a small text label. B3 was partially addressed (draft warning in playground) but the active version indicator could be more prominent.

---

## 6. Prioritized action plan

### Immediate (unblock internal-test release)

| # | Action | Effort | Spec |
|---|---|---|---|
| 1 | Create `useSession()` hook — eliminate 8+ duplicate session fetches | Small | New file: `lib/hooks/use-session.ts` |
| 2 | Create `bustConfigCache(orgId)` helper — eliminate 6+ duplicate cache-bust calls | Small | New file or add to `client.ts` |
| 3 | Extract `<PageLoader>` shared component (skeleton + error + retry + empty) | Small | New component |
| 4 | Await config-changed POST responses + surface failures | Small | Fix 6 call sites |

### Short-term (next 1-2 weeks, after internal-test ships)

| # | Action | Effort | Spec |
|---|---|---|---|
| 5 | Batch-migrate remaining routes to `defineRoute` (3 lanes: auth, messages/livechat, admin-crud) | Medium | Existing G1 pattern |
| 6 | Migrate remaining pages to `useApi` — target zero raw fetch() in page components | Medium | Existing apiClient pattern |
| 7 | Execute G5 observability (structured logging + Sentry + requestId + token metrics) | Medium | Enterprise spec §5.2 Lane O |

### Medium-term (Wave 2–3)

| # | Action | Effort | Spec |
|---|---|---|---|
| 8 | G4 Redis stateless runtime | Large | Enterprise spec §? (to be detailed) |
| 9 | G2-RLS database-level tenant isolation | Large | Enterprise spec §5.3 |
| 10 | G6 durable async / job queue | Large | Enterprise spec §? (to be detailed) |
| 11 | G7 data model correctness (jsonb, optimistic concurrency, partial unique index) | Medium | Enterprise spec §? (to be detailed) |
| 12 | G10 loop.ts decomposition + G11 Phase 2 (preReply + uniform checkpoints) | Large | Enterprise spec §5b |

---

## 7. Process notes

### 7.1 The handoff discipline is working

`MASTER_BUILD_HANDOFF.md` is accurate and well-maintained. The two-handoff system (GENERIC + MASTER) is the right split. Keep it.

### 7.2 Migration collision guard

The `20260603000008` prefix collision (3 migrations sharing one prefix) was benign but shouldn't recur. The enterprise spec §3.4 calls for a CI guard — this hasn't been implemented yet. Low priority but should be done before the next multi-lane migration sprint.

### 7.3 G11 merge coordination

`guardrails/page.tsx` was modified by both the UX punch-list agent and the G11 agent. Current state: G11 owns it, UX agent skipped it (correctly). The `guardrailConfig` migration needs a distinct prefix from `20260604000002` (release notes). **Verify before merging.**

### 7.4 README hygiene

The root `README.md` had accumulated architecture analysis that belongs in handoff docs. Restored to a clean setup guide (this session). Architecture insight now lives in this document and `MASTER_BUILD_HANDOFF.md`.

---

## 8. Verdict

**The console ↔ backend architecture is on the right track.** The Wave 1 seams are correct, well-tested, and deletion-proven. The bottleneck is adoption — roughly half the codebase still uses pre-seam patterns. Every new feature built on a raw `fetch()` instead of `useApi`, or a hand-rolled route instead of `defineRoute`, adds to the migration backlog.

**The single highest-leverage action:** finish the route migration (Tier 1). A fully-migrated codebase makes every subsequent improvement (RLS, observability, caching) a one-place change instead of a scattered patch. Half-migrated is the worst state — it teaches inconsistency.

**The enterprise SaaS gaps (Tier 2/3) are real but correctly sequenced after migration.** Don't add Sentry to routes that still hand-roll error handling. Don't add RLS to tables accessed by unmigrated routes. Complete the foundation, then harden.
