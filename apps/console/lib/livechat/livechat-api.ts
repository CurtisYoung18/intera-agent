// apps/chat/lib/livechat/livechat-api.ts
// Wraps LiveChat Agent Chat REST API calls.
// Docs: https://developers.livechat.com/docs/messaging/agent-chat-api/
//
// Supports both auth methods:
// - Bot Access Token  → Authorization: Bearer <token>
// - Personal Access Token (PAT) → Authorization: Basic base64(accountId:token)
// Auto-detected unless authType is explicitly set.

import type { WidgetPayload, CardSpec } from './types'

const LC_API_BASE = 'https://api.livechatinc.com/v3.5/agent/action'
const LC_CONFIG_BASE = 'https://api.livechatinc.com/v3.5/configuration/action'

function buildAuthHeader(token: string, authType?: string, accountId?: string): string {
  if (authType === 'basic' && accountId) {
    return `Basic ${Buffer.from(`${accountId}:${token}`).toString('base64')}`
  }
  if (authType === 'bearer') return `Bearer ${token}`
  // auto-detect: long base64-like strings are likely PAT Basic
  if (token.length > 60 && /^[A-Za-z0-9+/=]+$/.test(token)) return `Basic ${token}`
  return `Bearer ${token}`
}

async function lcPost(
  action: string,
  body: unknown,
  botAccessToken: string,
  licenseId: string,
  region: string = process.env.LIVECHAT_REGION ?? 'dal',
  authType?: string,
  accountId?: string,
): Promise<unknown> {
  const bodyObj: Record<string, unknown> = { ...(body as Record<string, unknown>), license_id: licenseId }

  // Auto-inject ignore_requester_presence for actions that require agent to be chat member
  if (action === 'send_event' || action === 'send_typing_indicator') {
    bodyObj.ignore_requester_presence = true
  }

  const res = await fetch(`${LC_API_BASE}/${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: buildAuthHeader(botAccessToken, authType, accountId),
      'X-Region': region,
    },
    body: JSON.stringify(bodyObj),
  })
  if (!res.ok) {
    const text = await res.text()
    const err = new Error(`LiveChat API ${action} failed (${res.status}): ${text}`) as Error & { code?: string }
    if (res.status === 401) err.code = 'TOKEN_EXPIRED'
    if (res.status === 403) err.code = 'NOT_IN_CHAT'
    if (res.status === 429) err.code = 'RATE_LIMITED'
    throw err
  }
  return res.json()
}

/** Configuration API call (different base URL from Agent Chat API). */
async function lcConfigPost(
  action: string,
  body: unknown,
  botAccessToken: string,
  licenseId: string,
  region: string = process.env.LIVECHAT_REGION ?? 'dal',
  authType?: string,
  accountId?: string,
): Promise<unknown> {
  const bodyObj: Record<string, unknown> = { ...(body as Record<string, unknown>), license_id: licenseId }

  const res = await fetch(`${LC_CONFIG_BASE}/${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: buildAuthHeader(botAccessToken, authType, accountId),
      'X-Region': region,
    },
    body: JSON.stringify(bodyObj),
  })
  if (!res.ok) {
    const text = await res.text()
    const err = new Error(`LiveChat Config API ${action} failed (${res.status}): ${text}`) as Error & { code?: string }
    if (res.status === 401) err.code = 'TOKEN_EXPIRED'
    if (res.status === 429) err.code = 'RATE_LIMITED'
    throw err
  }
  return res.json()
}

export async function sendTextMessage(
  chatId: string, text: string, botAccessToken: string, licenseId: string,
  region?: string, authType?: string, accountId?: string,
): Promise<void> {
  await lcPost('send_event', {
    chat_id: chatId,
    event: { type: 'message', text, visibility: 'all' },
  }, botAccessToken, licenseId, region, authType, accountId)
}

export async function sendWidgetPayload(
  chatId: string, payload: WidgetPayload, botAccessToken: string, licenseId: string,
  region?: string, authType?: string, accountId?: string,
): Promise<void> {
  await lcPost('send_event', {
    chat_id: chatId,
    event: {
      type: 'custom',
      content: { type: 'intera_widget_payload', ...payload },
      visibility: 'all',
    },
  }, botAccessToken, licenseId, region, authType, accountId)
}

export async function sendQuickReplies(
  chatId: string, text: string, options: Array<{ id: string; label: string }>,
  botAccessToken: string, licenseId: string,
  region?: string, authType?: string, accountId?: string,
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
  }, botAccessToken, licenseId, region, authType, accountId)
}

export async function sendCard(
  chatId: string, card: CardSpec, botAccessToken: string, licenseId: string,
  region?: string, authType?: string, accountId?: string,
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
  }, botAccessToken, licenseId, region, authType, accountId)
}

export async function sendCarousel(
  chatId: string, cards: CardSpec[], botAccessToken: string, licenseId: string,
  region?: string, authType?: string, accountId?: string,
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
  }, botAccessToken, licenseId, region, authType, accountId)
}

export async function sendImage(
  chatId: string, imageUrl: string, caption: string | undefined,
  botAccessToken: string, licenseId: string,
  region?: string, authType?: string, accountId?: string,
): Promise<void> {
  await lcPost('send_event', {
    chat_id: chatId,
    event: {
      type: 'file',
      url: imageUrl,
      ...(caption ? { alternative_text: caption } : {}),
      visibility: 'all',
    },
  }, botAccessToken, licenseId, region, authType, accountId)
}

export async function sendSystemMessage(
  chatId: string, text: string, botAccessToken: string, licenseId: string,
  region?: string, authType?: string, accountId?: string,
): Promise<void> {
  await lcPost('send_event', {
    chat_id: chatId,
    event: { type: 'system_message', text, system_message_type: 'manual_message', visibility: 'all' },
  }, botAccessToken, licenseId, region, authType, accountId)
}

export async function setTypingIndicator(
  chatId: string, isTyping: boolean, botAccessToken: string, licenseId: string,
  region?: string, authType?: string, accountId?: string,
): Promise<void> {
  await lcPost('send_typing_indicator', {
    chat_id: chatId,
    is_typing: isTyping,
    recipients: 'all',
  }, botAccessToken, licenseId, region, authType, accountId)
}

export async function transferChat(
  chatId: string,
  target: { type: 'group'; ids: number[] } | { type: 'agent'; ids: string[] } | { type: 'queue' },
  botAccessToken: string,
  licenseId: string,
  region?: string, authType?: string, accountId?: string,
): Promise<void> {
  await lcPost('transfer_chat', { id: chatId, target }, botAccessToken, licenseId, region, authType, accountId)
}

/** Deactivate (close) a chat. No further messages can be sent to this thread. */
export async function deactivateChat(
  chatId: string,
  botAccessToken: string,
  licenseId: string,
  region?: string, authType?: string, accountId?: string,
): Promise<void> {
  await lcPost('deactivate_chat', { id: chatId }, botAccessToken, licenseId, region, authType, accountId)
}

export async function listGroups(
  botAccessToken: string, licenseId: string,
  region?: string, authType?: string, accountId?: string,
): Promise<Array<{ id: number; name: string; agents_count: number }>> {
  const res = await lcConfigPost('list_groups', {}, botAccessToken, licenseId, region, authType, accountId)
  // LiveChat config API returns array directly, or { groups: [...] }
  if (Array.isArray(res)) return res as Array<{ id: number; name: string; agents_count: number }>
  return (res as { groups?: Array<{ id: number; name: string; agents_count: number }> }).groups ?? []
}

export async function updateChatProperties(
  chatId: string, props: Record<string, string>, botAccessToken: string, licenseId: string,
  region?: string, authType?: string, accountId?: string,
): Promise<void> {
  // LiveChat namespaced properties: { intera: { case_id: "xxx", ... } }
  const interaProps: Record<string, string> = {}
  for (const [k, v] of Object.entries(props)) {
    interaProps[k] = v
  }
  await lcPost('update_chat_properties', { id: chatId, properties: { intera: interaProps } }, botAccessToken, licenseId, region, authType, accountId)
}
