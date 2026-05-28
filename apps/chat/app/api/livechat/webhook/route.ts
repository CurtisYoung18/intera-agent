// apps/chat/app/api/livechat/webhook/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { getLiveChatConfig } from '@/lib/livechat/config-store'
import { handleIncomingEvent } from '@/lib/livechat/bridge'
import { isDuplicateWebhook } from '@/lib/livechat/webhook-dedup'
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

export async function POST(request: NextRequest) {
  let rawBody: string
  let body: Record<string, unknown>
  try {
    rawBody = await request.text()
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!verifyWebhookSignature(request, rawBody)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const action = body.action as string
  const chatId = (body.chat_id ?? (body.payload as Record<string, unknown>)?.chat_id) as string | undefined

  if (!chatId) {
    return NextResponse.json({ error: 'Missing chat_id' }, { status: 400 })
  }

  const payload = (body.payload ?? {}) as Record<string, unknown>
  const event = (payload.event ?? {}) as Record<string, unknown>
  const userId = (event.author_id ?? 'anonymous') as string
  const customerId = (payload.license_id ?? process.env.DEFAULT_CUSTOMER_ID ?? 'default') as string

  // Dedup: use LiveChat event.id; fall back to webhook_id or raw body prefix
  const eventId = `livechat:${(event.id ?? body.webhook_id ?? rawBody.slice(0, 64)) as string}`
  if (await isDuplicateWebhook(eventId)) {
    return NextResponse.json({ ok: true, deduped: true })
  }

  const config = await getLiveChatConfig(customerId)
  if (!config?.enabled) {
    return NextResponse.json({ ok: true })
  }

  if (action === 'incoming_event') {
    const eventType = event.type as string

    if (eventType === 'message') {
      const text = event.text as string
      handleIncomingEvent(chatId, customerId, userId, { type: 'message', text }, config)
        .catch(err => console.error('[Webhook] handleIncomingEvent error:', err))
    }

    if (eventType === 'file') {
      handleIncomingEvent(chatId, customerId, userId, {
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
        const form = content as unknown as InteraFormSubmit
        handleIncomingEvent(chatId, customerId, userId, { type: 'form_submit', form }, config)
          .catch(err => console.error('[Webhook] form_submit error:', err))
      }

      if (contentType === 'intera_interaction_submit') {
        const interaction = content as unknown as InteraInteractionSubmit
        handleIncomingEvent(chatId, customerId, userId, { type: 'interaction_submit', interaction }, config)
          .catch(err => console.error('[Webhook] interaction_submit error:', err))
      }
    }

    if (eventType === 'rich_message_postback') {
      const postbackId = (event.postback as Record<string, unknown>)?.id as string
      if (postbackId) {
        handleIncomingEvent(chatId, customerId, userId, {
          type: 'postback',
          postbackId,
        }, config).catch(err => console.error('[Webhook] postback error:', err))
      }
    }
  }

  // incoming_chat — new conversation started, optional welcome message
  if (action === 'incoming_chat') {
    // Chat session init — bridge will handle session creation
    // Optional: send welcome card here
    handleIncomingEvent(chatId, customerId, userId, { type: 'message', text: '' }, config)
      .catch(err => console.error('[Webhook] incoming_chat error:', err))
  }

  if (action === 'chat_archived') {
    handleIncomingEvent(chatId, customerId, userId, { type: 'chat_archived' }, config)
      .catch(err => console.error('[Webhook] chat_archived error:', err))
  }

  return NextResponse.json({ ok: true })
}
