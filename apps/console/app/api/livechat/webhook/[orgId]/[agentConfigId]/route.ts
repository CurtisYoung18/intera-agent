// POST /api/livechat/webhook/[orgId]/[agentConfigId] — Per-agent LiveChat webhook
// Migrated to defineRoute (G1 contract seam).
// Loads per-agent channel binding and passes agentConfigId to the bridge for per-agent brain routing.

import { NextRequest, NextResponse } from 'next/server'
import { defineRoute, UnauthorizedError, NotFoundError } from '@/lib/api/define-route'
import { handleIncomingEvent } from '@/lib/livechat/bridge'
import { sendTextMessage } from '@/lib/livechat/livechat-api'
import { isDuplicateWebhook } from '@/lib/livechat/webhook-dedup'
import { checkRateLimit } from '@/lib/rate-limit'
import { getLiveChatConfig } from '@/lib/livechat/config-store'
import type { InteraInteractionSubmit, InteraFormSubmit } from '@/lib/livechat/types'

function getChatPresence(body: Record<string, unknown>): string[] {
  const additional = body.additional_data as Record<string, unknown> | undefined
  return (additional?.chat_presence_user_ids ?? []) as string[]
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ orgId: string; agentConfigId: string }> }) {
  const { orgId, agentConfigId } = await ctx.params

  const rl = checkRateLimit({ key: `webhook:${agentConfigId}`, max: 60, windowSec: 60 })
  if (!rl.allowed) return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 })

  const rawBody = await request.text()
  let body: Record<string, unknown>
  try { body = JSON.parse(rawBody) } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  return defineRoute<void, { agentConfigId: string }>({
    method: 'POST',
    auth: 'webhook',
    async handler({ params, repo }) {
      const agentConfig = await repo.agentConfig.findFirst({
        where: { id: params.agentConfigId, isActive: true },
        select: { id: true, name: true, orgId: true },
      })
      if (!agentConfig) throw new NotFoundError(`Agent config "${params.agentConfigId}" not found or not active`)

      const orgId = agentConfig.orgId

      // Load per-agent channel binding by agentConfigId
      const config = await getLiveChatConfig(agentConfig.id)
      if (!config?.enabled) return NextResponse.json({ error: 'Org not configured' }, { status: 404 })

      if (config.webhookSecret) {
        const payloadKey = body.secret_key as string | undefined
        if (!payloadKey || payloadKey !== config.webhookSecret) {
          throw new UnauthorizedError('Invalid secret_key')
        }
      } else {
        return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
      }

      const action = body.action as string
      const payload = (body.payload ?? {}) as Record<string, unknown>
      const chatId = (body.chat_id ?? payload.chat_id ?? (payload.chat as Record<string, unknown>)?.id) as string | undefined
      if (!chatId) return NextResponse.json({ error: 'Missing chat_id' }, { status: 400 })

      if (action !== 'incoming_chat') {
        const event = (payload.event ?? {}) as Record<string, unknown>
        const dedupId = (event.id ?? body.webhook_id ?? rawBody.slice(0, 64)) as string
        if (await isDuplicateWebhook(dedupId)) return NextResponse.json({ ok: true, dedup: true })
      }

      if (action === 'chat_archived' || action === 'chat_deactivated') {
        ;(handleIncomingEvent as any)(chatId, orgId, `livechat-${chatId}`, { type: 'chat_archived' }, config, agentConfig.id).catch(() => {})
        return NextResponse.json({ ok: true })
      }

      const event = (payload.event ?? payload) as Record<string, unknown>
      const eventType = event.type as string
      const msgAuthor = (event.author ?? {}) as Record<string, unknown>
      const authorId = (msgAuthor.id as string | undefined) ?? (event.author_id as string | undefined)
      const userId = authorId ?? `livechat-${chatId}`

      if (config.agentAccountId && authorId === config.agentAccountId) {
        return NextResponse.json({ ok: true, skipped: 'self_authored' })
      }

      const presentIds = getChatPresence(body)
      if (config.agentAccountId && presentIds.length > 0 && !presentIds.includes(config.agentAccountId)) {
        return NextResponse.json({ ok: true, skipped: 'not_my_chat' })
      }

      if (action === 'incoming_event') {
        if (eventType === 'message' || eventType === 'system_message') {
          const text = (event.text as string) || (event.system_message_text as string) || ''
          if (!text.trim()) return NextResponse.json({ ok: true, skipped: 'empty' })

          ;(handleIncomingEvent as any)(
            chatId,
            orgId,
            userId,
            { type: 'message', text },
            config,
            agentConfig.id,
          ).catch(() => {})

          return NextResponse.json({ ok: true })
        }

        if (eventType === 'file') {
          ;(handleIncomingEvent as any)(
            chatId,
            orgId,
            userId,
            {
              type: 'attachment',
              attachment: {
                url: event.url as string,
                contentType: (event.content_type ?? 'application/octet-stream') as string,
                filename: (event.name ?? 'file') as string,
              },
            },
            config,
            agentConfig.id,
          ).catch(() => {})

          return NextResponse.json({ ok: true })
        }
      }

      if (eventType === 'filled_form') {
        const form = (event.form ?? event.properties ?? {}) as Record<string, unknown>
        ;(handleIncomingEvent as any)(
          chatId,
          orgId,
          userId,
          { type: 'form_submit', form },
          config,
          agentConfig.id,
        ).catch(() => {})
        return NextResponse.json({ ok: true })
      }

      if (eventType === 'custom') {
        const content = (event.content ?? {}) as Record<string, unknown>
        const contentType = content.type as string

        if (contentType === 'intera_form_submit') {
          const form = content as unknown as InteraFormSubmit
          ;(handleIncomingEvent as any)(
            chatId,
            orgId,
            userId,
            { type: 'form_submit', form },
            config,
            agentConfig.id,
          ).catch(() => {})
          return NextResponse.json({ ok: true })
        }

        if (contentType === 'intera_interaction_submit') {
          const interaction = content as unknown as InteraInteractionSubmit
          ;(handleIncomingEvent as any)(
            chatId,
            orgId,
            userId,
            { type: 'interaction_submit', interaction },
            config,
            agentConfig.id,
          ).catch(() => {})
          return NextResponse.json({ ok: true })
        }
      }

      if (eventType === 'rich_message_postback') {
        const postbackId = (event.postback as Record<string, unknown> | undefined)?.id as string | undefined
        if (postbackId) {
          ;(handleIncomingEvent as any)(
            chatId,
            orgId,
            userId,
            { type: 'postback', postbackId },
            config,
            agentConfig.id,
          ).catch(() => {})
        }
        return NextResponse.json({ ok: true })
      }

      if (action === 'incoming_chat') {
        const p = { region: config.region, authType: config.authType, accountId: config.accountId }
        const chat = (payload.chat ?? {}) as Record<string, unknown>
        const thread = (chat.thread ?? {}) as Record<string, unknown>
        const threadEvents = (thread.events ?? []) as Array<Record<string, unknown>>

        const customerMessages = threadEvents.filter((threadEvent) => {
          if (threadEvent.type !== 'message') return false
          const text = ((threadEvent.text as string | undefined) ?? '').trim()
          if (!text) return false
          if (config.agentAccountId && threadEvent.author_id === config.agentAccountId) return false
          return true
        })

        if (customerMessages.length === 0) {
          await sendTextMessage(
            chatId,
            "Hello! I'm an AI assistant. How can I help you today?",
            config.botAccessToken,
            config.licenseId,
            p.region,
            p.authType,
            p.accountId,
          ).catch(() => {})
          return NextResponse.json({ ok: true })
        }

        for (const threadEvent of customerMessages) {
          const eventId = `livechat:${threadEvent.id as string}`
          const duplicate = await isDuplicateWebhook(eventId).catch(() => true)
          if (duplicate) continue

          ;(handleIncomingEvent as any)(
            chatId,
            orgId,
            (threadEvent.author_id as string | undefined) ?? userId,
            { type: 'message', text: threadEvent.text as string },
            config,
            agentConfig.id,
          ).catch(() => {})
        }

        return NextResponse.json({ ok: true })
      }

      return NextResponse.json({ ok: true, skipped: 'unhandled_event' })
    },
  })(request, ctx)
}
