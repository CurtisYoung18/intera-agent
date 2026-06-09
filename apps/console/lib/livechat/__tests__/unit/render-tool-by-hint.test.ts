import { describe, it, expect } from 'vitest'
import { renderToolByHint } from '../../../../channels/livechat/render-tool-by-hint'
import type { LivechatRenderHint } from '@intera/shared/channels/render-hints'

describe('renderToolByHint', () => {
  describe('card kind', () => {
    it('maps fields correctly', () => {
      const output = { order: { id: 'TX123', status: 'completed', thumbnailUrl: 'https://img.example/1.png' } }
      const hint: LivechatRenderHint = {
        kind: 'card',
        titleField: '$.order.id',
        subtitleField: '$.order.status',
        imageUrlField: '$.order.thumbnailUrl',
        buttons: [{ id: 'view', postback: 'view_order', labelStatic: 'View Order' }],
      }
      const actions = renderToolByHint(output, hint)
      expect(actions).toHaveLength(1)
      expect(actions[0]!.type).toBe('send_card')
      const card = (actions[0] as { card: { title: string; subtitle: string; imageUrl: string } }).card
      expect(card.title).toBe('TX123')
      expect(card.subtitle).toBe('completed')
      expect(card.imageUrl).toBe('https://img.example/1.png')
    })

    it('falls back to (untitled) when titleField missing', () => {
      const hint: LivechatRenderHint = { kind: 'card', titleField: '$.missing' }
      const actions = renderToolByHint({}, hint)
      expect((actions[0] as { card: { title: string } }).card.title).toBe('(untitled)')
    })
  })

  describe('carousel kind', () => {
    it('maps array to cards', () => {
      const output = { items: [{ title: 'A', desc: 'First' }, { title: 'B', desc: 'Second' }] }
      const hint: LivechatRenderHint = {
        kind: 'carousel',
        itemsField: '$.items',
        idField: '$.id',
        itemTemplate: {
          titleField: '$.title',
          subtitleField: '$.desc',
          buttons: [{ id: 'select', postback: 'select_item', labelField: '$.title' }],
        },
      }
      const actions = renderToolByHint(output, hint)
      expect(actions).toHaveLength(1)
      expect(actions[0]!.type).toBe('send_carousel')
      const cards = (actions[0] as { cards: Array<{ title: string }> }).cards
      expect(cards).toHaveLength(2)
      expect(cards[0]!.title).toBe('A')
      expect(cards[1]!.title).toBe('B')
    })

    it('renders nothing (noop) when array is empty — the agent reply covers it', () => {
      const hint: LivechatRenderHint = { kind: 'carousel', itemsField: '$.empty', itemTemplate: { titleField: '$.title' } }
      const actions = renderToolByHint({ empty: [] }, hint)
      expect(actions[0]!.type).toBe('noop')
    })
  })

  describe('quick_replies kind', () => {
    it('maps options array', () => {
      const output = { choices: [{ id: '1', label: 'Option 1' }, { id: '2', label: 'Option 2' }] }
      const hint: LivechatRenderHint = {
        kind: 'quick_replies',
        optionsField: '$.choices',
        optionIdField: '$.id',
        optionLabelField: '$.label',
        titleStatic: 'Pick one:',
      }
      const actions = renderToolByHint(output, hint)
      expect(actions[0]!.type).toBe('send_quick_replies')
      const qr = actions[0] as { text: string; options: Array<{ id: string; label: string }> }
      expect(qr.text).toBe('Pick one:')
      expect(qr.options).toHaveLength(2)
      expect(qr.options[0]!.label).toBe('Option 1')
    })
  })

  describe('plain kind', () => {
    it('returns text from string output', () => {
      const hint: LivechatRenderHint = { kind: 'plain' }
      const actions = renderToolByHint('simple result', hint)
      expect(actions[0]!.type).toBe('send_text')
      expect((actions[0] as { text: string }).text).toBe('simple result')
    })
  })

  describe('iframe kind', () => {
    it('returns noop since iframe is handled by renderer before renderToolByHint', () => {
      const hint: LivechatRenderHint = { kind: 'iframe', template: 'order_timeline' }
      const actions = renderToolByHint({ steps: [] }, hint)
      expect(actions[0]!.type).toBe('noop')
    })
  })

  describe('carousel with idField splicing', () => {
    it('splices item id into button postback', () => {
      const output = { results: [{ id: 'doc-1', title: 'Doc 1' }, { id: 'doc-2', title: 'Doc 2' }] }
      const hint: LivechatRenderHint = {
        kind: 'carousel',
        itemsField: '$.results',
        idField: '$.id',
        itemTemplate: {
          titleField: '$.title',
          buttons: [{ id: 'open', postback: 'open_doc', labelStatic: 'Open' }],
        },
      }
      const actions = renderToolByHint(output, hint)
      const cards = (actions[0] as { cards: Array<{ buttons: Array<{ id: string }> }> }).cards
      expect(cards[0]!.buttons[0]!.id).toBe('open_doc:doc-1')
      expect(cards[1]!.buttons[0]!.id).toBe('open_doc:doc-2')
    })
  })

  describe('card with labelField dynamic label', () => {
    it('resolves label from output via labelField', () => {
      const output = { item: { name: 'Dynamic Label' } }
      const hint: LivechatRenderHint = {
        kind: 'card',
        titleField: '$.item.name',
        buttons: [{ id: 'btn', postback: 'action', labelField: '$.item.name' }],
      }
      const actions = renderToolByHint(output, hint)
      const card = (actions[0] as { card: { buttons: Array<{ label: string }> } }).card
      expect(card.buttons[0]!.label).toBe('Dynamic Label')
    })
  })
})
