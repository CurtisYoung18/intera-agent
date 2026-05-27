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
} from './livechat-api'
import { enqueueRetry } from './retry-queue'
import { markChannelUnhealthy, markChannelHealthy } from './channel-health'
import { downloadAndEncode } from './image-utils'
import { generateCaseId } from '@/lib/utils'
import type { SSEEvent } from '@intera/shared/types'

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
      const { done, value } = await reader.read()
      if (done) break
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
  const base = { customerId: session.customerId, userId: session.userId, chatId: session.chatId }

  switch (event.type) {
    case 'form_submit':
      return { ...base, formResult: { caseId: session.caseId, answers: event.form?.answers ?? {} } }
    case 'interaction_submit':
      return { ...base, interactionResult: { caseId: session.caseId, optionId: event.interaction?.optionId, input: event.interaction?.input } }
    case 'attachment':
      return {
        ...base,
        message: `[用户上传文件] ${event.attachment.filename} (${event.attachment.contentType})`,
      }
    case 'postback':
      return { ...base, message: `[用户点击] ${event.postbackId}` }
    case 'chat_archived':
      return { ...base, message: '[会话已归档]' }
    default:
      return { ...base, message: event.text ?? '' }
  }
}

async function sendFailureNotice(
  chatId: string, config: LiveChatConfig, reason: 'engine_unreachable' | 'stream_truncated' | 'action_failed',
): Promise<void> {
  const msg = {
    engine_unreachable: '抱歉，系统暂时无法处理您的请求。我们正在恢复中，请稍后再试。',
    stream_truncated: '抱歉，回复中断。请重新发送您的问题。',
    action_failed: '抱歉，出现技术问题，已记录。如长时间无响应可联系人工。',
  }[reason]
  await sendTextMessage(chatId, msg, config.botAccessToken, config.licenseId).catch(() => {})
}

export async function handleIncomingEvent(
  chatId: string, customerId: string, userId: string,
  event: IncomingEvent, config: LiveChatConfig,
): Promise<void> {
  if (event.type === 'chat_archived') {
    await closeSession(chatId, 'archived_by_agent')
    return
  }

  let session = await getSession(chatId)
  if (!session) {
    session = { chatId, customerId, userId, caseId: generateCaseId(), state: 'idle', textBuffer: '' }
    await upsertSession(session)
  }

  if (event.type === 'form_submit' && event.form?.caseId) {
    session = { ...session, caseId: event.form.caseId }
    await upsertSession(session)
  }
  if (event.type === 'interaction_submit' && event.interaction?.caseId) {
    session = { ...session, caseId: event.interaction.caseId }
    await upsertSession(session)
  }

  await updateSessionState(chatId, 'thinking')

  // Typing indicator on
  setTypingIndicator(chatId, true, config.botAccessToken, config.licenseId).catch(() => {})

  const body = buildMessagesBody(event, session)

  // For attachment events, download and encode image for multimodal
  let contentBlocks: ContentBlock[] | undefined
  if (event.type === 'attachment') {
    try {
      const imageData = await downloadAndEncode(event.attachment.url)
      contentBlocks = [
        { type: 'text', text: `用户上传了图片: ${event.attachment.filename}` },
        { type: 'image', source: { type: 'base64', media_type: event.attachment.contentType, data: imageData } },
      ]
    } catch (err) {
      console.error('[Bridge] Failed to download attachment:', err)
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
    await enqueueRetry(chatId, customerId, userId, event, String(err))
    await updateSessionState(chatId, 'idle')
    setTypingIndicator(chatId, false, config.botAccessToken, config.licenseId).catch(() => {})
    return
  }

  if (!response.ok || !response.body) {
    console.error('[Bridge] /api/messages returned', response.status)
    await sendFailureNotice(chatId, config, 'engine_unreachable')
    await updateSessionState(chatId, 'idle')
    setTypingIndicator(chatId, false, config.botAccessToken, config.licenseId).catch(() => {})
    return
  }

  // Typing indicator off when first text_delta arrives (handled in SSE loop)
  let typingStopped = false

  const livechatRenderer = new LiveChatRenderer(config.showSkillStatus)
  const binding: ChannelBindingConfig = {
    channel: 'livechat',
    enabled: config.enabled,
    credentials: { botAccessToken: config.botAccessToken, licenseId: config.licenseId },
  }
  const renderCtx: RenderContext = {
    caseId: session.caseId, customerId, sessionId: chatId, binding,
  }

  let streamTruncated = true
  try {
    for await (const sseEvent of parseSSEStream(response.body)) {
      // Stop typing on first text content
      if (!typingStopped && (sseEvent.type === 'text_delta' || sseEvent.type === 'message_stop')) {
        typingStopped = true
        setTypingIndicator(chatId, false, config.botAccessToken, config.licenseId).catch(() => {})
      }

      const actions = livechatRenderer.render(sseEvent, renderCtx)

      for (const action of actions) {
        try {
          switch (action.type) {
            case 'send_widget_payload':
              await sendWidgetPayload(chatId, action.payload, config.botAccessToken, config.licenseId)
              break
            case 'send_text':
              await sendTextMessage(chatId, action.text, config.botAccessToken, config.licenseId)
              break
            case 'send_quick_replies':
              await sendQuickReplies(chatId, action.text, action.options, config.botAccessToken, config.licenseId)
              break
            case 'send_card':
              await sendCard(chatId, action.card, config.botAccessToken, config.licenseId)
              break
            case 'send_carousel':
              await sendCarousel(chatId, action.cards, config.botAccessToken, config.licenseId)
              break
            case 'send_image':
              await sendImage(chatId, action.url, action.caption, config.botAccessToken, config.licenseId)
              break
            case 'send_system_message':
              await sendSystemMessage(chatId, action.text, config.botAccessToken, config.licenseId)
              break
            case 'set_typing':
              await setTypingIndicator(chatId, action.isTyping, config.botAccessToken, config.licenseId)
              break
            case 'transfer_chat':
              await transferChat(chatId, action.group ? { type: 'group', ids: [action.group] } : { type: 'queue' }, config.botAccessToken, config.licenseId)
              await updateChatProperties(chatId, { case_id: action.caseId }, config.botAccessToken, config.licenseId)
              await updateSessionState(chatId, 'transferred')
              break
            case 'update_chat_properties':
              await updateChatProperties(chatId, action.props, config.botAccessToken, config.licenseId)
              break
            case 'buffer_text':
              await appendTextBuffer(chatId, action.delta)
              break
            case 'flush_text': {
              const text = await flushTextBuffer(chatId)
              if (text.trim()) {
                await sendTextMessage(chatId, text, config.botAccessToken, config.licenseId)
              }
              break
            }
            case 'noop':
            default:
              break
          }
        } catch (err) {
          const code = (err as { code?: string })?.code
          if (code === 'TOKEN_EXPIRED') {
            await markChannelUnhealthy(customerId, 'livechat', 'token_expired', String(err))
          } else if (code === 'RATE_LIMITED') {
            await markChannelUnhealthy(customerId, 'livechat', 'rate_limited', String(err))
          }
          console.error('[Bridge] action failed:', action.type, err)
        }
      }
    }
    streamTruncated = false
  } catch (err) {
    console.error('[Bridge] SSE stream error:', err)
    await sendFailureNotice(chatId, config, 'stream_truncated')
    await enqueueRetry(chatId, customerId, userId, event, String(err))
  } finally {
    // Ensure typing is off
    if (!typingStopped) {
      setTypingIndicator(chatId, false, config.botAccessToken, config.licenseId).catch(() => {})
    }
    await updateSessionState(chatId, 'idle')
  }

  if (!streamTruncated) {
    await markChannelHealthy(customerId, 'livechat').catch(() => {})
  }
}
