// apps/chat/app/api/livechat/webhook/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { getLiveChatConfig } from '@/lib/livechat/config-store'
import { handleIncomingEvent } from '@/lib/livechat/bridge'
import type { InteraInteractionSubmit, InteraFormSubmit } from '@/lib/livechat/types'

function verifyWebhookSignature(request: NextRequest, rawBody: string): boolean {
  const secret = process.env.LIVECHAT_WEBHOOK_SECRET
  if (!secret) {
    console.warn('[Webhook] LIVECHAT_WEBHOOK_SECRET not set — skipping signature verification')
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

  // LiveChat sends the action name in the body
  const action = body.action as string
  const chatId = (body.chat_id ?? (body.payload as Record<string, unknown>)?.chat_id) as string | undefined

  if (!chatId) {
    return NextResponse.json({ error: 'Missing chat_id' }, { status: 400 })
  }

  // Extract customer/user context.
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
        const interaction = content as unknown as InteraInteractionSubmit
        handleIncomingEvent(chatId, customerId, userId, { type: 'interaction_submit', interaction }, config)
          .catch(err => console.error('[Webhook] interaction_submit error:', err))
      }
    }
  }

  // Always return 200 quickly — LiveChat retries if it receives anything else
  return NextResponse.json({ ok: true })
}
