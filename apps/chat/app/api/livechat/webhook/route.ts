// apps/chat/app/api/livechat/webhook/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { getLiveChatConfig } from '@/lib/livechat/config-store'
import { handleIncomingEvent } from '@/lib/livechat/bridge'
import type { IntereaInteractionSubmit, InteraFormSubmit } from '@/lib/livechat/types'

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
