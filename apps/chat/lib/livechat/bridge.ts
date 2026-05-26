// apps/chat/lib/livechat/bridge.ts
// Orchestrates: LiveChat webhook → /api/messages SSE → LiveChat API calls.

import type { LiveChatConfig, BridgeSession, IntereaInteractionSubmit, InteraFormSubmit } from './types'
import { getSession, upsertSession, updateSessionState, appendTextBuffer, flushTextBuffer } from './session-store'
import { translateSSEEvent } from './event-translators'
import {
  sendTextMessage,
  sendWidgetPayload,
  sendQuickReplies,
  transferChat,
  updateChatProperties,
} from './livechat-api'
import { generateCaseId } from '@/lib/utils'
import type { SSEEvent } from '@intera/shared/types'

function getInternalMessagesUrl(): string {
  // In Railway, apps/chat calls its own API directly (same process).
  // Use localhost to avoid going through the public URL.
  const base = process.env.INTERNAL_CHAT_API_URL ?? 'http://localhost:3000'
  return `${base}/api/messages`
}

/** Parse an SSE stream body into individual SSEEvent objects. */
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
          } catch (_e) { /* skip malformed lines */ }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/** Build the /api/messages POST body based on the incoming event type. */
function buildMessagesBody(
  event: { type: 'message' | 'form_submit' | 'interaction_submit'; text?: string; form?: InteraFormSubmit; interaction?: IntereaInteractionSubmit },
  session: BridgeSession,
): Record<string, unknown> {
  const base = {
    customerId: session.customerId,
    userId: session.userId,
    chatId: session.chatId,
  }

  if (event.type === 'form_submit' && event.form) {
    return { ...base, formResult: { caseId: session.caseId, answers: event.form.answers } }
  }

  if (event.type === 'interaction_submit' && event.interaction) {
    return {
      ...base,
      interactionResult: {
        caseId: session.caseId,
        optionId: event.interaction.optionId,
        input: event.interaction.input,
      },
    }
  }

  // Plain user message
  return { ...base, message: event.text ?? '' }
}

/** Main entry: handle an incoming LiveChat event for a given chat. */
export async function handleIncomingEvent(
  chatId: string,
  customerId: string,
  userId: string,
  event: { type: 'message' | 'form_submit' | 'interaction_submit'; text?: string; form?: InteraFormSubmit; interaction?: IntereaInteractionSubmit },
  config: LiveChatConfig,
): Promise<void> {
  // Load or create session
  let session = await getSession(chatId)
  if (!session) {
    session = {
      chatId,
      customerId,
      userId,
      caseId: generateCaseId(),
      state: 'idle',
      textBuffer: '',
    }
    await upsertSession(session)
  }

  // Update caseId from incoming event if form/interaction submit carries it
  if (event.type === 'form_submit' && event.form?.caseId) {
    session = { ...session, caseId: event.form.caseId }
    await upsertSession(session)
  }
  if (event.type === 'interaction_submit' && event.interaction?.caseId) {
    session = { ...session, caseId: event.interaction.caseId }
    await upsertSession(session)
  }

  await updateSessionState(chatId, 'thinking')

  const body = buildMessagesBody(event, session)

  let response: Response
  try {
    response = await fetch(getInternalMessagesUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    console.error('[Bridge] Failed to call /api/messages:', err)
    await updateSessionState(chatId, 'idle')
    return
  }

  if (!response.ok || !response.body) {
    console.error('[Bridge] /api/messages returned', response.status)
    await updateSessionState(chatId, 'idle')
    return
  }

  // Consume SSE stream
  for await (const sseEvent of parseSSEStream(response.body)) {
    const action = translateSSEEvent(sseEvent, {
      showSkillStatus: config.showSkillStatus,
      caseId: session.caseId,
    })

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

        case 'transfer_chat':
          await transferChat(chatId, config.botAccessToken, config.licenseId)
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
      console.error('[Bridge] action failed:', action.type, err)
    }
  }

  await updateSessionState(chatId, 'idle')
}
