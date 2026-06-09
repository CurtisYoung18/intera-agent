// apps/chat/channels/livechat/render-tool-by-hint.ts
// Translates a tool result into LiveChat BridgeActions based on renderHints.livechat config.

import type { BridgeAction, CardSpec } from '@/lib/livechat/types'
import type { LivechatRenderHint } from '@intera/shared/channels/render-hints'

function parseIfString(v: unknown): unknown {
  if (typeof v === 'string') {
    try { return JSON.parse(v) } catch { return v }
  }
  return v
}

export function renderToolByHint(
  output: unknown,
  hint: LivechatRenderHint,
): BridgeAction[] {
  const data = parseIfString(output)
  switch (hint.kind) {
    case 'card': {
      const title = String(readPath(data, hint.titleField) ?? '')
      const subtitle = hint.subtitleField ? String(readPath(data, hint.subtitleField) ?? '') : undefined
      const imageUrl = hint.imageUrlField ? String(readPath(data, hint.imageUrlField) ?? '') : undefined
      const buttons: CardSpec['buttons'] = (hint.buttons ?? []).map(b => ({
        id: b.postback,
        label: String(b.labelField ? (readPath(data, b.labelField) ?? '') : (b.labelStatic ?? b.id)),
        type: b.type as 'message' | 'url' | 'webview' | undefined,
        url: b.url,
      }))
      return [{ type: 'send_card', card: { title: title || '(untitled)', subtitle: subtitle || undefined, imageUrl: imageUrl || undefined, buttons } }]
    }

    case 'carousel': {
      const items = readPath(data, hint.itemsField)
      if (!Array.isArray(items) || items.length === 0) {
        // Empty result → render nothing. The agent's own text reply already
        // tells the customer there are no results; a literal "(no results)"
        // card on top is redundant + jarring (and untranslated).
        return [{ type: 'noop' }]
      }
      const tpl = hint.itemTemplate!
      const cards: CardSpec[] = (items as unknown[]).slice(0, 10).map((item, i) => ({
        title: String(readPath(item, tpl.titleField) ?? `Item ${i + 1}`),
        subtitle: tpl.subtitleField ? String(readPath(item, tpl.subtitleField) ?? '') : undefined,
        imageUrl: tpl.imageUrlField ? String(readPath(item, tpl.imageUrlField) ?? '') : undefined,
        buttons: (tpl.buttons ?? []).map(b => ({
          id: `${b.postback}:${String(readPath(item, hint.idField ?? '$.id') ?? i)}`,
          label: String(b.labelField ? (readPath(item, b.labelField) ?? '') : (b.labelStatic ?? b.id)),
          type: b.type as 'message' | 'url' | 'webview' | undefined,
          url: b.url,
        })),
      }))
      return [{ type: 'send_carousel', cards }]
    }

    case 'quick_replies': {
      const options = readPath(data, hint.optionsField)
      if (!Array.isArray(options)) return [{ type: 'noop' }]
      return [{
        type: 'send_quick_replies',
        text: hint.titleStatic ?? 'Please select:',
        options: (options as unknown[]).map((o) => ({
          id: String(readPath(o, hint.optionIdField ?? '$.id') ?? ''),
          label: String(readPath(o, hint.optionLabelField ?? '$.label') ?? ''),
        })),
      }]
    }

    case 'plain': {
      const text = typeof output === 'string' ? output : JSON.stringify(output, null, 2)
      return [{ type: 'send_text', text }]
    }

    default:
      return [{ type: 'noop' }]
  }
}

export function readPath(obj: unknown, path?: string): unknown {
  if (!path) return undefined
  try {
    const cleaned = path.startsWith('$.') ? path.slice(2) : path
    return cleaned.split('.').reduce<unknown>((acc, key) => {
      if (acc === undefined || acc === null) return undefined
      return (acc as Record<string, unknown>)?.[key]
    }, obj)
  } catch {
    return undefined
  }
}
