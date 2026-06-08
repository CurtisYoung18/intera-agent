> **Historical receipt note (2026-06-08):** This file is preserved as past-work evidence. It may contain old terms such as `Skill`, `Policy`, `Guardrail`, `stage`, or `sub-agent`, and some files still read like implementation plans. Do not dispatch new work from this file. Current work starts at [../README.md](../README.md), [../handoffs/MASTER_BUILD_HANDOFF.md](../handoffs/MASTER_BUILD_HANDOFF.md), and [../to-do/2026-06-08-foundation-reset-domain-model.md](../to-do/2026-06-08-foundation-reset-domain-model.md).

# Organization Settings & Integrations — Page Consolidation

**Author:** Claude (brainstormed with user) | **Date:** 2026-06-04 | **Status:** ready for implementation

> **User-approved design (2026-06-04):** consolidate 3 standalone pages (Members, API Keys, Channels) into 2 tabbed
> pages (Organization, Integrations). Sidebar net -1 item. All API routes preserved. Org name-only in General tab;
> Permissions tab = read-only role matrix. Old pages deleted, no redirects.

---

## Step 1 — New i18n keys

**File:** `apps/console/lib/i18n/dictionaries.ts`

Add `sidebar.integrations` key to both locales (en near L482 `sidebar.organization`, zh near L1907).

```
en:  'sidebar.integrations': 'Integrations',
zh:  'sidebar.integrations': '集成',
```

Add tab labels and page-level keys (see Step 2/3 for usage):

```
en:
  'organization.title': 'Organization',
  'organization.general': 'General',
  'organization.members': 'Members',
  'organization.permissions': 'Permissions',
  'organization.nameLabel': 'Organization Name',
  'organization.nameSaved': 'Name updated',
  'organization.nameSaveError': 'Failed to save',
  'integrationsPage.title': 'Integrations',
  'integrationsPage.channels': 'Channels',
  'integrationsPage.apiKeys': 'API Keys',

zh:
  'organization.title': '组织',
  'organization.general': '通用',
  'organization.members': '成员',
  'organization.permissions': '权限',
  'organization.nameLabel': '组织名称',
  'organization.nameSaved': '名称已更新',
  'organization.nameSaveError': '保存失败',
  'integrationsPage.title': '集成',
  'integrationsPage.channels': '渠道',
  'integrationsPage.apiKeys': 'API 密钥',
```

Note: the existing `integrations.*` namespace (L898-914 en, L2313+ zh) is for LiveChat page — do NOT reuse.
New keys use prefix `integrationsPage.*` to avoid collision.

---

## Step 2 — New `/admin/organization/page.tsx`

**File:** `apps/console/app/admin/organization/page.tsx` (NEW)

**Route:** `/admin/organization?tab=general|members|permissions` (default: `general`)

### Tab: General

- Fetch current org info from `/api/auth/session` → get `orgId` + `customerName`
- Editable text input for org name, pre-filled with current name
- Save button → `PUT /api/admin/organizations/${orgId}` with `{ name }` body
- Show success/error feedback after save
- After save, update local state + sidebar will reflect on next session load

### Tab: Members

- Embed existing members logic from `apps/console/app/admin/members/page.tsx` (currently L1-289)
- Copy the entire component body — member list table, invite modal, role dropdowns
- Use `apiClient` for API calls (the existing page already does this at L52-54, L71, L86, L91)
- Preserve all RBAC guards (owner-only role changes, last-owner protection)

### Tab: Permissions

- Read-only table showing role → capabilities matrix:

| Capability | Owner | Admin | Operator | Viewer |
|---|---|---|---|---|
| Manage org settings | ✓ | — | — | — |
| Manage members | ✓ | ✓ | — | — |
| Edit agent config | ✓ | ✓ | — | — |
| View agent config | ✓ | ✓ | ✓ | ✓ |
| Access playground | ✓ | ✓ | ✓ | — |
| View dashboards | ✓ | ✓ | ✓ | ✓ |
| View chats | ✓ | ✓ | ✓ | — |
| Manage API keys | ✓ | ✓ | — | — |

- Static data (no API call). Define the matrix as a constant.

### Tab switching

- Read `?tab=` from `useSearchParams()`, default to `general`
- Render tabs as horizontal button row (match console visual style: glass-morphism, rounded-xl)
- Active tab gets `bg-black/[0.04]` + left accent bar pattern (reuse sidebar's active indicator)

### Error/loading states

- Use the pattern from `model/page.tsx`: try/catch/finally, error card with retry button
- Members tab: keep existing error+retry from `members/page.tsx` (L106-115)

---

## Step 3 — New `/admin/integrations/page.tsx`

**File:** `apps/console/app/admin/integrations/page.tsx` (NEW)

**Route:** `/admin/integrations?tab=channels|api-keys` (default: `channels`)

### Tab: Channels

- Embed existing channel hub cards from `apps/console/app/admin/channels/page.tsx` (L1-77)
- Channel cards: LiveChat → `/admin/channels/livechat`, Web Chat → `/admin/channels/web-chat`, Telegram (coming soon), LiveDesk (coming soon)
- Preserve all existing links and "Coming soon" badges
- Note: `/admin/channels/livechat` and `/admin/channels/web-chat` sub-pages remain UNCHANGED

### Tab: API Keys

- Embed existing API keys management from `apps/console/app/admin/api-keys/page.tsx` (L1-410)
- All CRUD operations, agent binding dropdown, revealed keys in sessionStorage, usage tutorial
- Use `fetch()` directly (existing page uses raw fetch, not apiClient — L83, L98, L122, L146)

### Tab switching

- Same pattern as Organization page: `useSearchParams()`, horizontal tab bar

---

## Step 4 — Sidebar changes

**File:** `apps/console/components/console-sidebar.tsx`

### NavSlug type (L32)

Add two new slugs:
```ts
type NavSlug = 'playground' | 'chats' | 'users' | 'dashboards' | 'guide' | 'agentConfig' | 'tools' | 'guardrails' | 'caseTypes' | 'knowledge' | 'channels' | 'apiKeys' | 'model' | 'memory' | 'members' | 'integrations' | 'organization'
```

### BUILD_ITEMS (L71-82)

- **Remove** line 80: `{ href: '/admin/channels', slug: 'channels', icon: Plug, color: '#7c3aed' },`
- **Remove** line 81: `{ href: '/admin/api-keys', slug: 'apiKeys', icon: Key, color: '#d4912e' },`
- **Add** at end of BUILD_ITEMS:
  ```ts
  { href: '/admin/integrations', slug: 'integrations' as NavSlug, icon: Plug, color: '#7c3aed' },
  ```

### OPERATE_ITEMS (L84-90)

- **Remove** line 89: `{ href: '/admin/members', slug: 'members', icon: Users2, color: '#6366f1' },`
- **Add** at end of OPERATE_ITEMS:
  ```ts
  { href: '/admin/organization', slug: 'organization' as NavSlug, icon: Building2, color: '#6366f1' },
  ```

### navLabel function (L97-99)

Add cases for new slugs (or let them fall through to `t()` — verify keys exist in dictionaries).

### Unused imports after changes

- `Key` icon (L24) — was used by API Keys, no longer needed → remove
- `Plug` icon (L17) — was used by Channels, still used by Integrations → keep
- `Users2` icon (L18) — used by both Users (OPERATE_ITEMS) and old Members → still needed for Users, keep

---

## Step 5 — Delete old page files

```
rm apps/console/app/admin/members/page.tsx
rm apps/console/app/admin/api-keys/page.tsx
rm apps/console/app/admin/channels/page.tsx
```

No redirects (user chose "delete entirely"). Old URLs will 404.

Important: `apps/console/app/admin/channels/` directory has sub-pages (`livechat/page.tsx`, `web-chat/`). Only delete `channels/page.tsx` (the hub), NOT the sub-directories.

---

## Step 6 — Verification

```bash
# Type check
npx tsc --noEmit -p apps/console/tsconfig.json   # must be 0 errors

# Tests
npm test                                          # all green (1 known PostgreSQL fail acceptable)

# Build
npm run build:console                             # must succeed

# Manual checks
# - /admin/organization → General tab shows org name, can edit + save
# - /admin/organization?tab=members → member list loads, can invite, can change roles
# - /admin/organization?tab=permissions → role matrix renders
# - /admin/integrations → Channels tab shows channel cards, links work
# - /admin/integrations?tab=api-keys → API key CRUD works
# - Sidebar shows Integrations (Build) + Organization (Operate), old entries gone
# - /admin/members → 404
# - /admin/api-keys → 404
# - /admin/channels → 404
# - /admin/channels/livechat → still works
```

---

## Summary

| Action | File |
|---|---|
| NEW | `apps/console/app/admin/organization/page.tsx` |
| NEW | `apps/console/app/admin/integrations/page.tsx` |
| EDIT | `apps/console/components/console-sidebar.tsx` |
| EDIT | `apps/console/lib/i18n/dictionaries.ts` |
| DELETE | `apps/console/app/admin/members/page.tsx` |
| DELETE | `apps/console/app/admin/api-keys/page.tsx` |
| DELETE | `apps/console/app/admin/channels/page.tsx` |
