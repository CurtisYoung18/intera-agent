import { describe, it, expect } from 'vitest'
import type { BridgeAction, CardSpec } from '../../types'

describe('BridgeAction type', () => {
  describe('CardSpec', () => {
    it('accepts valid card', () => {
      const card: CardSpec = {
        title: 'Order #123',
        subtitle: 'completed',
        imageUrl: 'https://img.example/1.png',
        buttons: [{ id: 'view', label: 'View Details', type: 'message' }],
      }
      expect(card.title).toBe('Order #123')
      expect(card.buttons).toHaveLength(1)
    })

    it('accepts card without image', () => {
      const card: CardSpec = {
        title: 'Simple',
        buttons: [{ id: 'ok', label: 'OK' }],
      }
      expect(card.imageUrl).toBeUndefined()
    })
  })

  describe('send_card action', () => {
    it('conforms to BridgeAction', () => {
      const action: BridgeAction = {
        type: 'send_card',
        card: { title: 'Test', buttons: [{ id: 'b1', label: 'Click' }] },
      }
      expect(action.type).toBe('send_card')
    })
  })

  describe('send_carousel action', () => {
    it('conforms to BridgeAction', () => {
      const action: BridgeAction = {
        type: 'send_carousel',
        cards: [{ title: 'C1', buttons: [] }, { title: 'C2', buttons: [] }],
      }
      expect(action.cards).toHaveLength(2)
    })
  })

  describe('send_image action', () => {
    it('conforms to BridgeAction', () => {
      const action: BridgeAction = { type: 'send_image', url: 'https://img.example/pic.png' }
      expect(action.url).toBe('https://img.example/pic.png')
    })
  })

  describe('send_system_message action', () => {
    it('conforms to BridgeAction', () => {
      const action: BridgeAction = { type: 'send_system_message', text: 'Notice' }
      expect(action.text).toBe('Notice')
    })
  })

  describe('set_typing action', () => {
    it('conforms to BridgeAction', () => {
      const action: BridgeAction = { type: 'set_typing', isTyping: true }
      expect(action.isTyping).toBe(true)
    })
  })
})
