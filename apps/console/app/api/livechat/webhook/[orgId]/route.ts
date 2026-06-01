// Per-org webhook — standalone handler using DB LiveChatConfig for secret verification.

import { NextRequest, NextResponse } from 'next/server'
import { getLiveChatConfig } from '@/lib/livechat/config-store'
import { handleIncomingEvent } from '@/lib/livechat/bridge'
import { sendTextMessage, deactivateChat } from '@/lib/livechat/livechat-api'
import { isDuplicateWebhook } from '@/lib/livechat/webhook-dedup'
import type { InteraInteractionSubmit, InteraFormSubmit } from '@/lib/livechat/types'

function getChatPresence(body: Record<string, unknown>): string[] {
  const additional = body.additional_data as Record<string, unknown> | undefined
  return (additional?.chat_presence_user_ids ?? []) as string[]
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params
  const rawBody = await request.text()
  let body: Record<string, unknown>
  try { body = JSON.parse(rawBody) } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const config = await getLiveChatConfig(orgId)
  if (!config?.enabled) {
    return NextResponse.json({ error: 'Org not configured' }, { status: 404 })
  }

  // Verify via per-org webhookSecret from DB
  if (config.webhookSecret) {
    const payloadKey = body.secret_key as string | undefined
    if (!payloadKey || payloadKey !== config.webhookSecret) {
      return NextResponse.json({ error: 'Invalid secret_key' }, { status: 401 })
    }
  } else {
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }

  const action = body.action as string
  const payload = (body.payload ?? {}) as Record<string, unknown>
  const chatId = (body.chat_id
    ?? payload.chat_id
    ?? (payload.chat as Record<string, unknown>)?.id
  ) as string | undefined
  if (!chatId) return NextResponse.json({ error: 'Missing chat_id' }, { status: 400 })

  // Dedup (skip incoming_chat — LiveChat reuses webhook_id)
  if (action !== 'incoming_chat') {
    const event = (payload.event ?? {}) as Record<string, unknown>
    const dedupId = (event.id ?? body.webhook_id ?? rawBody.slice(0, 64)) as string
    if (await isDuplicateWebhook(`livechat:${dedupId}`)) {
      return NextResponse.json({ ok: true, deduped: true })
    }
  }

  const event = (payload.event ?? {}) as Record<string, unknown>
  const eventType = event.type as string
  const userId = (event.author_id ?? 'anonymous') as string

  if (action === 'incoming_event') {
    if (config.agentAccountId && userId === config.agentAccountId) {
      return NextResponse.json({ ok: true, skipped: 'self_authored' })
    }
    const presentIds = getChatPresence(body)
    if (config.agentAccountId && presentIds.length > 0 && !presentIds.includes(config.agentAccountId)) {
      return NextResponse.json({ ok: true, skipped: 'not_my_chat' })
    }

    if (eventType === 'message' || eventType === 'system_message') {
      const text = (event.text as string) || (event.system_message_text as string) || ''
      if (!text.trim()) return NextResponse.json({ ok: true, skipped: 'empty' })

      if (/chat is idle|archived the chat|deactivated/i.test(text)) {
        deactivateChat(chatId, config.botAccessToken, config.licenseId, config.region, config.authType, config.accountId)
          .catch(() => {})
        return NextResponse.json({ ok: true, deactivated: true })
      }

      handleIncomingEvent(chatId, orgId, userId, { type: 'message', text }, config)
        .catch(err => console.error('[Webhook] error:', err))
    }

    if (eventType === 'file') {
      handleIncomingEvent(chatId, orgId, userId, {
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
      if (content.type === 'intera_form_submit') {
        handleIncomingEvent(chatId, orgId, userId, { type: 'form_submit', form: content as unknown as InteraFormSubmit }, config)
          .catch(err => console.error('[Webhook] form_submit error:', err))
      }
      if (content.type === 'intera_interaction_submit') {
        handleIncomingEvent(chatId, orgId, userId, { type: 'interaction_submit', interaction: content as unknown as InteraInteractionSubmit }, config)
          .catch(err => console.error('[Webhook] interaction_submit error:', err))
      }
    }

    if (eventType === 'rich_message_postback') {
      const postbackId = (event.postback as Record<string, unknown>)?.id as string
      if (postbackId) {
        handleIncomingEvent(chatId, orgId, userId, { type: 'postback', postbackId }, config)
          .catch(err => console.error('[Webhook] postback error:', err))
      }
    }
  }

  // BUG-E: incoming_chat parses thread.events for first customer message
  if (action === 'incoming_chat') {
    const p = { region: config.region, authType: config.authType, accountId: config.accountId }
    const chat = (payload.chat ?? {}) as Record<string, unknown>
    const thread = (chat.thread ?? {}) as Record<string, unknown>
    const threadEvents = (thread.events ?? []) as Array<Record<string, unknown>>

    const customerMessages = threadEvents.filter((e) => {
      if (e.type !== 'message') return false
      if (!((e.text as string) || '').trim()) return false
      if (config.agentAccountId && e.author_id === config.agentAccountId) return false
      return true
    })

    if (customerMessages.length === 0) {
      sendTextMessage(chatId, 'Hello! I\'m an AI assistant. How can I help you today?',
        config.botAccessToken, config.licenseId,
        p.region, p.authType, p.accountId,
      ).catch(() => {})
    } else {
      for (const e of customerMessages) {
        const evUserId = (e.author_id ?? userId) as string
        const dup = await isDuplicateWebhook(`livechat:${e.id as string}`).catch(() => true)
        if (!dup) {
          handleIncomingEvent(chatId, orgId, evUserId, { type: 'message', text: e.text as string }, config)
            .catch(err => console.error('[Webhook] first-msg error:', err))
        }
      }
    }
  }

  if (action === 'chat_archived') {
    handleIncomingEvent(chatId, orgId, userId, { type: 'chat_archived' }, config)
      .catch(err => console.error('[Webhook] chat_archived error:', err))
  }

  return NextResponse.json({ ok: true })
}
