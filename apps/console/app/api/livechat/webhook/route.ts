// apps/chat/app/api/livechat/webhook/route.ts
// Single-tenant webhook (global LIVECHAT_WEBHOOK_SECRET).

import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { getLiveChatConfigForOrg } from '@/lib/livechat/config-store'
import { handleIncomingEvent } from '@/lib/livechat/bridge'
import { upsertSession } from '@/lib/livechat/session-store'
import { sendTextMessage } from '@/lib/livechat/livechat-api'
import { isDuplicateWebhook } from '@/lib/livechat/webhook-dedup'
import { generateCaseId } from '@/lib/utils'
import type { InteraInteractionSubmit, InteraFormSubmit } from '@/lib/livechat/types'

function verifyWebhookSignature(request: NextRequest, rawBody: string): boolean {
  const secret = process.env.LIVECHAT_WEBHOOK_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('LIVECHAT_WEBHOOK_SECRET is required in production')
    }
    console.warn('[Webhook] LIVECHAT_WEBHOOK_SECRET not set — DEV ONLY, skipping verification')
    return true
  }
  const incoming = request.headers.get('x-livechat-webhook-signature')
  if (!incoming) return false
  const expected = createHmac('sha256', secret).update(rawBody, 'utf-8').digest('hex')
  try {
    return timingSafeEqual(Buffer.from(incoming, 'utf-8'), Buffer.from(expected, 'utf-8'))
  } catch {
    return false
  }
}

function getChatPresence(body: Record<string, unknown>): string[] {
  const additional = body.additional_data as Record<string, unknown> | undefined
  const payload = body.payload as Record<string, unknown> | undefined
  const ids = additional?.chat_presence_user_ids
    ?? payload?.chat_presence_user_ids
    ?? []
  return ids as string[]
}

export async function POST(request: NextRequest) {
  let rawBody: string
  let body: Record<string, unknown>
  try {
    rawBody = await request.text()
    body = JSON.parse(rawBody)
    console.log('[Webhook:global] received', { action: body.action })
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // LiveChat webhooks verify via secret_key in payload body
  const webhookSecret = process.env.LIVECHAT_WEBHOOK_SECRET
  if (webhookSecret) {
    const payloadKey = body.secret_key as string | undefined
    if (!payloadKey || payloadKey !== webhookSecret) {
      console.warn('[Webhook:global] invalid secret_key')
      return NextResponse.json({ error: 'Invalid secret_key' }, { status: 401 })
    }
  } else if (process.env.NODE_ENV === 'production') {
    console.error('[Webhook:global] LIVECHAT_WEBHOOK_SECRET not set')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }

  const action = body.action as string
  const chatId = (body.chat_id ?? (body.payload as Record<string, unknown>)?.chat_id) as string | undefined

  if (!chatId) {
    return NextResponse.json({ error: 'Missing chat_id' }, { status: 400 })
  }

  const payload = (body.payload ?? {}) as Record<string, unknown>
  const event = (payload.event ?? {}) as Record<string, unknown>
  const userId = (event.author_id ?? 'anonymous') as string
  const orgId = (payload.license_id ?? process.env.DEFAULT_ORG_ID ?? 'default') as string

  // Dedup — skip incoming_chat (LiveChat reuses webhook_id across sessions).
  // Thread events inside incoming_chat are individually deduped in the handler below.
  if (action !== 'incoming_chat') {
    const dedupId = (event.id ?? body.webhook_id ?? rawBody.slice(0, 64)) as string
    const eventId = `livechat:${dedupId}`
    if (await isDuplicateWebhook(eventId)) {
      return NextResponse.json({ ok: true, deduped: true })
    }
  }

  const resolved = await getLiveChatConfigForOrg(orgId)
  const agentConfigId = resolved?.agentConfigId
  const config = resolved?.config ?? null
  if (!config?.enabled) {
    console.warn('[Webhook] config missing or disabled', { orgId, action, chatId })
    return NextResponse.json({ ok: true, skipped: 'config_disabled' })
  }

  // RC4: author self-filter — skip events authored by our own agent
  if (config.agentAccountId && userId === config.agentAccountId) {
    return NextResponse.json({ ok: true, skipped: 'self_authored' })
  }

  // RC0/F: chat_presence_user_ids filter — only respond to chats assigned to our agent
  const presentIds = getChatPresence(body)
  if (config.agentAccountId && presentIds.length > 0 && !presentIds.includes(config.agentAccountId)) {
    return NextResponse.json({ ok: true, skipped: 'not_my_chat' })
  }

  if (action === 'incoming_event') {
    const eventType = event.type as string

    if (eventType === 'message' || eventType === 'system_message') {
      const text = (event.text as string) || (event.system_message_text as string) || ''
      if (!text.trim()) return NextResponse.json({ ok: true, skipped: 'empty' })
      handleIncomingEvent(chatId, orgId, userId, { type: 'message', text }, config, agentConfigId)
        .catch(err => console.error('[Webhook] handleIncomingEvent error:', err))
    }

    if (eventType === 'file') {
      handleIncomingEvent(chatId, orgId, userId, {
        type: 'attachment',
        attachment: {
          url: event.url as string,
          contentType: (event.content_type ?? 'application/octet-stream') as string,
          filename: (event.name ?? 'file') as string,
        },
      }, config, agentConfigId).catch(err => console.error('[Webhook] attachment error:', err))
    }

    if (eventType === 'custom') {
      const content = (event.content ?? {}) as Record<string, unknown>
      const contentType = content.type as string

      if (contentType === 'intera_form_submit') {
        const form = content as unknown as InteraFormSubmit
        handleIncomingEvent(chatId, orgId, userId, { type: 'form_submit', form }, config, agentConfigId)
          .catch(err => console.error('[Webhook] form_submit error:', err))
      }

      if (contentType === 'intera_interaction_submit') {
        const interaction = content as unknown as InteraInteractionSubmit
        handleIncomingEvent(chatId, orgId, userId, { type: 'interaction_submit', interaction }, config, agentConfigId)
          .catch(err => console.error('[Webhook] interaction_submit error:', err))
      }
    }

    if (eventType === 'rich_message_postback') {
      const postbackId = (event.postback as Record<string, unknown>)?.id as string
      if (postbackId) {
        handleIncomingEvent(chatId, orgId, userId, {
          type: 'postback',
          postbackId,
        }, config, agentConfigId).catch(err => console.error('[Webhook] postback error:', err))
      }
    }
  }

  // BUG-E: incoming_chat carries the customer's first message in thread.events.
  if (action === 'incoming_chat') {
    const p = { region: config.region, authType: config.authType, accountId: config.accountId }

    const chat = (payload.chat ?? {}) as Record<string, unknown>
    const thread = (chat.thread ?? {}) as Record<string, unknown>
    const threadEvents = (thread.events ?? []) as Array<Record<string, unknown>>

    const customerMessages = threadEvents.filter((e) => {
      if (e.type !== 'message') return false
      const text = (e.text as string) || ''
      if (!text.trim()) return false
      if (config.agentAccountId && e.author_id === config.agentAccountId) return false
      return true
    })

    const freshSessionUserId =
      (customerMessages[0]?.author_id as string | undefined) ??
      userId
    await upsertSession({
      chatId,
      orgId,
      userId: freshSessionUserId,
      caseId: generateCaseId(),
      agentConfigId,
      state: 'idle',
      textBuffer: '',
    })

    if (customerMessages.length === 0) {
      sendTextMessage(
        chatId, 'Hello! I\'m an AI assistant. How can I help you today?',
        config.botAccessToken, config.licenseId,
        p.region, p.authType, p.accountId,
      ).catch(err => console.error('[Webhook] incoming_chat welcome error:', err))
    } else {
      for (const e of customerMessages) {
        const evUserId = (e.author_id ?? userId) as string
        const eventId = `livechat:${e.id as string}`
        const dup = await isDuplicateWebhook(eventId).catch(() => true)
        if (!dup) {
          handleIncomingEvent(chatId, orgId, evUserId, { type: 'message', text: e.text as string }, config, agentConfigId)
            .catch(err => console.error('[Webhook] incoming_chat first-msg error:', err))
        }
      }
    }
  }

  if (action === 'chat_archived') {
    handleIncomingEvent(chatId, orgId, userId, { type: 'chat_archived' }, config, agentConfigId)
      .catch(err => console.error('[Webhook] chat_archived error:', err))
  }

  return NextResponse.json({ ok: true })
}
