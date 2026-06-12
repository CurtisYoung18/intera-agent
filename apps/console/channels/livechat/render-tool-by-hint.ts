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

function readRecordValue(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined
  return (obj as Record<string, unknown>)[key]
}

function firstPresentValue(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null && value !== '')
}

function firstPresentRecordValue(obj: unknown, keys: string[]): unknown {
  return firstPresentValue(...keys.map((key) => readRecordValue(obj, key)))
}

function looksLikeKnowledgeHit(item: unknown): boolean {
  return firstPresentRecordValue(item, [
    'document_name',
    'documentName',
    'data_id',
    'dataId',
    'content',
    'score',
    'title',
    'snippet',
  ]) !== undefined
}

function readKnowledgeAwareValue(
  item: unknown,
  primaryPath: string | undefined,
  fallbacks: string[],
): unknown {
  const primary = primaryPath ? readPath(item, primaryPath) : undefined
  if (primary !== undefined && primary !== null && primary !== '') return primary
  if (!looksLikeKnowledgeHit(item)) return primary
  return firstPresentRecordValue(item, fallbacks)
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
        title: String(readKnowledgeAwareValue(item, tpl.titleField, ['document_name', 'documentName', 'title']) ?? `Item ${i + 1}`),
        subtitle: (() => {
          if (!tpl.subtitleField) return undefined
          const subtitle = readKnowledgeAwareValue(item, tpl.subtitleField, ['content', 'snippet'])
          if (subtitle !== undefined && subtitle !== null && subtitle !== '') return String(subtitle)
          const score = readRecordValue(item, 'score')
          return typeof score === 'number' ? `Score: ${score.toFixed(2)}` : ''
        })(),
        imageUrl: tpl.imageUrlField ? String(readPath(item, tpl.imageUrlField) ?? '') : undefined,
        buttons: (tpl.buttons ?? []).map(b => ({
          id: `${b.postback}:${String(readKnowledgeAwareValue(item, hint.idField ?? '$.id', ['data_id', 'dataId', 'id']) ?? i)}`,
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
