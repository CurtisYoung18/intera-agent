// apps/chat/lib/livechat/bridge.ts
// Orchestrates: LiveChat webhook → /api/messages SSE → LiveChat API calls.

import type { LiveChatConfig, IncomingEvent, ContentBlock } from './types'
import { getSession, upsertSession, updateSessionState, appendTextBuffer, flushTextBuffer, closeSession, type BridgeSessionRow } from './session-store'
import { LiveChatRenderer } from '@/channels/livechat/renderer'
import type { RenderContext } from '@intera/shared/channels/renderer'
import type { ChannelBindingConfig } from '@intera/shared/channels/binding'
import {
  sendTextMessage, sendWidgetPayload, sendQuickReplies, sendCard, sendCarousel,
  sendImage, sendSystemMessage, setTypingIndicator, transferChat, updateChatProperties,
  deactivateChat,
} from './livechat-api'
import { enqueueRetry } from './retry-queue'
import { markChannelUnhealthy, markChannelHealthy } from './channel-health'
import { downloadAndEncode, isSupportedImageType } from './image-utils'
import { generateCaseId } from '@/lib/utils'
import type { SSEEvent } from '@intera/shared/types'

/** Extract optional LiveChat API params from config for transparent pass-through. */
function lcParams(config: LiveChatConfig): {
  region?: string; authType?: string; accountId?: string
} {
  return {
    region: config.region,
    authType: config.authType,
    accountId: config.accountId,
  }
}

function getInternalMessagesUrl(): string {
  const base = process.env.INTERNAL_CHAT_API_URL ?? 'http://localhost:3000'
  return `${base}/api/messages`
}

async function* parseSSEStream(body: ReadableStream<Uint8Array>): AsyncGenerator<SSEEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      let done = false
      let value: Uint8Array | undefined
      try {
        const result = await reader.read()
        done = result.done ?? false
        value = result.value
      } catch (e) {
        // Stream cancelled/terminated after server finished writing — normal end
        if ((e as Error).name === 'TypeError' && (e as Error).message === 'terminated') {
          break
        }
        throw e
      }
      if (done || !value) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const event = JSON.parse(line.slice(6)) as SSEEvent
            yield event
          } catch { /* skip malformed */ }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

function buildMessagesBody(
  event: IncomingEvent,
  session: BridgeSessionRow,
): Record<string, unknown> {
  const base = { orgId: session.orgId, userId: session.userId, chatId: session.chatId, caseId: session.caseId }

  switch (event.type) {
    case 'form_submit':
      return { ...base, formResult: { caseId: session.caseId, answers: event.form?.answers ?? {} } }
    case 'interaction_submit':
      return { ...base, interactionResult: { caseId: session.caseId, optionId: event.interaction?.optionId, input: event.interaction?.input } }
    case 'attachment':
      return {
        ...base,
        message: `[File upload] ${event.attachment.filename} (${event.attachment.contentType})`,
      }
    case 'postback': {
      const colonIdx = event.postbackId.indexOf(':')
      const optionId = colonIdx > 0 ? event.postbackId.slice(0, colonIdx) : event.postbackId
      const input = colonIdx > 0 ? event.postbackId.slice(colonIdx + 1) : undefined
      return { ...base, interactionResult: { caseId: session.caseId, optionId, input } }
    }
    case 'chat_archived':
      return { ...base, message: '[Chat archived]' }
    default: {
      const text = (event.text ?? '').trim()
      if (!text) {
        // empty message (e.g. incoming_chat) → don't feed to agent loop
        return { ...base, skip: true }
      }
      return { ...base, message: text }
    }
  }
}

async function sendFailureNotice(
  chatId: string, config: LiveChatConfig, reason: 'engine_unreachable' | 'stream_truncated' | 'action_failed',
): Promise<void> {
  const msg = {
    engine_unreachable: 'Service is temporarily unavailable. Our systems are recovering — please try again shortly.',
    stream_truncated: 'Sorry, the response was interrupted. Please resend your message.',
    action_failed: 'A technical issue occurred and has been logged. If you do not receive a response soon, please contact support.',
  }[reason]
  await sendTextMessage(chatId, msg, config.botAccessToken, config.licenseId, config.region, config.authType, config.accountId).catch(() => {})
}

export async function handleIncomingEvent(
  chatId: string, orgId: string, userId: string,
  event: IncomingEvent, config: LiveChatConfig,
): Promise<void> {
  // Skip system-generated messages that would waste agent tokens
  if (event.type === 'message' && (event as { text?: string }).text) {
    const text = (event as { text?: string }).text ?? ''
    if (/chat is idle|chat has been|chat closed|chat archived|archived the chat|deactivated/i.test(text)) {
      console.log('[Bridge] Skipping system message, deactivating:', chatId)
      deactivateChat(chatId, config.botAccessToken, config.licenseId, config.region, config.authType, config.accountId)
        .catch(e => console.error('[Bridge] deactivateChat failed:', e))
      await closeSession(chatId, 'idle_timeout')
      // Reset session for fresh start on reopen
      await upsertSession({ chatId, orgId, userId, caseId: generateCaseId(), state: 'idle', textBuffer: '' })
      return
    }
  }

  if (event.type === 'chat_archived') {
    await closeSession(chatId, 'archived_by_agent')
    // Reset session so reopen starts fresh (no old case context)
    await upsertSession({ chatId, orgId, userId, caseId: generateCaseId(), state: 'idle', textBuffer: '' })
    return
  }

  let session = await getSession(chatId)
  if (!session) {
    session = { chatId, orgId, userId, caseId: generateCaseId(), state: 'idle', textBuffer: '' }
    await upsertSession(session)
    // Claim ownership on first touch (§2.2)
    updateChatProperties(chatId, { owner: 'intera' }, config.botAccessToken, config.licenseId, config.region, config.authType, config.accountId).catch(() => {})
  }

  if (event.type === 'form_submit' && event.form?.caseId) {
    session = { ...session, caseId: event.form.caseId }
    await upsertSession(session)
  }
  if (event.type === 'interaction_submit' && event.interaction?.caseId) {
    session = { ...session, caseId: event.interaction.caseId }
    await upsertSession(session)
  }

  // If session was transferred to human, don't re-enter agent loop (§3)
  if (session.state === 'transferred') {
    console.log('[Bridge] Session transferred, skipping agent loop for chat:', chatId)
    return
  }

  await updateSessionState(chatId, 'thinking')

  const p = lcParams(config)

  // Typing indicator on
  setTypingIndicator(chatId, true, config.botAccessToken, config.licenseId, p.region, p.authType, p.accountId).catch(e => console.error('[Bridge] setTyping on failed:', e))

  const body = buildMessagesBody(event, session)

  // Empty message from non-action events (e.g. incoming_chat) → skip agent loop
  if (body.skip) {
    await updateSessionState(chatId, 'idle')
    return
  }

  // For attachment events, download and encode image for multimodal.
  // BUG-A: Only supported image types are sent as image blocks; non-image
  // attachments get a text-only fallback so the multimodal API doesn't reject.
  let contentBlocks: ContentBlock[] | undefined
  if (event.type === 'attachment') {
    const attachContentType = event.attachment.contentType
    if (isSupportedImageType(attachContentType)) {
      try {
        const result = await downloadAndEncode(event.attachment.url)
        contentBlocks = [
          { type: 'text', text: `Customer uploaded image: ${event.attachment.filename}` },
          { type: 'image', source: { type: 'base64', media_type: result.contentType, data: result.data } },
        ]
      } catch (err) {
        console.error('[Bridge] Failed to download image attachment:', err)
        ;(body as Record<string, unknown>).message = `[Image download failed] ${event.attachment.filename}`
      }
    } else {
      // Non-image file: don't try to construct an image block
      const typeLabel = attachContentType || 'unknown type'
      ;(body as Record<string, unknown>).message = `[File upload] ${event.attachment.filename} (${typeLabel})`
    }
  }

  if (contentBlocks) {
    (body as Record<string, unknown>).contentBlocks = contentBlocks
  }

  let response: Response
  try {
    response = await fetch(getInternalMessagesUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    console.error('[Bridge] Failed to call /api/messages:', err)
    await sendFailureNotice(chatId, config, 'engine_unreachable')
    await enqueueRetry(chatId, orgId, userId, event, String(err))
    await updateSessionState(chatId, 'idle')
    setTypingIndicator(chatId, false, config.botAccessToken, config.licenseId, p.region, p.authType, p.accountId).catch(() => {})
    return
  }

  // BUG-D: /api/messages never returns 202 — queued messages flow through SSE
  // with message_stop{reason:'queued'}. Dead branch removed.
  if (!response.ok || !response.body) {
    console.error('[Bridge] /api/messages returned', response.status)
    await sendFailureNotice(chatId, config, 'engine_unreachable')
    await updateSessionState(chatId, 'idle')
    setTypingIndicator(chatId, false, config.botAccessToken, config.licenseId, p.region, p.authType, p.accountId).catch(() => {})
    return
  }

  const livechatRenderer = new LiveChatRenderer(config.showSkillStatus)
  const binding: ChannelBindingConfig = {
    channel: 'livechat',
    enabled: config.enabled,
    credentials: { botAccessToken: config.botAccessToken, licenseId: config.licenseId },
  }
  const renderCtx: RenderContext = {
    caseId: session.caseId, orgId, sessionId: chatId, binding,
  }

  let streamTruncated = true
  try {
    for await (const sseEvent of parseSSEStream(response.body)) {
      const actions = livechatRenderer.render(sseEvent, renderCtx)

      for (const action of actions) {
        try {
          switch (action.type) {
            case 'send_widget_payload':
              await sendWidgetPayload(chatId, action.payload, config.botAccessToken, config.licenseId, p.region, p.authType, p.accountId)
              break
            case 'send_text':
              await sendTextMessage(chatId, action.text, config.botAccessToken, config.licenseId, p.region, p.authType, p.accountId)
              break
            case 'send_quick_replies':
              await sendQuickReplies(chatId, action.text, action.options, config.botAccessToken, config.licenseId, p.region, p.authType, p.accountId)
              break
            case 'send_card':
              await sendCard(chatId, action.card, config.botAccessToken, config.licenseId, p.region, p.authType, p.accountId)
              break
            case 'send_carousel':
              await sendCarousel(chatId, action.cards, config.botAccessToken, config.licenseId, p.region, p.authType, p.accountId)
              break
            case 'send_image':
              await sendImage(chatId, action.url, action.caption, config.botAccessToken, config.licenseId, p.region, p.authType, p.accountId)
              break
            case 'send_system_message':
              await sendSystemMessage(chatId, action.text, config.botAccessToken, config.licenseId, p.region, p.authType, p.accountId)
              break
            case 'set_typing':
              await setTypingIndicator(chatId, action.isTyping, config.botAccessToken, config.licenseId, p.region, p.authType, p.accountId)
              break
            case 'transfer_chat': {
              const target = action.group
                ? { type: 'group' as const, ids: [action.group] }
                : config.transferGroupId != null
                  ? { type: 'group' as const, ids: [config.transferGroupId] }
                  : { type: 'queue' as const }
              await transferChat(chatId, target, config.botAccessToken, config.licenseId, p.region, p.authType, p.accountId)
              await updateChatProperties(chatId, { case_id: action.caseId }, config.botAccessToken, config.licenseId, p.region, p.authType, p.accountId)
              await updateSessionState(chatId, 'transferred')
              break
            }
            case 'update_chat_properties':
              await updateChatProperties(chatId, action.props, config.botAccessToken, config.licenseId, p.region, p.authType, p.accountId)
              break
            case 'buffer_text':
              await appendTextBuffer(chatId, action.delta)
              break
            case 'flush_text': {
              const text = (await flushTextBuffer(chatId)).trimStart()
              if (text.trim()) {
                await sendTextMessage(chatId, text, config.botAccessToken, config.licenseId, p.region, p.authType, p.accountId).catch(e => console.error('[Bridge] sendText failed:', e))
              }
              break
            }
            case 'noop':
            default:
              break
          }
        } catch (err) {
          const e = err as Error & { code?: string }
          const msg = e.message ?? ''
          if (e.code === 'TOKEN_EXPIRED') {
            await markChannelUnhealthy(orgId, 'livechat', 'token_expired', String(err))
          } else if (e.code === 'NOT_IN_CHAT') {
            await markChannelUnhealthy(orgId, 'livechat', 'token_expired', String(err))
          } else if (e.code === 'RATE_LIMITED') {
            await markChannelUnhealthy(orgId, 'livechat', 'rate_limited', String(err))
          } else if (msg.includes('Chat not active')) {
            // Chat has been archived — don't retry, just close the session
            await closeSession(chatId, 'archived_externally')
            console.warn('[Bridge] Chat archived externally:', chatId)
            return // breaks out of the SSE loop
          }
          console.error('[Bridge] action failed:', action.type, err)
        }
      }
    }
    streamTruncated = false
  } catch (err) {
    console.error('[Bridge] SSE stream error:', err)
    // Flush any buffered text first — the agent may have produced a (partial) response
    const buffered = await flushTextBuffer(chatId)
    if (buffered.trim()) {
      await sendTextMessage(chatId, buffered, config.botAccessToken, config.licenseId, p.region, p.authType, p.accountId).catch(() => {})
      // Response was sent — don't retry; the "terminated" was just the stream closing after message_stop
      streamTruncated = false
    } else {
      await sendFailureNotice(chatId, config, 'stream_truncated')
      await enqueueRetry(chatId, orgId, userId, event, String(err))
    }
  } finally {
    // Ensure typing indicator is off
    setTypingIndicator(chatId, false, config.botAccessToken, config.licenseId, p.region, p.authType, p.accountId).catch(() => {})
    await updateSessionState(chatId, 'idle')
  }

  if (!streamTruncated) {
    await markChannelHealthy(orgId, 'livechat').catch(() => {})
  }
}
