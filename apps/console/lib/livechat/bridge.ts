// apps/chat/lib/livechat/bridge.ts
// Orchestrates: LiveChat webhook → /api/messages SSE → LiveChat API calls.

import type { LiveChatConfig, IncomingEvent, ContentBlock } from './types'
import { getSession, upsertSession, updateSessionState, appendTextBuffer, flushTextBuffer, closeSession, type BridgeSessionRow } from './session-store'
import { LiveChatRenderer } from '@/channels/livechat/renderer'
import type { RenderContext } from '@intera/shared/channels/renderer'
import type { ChannelBindingConfig } from '@intera/shared/channels/binding'
import {
  sendTextMessage, sendWidgetPayload, sendQuickReplies, sendCard, sendCarousel,
  sendImage, sendSystemMessage, setTypingIndicator, transferChat,
  deactivateChat,
} from './livechat-api'
import { enqueueRetry } from './retry-queue'

import { downloadAndEncode, isSupportedImageType, resolveRenderableImageUrls } from './image-utils'
import { getInternalMessagesUrl } from './internal-messages-url'
import { generateCaseId } from '@/lib/utils'
import { INTERNAL_SECRET_HEADER } from '@/lib/api-auth'
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
  options?: { pinCaseToSession?: boolean },
): Record<string, unknown> {
  const base = {
    orgId: session.orgId,
    userId: session.userId,
    chatId: session.chatId,
    caseId: session.caseId,
    ...(options?.pinCaseToSession ? { sessionCasePinned: true } : {}),
  }

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

async function flushBufferedTextAsMessages(
  chatId: string,
  rawText: string,
  config: LiveChatConfig,
  params: ReturnType<typeof lcParams>,
): Promise<void> {
  const text = rawText.trimStart()
  if (!text.trim()) return

  await sendTextMessage(
    chatId,
    text,
    config.botAccessToken,
    config.licenseId,
    params.region,
    params.authType,
    params.accountId,
  )

  const imageUrls = await resolveRenderableImageUrls(text)
  for (const imageUrl of imageUrls) {
    try {
      await sendImage(
        chatId,
        imageUrl,
        undefined,
        config.botAccessToken,
        config.licenseId,
        params.region,
        params.authType,
        params.accountId,
      )
    } catch (err) {
      console.error('[Bridge] sendImage failed:', imageUrl, err)
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

function canResumeTransferredSession(event: IncomingEvent): boolean {
  return event.type === 'message' ||
    event.type === 'attachment' ||
    event.type === 'interaction_submit' ||
    event.type === 'form_submit' ||
    event.type === 'postback'
}

export async function handleIncomingEvent(
  chatId: string, orgId: string, userId: string,
  event: IncomingEvent, config: LiveChatConfig,
  agentConfigId?: string,
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
  }

  let resumedTransferredSession = false
  const shouldPinCaseToSession =
    event.type === 'form_submit' ||
    event.type === 'interaction_submit' ||
    event.type === 'postback' ||
    event.type === 'attachment'

  if (event.type === 'form_submit' && event.form?.caseId) {
    session = { ...session, caseId: event.form.caseId }
    await upsertSession(session)
  }
  if (event.type === 'interaction_submit' && event.interaction?.caseId) {
    session = { ...session, caseId: event.interaction.caseId }
    await upsertSession(session)
  }

  if (session.state === 'transferred') {
    if (!canResumeTransferredSession(event)) {
      console.log('[Bridge] Session transferred, skipping agent loop for chat:', chatId)
      return
    }
    resumedTransferredSession = true

    session = {
      ...session,
      caseId: event.type === 'message' || event.type === 'attachment'
        ? generateCaseId()
        : session.caseId,
      state: 'idle',
      textBuffer: '',
    }
    await upsertSession(session)
    console.log('[Bridge] Resumed transferred session for chat:', chatId)
  }

  await updateSessionState(chatId, 'thinking')

  const p = lcParams(config)

  // Typing indicator on
  setTypingIndicator(chatId, true, config.botAccessToken, config.licenseId, p.region, p.authType, p.accountId).catch(e => console.error('[Bridge] setTyping on failed:', e))

  const body = buildMessagesBody(event, session, {
    pinCaseToSession: shouldPinCaseToSession || resumedTransferredSession,
  })

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
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      [INTERNAL_SECRET_HEADER]: process.env.INTERNAL_API_SECRET || '',
      'x-intera-org': session.orgId,
    }
    if (agentConfigId) headers['x-intera-agent-config-id'] = agentConfigId

    response = await fetch(getInternalMessagesUrl(), {
      method: 'POST',
      headers,
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
  let transferredToHuman = false
  try {
    for await (const sseEvent of parseSSEStream(response.body)) {
      const actions = livechatRenderer.render(sseEvent, renderCtx)

      for (const action of actions) {
        if (transferredToHuman) continue

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
              const pendingText = (await flushTextBuffer(chatId)).trimStart()
              await flushBufferedTextAsMessages(chatId, pendingText, config, p)
              const target = action.group
                ? { type: 'group' as const, ids: [action.group] }
                : config.transferGroupId != null
                  ? { type: 'group' as const, ids: [config.transferGroupId] }
                  : { type: 'queue' as const }
              await transferChat(chatId, target, config.botAccessToken, config.licenseId, p.region, p.authType, p.accountId)
              transferredToHuman = true
              await updateSessionState(chatId, 'transferred')
              break
            }
            case 'buffer_text':
              await appendTextBuffer(chatId, action.delta)
              break
            case 'flush_text': {
              const text = await flushTextBuffer(chatId)
              await flushBufferedTextAsMessages(chatId, text, config, p).catch(e => console.error('[Bridge] sendText failed:', e))
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
            // channel health tracking removed
          } else if (e.code === 'NOT_IN_CHAT') {
            // channel health tracking removed
          } else if (e.code === 'RATE_LIMITED') {
            // channel health tracking removed
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
    if (!transferredToHuman) {
      setTypingIndicator(chatId, false, config.botAccessToken, config.licenseId, p.region, p.authType, p.accountId).catch(() => {})
      await updateSessionState(chatId, 'idle')
    }
  }

  // channel health tracking removed (markChannelHealthy)
}
