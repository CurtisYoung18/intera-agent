// Customer-facing message constants + a tiny language detector.
//
// IMPORTANT: This is END-CUSTOMER copy, NOT the console operator i18n.
// Do NOT import the console `dictionaries.ts` here — that dictionary is the
// operator back-office i18n and must never leak into customer-facing output.
//
// The detector is intentionally minimal: we only branch between Chinese (zh)
// and English (en) for the escalation message. Anything containing a CJK
// character is treated as Chinese; everything else (including empty/null
// input) defaults to English.

export type CustomerLocale = 'zh' | 'en'

/**
 * Returns 'zh' if `text` contains any CJK (Han) character, else 'en'.
 * Null / undefined / empty input → 'en'.
 */
export function detectCustomerLocale(text: string | undefined | null): CustomerLocale {
  if (!text) return 'en'
  return /[一-鿿]/.test(text) ? 'zh' : 'en'
}

/**
 * Customer-facing escalation-to-human message, per locale.
 * `zh` is the original verbatim Mandarin string; `en` is a faithful
 * English equivalent.
 */
export const ESCALATION_TO_HUMAN: { zh: string; en: string } = {
  zh: '非常抱歉，您的问题需要由人工专员协助处理。我们已为您创建工单，专员将尽快与您联系，感谢您的耐心等待。',
  en: "I'm sorry — your issue needs help from a human specialist. We've created a support ticket and a specialist will contact you as soon as possible. Thank you for your patience.",
}

/**
 * Convenience helper: pick the escalation message that matches the locale of
 * `text` (the latest customer utterance).
 */
export function escalationMessageFor(text: string | undefined | null): string {
  return ESCALATION_TO_HUMAN[detectCustomerLocale(text)]
}

// ---------------------------------------------------------------------------
// Latest-user-text extraction
// ---------------------------------------------------------------------------

/**
 * Minimal structural shape of a conversation message we need here. Kept local
 * (not importing the full `Message` union) so this customer-copy module stays
 * dependency-free. Customer content may be a plain string (`content`) or an
 * array of content blocks (`contentBlocks`) — we extract the text from either.
 */
interface MessageLike {
  role: string
  content?: unknown
  contentBlocks?: Array<{ type?: string; text?: string }> | null
}

/** Extract the plain text from a single message's content / contentBlocks. */
function messageText(msg: MessageLike): string {
  if (typeof msg.content === 'string' && msg.content.trim()) return msg.content
  // Fallback: some content may be an array of blocks (string content empty).
  const blocks = Array.isArray(msg.content)
    ? (msg.content as Array<{ type?: string; text?: string }>)
    : msg.contentBlocks
  if (Array.isArray(blocks)) {
    const text = blocks
      .filter((b) => b && (b.type === undefined || b.type === 'text') && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join(' ')
      .trim()
    if (text) return text
  }
  return ''
}

/**
 * Scan a conversation backwards and return the text of the most recent
 * `role === 'user'` message. Returns `''` if none found — `escalationMessageFor`
 * then defaults to English.
 */
export function latestUserText(messages: ReadonlyArray<MessageLike> | undefined | null): string {
  if (!messages) return ''
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg && msg.role === 'user') {
      const text = messageText(msg)
      if (text) return text
    }
  }
  return ''
}
