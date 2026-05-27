// apps/chat/lib/livechat/livechat-api.ts
// Wraps LiveChat Bot Agent REST API calls.
// Docs: https://developers.livechat.com/docs/messaging/agent-chat-api/

import type { WidgetPayload, CardSpec } from './types'

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
      'X-Region': 'fra',
    },
    body: JSON.stringify({ ...(body as Record<string, unknown>), license_id: licenseId }),
  })
  if (!res.ok) {
    const text = await res.text()
    const err = new Error(`LiveChat API ${action} failed (${res.status}): ${text}`) as Error & { code?: string }
    if (res.status === 401) err.code = 'TOKEN_EXPIRED'
    if (res.status === 429) err.code = 'RATE_LIMITED'
    throw err
  }
}

export async function sendTextMessage(
  chatId: string, text: string, botAccessToken: string, licenseId: string,
): Promise<void> {
  await lcPost('send_event', {
    chat_id: chatId,
    event: { type: 'message', text, visibility: 'all' },
  }, botAccessToken, licenseId)
}

export async function sendWidgetPayload(
  chatId: string, payload: WidgetPayload, botAccessToken: string, licenseId: string,
): Promise<void> {
  await lcPost('send_event', {
    chat_id: chatId,
    event: {
      type: 'custom',
      content: { type: 'intera_widget_payload', ...payload },
      visibility: 'all',
    },
  }, botAccessToken, licenseId)
}

export async function sendQuickReplies(
  chatId: string, text: string, options: Array<{ id: string; label: string }>,
  botAccessToken: string, licenseId: string,
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

export async function sendCard(
  chatId: string, card: CardSpec, botAccessToken: string, licenseId: string,
): Promise<void> {
  const buttons = card.buttons.slice(0, 10).map(b => {
    const base: Record<string, unknown> = { text: b.label, postback_id: b.id, user_ids: [] }
    if (b.type === 'url') return { ...base, type: 'url', value: b.url }
    if (b.type === 'webview') return { ...base, type: 'webview', value: b.url, webview_height: 'tall' }
    return { ...base, type: 'message' }
  })

  await lcPost('send_event', {
    chat_id: chatId,
    event: {
      type: 'rich_message',
      template_id: 'cards',
      elements: [{
        title: card.title,
        subtitle: card.subtitle,
        image: card.imageUrl ? { url: card.imageUrl } : undefined,
        buttons,
      }],
      visibility: 'all',
    },
  }, botAccessToken, licenseId)
}

export async function sendCarousel(
  chatId: string, cards: CardSpec[], botAccessToken: string, licenseId: string,
): Promise<void> {
  const elements = cards.slice(0, 10).map(c => ({
    title: c.title,
    subtitle: c.subtitle,
    image: c.imageUrl ? { url: c.imageUrl } : undefined,
    buttons: c.buttons.slice(0, 3).map(b => {
      const base: Record<string, unknown> = { text: b.label, postback_id: b.id, user_ids: [] }
      if (b.type === 'url') return { ...base, type: 'url', value: b.url }
      if (b.type === 'webview') return { ...base, type: 'webview', value: b.url, webview_height: 'tall' }
      return { ...base, type: 'message' }
    }),
  }))

  await lcPost('send_event', {
    chat_id: chatId,
    event: { type: 'rich_message', template_id: 'cards', elements, visibility: 'all' },
  }, botAccessToken, licenseId)
}

export async function sendImage(
  chatId: string, imageUrl: string, caption: string | undefined,
  botAccessToken: string, licenseId: string,
): Promise<void> {
  await lcPost('send_event', {
    chat_id: chatId,
    event: {
      type: 'file',
      url: imageUrl,
      ...(caption ? { alternative_text: caption } : {}),
      visibility: 'all',
    },
  }, botAccessToken, licenseId)
}

export async function sendSystemMessage(
  chatId: string, text: string, botAccessToken: string, licenseId: string,
): Promise<void> {
  await lcPost('send_event', {
    chat_id: chatId,
    event: { type: 'system_message', text, system_message_type: 'manual_message', visibility: 'all' },
  }, botAccessToken, licenseId)
}

export async function setTypingIndicator(
  chatId: string, isTyping: boolean, botAccessToken: string, licenseId: string,
): Promise<void> {
  await lcPost('send_typing_indicator', {
    chat_id: chatId,
    is_typing: isTyping,
    recipients: 'all',
  }, botAccessToken, licenseId)
}

export async function transferChat(
  chatId: string,
  target: { type: 'group'; ids: number[] } | { type: 'agent'; ids: string[] } | { type: 'queue' },
  botAccessToken: string,
  licenseId: string,
): Promise<void> {
  await lcPost('transfer_chat', { id: chatId, target }, botAccessToken, licenseId)
}

export async function updateChatProperties(
  chatId: string, props: Record<string, string>, botAccessToken: string, licenseId: string,
): Promise<void> {
  const properties: Record<string, Record<string, string>> = {}
  for (const [k, v] of Object.entries(props)) {
    properties[`intera.${k}`] = { value: v }
  }
  await lcPost('update_chat_properties', { id: chatId, properties }, botAccessToken, licenseId)
}
