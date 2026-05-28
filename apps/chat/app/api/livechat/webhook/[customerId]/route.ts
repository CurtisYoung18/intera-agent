// apps/chat/app/api/livechat/webhook/[customerId]/route.ts
// Per-customer webhook endpoint with isolated secrets (multi-tenant).

import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { getLiveChatConfig } from '@/lib/livechat/config-store'
import { handleIncomingEvent } from '@/lib/livechat/bridge'
import { upsertSession } from '@/lib/livechat/session-store'
import { sendTextMessage } from '@/lib/livechat/livechat-api'
import { isDuplicateWebhook } from '@/lib/livechat/webhook-dedup'
import { generateCaseId } from '@/lib/utils'
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
  { params }: { params: Promise<{ customerId: string }> },
) {
  const { customerId } = await params

  let rawBody: string
  let body: Record<string, unknown>
  try {
    rawBody = await request.text()
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Per-customer secret verification
  const config = await getLiveChatConfig(customerId)
  if (!config?.enabled) {
    console.warn('[Webhook] config missing or disabled', { customerId, action: body.action, chatId: body.chat_id })
    return NextResponse.json({ error: 'Customer not configured' }, { status: 404 })
  }

  const secret = config.webhookSecret ?? process.env.LIVECHAT_WEBHOOK_SECRET

  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
    }
    console.warn('[Webhook] secret not set — DEV ONLY')
  } else {
    const incoming = request.headers.get('x-livechat-webhook-signature')
    if (!incoming) {
      return NextResponse.json({ error: 'Missing signature' }, { status: 401 })
    }
    const expected = createHmac('sha256', secret).update(rawBody, 'utf-8').digest('hex')
    try {
      if (!timingSafeEqual(Buffer.from(incoming, 'utf-8'), Buffer.from(expected, 'utf-8'))) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }
    } catch {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  }

  const action = body.action as string
  const chatId = (body.chat_id ?? (body.payload as Record<string, unknown>)?.chat_id) as string | undefined

  if (!chatId) {
    return NextResponse.json({ error: 'Missing chat_id' }, { status: 400 })
  }

  const payload = (body.payload ?? {}) as Record<string, unknown>
  const event = (payload.event ?? {}) as Record<string, unknown>
  const userId = (event.author_id ?? 'anonymous') as string

  // Dedup
  const eventId = `livechat:${(event.id ?? body.webhook_id ?? rawBody.slice(0, 64)) as string}`
  if (await isDuplicateWebhook(eventId)) {
    return NextResponse.json({ ok: true, deduped: true })
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

    if (eventType === 'message') {
      handleIncomingEvent(chatId, customerId, userId, { type: 'message', text: event.text as string }, config)
        .catch(err => console.error('[Webhook] error:', err))
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
        handleIncomingEvent(chatId, customerId, userId, { type: 'form_submit', form: content as unknown as InteraFormSubmit }, config)
          .catch(err => console.error('[Webhook] form_submit error:', err))
      }

      if (contentType === 'intera_interaction_submit') {
        handleIncomingEvent(chatId, customerId, userId, { type: 'interaction_submit', interaction: content as unknown as InteraInteractionSubmit }, config)
          .catch(err => console.error('[Webhook] interaction_submit error:', err))
      }
    }

    if (eventType === 'rich_message_postback') {
      const postbackId = (event.postback as Record<string, unknown>)?.id as string
      if (postbackId) {
        handleIncomingEvent(chatId, customerId, userId, { type: 'postback', postbackId }, config)
          .catch(err => console.error('[Webhook] postback error:', err))
      }
    }
  }

  // RC5: incoming_chat — create session + optional welcome; don't feed empty message to loop
  if (action === 'incoming_chat') {
    const p = { region: config.region, authType: config.authType, accountId: config.accountId }
    upsertSession({ chatId, customerId, userId, caseId: generateCaseId(), state: 'idle', textBuffer: '' })
      .then(() => {
        sendTextMessage(
          chatId, '您好，我是智能客服，请描述您遇到的问题～',
          config.botAccessToken, config.licenseId,
          p.region, p.authType, p.accountId,
        ).catch(() => {})
      })
      .catch(err => console.error('[Webhook] incoming_chat session error:', err))
  }

  if (action === 'chat_archived') {
    handleIncomingEvent(chatId, customerId, userId, { type: 'chat_archived' }, config)
      .catch(err => console.error('[Webhook] chat_archived error:', err))
  }

  return NextResponse.json({ ok: true })
}
