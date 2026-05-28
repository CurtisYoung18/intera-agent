# LiveChat Multi-App Exclusivity + Routing Guards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement code-side guards so Intera only responds to chats assigned to its agent — preventing multi-AI race conditions via presence filtering, self-author filtering, chat ownership, and human-takeover detection.

**Architecture:** Add `agentAccountId`/`region`/`authType`/`accountId` to LiveChatConfig (schema + types already staged). Then wire webhook routes with `chat_presence_user_ids` presence filtering (the core fix) and self-author echo prevention. Update `livechat-api.ts` with configurable region + `ignore_requester_presence` fallback. Add ownership guard and transferred-state detection in bridge.

**Tech Stack:** TypeScript, Prisma (PostgreSQL/SQLite), Next.js Route Handlers, Vitest

---

### Task 1: Push schema migration

**Files:**
- (Already modified) `packages/shared/prisma/schema.prisma:393-396`

Schema and types are already staged with `region`, `authType`, `accountId`, `agentAccountId` columns. Push the migration and regenerate Prisma client.

- [ ] **Step 1: Regenerate Prisma client and push schema**

```bash
npm run db:generate && npm run db:push
```

Expected: Prisma client regenerated with new columns. Schema pushed to dev database.

---

### Task 2: Map new columns in config-store

**Files:**
- Modify: `apps/chat/lib/livechat/config-store.ts:27-35`

- [ ] **Step 1: Update `getLiveChatConfig` to map new columns**

In `config-store.ts`, update the config object in `getLiveChatConfig`:

```ts
const config: LiveChatConfig = {
  customerId: row.customerId,
  botAccessToken: row.botAccessToken,
  licenseId: row.licenseId,
  webhookSecret: row.webhookSecret ?? undefined,
  region: row.region ?? undefined,
  authType: (row.authType as LiveChatConfig['authType']) ?? undefined,
  accountId: row.accountId ?? undefined,
  agentAccountId: row.agentAccountId ?? undefined,
  showSkillStatus: row.showSkillStatus,
  enabled: row.enabled,
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit -p apps/chat/tsconfig.json 2>&1 | head -20
```

Expected: No new type errors in config-store.ts.

---

### Task 3: Accept new fields in config API

**Files:**
- Modify: `apps/chat/app/api/livechat/config/route.ts`

- [ ] **Step 1: Update PUT handler to read new fields**

In [config/route.ts:38-39](apps/chat/app/api/livechat/config/route.ts#L38-L39), update destructuring:

```ts
const { customerId, botAccessToken, licenseId, webhookSecret, region, authType, accountId, agentAccountId, showSkillStatus, enabled } = body as {
  customerId: string; botAccessToken: string; licenseId: string; webhookSecret?: string;
  region?: string; authType?: string; accountId?: string; agentAccountId?: string;
  showSkillStatus: boolean; enabled: boolean
}
```

- [ ] **Step 2: Update PUT upsert call to include new fields**

After the `••••••••` handling block, update the upsert call:

```ts
await upsertLiveChatConfig(customerId, {
  botAccessToken: tokenToSave, licenseId: licenseId ?? '',
  webhookSecret: secretToSave,
  region: (region as string) ?? 'dal',
  authType: (authType as 'bearer' | 'basic' | 'auto' | undefined) ?? 'auto',
  accountId: (accountId as string) ?? '',
  agentAccountId: (agentAccountId as string) ?? '',
  showSkillStatus: showSkillStatus ?? true, enabled: enabled ?? false,
})
```

- [ ] **Step 3: Update GET handler to return new fields**

In the GET handler, add new fields to the return object:

```ts
return json({
  ...config,
  botAccessToken: config.botAccessToken ? '••••••••' : '',
  webhookSecret: config.webhookSecret ? '••••••••' : '',
})
```

The `...config` spread already includes `region`, `authType`, `accountId`, `agentAccountId` from the config-store mapping.

---

### Task 4: Update livechat-api.ts — region parameter + ignore_requester_presence

**Files:**
- Modify: `apps/chat/lib/livechat/livechat-api.ts`

- [ ] **Step 1: Change `lcPost` to accept optional region, default to `dal`**

Replace the `lcPost` function signature and body:

```ts
const LC_API_BASE = 'https://api.livechatinc.com/v3.5/agent/action'

function detectAuth(token: string, authType?: string): string {
  if (authType === 'basic') return `Basic ${token}`
  if (authType === 'bearer') return `Bearer ${token}`
  // auto: PAT tokens are base64-encoded "accountId:token" — long strings with = padding
  if (token.length > 60 && /^[A-Za-z0-9+/=]+$/.test(token)) return `Basic ${token}`
  return `Bearer ${token}`
}

async function lcPost(
  action: string,
  body: unknown,
  botAccessToken: string,
  licenseId: string,
  region: string = 'dal',
  authType?: string,
): Promise<void> {
  const res = await fetch(`${LC_API_BASE}/${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: detectAuth(botAccessToken, authType),
      'X-Region': region,
    },
    body: JSON.stringify({ ...(body as Record<string, unknown>), license_id: licenseId }),
  })
  if (!res.ok) {
    const text = await res.text()
    const err = new Error(`LiveChat API ${action} failed (${res.status}): ${text}`) as Error & { code?: string }
    if (res.status === 401) err.code = 'TOKEN_EXPIRED'
    if (res.status === 403) err.code = 'NOT_IN_CHAT'
    if (res.status === 429) err.code = 'RATE_LIMITED'
    throw err
  }
}
```

- [ ] **Step 2: Add `ignore_requester_presence: true` in `lcPost` for send actions**

Add after the `license_id` line in the JSON body, auto-inject for send_event and send_typing_indicator:

```ts
const baseBody = { ...(body as Record<string, unknown>), license_id: licenseId }
if (action === 'send_event' || action === 'send_typing_indicator') {
  baseBody.ignore_requester_presence = true
}
```

- [ ] **Step 3: Update all exported function signatures to accept and pass `region`**

Update each function to accept `region?: string` and `authType?: string` params, pass them to `lcPost`:

```ts
export async function sendTextMessage(
  chatId: string, text: string, botAccessToken: string, licenseId: string, region?: string, authType?: string,
): Promise<void> {
  await lcPost('send_event', {
    chat_id: chatId,
    event: { type: 'message', text, visibility: 'all' },
  }, botAccessToken, licenseId, region, authType)
}
```

Apply the same pattern (`region?: string, authType?: string` added as last two params, passed to `lcPost`) to ALL exported functions:
- `sendWidgetPayload`
- `sendQuickReplies`
- `sendCard`
- `sendCarousel`
- `sendImage`
- `sendSystemMessage`
- `setTypingIndicator`
- `transferChat`
- `updateChatProperties`

The `listGroups` function also needs updating — same pattern, `region` + `authType` params.

---

### Task 5: Update bridge.ts — pass region/authType to API calls

**Files:**
- Modify: `apps/chat/lib/livechat/bridge.ts`

- [ ] **Step 1: Update bridge's `sendFailureNotice` to pass region/authType**

In [bridge.ts:76-84](apps/chat/lib/livechat/bridge.ts#L76-L84), update the `sendFailureNotice` signature and call:

```ts
async function sendFailureNotice(
  chatId: string, config: LiveChatConfig, reason: 'engine_unreachable' | 'stream_truncated' | 'action_failed',
): Promise<void> {
  const msg = { /* same as before */ }[reason]
  await sendTextMessage(chatId, msg, config.botAccessToken, config.licenseId, config.region, config.authType).catch(() => {})
}
```

- [ ] **Step 2: Update all `send*` / API calls in `handleIncomingEvent` to pass region/authType**

In the switch block for each `action.type`, add `config.region, config.authType` as the last two arguments:

```ts
case 'send_text':
  await sendTextMessage(chatId, action.text, config.botAccessToken, config.licenseId, config.region, config.authType)
  break
// ... apply same pattern to ALL cases: sendWidgetPayload, sendQuickReplies, sendCard,
//     sendCarousel, sendImage, sendSystemMessage, setTypingIndicator, transferChat, updateChatProperties
```

- [ ] **Step 3: Add chat ownership guard (§2.2) — write `intera.owner` on first session creation**

After `await upsertSession(session)` in `handleIncomingEvent` (around line 98), add:

```ts
// Write ownership on first touch if session was just created
if (!session) {
  await updateChatProperties(chatId, { owner: 'intera' }, config.botAccessToken, config.licenseId, config.region, config.authType).catch(() => {})
}
```

Wait — the code flow is: get session → if null, create + upsert → then later do things. The `!session` check won't work because we reassign `session`. Let me re-read the bridge code...

Actually looking at the code, `let session = await getSession(chatId)` then `if (!session) { session = {...}; await upsertSession(session) }`. So right after the upsert block I can add ownership:

```ts
if (!session) {
  session = { chatId, customerId, userId, caseId: generateCaseId(), state: 'idle', textBuffer: '' }
  await upsertSession(session)
  // Claim ownership on first touch
  updateChatProperties(chatId, { owner: 'intera' }, config.botAccessToken, config.licenseId, config.region, config.authType).catch(() => {})
}
```

- [ ] **Step 4: Add transferred state guard (§3) — skip agent loop for transferred sessions**

After `await updateSessionState(chatId, 'thinking')` at line 110, add a check:

```ts
// If session was transferred to human, don't re-enter agent loop
if (session.state === 'transferred') {
  console.log('[Bridge] Session transferred, skipping agent loop for chat:', chatId)
  await updateSessionState(chatId, 'idle')
  return
}
```

Wait — but by this point we already called `updateSessionState(chatId, 'thinking')`. Let me put the check BEFORE that:

After the session upsert/form/interaction handling but before `updateSessionState(chatId, 'thinking')`:

```ts
if (session.state === 'transferred') {
  console.log('[Bridge] Session transferred, skipping agent loop for chat:', chatId)
  return
}

await updateSessionState(chatId, 'thinking')
```

- [ ] **Step 5: Add empty message defense in `buildMessagesBody`**

In the `default` case of `buildMessagesBody`, guard against empty text:

```ts
default:
  return { ...base, message: event.text?.trim() ? event.text : '[新会话]' }
```

Also update `incoming_chat` handling — but that's in the webhook routes (Task 6).

---

### Task 6: Update webhook routes — presence filtering, self-author filtering, incoming_chat fix

**Files:**
- Modify: `apps/chat/app/api/livechat/webhook/route.ts`
- Modify: `apps/chat/app/api/livechat/webhook/[customerId]/route.ts`

Both routes need identical changes. I'll show changes for the general route first, then note the per-customer route differences.

- [ ] **Step 1: Update general webhook route — add presence filtering and self-author filtering**

In [webhook/route.ts](apps/chat/app/api/livechat/webhook/route.ts), after the dedup check (line 57-59) and config check (line 61-64), add the filtering logic. Replace lines 49-64 area with:

```ts
const payload = (body.payload ?? {}) as Record<string, unknown>
const event = (payload.event ?? {}) as Record<string, unknown>
const authorId = (event.author_id ?? 'anonymous') as string
const customerId = (payload.license_id ?? process.env.DEFAULT_CUSTOMER_ID ?? 'default') as string

// Dedup
const eventId = `livechat:${(event.id ?? body.webhook_id ?? rawBody.slice(0, 64)) as string}`
if (await isDuplicateWebhook(eventId)) {
  return NextResponse.json({ ok: true, deduped: true })
}

const config = await getLiveChatConfig(customerId)
if (!config?.enabled) {
  return NextResponse.json({ ok: true })
}

// Self-author filter (修复 C): don't respond to messages authored by our own agent
if (config.agentAccountId && authorId === config.agentAccountId) {
  console.log(`[Webhook] Skipping self-authored event from agent ${config.agentAccountId}`)
  return NextResponse.json({ ok: true, skipped: 'self_authored' })
}

// Presence filter (修复 F): only respond if our agent is in the chat
const presentIds = ((body.additional_data as Record<string, unknown>)?.chat_presence_user_ids
  ?? payload.chat_presence_user_ids
  ?? []) as string[]
if (config.agentAccountId && presentIds.length > 0 && !presentIds.includes(config.agentAccountId)) {
  console.log(`[Webhook] Agent ${config.agentAccountId} not in chat presence, skipping`)
  return NextResponse.json({ ok: true, skipped: 'not_my_chat' })
}
```

Note: `userId` is still needed for bridge. Since `authorId` may be the agent, we need to separate `userId` from `authorId`:

```ts
const userId = (event.author_id ?? 'anonymous') as string
```

This stays as is — the bridge uses userId for session tracking, the filter is separate.

- [ ] **Step 2: Fix `incoming_chat` handling in general webhook route**

Replace lines 115-120:

```ts
// incoming_chat — new conversation started, just create session, don't feed empty message
if (action === 'incoming_chat') {
  console.log(`[Webhook] incoming_chat for chat ${chatId}, customer ${customerId}`)
  // Bridge will create session on first real message; nothing to do yet
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Apply same changes to per-customer webhook route**

In `[customerId]/route.ts`, apply the same three changes:

1. **Self-author filter** — after config check and dedup, before dispatch:
```ts
const authorId = (event.author_id ?? 'anonymous') as string
if (config.agentAccountId && authorId === config.agentAccountId) {
  console.log(`[Webhook] Skipping self-authored event from agent ${config.agentAccountId}`)
  return NextResponse.json({ ok: true, skipped: 'self_authored' })
}
```

2. **Presence filter** — right after self-author filter:
```ts
const presentIds = ((body.additional_data as Record<string, unknown>)?.chat_presence_user_ids
  ?? payload.chat_presence_user_ids
  ?? []) as string[]
if (config.agentAccountId && presentIds.length > 0 && !presentIds.includes(config.agentAccountId)) {
  console.log(`[Webhook] Agent ${config.agentAccountId} not in chat presence, skipping`)
  return NextResponse.json({ ok: true, skipped: 'not_my_chat' })
}
```

Note: In the per-customer route, `payload` is already defined at line 62 and `config` is already fetched at line 27. The `body` is also already parsed. Add the presence filter using these existing variables.

3. **Fix `incoming_chat`** — same as general route, return early instead of feeding empty message.

---

### Task 7: Update existing tests for API signature changes

**Files:**
- Modify: `apps/chat/lib/livechat/__tests__/unit/livechat-api.test.ts`

- [ ] **Step 1: Update test calls to match new function signatures**

The test file calls functions like `sendTextMessage(chatId, text, token, license)`. Update each call to pass the new optional params where needed. Since the new params are optional (`region?, authType?`), existing calls will still compile. But the test for `lcPost` behavior should verify:

1. Default region is `dal` when not passed
2. Region is passed through when provided
3. `ignore_requester_presence: true` is included in send_event/send_typing_indicator bodies

Add a new test block:

```ts
describe('region and ignore_requester_presence', () => {
  it('defaults region to dal', async () => {
    await sendTextMessage('chat1', 'hello', 'token', 'license')
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(init.headers!['X-Region'] as string).toBe('dal')
  })

  it('passes custom region', async () => {
    await sendTextMessage('chat1', 'hello', 'token', 'license', 'fra')
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(init.headers!['X-Region'] as string).toBe('fra')
  })

  it('includes ignore_requester_presence for send_event', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true } as Response)
    await sendTextMessage('chat1', 'hello', 'token', 'license')
    const body = JSON.parse(mockFetch.mock.calls[0][1]!.body as string)
    expect(body.ignore_requester_presence).toBe(true)
  })
})
```

---

### Task 8: Test webhook filtering logic (unit)

**Files:**
- Create: `apps/chat/lib/livechat/__tests__/unit/webhook-filter.test.ts`

Since the filtering logic is inline in the route handlers, test the logic by extracting it into a helper, OR just test at the integration level. The presence/self-author filtering is simple enough to test via direct route invocation or an extracted pure function.

- [ ] **Step 1: Extract filtering logic into a testable helper (optional but recommended)**

To make the filtering testable without spinning up Next.js, add a helper in a new file `apps/chat/lib/livechat/webhook-filter.ts`:

```ts
export interface FilterResult {
  skip: boolean
  reason?: 'self_authored' | 'not_my_chat'
}

export function shouldSkipEvent(params: {
  agentAccountId?: string
  authorId: string
  presentIds: string[]
}): FilterResult {
  // Self-author filter
  if (params.agentAccountId && params.authorId === params.agentAccountId) {
    return { skip: true, reason: 'self_authored' }
  }
  // Presence filter
  if (params.agentAccountId && params.presentIds.length > 0 && !params.presentIds.includes(params.agentAccountId)) {
    return { skip: true, reason: 'not_my_chat' }
  }
  return { skip: false }
}
```

- [ ] **Step 2: Write unit tests for the filter helper**

Create `apps/chat/lib/livechat/__tests__/unit/webhook-filter.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { shouldSkipEvent } from '../../../webhook-filter'

describe('shouldSkipEvent', () => {
  const agentId = 'agent@example.com'

  it('returns skip=false when no agentAccountId configured', () => {
    expect(shouldSkipEvent({ authorId: 'visitor', presentIds: [] })).toEqual({ skip: false })
  })

  it('returns skip=true with self_authored when author is our agent', () => {
    expect(shouldSkipEvent({ agentAccountId: agentId, authorId: agentId, presentIds: [agentId] }))
      .toEqual({ skip: true, reason: 'self_authored' })
  })

  it('returns skip=true with not_my_chat when agent not in presentIds', () => {
    expect(shouldSkipEvent({ agentAccountId: agentId, authorId: 'visitor', presentIds: ['other@agent.com'] }))
      .toEqual({ skip: true, reason: 'not_my_chat' })
  })

  it('returns skip=false when agent is in presentIds and author is visitor', () => {
    expect(shouldSkipEvent({ agentAccountId: agentId, authorId: 'visitor', presentIds: [agentId] }))
      .toEqual({ skip: false })
  })

  it('returns skip=false when presentIds is empty (no presence data)', () => {
    expect(shouldSkipEvent({ agentAccountId: agentId, authorId: 'visitor', presentIds: [] }))
      .toEqual({ skip: false })
  })

  it('self_authored takes priority over not_my_chat', () => {
    expect(shouldSkipEvent({ agentAccountId: agentId, authorId: agentId, presentIds: ['other@agent.com'] }))
      .toEqual({ skip: true, reason: 'self_authored' })
  })
})
```

- [ ] **Step 3: Use the helper in both webhook routes**

Replace the inline filtering in both route files with:

```ts
import { shouldSkipEvent } from '@/lib/livechat/webhook-filter'

// ... after config check ...
const filterResult = shouldSkipEvent({
  agentAccountId: config.agentAccountId,
  authorId,
  presentIds,
})
if (filterResult.skip) {
  console.log(`[Webhook] Skipping event: ${filterResult.reason}`)
  return NextResponse.json({ ok: true, skipped: filterResult.reason })
}
```

- [ ] **Step 4: Run the new tests**

```bash
npx vitest run apps/chat/lib/livechat/__tests__/unit/webhook-filter.test.ts
```

Expected: 6 tests pass.

---

### Task 9: Run all livechat tests

- [ ] **Step 1: Run full livechat test suite**

```bash
npx vitest run apps/chat/lib/livechat/__tests__/
```

Expected: All existing tests still pass. Fix any failing tests from signature changes.

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit -p apps/chat/tsconfig.json 2>&1 | head -40
```

Expected: No type errors.

---

### Task 10: Verification checklist

- [ ] **Step 1: Verify schema migration applied**

```bash
npx prisma db pull --print -p packages/shared/prisma/schema.prisma 2>&1 | grep -A2 livechat_configs
```

Or simpler: check the Prisma client has new fields:

```bash
node -e "const { Prisma } = require('@prisma/client'); console.log(Object.keys(Prisma.LiveChatConfigScalarFieldEnum))"
```

- [ ] **Step 2: Review the full diff before commit**

```bash
git diff HEAD
```

- [ ] **Step 3: Verify against acceptance criteria from doc ②**

- [ ] Presence filter: `chat_presence_user_ids` check returns `{ skipped: 'not_my_chat' }` when agent not present
- [ ] Self-author filter: agent-authored events return `{ skipped: 'self_authored' }`
- [ ] `incoming_chat` no longer feeds empty message to agent loop
- [ ] `livechat-api.ts` uses configurable region (default `dal`), includes `ignore_requester_presence: true`
- [ ] Bridge passes `config.region`/`config.authType` to all API calls
- [ ] Bridge writes `intera.owner` property on first session touch
- [ ] Bridge skips agent loop for transferred sessions
- [ ] All existing tests pass
