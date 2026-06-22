// apps/chat/lib/livechat/bridge.ts
// Orchestrates: LiveChat webhook → /api/messages SSE → LiveChat API calls.

import type { LiveChatConfig, IncomingEvent, ContentBlock, LiveChatFailureReason } from './types'
import { getSession, upsertSession, updateSessionState, appendTextBuffer, flushTextBuffer, closeSession, rotateSessionCase, type BridgeSessionRow } from './session-store'
import { LiveChatRenderer } from '@/channels/livechat/renderer'
import { confirmProcedureHumanHandoff } from '@/lib/agent/session-store'
import type { RenderContext } from '@intera/shared/channels/renderer'
import type { ChannelBindingConfig } from '@intera/shared/channels/binding'
import {
  sendAgentNote, sendTextMessage, sendWidgetPayload, sendQuickReplies, sendCard, sendCarousel,
  sendImage, sendSystemMessage, setTypingIndicator, transferChat,
  deactivateChat,
} from './livechat-api'
import { enqueueRetry } from './retry-queue'

import { downloadAndEncode, isLikelyImageAttachment, resolveRenderableImageUrls } from './image-utils'
import { getInternalMessagesUrl } from './internal-messages-url'
import { liveChatFailureMessage } from './failure-messages'
import { generateCaseId } from '@/lib/utils'
import { INTERNAL_SECRET_HEADER } from '@/lib/api-auth'
import type { SSEEvent } from '@intera/shared/types'

type FormSnapshot = {
  title?: string
  description?: string
  fields?: Array<{
    id?: string
    key?: string
    type?: string
    label?: string
    required?: boolean
    options?: string[]
    placeholder?: string
    defaultValue?: string
  }>
  answers?: Record<string, string>
}

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
  options?: { pinCaseToSession?: boolean; disableCaseRouting?: boolean },
): Record<string, unknown> {
  const base = {
    orgId: session.orgId,
    userId: session.userId,
    chatId: session.chatId,
    caseId: session.caseId,
    ...(options?.disableCaseRouting ? { disableCaseRouting: true } : {}),
    ...(options?.pinCaseToSession ? { sessionCasePinned: true } : {}),
  }

  switch (event.type) {
    case 'form_submit':
      return {
        ...base,
        formResult: {
          caseId: session.caseId,
          answers: event.form?.answers ?? {},
          ...(event.form?.toolCallId ? { toolCallId: event.form.toolCallId } : {}),
          ...(event.form?.title ? { title: event.form.title } : {}),
          ...(event.form?.description ? { description: event.form.description } : {}),
          ...(event.form?.fields?.length ? { fields: event.form.fields } : {}),
        },
      }
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

function summarizeFormField(field: NonNullable<FormSnapshot['fields']>[number]): string | null {
  const id = typeof field.id === 'string' ? field.id.trim() : ''
  const label = typeof field.label === 'string' && field.label.trim() ? field.label.trim() : id
  if (!label) return null

  const type = typeof field.type === 'string' && field.type.trim() ? field.type.trim() : 'text'
  const tags = [type]
  if (field.required) tags.push('required')
  const placeholder = typeof field.placeholder === 'string' && field.placeholder.trim() ? field.placeholder.trim() : ''
  return placeholder
    ? `- ${label} [${tags.join(', ')}] - ${placeholder}`
    : `- ${label} [${tags.join(', ')}]`
}

function formatAgentVisibleFormRequest(form: FormSnapshot | undefined): string | null {
  if (!form) return null

  const lines = ['[Intera] Form requested']
  const title = typeof form.title === 'string' && form.title.trim() ? form.title.trim() : ''
  const description = typeof form.description === 'string' && form.description.trim() ? form.description.trim() : ''
  const fieldLines = Array.isArray(form.fields)
    ? form.fields.map(summarizeFormField).filter((line): line is string => Boolean(line))
    : []

  if (title) lines.push(`Title: ${title}`)
  if (description) lines.push(`Description: ${description}`)
  if (fieldLines.length > 0) {
    lines.push('Fields:')
    lines.push(...fieldLines)
  }

  return lines.join('\n')
}

function formatAgentVisibleFormSubmission(form: FormSnapshot | undefined): string | null {
  if (!form || !form.answers || Object.keys(form.answers).length === 0) return null

  const labelById = new Map<string, string>()
  for (const field of form.fields ?? []) {
    const id = typeof field.id === 'string' ? field.id.trim() : ''
    const label = typeof field.label === 'string' && field.label.trim() ? field.label.trim() : id
    if (id && label) labelById.set(id, label)
  }

  const lines = ['[Intera] Form submitted']
  const title = typeof form.title === 'string' && form.title.trim() ? form.title.trim() : ''
  if (title) lines.push(`Title: ${title}`)
  lines.push('Answers:')
  for (const [key, value] of Object.entries(form.answers)) {
    const label = labelById.get(key) ?? key
    const rendered = typeof value === 'string' ? value.trim() : String(value)
    lines.push(`- ${label}: ${rendered || '(empty)'}`)
  }

  return lines.join('\n')
}

function isTransferGroupUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /Cannot assign any agent from requested groups/i.test(message)
}

async function transferChatWithFallback(
  chatId: string,
  target: { type: 'group'; ids: number[] } | { type: 'agent'; ids: string[] } | { type: 'queue' },
  config: LiveChatConfig,
  params: ReturnType<typeof lcParams>,
): Promise<void> {
  try {
    await transferChat(chatId, target, config.botAccessToken, config.licenseId, params.region, params.authType, params.accountId)
    return
  } catch (error) {
    if (target.type === 'group' && isTransferGroupUnavailableError(error)) {
      await transferChat(
        chatId,
        { type: 'queue' },
        config.botAccessToken,
        config.licenseId,
        params.region,
        params.authType,
        params.accountId,
      )
      return
    }
    throw error
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

  await sendRenderableImagesFromText(chatId, text, config, params)
}

async function sendRenderableImagesFromText(
  chatId: string,
  rawText: string,
  config: LiveChatConfig,
  params: ReturnType<typeof lcParams>,
): Promise<void> {
  const text = rawText.trim()
  if (!text) return

  let imageUrls: string[] = []
  try {
    imageUrls = await resolveRenderableImageUrls(text)
  } catch (err) {
    console.error('[Bridge] resolveRenderableImageUrls failed:', err)
    return
  }

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

function collectFormRequestImageText(data: unknown, config: LiveChatConfig): string {
  if (!data || typeof data !== 'object') return ''

  const form = data as FormSnapshot
  const parts: string[] = []
  const push = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) parts.push(value.trim())
  }

  push(form.title)
  push(form.description)
  for (const field of form.fields ?? []) {
    push(field.id)
    push(field.key)
    push(field.label)
    push(field.placeholder)
    push(field.defaultValue)
    for (const option of field.options ?? []) push(option)
  }

  const configuredPlayerIdGuideUrl = config.playerIdGuideImageUrl?.trim()
  if (configuredPlayerIdGuideUrl && formRequestsPlayerIdGuide(parts, config.playerIdGuideKeywords)) {
    push(configuredPlayerIdGuideUrl)
  }

  return parts.join('\n')
}

const DEFAULT_PLAYER_ID_GUIDE_KEYWORDS = [
  'member id',
  'player id',
  'jayabaji member',
  'jaya member',
]

function normalizePlayerIdGuideKeyword(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function formRequestsPlayerIdGuide(parts: string[], configuredKeywords?: string[]): boolean {
  const keywords = (configuredKeywords?.length ? configuredKeywords : DEFAULT_PLAYER_ID_GUIDE_KEYWORDS)
    .map(normalizePlayerIdGuideKeyword)
    .filter(Boolean)
  if (!keywords.length) return false

  return parts.some((part) => {
    const normalized = normalizePlayerIdGuideKeyword(part)
    return keywords.some((keyword) => normalized.includes(keyword))
  })
}

async function sendFailureNotice(
  chatId: string, config: LiveChatConfig, reason: LiveChatFailureReason,
): Promise<void> {
  const msg = liveChatFailureMessage(config, reason)
  await sendTextMessage(chatId, msg, config.botAccessToken, config.licenseId, config.region, config.authType, config.accountId).catch(() => {})
}

async function readResponsePreview(response: Response): Promise<string> {
  try {
    const text = await response.text()
    return text.replace(/\s+/g, ' ').slice(0, 500)
  } catch {
    return ''
  }
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
    if (/chat is idle|chat has been|chat closed|closed the chat|chat archived|archived the chat|deactivated/i.test(text)) {
      // LiveChat already emitted its own closure/archive system event. Calling
      // deactivate_chat again can create duplicate "closed the chat" messages
      // in the customer transcript, so only rotate our internal bridge state.
      console.log('[Bridge] Skipping closure system message, rotating session:', chatId)
      await closeSession(chatId, 'idle_timeout')
      // Reset session for fresh start on reopen
      await upsertSession({ chatId, orgId, userId, caseId: generateCaseId(), agentConfigId, state: 'idle', textBuffer: '' })
      return
    }
  }

  if (event.type === 'chat_archived') {
    await closeSession(chatId, 'archived_by_agent')
    // Reset session so reopen starts fresh (no old case context)
    await upsertSession({ chatId, orgId, userId, caseId: generateCaseId(), agentConfigId, state: 'idle', textBuffer: '' })
    return
  }

  let session = await getSession(chatId)
  if (!session) {
    session = { chatId, orgId, userId, caseId: generateCaseId(), agentConfigId, state: 'idle', textBuffer: '' }
    await upsertSession(session)
  } else if (agentConfigId && session.agentConfigId !== agentConfigId) {
    session = { ...session, agentConfigId }
    await upsertSession(session)
  }

  const resolvedAgentConfigId = session.agentConfigId ?? agentConfigId
  if (event.type === 'form_submit') {
    const note = formatAgentVisibleFormSubmission(event.form)
    if (note) {
      await sendAgentNote(chatId, note, config.botAccessToken, config.licenseId, config.region, config.authType, config.accountId)
        .catch((err) => console.error('[Bridge] sendAgentNote(form_submit) failed:', err))
    }
  }

  let resumedTransferredSession = false
  const sessionStateBeforeEvent = session.state
  const shouldPinCaseToSession =
    event.type === 'form_submit' ||
    event.type === 'interaction_submit' ||
    event.type === 'postback' ||
    event.type === 'attachment' ||
    (sessionStateBeforeEvent === 'thinking' && event.type === 'message')
  const shouldDisableCaseRouting =
    event.type !== 'message' ||
    (sessionStateBeforeEvent === 'thinking' && event.type === 'message')

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
    disableCaseRouting: shouldDisableCaseRouting,
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
    const attachmentText = `Customer uploaded image: ${event.attachment.filename}`
    if (isLikelyImageAttachment(event.attachment)) {
      ;(body as Record<string, unknown>).message = attachmentText
      try {
        const result = await downloadAndEncode(event.attachment.url, {
          contentType: event.attachment.contentType,
          filename: event.attachment.filename,
        })
        contentBlocks = [
          { type: 'text', text: attachmentText },
          { type: 'image', source: { type: 'base64', media_type: result.contentType, data: result.data } },
        ]
      } catch (err) {
        console.error('[Bridge] Failed to download image attachment:', err)
        ;(body as Record<string, unknown>).message = `[Image download failed] ${event.attachment.filename}`
      }
    } else {
      // Non-image file: don't try to construct an image block
      const typeLabel = event.attachment.contentType || 'unknown type'
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
    if (resolvedAgentConfigId) headers['x-intera-agent-config-id'] = resolvedAgentConfigId

    response = await fetch(getInternalMessagesUrl(), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
  } catch (err) {
    console.error('[Bridge] Failed to call /api/messages:', err)
    await sendFailureNotice(chatId, config, 'engine_unreachable')
    await enqueueRetry(chatId, orgId, userId, event, String(err), resolvedAgentConfigId)
    await updateSessionState(chatId, 'idle')
    setTypingIndicator(chatId, false, config.botAccessToken, config.licenseId, p.region, p.authType, p.accountId).catch(() => {})
    return
  }

  // BUG-D: /api/messages never returns 202 — queued messages flow through SSE
  // with message_stop{reason:'queued'}. Dead branch removed.
  if (!response.ok || !response.body) {
    const responsePreview = await readResponsePreview(response)
    console.error('[Bridge] /api/messages returned', response.status, responsePreview ? { responsePreview } : undefined)
    await sendFailureNotice(chatId, config, 'engine_unreachable')
    await enqueueRetry(
      chatId,
      orgId,
      userId,
      event,
      `api_messages_${response.status}${responsePreview ? `: ${responsePreview}` : ''}`,
      resolvedAgentConfigId,
    )
    await updateSessionState(chatId, 'idle')
    setTypingIndicator(chatId, false, config.botAccessToken, config.licenseId, p.region, p.authType, p.accountId).catch(() => {})
    return
  }

  const livechatRenderer = new LiveChatRenderer(config.showSkillStatus, {
    failureMessages: config.failureMessages,
    transferTitle: config.transferTitle,
    transferMessage: config.transferMessage,
    transferFollowupLabel: config.transferFollowupLabel,
  })
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
  let sentActionFailureNotice = false
  let pendingHumanHandoff: { taskId?: string; queue?: string } | null = null
  try {
    for await (const sseEvent of parseSSEStream(response.body)) {
      if (sseEvent.type === 'form_request') {
        const discardedText = await flushTextBuffer(chatId)
        if (discardedText.trim()) {
          console.log('[Bridge] Discarded buffered preamble before card action:', {
            chatId,
            eventType: sseEvent.type,
          })
        }
      } else if (sseEvent.type === 'human_task_created') {
        const pendingText = await flushTextBuffer(chatId)
        await flushBufferedTextAsMessages(chatId, pendingText, config, p)
          .catch((err) => console.error('[Bridge] sendText before human handoff card failed:', err))
      }
      if (sseEvent.type === 'form_request' && typeof sseEvent.data === 'object' && sseEvent.data) {
        const note = formatAgentVisibleFormRequest(sseEvent.data as FormSnapshot)
        if (note) {
          await sendAgentNote(chatId, note, config.botAccessToken, config.licenseId, p.region, p.authType, p.accountId)
            .catch((err) => console.error('[Bridge] sendAgentNote(form_request) failed:', err))
        }
        await sendRenderableImagesFromText(
          chatId,
          collectFormRequestImageText(sseEvent.data, config),
          config,
          p,
        )
      }
      if (sseEvent.type === 'human_task_created' && typeof sseEvent.data === 'object' && sseEvent.data) {
        const payload = sseEvent.data as { taskId?: string; queue?: string }
        pendingHumanHandoff = {
          taskId: typeof payload.taskId === 'string' ? payload.taskId : undefined,
          queue: typeof payload.queue === 'string' ? payload.queue : undefined,
        }
      }
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
              await transferChatWithFallback(chatId, target, config, p)
              if (pendingHumanHandoff) {
                await confirmProcedureHumanHandoff(session.caseId, {
                  agentConfigId: session.agentConfigId,
                  taskId: pendingHumanHandoff.taskId,
                  queue: pendingHumanHandoff.queue,
                }).catch((err) => {
                  console.error('[Bridge] Failed to confirm ProcedureRun human handoff:', err)
                })
              }
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
          if (!sentActionFailureNotice) {
            sentActionFailureNotice = true
            await sendFailureNotice(chatId, config, 'action_failed')
          }
          if (action.type === 'transfer_chat') {
            await rotateSessionCase(chatId, generateCaseId()).catch((rotateErr) => {
              console.error('[Bridge] Failed to rotate session after transfer failure:', rotateErr)
            })
          }
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
      await enqueueRetry(chatId, orgId, userId, event, String(err), resolvedAgentConfigId)
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
