// apps/chat/app/api/livechat/webhook/[vendorId]/route.ts
// Per-customer webhook endpoint with isolated secrets (multi-tenant).

import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { getLiveChatConfig } from '@/lib/livechat/config-store'
import { handleIncomingEvent } from '@/lib/livechat/bridge'
import { sendTextMessage, deactivateChat } from '@/lib/livechat/livechat-api'
import { isDuplicateWebhook } from '@/lib/livechat/webhook-dedup'
import type { InteraInteractionSubmit, InteraFormSubmit, AttachmentData } from '@/lib/livechat/types'

function getChatPresence(body: Record<string, unknown>): string[] {
  const additional = body.additional_data as Record<string, unknown> | undefined
  const payload = body.payload as Record<string, unknown> | undefined
  const ids = additional?.chat_presence_user_ids
    ?? payload?.chat_presence_user_ids
    ?? []
  return ids as string[]
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ vendorId: string }> },
) {
  const { vendorId } = await params

  let rawBody: string
  let body: Record<string, unknown>
  try {
    rawBody = await request.text()
    body = JSON.parse(rawBody)
    console.log('[Webhook] received', { vendorId, action: body.action })
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Per-customer secret verification
  const config = await getLiveChatConfig(vendorId)
  if (!config?.enabled) {
    console.warn('[Webhook] config missing or disabled', { vendorId, action: body.action, chatId: body.chat_id })
    return NextResponse.json({ error: 'Customer not configured' }, { status: 404 })
  }

  const secret = config.webhookSecret ?? process.env.LIVECHAT_WEBHOOK_SECRET

  // LiveChat webhooks verify via secret_key in payload body (not HMAC signature header)
  if (secret) {
    const payloadKey = body.secret_key as string | undefined
    if (!payloadKey) {
      console.warn('[Webhook] missing secret_key in payload', { vendorId, action: body.action })
      return NextResponse.json({ error: 'Missing secret_key' }, { status: 401 })
    }
    if (payloadKey !== secret) {
      console.warn('[Webhook] secret_key mismatch', { vendorId, action: body.action, got: payloadKey.slice(0, 4) + '...' })
      return NextResponse.json({ error: 'Invalid secret_key' }, { status: 401 })
    }
  } else if (process.env.NODE_ENV === 'production') {
    console.error('[Webhook] no secret configured', { vendorId })
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }

  const action = body.action as string
  const payload = (body.payload ?? {}) as Record<string, unknown>
  const chatId = (body.chat_id
    ?? payload.chat_id
    ?? (payload.chat as Record<string, unknown>)?.id
  ) as string | undefined

  if (!chatId) {
    console.warn('[Webhook] missing chat_id', { vendorId, action, payload_keys: Object.keys(payload) })
    return NextResponse.json({ error: 'Missing chat_id' }, { status: 400 })
  }

  const event = (payload.event ?? {}) as Record<string, unknown>
  const eventType = event.type as string
  console.log('[Webhook] msg', `action=${action} chatId=${chatId} type=${eventType} author=${event.author_id} text=${((event.text || event.system_message_text || '') as string).slice(0, 60)}`)
  const userId = (event.author_id ?? 'anonymous') as string

  // Dedup — skip incoming_chat (LiveChat reuses webhook_id across sessions,
  // so webhook_id:chatId would false-positive on close→reopen). The thread
  // events inside incoming_chat are individually deduped in the handler below.
  if (action !== 'incoming_chat') {
    const dedupId = (event.id ?? body.webhook_id ?? rawBody.slice(0, 64)) as string
    const eventId = `livechat:${dedupId}`
    if (await isDuplicateWebhook(eventId)) {
      console.log('[Webhook] deduped', { eventId })
      return NextResponse.json({ ok: true, deduped: true })
    }
  }

  // RC4: author self-filter — skip events authored by our own agent
  if (config.agentAccountId && userId === config.agentAccountId) {
    console.log('[Webhook] self_authored', { userId, agentAccountId: config.agentAccountId })
    return NextResponse.json({ ok: true, skipped: 'self_authored' })
  }

  // RC0/F: chat_presence_user_ids filter — only respond to chats assigned to our agent
  const presentIds = getChatPresence(body)
  if (config.agentAccountId && presentIds.length > 0 && !presentIds.includes(config.agentAccountId)) {
    console.log('[Webhook] not_my_chat', { agentAccountId: config.agentAccountId, presentIds })
    return NextResponse.json({ ok: true, skipped: 'not_my_chat' })
  }

  if (action === 'incoming_event') {
    if (eventType === 'message' || eventType === 'system_message') {
      const text = (event.text as string) || (event.system_message_text as string) || ''
      if (!text.trim()) return NextResponse.json({ ok: true, skipped: 'empty' })

      // LiveChat idle timeout → deactivate chat directly, no agent loop needed
      if (/chat is idle|chat has been|chat closed|chat archived|archived the chat|deactivated/i.test(text)) {
        console.log('[Webhook] idle timeout, deactivating chat:', chatId)
        const p = { region: config.region, authType: config.authType, accountId: config.accountId }
        deactivateChat(chatId, config.botAccessToken, config.licenseId, p.region, p.authType, p.accountId)
          .catch(err => console.error('[Webhook] deactivateChat failed:', err))
        return NextResponse.json({ ok: true, deactivated: true })
      }

      handleIncomingEvent(chatId, vendorId, userId, { type: 'message', text }, config)
        .catch(err => console.error('[Webhook] error:', err))
    }

    if (eventType === 'file') {
      handleIncomingEvent(chatId, vendorId, userId, {
        type: 'attachment',
        attachment: {
          url: event.url as string,
          contentType: (event.content_type ?? 'application/octet-stream') as string,
          filename: (event.name ?? 'file') as string,
        },
      }, config).catch(err => console.error('[Webhook] attachment error:', err))
    }

    if (eventType === 'custom') {
      const content = (event.content ?? {}) as Record<string, unknown>
      const contentType = content.type as string

      if (contentType === 'intera_form_submit') {
        handleIncomingEvent(chatId, vendorId, userId, { type: 'form_submit', form: content as unknown as InteraFormSubmit }, config)
          .catch(err => console.error('[Webhook] form_submit error:', err))
      }

      if (contentType === 'intera_interaction_submit') {
        handleIncomingEvent(chatId, vendorId, userId, { type: 'interaction_submit', interaction: content as unknown as InteraInteractionSubmit }, config)
          .catch(err => console.error('[Webhook] interaction_submit error:', err))
      }
    }

    if (eventType === 'rich_message_postback') {
      const postbackId = (event.postback as Record<string, unknown>)?.id as string
      if (postbackId) {
        handleIncomingEvent(chatId, vendorId, userId, { type: 'postback', postbackId }, config)
          .catch(err => console.error('[Webhook] postback error:', err))
      }
    }
  }

  // BUG-E: incoming_chat carries the customer's first message in thread.events.
  // Must parse and feed to agent before returning response, otherwise the
  // serverless runtime may kill the async callbacks before they execute.
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
        // Dedup + dispatch MUST be awaited so the serverless runtime doesn't kill them
        const dup = await isDuplicateWebhook(eventId).catch(() => true)
        if (!dup) {
          handleIncomingEvent(chatId, vendorId, evUserId, { type: 'message', text: e.text as string }, config)
            .catch(err => console.error('[Webhook] incoming_chat first-msg error:', err))
        }
      }
    }
  }

  if (action === 'chat_archived') {
    handleIncomingEvent(chatId, vendorId, userId, { type: 'chat_archived' }, config)
      .catch(err => console.error('[Webhook] chat_archived error:', err))
  }

  return NextResponse.json({ ok: true })
}
