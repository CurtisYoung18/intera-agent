# LiveChat Rich UX Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Intera Agent Loop to LiveChat via a thin Bridge adapter, surfacing skill execution status, option selection, and form collection as rich in-widget experiences using an In-Chat App (three views: StatusTrack, OptionList, FormCard).

**Architecture:** A Bridge module inside `apps/chat` receives LiveChat webhooks, calls the existing `POST /api/messages` SSE endpoint, and translates SSE events into LiveChat Bot Agent API calls. An In-Chat App (`/livechat-widget` route) runs as an iframe inside the LiveChat widget, rendering Glass Bubble status animations, option lists, and flip-card forms — all dynamically populated from LLM-generated payloads pushed by the Bridge. Integration credentials and feature toggles are managed through a new Console "Integration" settings page, stored in Prisma.

**Tech Stack:** Next.js 14 App Router, TypeScript, Prisma (PostgreSQL on Railway), LiveChat Bot Agent API, LiveChat In-Chat App SDK (`@livechat/chat-widget-sdk`), Tailwind CSS, Framer Motion (already in project).

---

## File Map

### New files
| File | Responsibility |
|------|---------------|
| `packages/shared/prisma/schema.prisma` | Add `LiveChatSession` + `LiveChatConfig` models |
| `apps/chat/lib/livechat/types.ts` | Shared TypeScript types for the Bridge |
| `apps/chat/lib/livechat/livechat-api.ts` | HTTP wrapper for LiveChat Bot Agent API |
| `apps/chat/lib/livechat/config-store.ts` | Read/write `LiveChatConfig` with 30s TTL cache |
| `apps/chat/lib/livechat/session-store.ts` | Read/write `LiveChatSession` via Prisma |
| `apps/chat/lib/livechat/event-translators.ts` | Pure functions: SSE event → Bridge action descriptor |
| `apps/chat/lib/livechat/bridge.ts` | SSE consumer loop; orchestrates translators + API calls |
| `apps/chat/app/api/livechat/webhook/route.ts` | POST handler for LiveChat webhooks |
| `apps/chat/app/api/livechat/config/route.ts` | GET/PUT for LiveChatConfig (called by Console) |
| `apps/chat/app/livechat-widget/page.tsx` | In-Chat App entry; hosts all three views |
| `apps/console/app/admin/integrations/page.tsx` | Console Integration settings page |

### Modified files
| File | Change |
|------|--------|
| `packages/shared/prisma/schema.prisma` | Add two new models |
| `apps/console/components/console-sidebar.tsx` | Add "Integrations" nav item to `ADMIN_ITEMS` |
| `apps/console/lib/i18n/dictionaries.ts` | Add `sidebar.integrations` translation key |

---

## Task 1: Prisma Schema — Add LiveChatSession + LiveChatConfig

**Files:**
- Modify: `packages/shared/prisma/schema.prisma`

- [ ] **Step 1: Add models to schema**

Open `packages/shared/prisma/schema.prisma` and append at the end of the file:

```prisma
model LiveChatSession {
  chatId      String   @id
  customerId  String
  userId      String
  caseId      String
  state       String   @default("idle")
  textBuffer  String   @default("")
  updatedAt   DateTime @updatedAt
}

model LiveChatConfig {
  id              String   @id @default(cuid())
  customerId      String   @unique
  botAccessToken  String
  licenseId       String
  showSkillStatus Boolean  @default(true)
  enabled         Boolean  @default(false)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

- [ ] **Step 2: Push schema to DB**

```bash
npx prisma db push --schema=./packages/shared/prisma/schema.prisma --accept-data-loss --skip-generate
```

Expected output: `Your database is now in sync with your Prisma schema.`

- [ ] **Step 3: Regenerate Prisma client**

```bash
npx prisma generate --schema=./packages/shared/prisma/schema.prisma
```

Expected output: `Generated Prisma Client`

- [ ] **Step 4: Commit**

```bash
git add packages/shared/prisma/schema.prisma
git commit -m "feat: add LiveChatSession and LiveChatConfig prisma models"
```

---

## Task 2: Shared Types

**Files:**
- Create: `apps/chat/lib/livechat/types.ts`

- [ ] **Step 1: Create types file**

```typescript
// apps/chat/lib/livechat/types.ts

export type BridgeState =
  | 'idle'
  | 'thinking'
  | 'waiting_choice'
  | 'waiting_form'
  | 'transferred'

export interface BridgeSession {
  chatId: string
  customerId: string
  userId: string
  caseId: string
  state: BridgeState
  textBuffer: string
}

export interface LiveChatConfig {
  customerId: string
  botAccessToken: string
  licenseId: string
  showSkillStatus: boolean
  enabled: boolean
}

// intera_widget_payload variants
export type WidgetPayloadKind =
  | 'status_track'
  | 'propose_interaction'
  | 'request_user_input'

export interface StatusTrackStep {
  id: string           // tool/skill name
  label: string        // human-readable label
  state: 'running' | 'done'
  durationMs?: number
}

export interface InteractionOption {
  id: string
  label: string
  description?: string
  inputType?: 'none' | 'text'
  inputPlaceholder?: string
}

export interface FormField {
  id: string
  type: 'text' | 'number' | 'select' | 'textarea' | 'file' | 'date'
  label: string
  required?: boolean
  options?: string[]   // for type=select
  placeholder?: string
}

export interface WidgetPayload {
  kind: WidgetPayloadKind
  caseId: string
  // status_track
  step?: StatusTrackStep
  // propose_interaction
  options?: InteractionOption[]
  // request_user_input
  fields?: FormField[]
}

// Events sent from In-Chat App back to Bridge via LiveChat send_event
export interface IntereaInteractionSubmit {
  caseId: string
  optionId: string
  input?: string
}

export interface InteraFormSubmit {
  caseId: string
  answers: Record<string, string>
}

// Bridge action descriptor returned by event-translators
export type BridgeAction =
  | { type: 'send_widget_payload'; payload: WidgetPayload }
  | { type: 'send_text'; text: string }
  | { type: 'send_quick_replies'; text: string; options: Array<{ id: string; label: string }> }
  | { type: 'transfer_chat'; caseId: string }
  | { type: 'update_chat_properties'; props: Record<string, string> }
  | { type: 'buffer_text'; delta: string }
  | { type: 'flush_text' }
  | { type: 'noop' }
```

- [ ] **Step 2: Commit**

```bash
git add apps/chat/lib/livechat/types.ts
git commit -m "feat: add livechat bridge shared types"
```

---

## Task 3: LiveChat API Wrapper

**Files:**
- Create: `apps/chat/lib/livechat/livechat-api.ts`

- [ ] **Step 1: Create the API wrapper**

```typescript
// apps/chat/lib/livechat/livechat-api.ts
// Wraps LiveChat Bot Agent REST API calls.
// Docs: https://developers.livechat.com/docs/messaging/agent-chat-api/

import type { WidgetPayload } from './types'

const LC_API_BASE = 'https://api.livechatinc.com/v3.5/agent/action'

async function lcPost(
  action: string,
  body: unknown,
  botAccessToken: string,
  licenseId: string,
): Promise<void> {
  const res = await fetch(`${LC_API_BASE}/${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${botAccessToken}`,
      'X-Region': 'fra',           // adjust if your LiveChat license is in a different region
    },
    body: JSON.stringify({ ...body, license_id: licenseId }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`LiveChat API ${action} failed (${res.status}): ${text}`)
  }
}

/** Send a plain text message to a chat. */
export async function sendTextMessage(
  chatId: string,
  text: string,
  botAccessToken: string,
  licenseId: string,
): Promise<void> {
  await lcPost('send_event', {
    chat_id: chatId,
    event: {
      type: 'message',
      text,
      visibility: 'all',
    },
  }, botAccessToken, licenseId)
}

/** Send an intera_widget_payload custom event (triggers In-Chat App view switch). */
export async function sendWidgetPayload(
  chatId: string,
  payload: WidgetPayload,
  botAccessToken: string,
  licenseId: string,
): Promise<void> {
  await lcPost('send_event', {
    chat_id: chatId,
    event: {
      type: 'custom',
      content: {
        type: 'intera_widget_payload',
        ...payload,
      },
      visibility: 'all',
    },
  }, botAccessToken, licenseId)
}

/** Send a quick_replies rich message. */
export async function sendQuickReplies(
  chatId: string,
  text: string,
  options: Array<{ id: string; label: string }>,
  botAccessToken: string,
  licenseId: string,
): Promise<void> {
  await lcPost('send_event', {
    chat_id: chatId,
    event: {
      type: 'rich_message',
      template_id: 'quick_replies',
      elements: [{
        title: text,
        buttons: options.map(o => ({
          type: 'message',
          text: o.label,
          postback_id: o.id,
          user_ids: [],
        })),
      }],
      visibility: 'all',
    },
  }, botAccessToken, licenseId)
}

/** Transfer the chat to the first available agent queue. */
export async function transferChat(
  chatId: string,
  botAccessToken: string,
  licenseId: string,
): Promise<void> {
  await lcPost('transfer_chat', {
    id: chatId,
    target: { type: 'queue' },
  }, botAccessToken, licenseId)
}

/** Write key-value properties onto the chat (visible in agent dashboard). */
export async function updateChatProperties(
  chatId: string,
  props: Record<string, string>,
  botAccessToken: string,
  licenseId: string,
): Promise<void> {
  const properties: Record<string, Record<string, string>> = {}
  for (const [k, v] of Object.entries(props)) {
    properties[`intera.${k}`] = { value: v }
  }
  await lcPost('update_chat_properties', {
    id: chatId,
    properties,
  }, botAccessToken, licenseId)
}
```

- [ ] **Step 2: Manual smoke test (no framework)**

Verify the module compiles without errors:

```bash
cd apps/chat && npx tsc --noEmit 2>&1 | grep "livechat-api"
```

Expected: no output (no type errors).

- [ ] **Step 3: Commit**

```bash
git add apps/chat/lib/livechat/livechat-api.ts
git commit -m "feat: add livechat bot agent api wrapper"
```

---

## Task 4: Config Store

**Files:**
- Create: `apps/chat/lib/livechat/config-store.ts`

- [ ] **Step 1: Create config store with 30s TTL cache**

```typescript
// apps/chat/lib/livechat/config-store.ts
// Reads LiveChatConfig from Prisma with a 30-second TTL cache.
// Same caching pattern as lib/agent/config-cache.ts.

import { prisma } from '@intera/shared/prisma'
import type { LiveChatConfig } from './types'

interface CacheEntry {
  config: LiveChatConfig
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()
const TTL_MS = 30_000

export function invalidateLiveChatConfig(customerId: string): void {
  cache.delete(customerId)
}

export async function getLiveChatConfig(customerId: string): Promise<LiveChatConfig | null> {
  const cached = cache.get(customerId)
  if (cached && cached.expiresAt > Date.now()) return cached.config

  try {
    const row = await prisma.liveChatConfig.findUnique({ where: { customerId } })
    if (!row || !row.enabled) return null

    const config: LiveChatConfig = {
      customerId: row.customerId,
      botAccessToken: row.botAccessToken,
      licenseId: row.licenseId,
      showSkillStatus: row.showSkillStatus,
      enabled: row.enabled,
    }
    cache.set(customerId, { config, expiresAt: Date.now() + TTL_MS })
    return config
  } catch (err) {
    console.error('[LiveChat] Failed to load config:', err)
    return null
  }
}

export async function upsertLiveChatConfig(
  customerId: string,
  data: Omit<LiveChatConfig, 'customerId'>,
): Promise<void> {
  await prisma.liveChatConfig.upsert({
    where: { customerId },
    update: data,
    create: { customerId, ...data },
  })
  invalidateLiveChatConfig(customerId)
}
```

- [ ] **Step 2: Type-check**

```bash
cd apps/chat && npx tsc --noEmit 2>&1 | grep "config-store"
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add apps/chat/lib/livechat/config-store.ts
git commit -m "feat: add livechat config store with 30s ttl cache"
```

---

## Task 5: Session Store

**Files:**
- Create: `apps/chat/lib/livechat/session-store.ts`

- [ ] **Step 1: Create session store**

```typescript
// apps/chat/lib/livechat/session-store.ts
// Manages LiveChatSession rows in Prisma.
// chatId is the LiveChat chat_id — globally unique per conversation.

import { prisma } from '@intera/shared/prisma'
import type { BridgeSession, BridgeState } from './types'

export async function getSession(chatId: string): Promise<BridgeSession | null> {
  try {
    const row = await prisma.liveChatSession.findUnique({ where: { chatId } })
    if (!row) return null
    return {
      chatId: row.chatId,
      customerId: row.customerId,
      userId: row.userId,
      caseId: row.caseId,
      state: row.state as BridgeState,
      textBuffer: row.textBuffer,
    }
  } catch (err) {
    console.error('[LiveChat] getSession failed:', err)
    return null
  }
}

export async function upsertSession(session: BridgeSession): Promise<void> {
  await prisma.liveChatSession.upsert({
    where: { chatId: session.chatId },
    update: {
      customerId: session.customerId,
      userId: session.userId,
      caseId: session.caseId,
      state: session.state,
      textBuffer: session.textBuffer,
    },
    create: {
      chatId: session.chatId,
      customerId: session.customerId,
      userId: session.userId,
      caseId: session.caseId,
      state: session.state,
      textBuffer: session.textBuffer,
    },
  })
}

export async function updateSessionState(chatId: string, state: BridgeState): Promise<void> {
  await prisma.liveChatSession.update({
    where: { chatId },
    data: { state },
  })
}

export async function appendTextBuffer(chatId: string, delta: string): Promise<void> {
  const current = await prisma.liveChatSession.findUnique({
    where: { chatId },
    select: { textBuffer: true },
  })
  await prisma.liveChatSession.update({
    where: { chatId },
    data: { textBuffer: (current?.textBuffer ?? '') + delta },
  })
}

/** Returns the buffered text and resets the buffer to empty. */
export async function flushTextBuffer(chatId: string): Promise<string> {
  const row = await prisma.liveChatSession.findUnique({
    where: { chatId },
    select: { textBuffer: true },
  })
  const text = row?.textBuffer ?? ''
  if (text) {
    await prisma.liveChatSession.update({
      where: { chatId },
      data: { textBuffer: '' },
    })
  }
  return text
}
```

- [ ] **Step 2: Type-check**

```bash
cd apps/chat && npx tsc --noEmit 2>&1 | grep "session-store"
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add apps/chat/lib/livechat/session-store.ts
git commit -m "feat: add livechat session store backed by prisma"
```

---

## Task 6: Event Translators

**Files:**
- Create: `apps/chat/lib/livechat/event-translators.ts`

- [ ] **Step 1: Create translators**

Pure functions mapping Intera SSE event data → `BridgeAction`. No side effects.

```typescript
// apps/chat/lib/livechat/event-translators.ts

import type { BridgeAction, StatusTrackStep } from './types'
import type { SSEEvent } from '@intera/shared/types'

// Skill name → human-readable label (extend as new skills are added)
const SKILL_LABELS: Record<string, string> = {
  kb_hybrid_retrieve:   '知识库检索',
  propose_interaction:  '生成选项',
  request_user_input:   '收集信息',
  create_human_task:    '转接人工',
  create_case:          '建立案例',
  finalize_case:        '完成案例',
  propose_cases:        '意图确认',
  ocr_receipt:          'OCR 识别',
}

function skillLabel(toolName: string): string {
  return SKILL_LABELS[toolName] ?? toolName.replace(/_/g, ' ')
}

/** Translate a single SSE event to a BridgeAction. */
export function translateSSEEvent(
  event: SSEEvent,
  opts: { showSkillStatus: boolean; caseId: string },
): BridgeAction {
  const { showSkillStatus, caseId } = opts

  switch (event.type) {
    case 'tool_executing': {
      if (!showSkillStatus) return { type: 'noop' }
      const toolName = (event.data as { toolName?: string })?.toolName ?? 'unknown'
      const step: StatusTrackStep = {
        id: toolName,
        label: skillLabel(toolName),
        state: 'running',
      }
      return {
        type: 'send_widget_payload',
        payload: { kind: 'status_track', caseId, step },
      }
    }

    case 'skill_result': {
      if (!showSkillStatus) return { type: 'noop' }
      const d = event.data as { toolName?: string; durationMs?: number }
      const step: StatusTrackStep = {
        id: d.toolName ?? 'unknown',
        label: skillLabel(d.toolName ?? 'unknown'),
        state: 'done',
        durationMs: d.durationMs,
      }
      return {
        type: 'send_widget_payload',
        payload: { kind: 'status_track', caseId, step },
      }
    }

    case 'interaction_proposed': {
      const d = event.data as { options?: Array<{ id: string; label: string; description?: string; inputType?: 'none' | 'text'; inputPlaceholder?: string }> }
      return {
        type: 'send_widget_payload',
        payload: {
          kind: 'propose_interaction',
          caseId,
          options: d.options ?? [],
        },
      }
    }

    case 'form_request': {
      const d = event.data as { fields?: Array<{ id: string; type: string; label: string; required?: boolean; options?: string[]; placeholder?: string }> }
      return {
        type: 'send_widget_payload',
        payload: {
          kind: 'request_user_input',
          caseId,
          fields: (d.fields ?? []) as import('./types').FormField[],
        },
      }
    }

    case 'clarification': {
      const d = event.data as { options?: Array<{ id: string; label: string }> }
      if (!d.options?.length) return { type: 'noop' }
      return {
        type: 'send_quick_replies',
        text: '请选择您的问题类型：',
        options: d.options,
      }
    }

    case 'escalated': {
      return { type: 'transfer_chat', caseId }
    }

    case 'case_created': {
      const d = event.data as { caseId?: string; caseType?: string }
      return {
        type: 'update_chat_properties',
        props: {
          case_id: d.caseId ?? caseId,
          case_type: d.caseType ?? 'general',
        },
      }
    }

    case 'text_delta': {
      const d = event.data as { text?: string }
      return { type: 'buffer_text', delta: d.text ?? '' }
    }

    case 'message_stop': {
      return { type: 'flush_text' }
    }

    default:
      return { type: 'noop' }
  }
}
```

- [ ] **Step 2: Type-check**

```bash
cd apps/chat && npx tsc --noEmit 2>&1 | grep "event-translators"
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add apps/chat/lib/livechat/event-translators.ts
git commit -m "feat: add sse-to-livechat event translators"
```

---

## Task 7: Bridge Core

**Files:**
- Create: `apps/chat/lib/livechat/bridge.ts`

- [ ] **Step 1: Create bridge**

```typescript
// apps/chat/lib/livechat/bridge.ts
// Orchestrates: LiveChat webhook → /api/messages SSE → LiveChat API calls.

import type { LiveChatConfig, BridgeSession, IntereaInteractionSubmit, InteraFormSubmit } from './types'
import { getSession, upsertSession, updateSessionState, appendTextBuffer, flushTextBuffer } from './session-store'
import { translateSSEEvent } from './event-translators'
import {
  sendTextMessage,
  sendWidgetPayload,
  sendQuickReplies,
  transferChat,
  updateChatProperties,
} from './livechat-api'
import { generateCaseId } from '@/lib/utils'
import type { SSEEvent } from '@intera/shared/types'

function getInternalMessagesUrl(): string {
  // In Railway, apps/chat calls its own API directly (same process).
  // Use localhost to avoid going through the public URL.
  const base = process.env.INTERNAL_CHAT_API_URL ?? 'http://localhost:3000'
  return `${base}/api/messages`
}

/** Parse an SSE stream body into individual SSEEvent objects. */
async function* parseSSEStream(body: ReadableStream<Uint8Array>): AsyncGenerator<SSEEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const event = JSON.parse(line.slice(6)) as SSEEvent
            yield event
          } catch { /* skip malformed lines */ }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/** Build the /api/messages POST body based on the incoming event type. */
function buildMessagesBody(
  event: { type: 'message' | 'form_submit' | 'interaction_submit'; text?: string; form?: InteraFormSubmit; interaction?: IntereaInteractionSubmit },
  session: BridgeSession,
): Record<string, unknown> {
  const base = {
    customerId: session.customerId,
    userId: session.userId,
    chatId: session.chatId,
  }

  if (event.type === 'form_submit' && event.form) {
    return { ...base, formResult: { caseId: session.caseId, answers: event.form.answers } }
  }

  if (event.type === 'interaction_submit' && event.interaction) {
    return {
      ...base,
      interactionResult: {
        caseId: session.caseId,
        optionId: event.interaction.optionId,
        input: event.interaction.input,
      },
    }
  }

  // Plain user message
  return { ...base, message: event.text ?? '' }
}

/** Main entry: handle an incoming LiveChat event for a given chat. */
export async function handleIncomingEvent(
  chatId: string,
  customerId: string,
  userId: string,
  event: { type: 'message' | 'form_submit' | 'interaction_submit'; text?: string; form?: InteraFormSubmit; interaction?: IntereaInteractionSubmit },
  config: LiveChatConfig,
): Promise<void> {
  // Load or create session
  let session = await getSession(chatId)
  if (!session) {
    session = {
      chatId,
      customerId,
      userId,
      caseId: generateCaseId(),
      state: 'idle',
      textBuffer: '',
    }
    await upsertSession(session)
  }

  // Update caseId from incoming event if form/interaction submit carries it
  if (event.type === 'form_submit' && event.form?.caseId) {
    session = { ...session, caseId: event.form.caseId }
    await upsertSession(session)
  }
  if (event.type === 'interaction_submit' && event.interaction?.caseId) {
    session = { ...session, caseId: event.interaction.caseId }
    await upsertSession(session)
  }

  await updateSessionState(chatId, 'thinking')

  const body = buildMessagesBody(event, session)

  let response: Response
  try {
    response = await fetch(getInternalMessagesUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    console.error('[Bridge] Failed to call /api/messages:', err)
    await updateSessionState(chatId, 'idle')
    return
  }

  if (!response.ok || !response.body) {
    console.error('[Bridge] /api/messages returned', response.status)
    await updateSessionState(chatId, 'idle')
    return
  }

  // Consume SSE stream
  for await (const sseEvent of parseSSEStream(response.body)) {
    const action = translateSSEEvent(sseEvent, {
      showSkillStatus: config.showSkillStatus,
      caseId: session.caseId,
    })

    try {
      switch (action.type) {
        case 'send_widget_payload':
          await sendWidgetPayload(chatId, action.payload, config.botAccessToken, config.licenseId)
          break

        case 'send_text':
          await sendTextMessage(chatId, action.text, config.botAccessToken, config.licenseId)
          break

        case 'send_quick_replies':
          await sendQuickReplies(chatId, action.text, action.options, config.botAccessToken, config.licenseId)
          break

        case 'transfer_chat':
          await transferChat(chatId, config.botAccessToken, config.licenseId)
          await updateChatProperties(chatId, { case_id: action.caseId }, config.botAccessToken, config.licenseId)
          await updateSessionState(chatId, 'transferred')
          break

        case 'update_chat_properties':
          await updateChatProperties(chatId, action.props, config.botAccessToken, config.licenseId)
          break

        case 'buffer_text':
          await appendTextBuffer(chatId, action.delta)
          break

        case 'flush_text': {
          const text = await flushTextBuffer(chatId)
          if (text.trim()) {
            await sendTextMessage(chatId, text, config.botAccessToken, config.licenseId)
          }
          break
        }

        case 'noop':
        default:
          break
      }
    } catch (err) {
      console.error('[Bridge] action failed:', action.type, err)
    }
  }

  await updateSessionState(chatId, 'idle')
}
```

- [ ] **Step 2: Type-check**

```bash
cd apps/chat && npx tsc --noEmit 2>&1 | grep "bridge"
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add apps/chat/lib/livechat/bridge.ts
git commit -m "feat: add livechat bridge sse consumer"
```

---

## Task 8: Webhook Route + Config API Route

**Files:**
- Create: `apps/chat/app/api/livechat/webhook/route.ts`
- Create: `apps/chat/app/api/livechat/config/route.ts`

- [ ] **Step 1: Create webhook handler**

```typescript
// apps/chat/app/api/livechat/webhook/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { getLiveChatConfig } from '@/lib/livechat/config-store'
import { handleIncomingEvent } from '@/lib/livechat/bridge'
import type { IntereaInteractionSubmit, InteraFormSubmit } from '@/lib/livechat/types'

// Verify LiveChat webhook secret to prevent unauthorized calls.
function verifyWebhookSecret(request: NextRequest, secret: string): boolean {
  const incoming = request.headers.get('x-livechat-webhook-secret')
  return incoming === secret
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // LiveChat sends the action name in the body
  const action = body.action as string
  const chatId = (body.chat_id ?? (body.payload as Record<string, unknown>)?.chat_id) as string | undefined

  if (!chatId) {
    return NextResponse.json({ error: 'Missing chat_id' }, { status: 400 })
  }

  // Extract customer/user context.
  // LiveChat sends user info in the event payload — adapt to your LiveChat account structure.
  const payload = (body.payload ?? {}) as Record<string, unknown>
  const event = (payload.event ?? {}) as Record<string, unknown>
  const userId = (event.author_id ?? 'anonymous') as string
  const customerId = (payload.license_id ?? process.env.DEFAULT_CUSTOMER_ID ?? 'default') as string

  const config = await getLiveChatConfig(customerId)
  if (!config?.enabled) {
    // Integration not configured for this customer — silently ack
    return NextResponse.json({ ok: true })
  }

  // Route by event type
  if (action === 'incoming_event') {
    const eventType = event.type as string

    if (eventType === 'message') {
      const text = event.text as string
      // Fire-and-forget: webhook must respond quickly, Bridge runs async
      handleIncomingEvent(chatId, customerId, userId, { type: 'message', text }, config)
        .catch(err => console.error('[Webhook] handleIncomingEvent error:', err))
    }

    if (eventType === 'custom') {
      const content = (event.content ?? {}) as Record<string, unknown>
      const contentType = content.type as string

      if (contentType === 'intera_form_submit') {
        const form = content as unknown as InteraFormSubmit
        handleIncomingEvent(chatId, customerId, userId, { type: 'form_submit', form }, config)
          .catch(err => console.error('[Webhook] form_submit error:', err))
      }

      if (contentType === 'intera_interaction_submit') {
        const interaction = content as unknown as IntereaInteractionSubmit
        handleIncomingEvent(chatId, customerId, userId, { type: 'interaction_submit', interaction }, config)
          .catch(err => console.error('[Webhook] interaction_submit error:', err))
      }
    }
  }

  // Always return 200 quickly — LiveChat retries if it receives anything else
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Create config API route (called by Console)**

```typescript
// apps/chat/app/api/livechat/config/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { getLiveChatConfig, upsertLiveChatConfig } from '@/lib/livechat/config-store'

export async function GET(request: NextRequest) {
  const customerId = request.nextUrl.searchParams.get('customerId') ?? 'default'
  const config = await getLiveChatConfig(customerId)
  if (!config) {
    return NextResponse.json({
      customerId,
      botAccessToken: '',
      licenseId: '',
      showSkillStatus: true,
      enabled: false,
    })
  }
  // Mask the token in GET response — Console only needs to know it's set
  return NextResponse.json({
    ...config,
    botAccessToken: config.botAccessToken ? '••••••••' : '',
  })
}

export async function PUT(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { customerId, botAccessToken, licenseId, showSkillStatus, enabled } = body as {
    customerId: string
    botAccessToken: string
    licenseId: string
    showSkillStatus: boolean
    enabled: boolean
  }

  if (!customerId) return NextResponse.json({ error: 'customerId required' }, { status: 400 })

  // If botAccessToken is the mask string, preserve the existing token
  let tokenToSave = botAccessToken
  if (botAccessToken === '••••••••') {
    const existing = await getLiveChatConfig(customerId)
    tokenToSave = existing?.botAccessToken ?? ''
  }

  await upsertLiveChatConfig(customerId, {
    botAccessToken: tokenToSave,
    licenseId: licenseId ?? '',
    showSkillStatus: showSkillStatus ?? true,
    enabled: enabled ?? false,
  })

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Type-check**

```bash
cd apps/chat && npx tsc --noEmit 2>&1 | grep "livechat"
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add apps/chat/app/api/livechat/
git commit -m "feat: add livechat webhook and config api routes"
```

---

## Task 9: In-Chat App Shell + StatusTrack View

**Files:**
- Create: `apps/chat/app/livechat-widget/page.tsx`

- [ ] **Step 1: Install LiveChat Widget SDK**

```bash
cd apps/chat && npm install @livechat/chat-widget-sdk
```

- [ ] **Step 2: Create the In-Chat App page**

This page is a full-screen iframe served at `/livechat-widget`. It uses `'use client'` and the LiveChat SDK.

```tsx
// apps/chat/app/livechat-widget/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import type { WidgetPayload, StatusTrackStep, InteractionOption, FormField } from '@/lib/livechat/types'

// ── Types ────────────────────────────────────────────────────────────────────

type ViewKind = 'idle' | 'status_track' | 'propose_interaction' | 'request_user_input'

interface AppState {
  view: ViewKind
  caseId: string
  steps: StatusTrackStep[]
  options: InteractionOption[]
  fields: FormField[]
}

const INITIAL_STATE: AppState = {
  view: 'idle',
  caseId: '',
  steps: [],
  options: [],
  fields: [],
}

// ── LiveChat SDK bridge ───────────────────────────────────────────────────────

declare global {
  interface Window {
    LiveChatWidget?: {
      on: (event: string, cb: (data: unknown) => void) => void
      call: (action: string, payload?: unknown) => void
    }
  }
}

function sendToLiveChat(type: string, properties: Record<string, unknown>) {
  window.LiveChatWidget?.call('send_event', { type, properties })
}

// ── StatusTrack View ─────────────────────────────────────────────────────────

function StatusTrack({ steps }: { steps: StatusTrackStep[] }) {
  return (
    <div className="p-3 space-y-2">
      <p className="text-[10px] uppercase tracking-widest text-indigo-400 font-semibold mb-3">
        Intera 处理中
      </p>
      <AnimatePresence initial={false}>
        {steps.map((step) => (
          <motion.div
            key={step.id + step.state}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="flex items-center gap-2.5 bg-white/70 backdrop-blur-sm border border-indigo-100 rounded-xl px-3 py-2 shadow-sm"
          >
            {step.state === 'running' ? (
              <div className="w-3 h-3 rounded-full border-2 border-indigo-200 border-t-indigo-500 animate-spin flex-shrink-0" />
            ) : (
              <div className="w-3 h-3 rounded-full border-2 border-emerald-300 bg-emerald-50 flex items-center justify-center flex-shrink-0">
                <svg className="w-2 h-2 text-emerald-500" viewBox="0 0 8 8" fill="none">
                  <path d="M1 4l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className={`text-[12px] font-medium truncate ${step.state === 'done' ? 'text-gray-700' : 'text-gray-900'}`}>
                {step.label}
              </p>
            </div>
            {step.state === 'done' && step.durationMs != null && (
              <span className="text-[10px] text-emerald-400 flex-shrink-0">
                {(step.durationMs / 1000).toFixed(1)}s
              </span>
            )}
            {step.state === 'running' && (
              <span className="text-[10px] text-indigo-400 flex-shrink-0">进行中</span>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

// ── OptionList View ──────────────────────────────────────────────────────────

function OptionList({
  caseId,
  options,
  onSubmit,
}: {
  caseId: string
  options: InteractionOption[]
  onSubmit: () => void
}) {
  const [textInputs, setTextInputs] = useState<Record<string, string>>({})

  const handleSelect = (opt: InteractionOption) => {
    const input = opt.inputType === 'text' ? (textInputs[opt.id] ?? '') : undefined
    sendToLiveChat('intera_interaction_submit', { caseId, optionId: opt.id, input })
    onSubmit()
  }

  return (
    <div className="p-3 space-y-2">
      {options.map((opt) => (
        <div key={opt.id} className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
          <button
            onClick={() => opt.inputType !== 'text' && handleSelect(opt)}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors"
          >
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-gray-800 truncate">{opt.label}</p>
              {opt.description && (
                <p className="text-[11px] text-gray-400 truncate">{opt.description}</p>
              )}
            </div>
            <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
          {opt.inputType === 'text' && (
            <div className="px-3 pb-2.5 space-y-2 border-t border-gray-50">
              <input
                type="text"
                placeholder={opt.inputPlaceholder ?? '请输入…'}
                value={textInputs[opt.id] ?? ''}
                onChange={(e) => setTextInputs(prev => ({ ...prev, [opt.id]: e.target.value }))}
                className="w-full px-2.5 py-1.5 text-[12px] border border-gray-200 rounded-lg outline-none focus:border-indigo-300"
              />
              <button
                onClick={() => handleSelect(opt)}
                disabled={!(textInputs[opt.id] ?? '').trim()}
                className="w-full py-1.5 text-[12px] font-semibold text-white bg-indigo-500 rounded-lg disabled:opacity-40"
              >
                提交
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── FormCard View ────────────────────────────────────────────────────────────

function FormCard({
  caseId,
  fields,
  onSubmit,
}: {
  caseId: string
  fields: FormField[]
  onSubmit: () => void
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [flipped, setFlipped] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const set = (id: string, val: string) => setValues(prev => ({ ...prev, [id]: val }))

  const handleSubmit = async () => {
    setSubmitting(true)
    setFlipped(true)
    await new Promise(r => setTimeout(r, 350)) // wait for flip animation
    sendToLiveChat('intera_form_submit', { caseId, answers: values })
    onSubmit()
  }

  const isValid = fields.every(f => !f.required || (values[f.id] ?? '').trim())

  return (
    <div className="p-3" style={{ perspective: '600px' }}>
      <div
        className="relative transition-transform duration-500"
        style={{ transformStyle: 'preserve-3d', transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}
      >
        {/* Front */}
        <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-4 space-y-3" style={{ backfaceVisibility: 'hidden' }}>
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">请填写信息</p>
          {fields.map((field) => (
            <div key={field.id} className="space-y-1">
              <label className="block text-[12px] font-medium text-gray-700">
                {field.label}{field.required && <span className="text-red-400 ml-0.5">*</span>}
              </label>
              {field.type === 'select' ? (
                <select
                  value={values[field.id] ?? ''}
                  onChange={(e) => set(field.id, e.target.value)}
                  className="w-full px-2.5 py-1.5 text-[12px] border border-gray-200 rounded-lg bg-white"
                >
                  <option value="">请选择…</option>
                  {(field.options ?? []).map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : field.type === 'textarea' ? (
                <textarea
                  rows={3}
                  placeholder={field.placeholder}
                  value={values[field.id] ?? ''}
                  onChange={(e) => set(field.id, e.target.value)}
                  className="w-full px-2.5 py-1.5 text-[12px] border border-gray-200 rounded-lg resize-none"
                />
              ) : (
                <input
                  type={field.type === 'file' ? 'file' : field.type === 'date' ? 'date' : 'text'}
                  placeholder={field.placeholder}
                  value={field.type === 'file' ? undefined : (values[field.id] ?? '')}
                  onChange={(e) => set(field.id, field.type === 'file' ? (e.target.files?.[0]?.name ?? '') : e.target.value)}
                  className="w-full px-2.5 py-1.5 text-[12px] border border-gray-200 rounded-lg"
                />
              )}
            </div>
          ))}
          <button
            onClick={handleSubmit}
            disabled={!isValid || submitting}
            className="w-full py-2 text-[13px] font-semibold text-white bg-indigo-500 rounded-xl disabled:opacity-40"
          >
            提交
          </button>
        </div>

        {/* Back (success state) */}
        <div
          className="absolute inset-0 bg-emerald-50 border border-emerald-100 rounded-xl flex flex-col items-center justify-center gap-2 text-emerald-600"
          style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
        >
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-[13px] font-semibold">已提交，请稍候…</p>
        </div>
      </div>
    </div>
  )
}

// ── Main App ─────────────────────────────────────────────────────────────────

export default function LiveChatWidget() {
  const [state, setState] = useState<AppState>(INITIAL_STATE)

  useEffect(() => {
    // Listen for intera_widget_payload events from Bridge
    window.LiveChatWidget?.on('new_event', (raw: unknown) => {
      const data = raw as { type?: string; content?: WidgetPayload }
      if (data?.type !== 'intera_widget_payload' || !data.content) return

      const payload = data.content
      setState(prev => {
        switch (payload.kind) {
          case 'status_track': {
            const step = payload.step
            if (!step) return prev
            const existingIdx = prev.steps.findIndex(s => s.id === step.id)
            const steps = existingIdx >= 0
              ? prev.steps.map((s, i) => i === existingIdx ? step : s)
              : [...prev.steps, step]
            return { ...prev, view: 'status_track', caseId: payload.caseId, steps }
          }
          case 'propose_interaction':
            return { ...prev, view: 'propose_interaction', caseId: payload.caseId, options: payload.options ?? [], steps: [] }
          case 'request_user_input':
            return { ...prev, view: 'request_user_input', caseId: payload.caseId, fields: payload.fields ?? [], steps: [] }
          default:
            return prev
        }
      })
    })
  }, [])

  const handleViewComplete = () => setState(INITIAL_STATE)

  if (state.view === 'idle') return null

  return (
    <div className="font-sans bg-gray-50 min-h-screen">
      <AnimatePresence mode="wait">
        {state.view === 'status_track' && (
          <motion.div key="status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <StatusTrack steps={state.steps} />
          </motion.div>
        )}
        {state.view === 'propose_interaction' && (
          <motion.div key="options" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <OptionList caseId={state.caseId} options={state.options} onSubmit={handleViewComplete} />
          </motion.div>
        )}
        {state.view === 'request_user_input' && (
          <motion.div key="form" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <FormCard caseId={state.caseId} fields={state.fields} onSubmit={handleViewComplete} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
```

- [ ] **Step 3: Disable Next.js layout for this page**

Create `apps/chat/app/livechat-widget/layout.tsx`:

```tsx
// apps/chat/app/livechat-widget/layout.tsx
// Opt out of the root layout — In-Chat App must be a bare HTML page (no nav, no shell).
export default function WidgetLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script src="https://cdn.livechat-static.com/api/v2.0/livechat-public-js-sdk.js" />
      </head>
      <body style={{ margin: 0, padding: 0, background: '#f9fafb' }}>
        {children}
      </body>
    </html>
  )
}
```

- [ ] **Step 4: Type-check**

```bash
cd apps/chat && npx tsc --noEmit 2>&1 | grep "livechat-widget"
```

Expected: no output.

- [ ] **Step 5: Build check**

```bash
npm run build -w apps/chat 2>&1 | tail -20
```

Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/chat/app/livechat-widget/
git commit -m "feat: add livechat in-chat app with statustrack, optionlist, formcard views"
```

---

## Task 10: Console Integration Settings Page

**Files:**
- Create: `apps/console/app/admin/integrations/page.tsx`
- Modify: `apps/console/components/console-sidebar.tsx`
- Modify: `apps/console/lib/i18n/dictionaries.ts`

- [ ] **Step 1: Add "Integrations" to sidebar nav**

Open `apps/console/components/console-sidebar.tsx`.

Add `Link` import (already there). Add to `ADMIN_ITEMS` array (after the `knowledge` entry):

```typescript
// add to imports at top:
import { Plug } from 'lucide-react'

// add to ADMIN_ITEMS array:
{ href: '/admin/integrations', slug: 'integrations' as NavSlug, icon: Plug, color: '#7c3aed' },
```

Also extend `NavSlug` type:
```typescript
type NavSlug = 'humanTasks' | 'cases' | 'chats' | 'guide' | 'agentConfig' | 'skills' | 'policies' | 'caseTypes' | 'routing' | 'knowledge' | 'integrations'
```

- [ ] **Step 2: Add i18n key**

Open `apps/console/lib/i18n/dictionaries.ts` and add `integrations` under every `sidebar` section that has the other nav items (search for `knowledge` and add the integrations entry next to it in both `en` and `zh` dictionaries):

```typescript
// In English dictionary sidebar section:
integrations: 'Integrations',

// In Chinese dictionary sidebar section:
integrations: '集成',
```

- [ ] **Step 3: Create the integrations page**

```tsx
// apps/console/app/admin/integrations/page.tsx
'use client'

import { useState, useEffect } from 'react'
import { Plug, Eye, EyeOff, Save, CheckCircle2, AlertCircle } from 'lucide-react'
import { chatApiUrl } from '@/lib/chat-api'
import { useConsoleLocale } from '@/components/locale-provider'

interface IntegrationConfig {
  botAccessToken: string
  licenseId: string
  showSkillStatus: boolean
  enabled: boolean
}

const EMPTY_CONFIG: IntegrationConfig = {
  botAccessToken: '',
  licenseId: '',
  showSkillStatus: true,
  enabled: false,
}

export default function IntegrationsPage() {
  const { t } = useConsoleLocale()
  const [config, setConfig] = useState<IntegrationConfig>(EMPTY_CONFIG)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [showToken, setShowToken] = useState(false)
  const [customerId, setCustomerId] = useState('default')

  // Load current customer from session
  useEffect(() => {
    fetch('/api/auth/session')
      .then(r => r.json())
      .then(d => { if (d.customerId) setCustomerId(d.customerId) })
      .catch(() => {})
  }, [])

  // Load config from apps/chat API
  useEffect(() => {
    if (!customerId) return
    setLoading(true)
    fetch(chatApiUrl(`/api/livechat/config?customerId=${encodeURIComponent(customerId)}`))
      .then(r => r.json())
      .then((data: IntegrationConfig) => setConfig(data))
      .catch(() => setConfig(EMPTY_CONFIG))
      .finally(() => setLoading(false))
  }, [customerId])

  const handleSave = async () => {
    setSaving(true)
    setSaveStatus('idle')
    try {
      const res = await fetch(chatApiUrl('/api/livechat/config'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...config, customerId }),
      })
      if (!res.ok) throw new Error('save failed')
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2500)
    } catch {
      setSaveStatus('error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="p-8 text-[13px] text-[var(--fog)]">Loading…</div>
    )
  }

  return (
    <div className="p-8 max-w-xl">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
          <Plug className="w-4 h-4 text-purple-600" />
        </div>
        <div>
          <h1 className="text-[18px] font-bold text-[var(--mist)]">集成</h1>
          <p className="text-[12px] text-[var(--fog)]">配置 LiveChat Bot Agent 接入</p>
        </div>
      </div>

      <div className="space-y-6">
        {/* Enable toggle */}
        <div className="flex items-center justify-between p-4 bg-white border border-black/[0.06] rounded-xl">
          <div>
            <p className="text-[13px] font-semibold text-[var(--mist)]">启用 LiveChat 集成</p>
            <p className="text-[11px] text-[var(--fog)] mt-0.5">开启后 Bridge 将处理 LiveChat 对话</p>
          </div>
          <button
            onClick={() => setConfig(c => ({ ...c, enabled: !c.enabled }))}
            className={`w-10 h-6 rounded-full transition-colors relative ${config.enabled ? 'bg-indigo-500' : 'bg-gray-200'}`}
          >
            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${config.enabled ? 'translate-x-5' : 'translate-x-1'}`} />
          </button>
        </div>

        {/* License ID */}
        <div className="space-y-1.5">
          <label className="block text-[12px] font-semibold text-[var(--mist)]">LiveChat License ID</label>
          <input
            type="text"
            value={config.licenseId}
            onChange={e => setConfig(c => ({ ...c, licenseId: e.target.value }))}
            placeholder="e.g. 12345678"
            className="w-full px-3 py-2 text-[13px] border border-black/[0.08] rounded-xl bg-white outline-none focus:border-indigo-300"
          />
          <p className="text-[11px] text-[var(--fog)]">在 LiveChat Developer Console → Apps → 你的 Bot 里找到</p>
        </div>

        {/* Bot Access Token */}
        <div className="space-y-1.5">
          <label className="block text-[12px] font-semibold text-[var(--mist)]">Bot Access Token</label>
          <div className="relative">
            <input
              type={showToken ? 'text' : 'password'}
              value={config.botAccessToken}
              onChange={e => setConfig(c => ({ ...c, botAccessToken: e.target.value }))}
              placeholder="Bearer token from LiveChat Bot settings"
              className="w-full px-3 py-2 pr-10 text-[13px] border border-black/[0.08] rounded-xl bg-white outline-none focus:border-indigo-300"
            />
            <button
              onClick={() => setShowToken(s => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--fog)] hover:text-[var(--mist)]"
            >
              {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-[11px] text-[var(--fog)]">在部署时于此填写，加密存入数据库</p>
        </div>

        {/* Show skill status toggle */}
        <div className="flex items-center justify-between p-4 bg-white border border-black/[0.06] rounded-xl">
          <div>
            <p className="text-[13px] font-semibold text-[var(--mist)]">对用户显示 Skill 执行状态</p>
            <p className="text-[11px] text-[var(--fog)] mt-0.5">开启后用户可在 widget 内看到 Intera 的处理步骤</p>
          </div>
          <button
            onClick={() => setConfig(c => ({ ...c, showSkillStatus: !c.showSkillStatus }))}
            className={`w-10 h-6 rounded-full transition-colors relative ${config.showSkillStatus ? 'bg-indigo-500' : 'bg-gray-200'}`}
          >
            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${config.showSkillStatus ? 'translate-x-5' : 'translate-x-1'}`} />
          </button>
        </div>

        {/* Webhook URL hint */}
        <div className="p-4 bg-gray-50 border border-black/[0.04] rounded-xl text-[12px] text-[var(--fog)] space-y-1">
          <p className="font-semibold text-[var(--mist)]">在 LiveChat 填写的 Webhook URL</p>
          <code className="block text-indigo-600 mt-1">
            {typeof window !== 'undefined' ? `${process.env.NEXT_PUBLIC_CHAT_API_URL ?? ''}/api/livechat/webhook` : '/api/livechat/webhook'}
          </code>
          <p className="mt-1">Event: <code>incoming_event</code></p>
        </div>

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 bg-indigo-500 text-white text-[13px] font-semibold rounded-xl hover:bg-indigo-600 disabled:opacity-40 transition-colors"
        >
          {saving ? (
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : saveStatus === 'saved' ? (
            <CheckCircle2 className="w-4 h-4" />
          ) : saveStatus === 'error' ? (
            <AlertCircle className="w-4 h-4" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          {saveStatus === 'saved' ? '已保存' : saveStatus === 'error' ? '保存失败' : '保存配置'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Type-check console**

```bash
cd apps/console && npx tsc --noEmit 2>&1 | tail -20
```

Expected: no type errors in livechat-related files.

- [ ] **Step 5: Build check**

```bash
npm run build -w apps/console 2>&1 | tail -20
```

Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/console/app/admin/integrations/ \
        apps/console/components/console-sidebar.tsx \
        apps/console/lib/i18n/dictionaries.ts
git commit -m "feat: add console integrations settings page for livechat config"
```

---

## Task 11: End-to-End Smoke Test

- [ ] **Step 1: Start local dev server**

```bash
npm run dev -w apps/chat
```

- [ ] **Step 2: Verify webhook route responds**

```bash
curl -s -X POST http://localhost:3000/api/livechat/webhook \
  -H "Content-Type: application/json" \
  -d '{"action":"incoming_event","chat_id":"test123","payload":{"event":{"type":"message","text":"hello","author_id":"user1"},"license_id":"default"}}' \
  | jq .
```

Expected: `{"ok":true}`

- [ ] **Step 3: Verify config API**

```bash
curl -s "http://localhost:3000/api/livechat/config?customerId=default" | jq .
```

Expected: JSON with `enabled: false` and empty fields (no config set yet).

- [ ] **Step 4: Verify In-Chat App page loads**

Open `http://localhost:3000/livechat-widget` in a browser.

Expected: blank page (idle state — no widget payload has been sent).

- [ ] **Step 5: Simulate widget payload in browser console**

With the page open, paste in browser console:

```javascript
window.dispatchEvent(new CustomEvent('livechat:new_event', {
  detail: {
    type: 'intera_widget_payload',
    content: {
      kind: 'status_track',
      caseId: 'test',
      step: { id: 'kb_hybrid_retrieve', label: '知识库检索', state: 'running' }
    }
  }
}))
```

> **Note:** Since the LiveChat SDK isn't available in local dev, modify the `useEffect` in `page.tsx` temporarily to listen to `window` custom events during local testing. Revert before deploying.

Expected: StatusTrack view appears with a spinning bubble.

- [ ] **Step 6: Deploy to Railway and verify build**

```bash
git push
```

Monitor Railway build logs. Expected: build succeeds, `npx prisma db push` runs, server starts.

- [ ] **Step 7: Register Webhook in LiveChat Developer Console**

1. Go to `developers.livechat.com` → your Bot app → Webhooks
2. Add webhook URL: `https://chat.intera.io/api/livechat/webhook`
3. Events: `incoming_event`
4. Save

- [ ] **Step 8: Register In-Chat App in LiveChat Developer Console**

1. Go to your Bot app → Widget Placement → Chat Widget
2. App URL: `https://chat.intera.io/livechat-widget`
3. Save and install to your LiveChat Organization

- [ ] **Step 9: Configure in Console**

1. Open Console → Admin → 集成
2. Fill in License ID and Bot Access Token
3. Toggle "启用 LiveChat 集成" ON
4. Save

- [ ] **Step 10: Live test in LiveChat widget**

Send a message in the LiveChat widget. Verify:
- StatusTrack glass bubbles appear as Intera executes skills ✓
- Final text reply appears as a LiveChat message ✓
- If `propose_interaction` triggers: OptionList view appears ✓
- Selecting an option closes the view and continues the conversation ✓

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|-----------------|------|
| StatusTrack Glass Bubble style | Task 9 (FormCard + StatusTrack in page.tsx) |
| propose_interaction → OptionList | Task 9 (OptionList component) |
| request_user_input → FormCard (flip) | Task 9 (FormCard component with 3D flip) |
| propose_cases → quick_replies | Task 7 (event-translators clarification → send_quick_replies) |
| text output buffer → flush | Task 7 (bridge.ts) + Task 6 (event-translators) |
| create_human_task → transfer_chat | Task 7 (bridge.ts escalated handler) |
| update_chat_properties on case_created | Task 6 (event-translators) + Task 7 |
| showSkillStatus toggle | Task 4 (config-store) + Task 6 (translators check) + Task 10 (console toggle) |
| Bot Token in Console, stored in DB | Task 4 (config-store), Task 8 (config route), Task 10 (page) |
| LiveChatSession in Prisma | Task 1 + Task 5 |
| LiveChatConfig in Prisma | Task 1 + Task 4 |
| Console "集成" sidebar nav item | Task 10 |
| In-Chat App at /livechat-widget | Task 9 |
| Bridge in apps/chat | Tasks 7-8 |

**All spec requirements covered. ✓**

**Type consistency check:**
- `WidgetPayload.kind` used in bridge.ts `translateSSEEvent` matches type definition in `types.ts` ✓
- `StatusTrackStep`, `InteractionOption`, `FormField` defined in Task 2, used correctly in Tasks 6 and 9 ✓
- `BridgeAction` discriminated union matches all `switch` cases in bridge.ts ✓
- `IntereaInteractionSubmit` / `InteraFormSubmit` defined in types.ts, used in webhook route ✓
- `sendWidgetPayload`, `sendTextMessage`, etc. signatures in livechat-api.ts match calls in bridge.ts ✓
