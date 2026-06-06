import { describe, it, expect } from 'vitest'
import type { LivechatRenderHint } from '@intera/shared/channels/render-hints'

describe('skill-render-hints-editor (logic tests)', () => {
  describe('card hint shape', () => {
    it('validates card hint fields', () => {
      const hint: LivechatRenderHint = {
        kind: 'card',
        titleField: '$.order.id',
        subtitleField: '$.order.status',
        imageUrlField: '$.order.thumbnailUrl',
        buttons: [{ id: 'view', postback: 'view_order', labelStatic: 'View', type: 'message' }],
      }
      expect(hint.kind).toBe('card')
      expect(hint.titleField).toBe('$.order.id')
      expect(hint.buttons).toHaveLength(1)
    })

    it('card hint is valid without subtitle/image/buttons', () => {
      const hint: LivechatRenderHint = { kind: 'card', titleField: '$.name' }
      expect(hint.subtitleField).toBeUndefined()
      expect(hint.imageUrlField).toBeUndefined()
      expect(hint.buttons).toBeUndefined()
    })
  })

  describe('carousel hint shape', () => {
    it('validates carousel hint fields', () => {
      const hint: LivechatRenderHint = {
        kind: 'carousel',
        itemsField: '$.results',
        idField: '$.id',
        itemTemplate: {
          titleField: '$.title',
          buttons: [{ id: 'open', postback: 'open_item', labelStatic: 'Open' }],
        },
      }
      expect(hint.kind).toBe('carousel')
      expect(hint.itemTemplate.titleField).toBe('$.title')
    })
  })

  describe('quick_replies hint shape', () => {
    it('validates quick_replies hint fields', () => {
      const hint: LivechatRenderHint = {
        kind: 'quick_replies',
        optionsField: '$.choices',
        optionIdField: '$.id',
        optionLabelField: '$.label',
        titleStatic: 'Pick one:',
      }
      expect(hint.kind).toBe('quick_replies')
      expect(hint.optionsField).toBe('$.choices')
      expect(hint.titleStatic).toBe('Pick one:')
    })
  })

  describe('plain hint shape', () => {
    it('validates plain hint is minimal', () => {
      const hint: LivechatRenderHint = { kind: 'plain' }
      expect(hint.kind).toBe('plain')
      expect(Object.keys(hint)).toHaveLength(1)
    })
  })

  describe('kind switching preserves data', () => {
    it('each kind is distinguishable', () => {
      const kinds = ['card', 'carousel', 'quick_replies', 'plain'] as const
      const hints: Record<string, LivechatRenderHint> = {
        card: { kind: 'card', titleField: '$.x' },
        carousel: { kind: 'carousel', itemsField: '$.x', itemTemplate: { titleField: '$.y' } },
        quick_replies: { kind: 'quick_replies', optionsField: '$.x' },
        plain: { kind: 'plain' },
      }
      for (const k of kinds) {
        expect(hints[k]!.kind).toBe(k)
      }
    })
  })

  describe('webview button type', () => {
    it('supports webview button in card hint', () => {
      const hint: LivechatRenderHint = {
        kind: 'card',
        titleField: '$.title',
        buttons: [{ id: 'web', postback: 'open', labelStatic: 'Open Page', type: 'webview', url: 'https://example.com' }],
      }
      expect(hint.buttons![0]!.type).toBe('webview')
      expect(hint.buttons![0]!.url).toBe('https://example.com')
    })
  })
})
