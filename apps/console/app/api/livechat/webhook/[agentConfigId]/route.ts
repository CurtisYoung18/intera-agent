// POST /api/livechat/webhook/[agentConfigId] — Per-agent LiveChat webhook
// Migrated to defineRoute (G1 contract seam).
// Loads per-agent channel binding and passes agentConfigId to the bridge for per-agent brain routing.

import { NextRequest, NextResponse } from 'next/server'
import { defineRoute, UnauthorizedError, NotFoundError } from '@/lib/api/define-route'
import { handleIncomingEvent } from '@/lib/livechat/bridge'
import { sendTextMessage, deactivateChat } from '@/lib/livechat/livechat-api'
import { isDuplicateWebhook } from '@/lib/livechat/webhook-dedup'
import { checkRateLimit } from '@/lib/rate-limit'
import { getLiveChatConfig } from '@/lib/livechat/config-store'
import type { InteraInteractionSubmit, InteraFormSubmit } from '@/lib/livechat/types'

function getChatPresence(body: Record<string, unknown>): string[] {
  const additional = body.additional_data as Record<string, unknown> | undefined
  return (additional?.chat_presence_user_ids ?? []) as string[]
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ agentConfigId: string }> }) {
  const { agentConfigId } = await ctx.params

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

      if (action === 'incoming_chat' || action === 'incoming_event') {
        (handleIncomingEvent as any)(chatId, orgId, `livechat-${chatId}`, { type: 'chat_started', presence: getChatPresence(body) }, config, agentConfig.id).catch(() => {})
        return NextResponse.json({ ok: true })
      }

      if (action === 'chat_deactivated') {
        await (deactivateChat as any)(chatId, config as any).catch(() => {})
        return NextResponse.json({ ok: true })
      }

      const event = (payload.event ?? payload) as Record<string, unknown>
      const eventType = event.type as string
      const msgAuthor = (event.author ?? {}) as Record<string, unknown>

      if (eventType === 'filled_form') {
        const form = (event.form ?? event.properties ?? {}) as Record<string, unknown>
        (handleIncomingEvent as any)(chatId, orgId, msgAuthor.id as string ?? `livechat-${chatId}`, { type: 'form_submit', form }, config, agentConfig.id).catch(() => {})
        return NextResponse.json({ ok: true })
      }

      const userMessage = event.text as string | undefined
      if (!userMessage || typeof userMessage !== 'string' || userMessage.trim().length === 0) {
        if (action === 'incoming_chat') (handleIncomingEvent as any)(chatId, orgId, `livechat-${chatId}`, { type: 'chat_started', presence: getChatPresence(body) }, config, agentConfig.id).catch(() => {})
        else await (sendTextMessage as any)(chatId, 'Sorry, I can only process text messages.', config as any)
        return NextResponse.json({ ok: true })
      }

      (handleIncomingEvent as any)(chatId, orgId, msgAuthor.id as string ?? `livechat-${chatId}`, {
        type: 'user_message', message: userMessage, conversationId: chatId,
      }, config, agentConfig.id).catch(() => {})

      return NextResponse.json({ ok: true })
    },
  })(request, ctx)
}
