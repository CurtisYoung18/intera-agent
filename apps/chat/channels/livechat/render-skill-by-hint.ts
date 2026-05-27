// apps/chat/channels/livechat/render-skill-by-hint.ts
// Translates a skill result into LiveChat BridgeActions based on renderHints.livechat config.

import type { BridgeAction, CardSpec } from '@/lib/livechat/types'
import type { LivechatRenderHint } from '@intera/shared/channels/render-hints'

export function renderSkillByHint(
  output: unknown,
  hint: LivechatRenderHint,
): BridgeAction[] {
  switch (hint.kind) {
    case 'card': {
      const title = readPath(output, hint.titleField)
      const subtitle = hint.subtitleField ? readPath(output, hint.subtitleField) : undefined
      const imageUrl = hint.imageUrlField ? readPath(output, hint.imageUrlField) : undefined
      const buttons: CardSpec['buttons'] = (hint.buttons ?? []).map(b => ({
        id: b.postback,
        label: b.labelField ? readPath(output, b.labelField) : (b.labelStatic ?? b.id),
        type: b.type,
        url: b.url,
      }))
      return [{ type: 'send_card', card: { title: title || '(untitled)', subtitle, imageUrl, buttons } }]
    }

    case 'carousel': {
      const items = readPath(output, hint.itemsField) as unknown[]
      if (!Array.isArray(items) || items.length === 0) {
        return [{ type: 'send_text', text: '(no results)' }]
      }
      const tpl = hint.itemTemplate!
      const cards: CardSpec[] = items.slice(0, 10).map((item, i) => ({
        title: readPath(item, tpl.titleField) || `Item ${i + 1}`,
        subtitle: tpl.subtitleField ? readPath(item, tpl.subtitleField) : undefined,
        imageUrl: tpl.imageUrlField ? readPath(item, tpl.imageUrlField) : undefined,
        buttons: (tpl.buttons ?? []).map(b => ({
          id: `${b.postback}:${readPath(item, hint.idField ?? '$.id') || i}`,
          label: b.labelField ? readPath(item, b.labelField) : (b.labelStatic ?? b.id),
          type: b.type,
          url: b.url,
        })),
      }))
      return [{ type: 'send_carousel', cards }]
    }

    case 'quick_replies': {
      const options = readPath(output, hint.optionsField) as unknown[]
      if (!Array.isArray(options)) return [{ type: 'noop' }]
      return [{
        type: 'send_quick_replies',
        text: hint.titleStatic ?? 'Please select:',
        options: options.map((o) => ({
          id: String(readPath(o, hint.optionIdField ?? '$.id') || ''),
          label: String(readPath(o, hint.optionLabelField ?? '$.label') || ''),
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

function readPath(obj: unknown, path?: string): string {
  if (!path) return ''
  try {
    const cleaned = path.startsWith('$.') ? path.slice(2) : path
    return cleaned.split('.').reduce((acc, key) => {
      if (acc === undefined || acc === null) return ''
      return (acc as Record<string, unknown>)?.[key]
    }, obj) as string ?? ''
  } catch {
    return ''
  }
}
