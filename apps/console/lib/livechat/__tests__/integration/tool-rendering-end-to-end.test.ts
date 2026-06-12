import { describe, it, expect } from 'vitest'
import { renderToolByHint } from '../../../../channels/livechat/render-tool-by-hint'
import type { LivechatRenderHint } from '@intera/shared/channels/render-hints'

describe('tool-rendering end-to-end', () => {
  describe('query_order_status → card', () => {
    const orderOutput = {
      order: {
        id: 'TX2026052712345678',
        status: 'completed',
        amount: '$49.99',
        thumbnailUrl: 'https://img.example/order-icon.png',
      },
    }

    const hint: LivechatRenderHint = {
      kind: 'card',
      titleField: '$.order.id',
      subtitleField: '$.order.status',
      imageUrlField: '$.order.thumbnailUrl',
      buttons: [
        { id: 'view', postback: 'view_order', labelStatic: 'View Order' },
        { id: 'contact', postback: 'contact_support', labelStatic: 'Contact Support' },
      ],
    }

    it('renders correct card from order output', () => {
      const actions = renderToolByHint(orderOutput, hint)
      expect(actions).toHaveLength(1)
      expect(actions[0]!.type).toBe('send_card')

      const card = (actions[0] as { card: { title: string; subtitle: string; imageUrl: string; buttons: Array<{ label: string }> } }).card
      expect(card.title).toBe('TX2026052712345678')
      expect(card.subtitle).toBe('completed')
      expect(card.imageUrl).toBe('https://img.example/order-icon.png')
      expect(card.buttons).toHaveLength(2)
      expect(card.buttons[0]!.label).toBe('View Order')
    })
  })

  describe('kb_hybrid_retrieve → carousel', () => {
    const kbOutput = {
      results: [
        { id: '1', title: 'How to reset password', snippet: 'Go to Settings > Security...', image: null },
        { id: '2', title: 'Deposit not received', snippet: 'Check your transaction history...', image: 'https://img.example/faq2.png' },
      ],
    }

    const hint: LivechatRenderHint = {
      kind: 'carousel',
      itemsField: '$.results',
      idField: '$.id',
      itemTemplate: {
        titleField: '$.title',
        subtitleField: '$.snippet',
        imageUrlField: '$.image',
        buttons: [{ id: 'open', postback: 'open_kb', labelStatic: 'Read More' }],
      },
    }

    it('renders carousel from KB results', () => {
      const actions = renderToolByHint(kbOutput, hint)
      expect(actions).toHaveLength(1)
      expect(actions[0]!.type).toBe('send_carousel')

      const cards = (actions[0] as { cards: Array<{ title: string; imageUrl: string }> }).cards
      expect(cards).toHaveLength(2)
      expect(cards[0]!.title).toBe('How to reset password')
      expect(cards[0]!.imageUrl).toBe('')
      expect(cards[1]!.title).toBe('Deposit not received')
      expect(cards[1]!.imageUrl).toBe('https://img.example/faq2.png')
    })
  })

  describe('kb_search production output → carousel', () => {
    const kbOutput = {
      success: true,
      list: [
        { document_name: 'Deposit FAQ', data_id: 'doc-1', content: 'Deposit evidence', score: 0.92 },
        { document_name: 'Promotion Rules', data_id: 'doc-2', content: 'Turnover requirement details', score: 0.81 },
      ],
    }

    const hint: LivechatRenderHint = {
      kind: 'carousel',
      itemsField: '$.list',
      idField: '$.data_id',
      itemTemplate: {
        titleField: '$.document_name',
        subtitleField: '$.content',
        buttons: [{ id: 'open', postback: 'open_kb', labelStatic: 'Read More' }],
      },
    }

    it('renders production kb_search hits with stable card titles and ids', () => {
      const actions = renderToolByHint(kbOutput, hint)
      expect(actions).toHaveLength(1)
      expect(actions[0]!.type).toBe('send_carousel')

      const cards = (actions[0] as { cards: Array<{ title: string; subtitle?: string; buttons: Array<{ id: string }> }> }).cards
      expect(cards).toHaveLength(2)
      expect(cards[0]!.title).toBe('Deposit FAQ')
      expect(cards[0]!.subtitle).toBe('Deposit evidence')
      expect(cards[0]!.buttons[0]!.id).toBe('open_kb:doc-1')
      expect(cards[1]!.title).toBe('Promotion Rules')
    })
  })

  describe('status_track fallback when no hint', () => {
    it('renderer uses status_track for tool_result without renderHints (tested in renderer.test.ts)', () => {
      // This is verified by renderer.test.ts tool_result case
      expect(true).toBe(true)
    })
  })

  describe('broken hint (missing titleField)', () => {
    it('returns (untitled) card instead of crashing', () => {
      const hint: LivechatRenderHint = { kind: 'card', titleField: '$.missing' }
      const actions = renderToolByHint({}, hint)
      expect(actions[0]!.type).toBe('send_card')
      expect((actions[0] as { card: { title: string } }).card.title).toBe('(untitled)')
    })
  })
})
