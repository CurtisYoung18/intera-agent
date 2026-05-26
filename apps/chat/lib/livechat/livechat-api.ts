// apps/chat/lib/livechat/livechat-api.ts
// Wraps LiveChat Bot Agent REST API calls.
// Docs: https://developers.livechat.com/docs/messaging/agent-chat-api/

import type { WidgetPayload } from './types'

const LC_API_BASE = 'https://api.livechatinc.com/v3.5/agent/action'

async function lcPost(
  action: string,
  body: unknown,
  botAccessToken: string,
  licenseId: string,
): Promise<void> {
  const res = await fetch(`${LC_API_BASE}/${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${botAccessToken}`,
      'X-Region': 'fra',           // adjust if your LiveChat license is in a different region
    },
    body: JSON.stringify({ ...(body as Record<string, unknown>), license_id: licenseId }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`LiveChat API ${action} failed (${res.status}): ${text}`)
  }
}

/** Send a plain text message to a chat. */
export async function sendTextMessage(
  chatId: string,
  text: string,
  botAccessToken: string,
  licenseId: string,
): Promise<void> {
  await lcPost('send_event', {
    chat_id: chatId,
    event: {
      type: 'message',
      text,
      visibility: 'all',
    },
  }, botAccessToken, licenseId)
}

/** Send an intera_widget_payload custom event (triggers In-Chat App view switch). */
export async function sendWidgetPayload(
  chatId: string,
  payload: WidgetPayload,
  botAccessToken: string,
  licenseId: string,
): Promise<void> {
  await lcPost('send_event', {
    chat_id: chatId,
    event: {
      type: 'custom',
      content: {
        type: 'intera_widget_payload',
        ...payload,
      },
      visibility: 'all',
    },
  }, botAccessToken, licenseId)
}

/** Send a quick_replies rich message. */
export async function sendQuickReplies(
  chatId: string,
  text: string,
  options: Array<{ id: string; label: string }>,
  botAccessToken: string,
  licenseId: string,
): Promise<void> {
  await lcPost('send_event', {
    chat_id: chatId,
    event: {
      type: 'rich_message',
      template_id: 'quick_replies',
      elements: [{
        title: text,
        buttons: options.map(o => ({
          type: 'message',
          text: o.label,
          postback_id: o.id,
          user_ids: [],
        })),
      }],
      visibility: 'all',
    },
  }, botAccessToken, licenseId)
}

/** Transfer the chat to the first available agent queue. */
export async function transferChat(
  chatId: string,
  botAccessToken: string,
  licenseId: string,
): Promise<void> {
  await lcPost('transfer_chat', {
    id: chatId,
    target: { type: 'queue' },
  }, botAccessToken, licenseId)
}

/** Write key-value properties onto the chat (visible in agent dashboard). */
export async function updateChatProperties(
  chatId: string,
  props: Record<string, string>,
  botAccessToken: string,
  licenseId: string,
): Promise<void> {
  const properties: Record<string, Record<string, string>> = {}
  for (const [k, v] of Object.entries(props)) {
    properties[`intera.${k}`] = { value: v }
  }
  await lcPost('update_chat_properties', {
    id: chatId,
    properties,
  }, botAccessToken, licenseId)
}
