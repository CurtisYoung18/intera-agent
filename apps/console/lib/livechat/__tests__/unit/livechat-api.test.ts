import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MockLiveChatServer } from '../mocks/livechat-api-mock'
import {
  sendTextMessage, sendWidgetPayload, sendQuickReplies, sendCard, sendCarousel,
  sendImage, sendSystemMessage, setTypingIndicator, transferChat, updateChatProperties,
} from '../../livechat-api'

describe('livechat-api', () => {
  let server: MockLiveChatServer
  const token = 'test-token'
  const license = '12345'

  beforeEach(() => {
    server = new MockLiveChatServer()
    server.install()
  })

  describe('sendTextMessage', () => {
    it('sends correct payload', async () => {
      await sendTextMessage('chat1', 'hello', token, license)
      const call = server.calls[0]!
      expect(call.action).toBe('send_event')
      expect(call.body).toMatchObject({ chat_id: 'chat1', license_id: license })
      expect((call.body as Record<string, unknown>).event).toMatchObject({ type: 'message', text: 'hello', visibility: 'all' })
    })

    it('throws on 401 with TOKEN_EXPIRED code', async () => {
      server.shouldFail.set('send_event', { status: 401 })
      await expect(sendTextMessage('chat1', 'hi', token, license)).rejects.toThrow()
      try { await sendTextMessage('chat1', 'hi', token, license) } catch (e) {
        expect((e as { code?: string }).code).toBe('TOKEN_EXPIRED')
      }
    })
  })

  describe('sendWidgetPayload', () => {
    it('sends custom event with widget payload', async () => {
      await sendWidgetPayload('chat1', { kind: 'status_track', caseId: 'c1', step: { id: 's1', label: 'Step 1', state: 'running' } }, token, license)
      const call = server.calls[0]!
      expect(call.action).toBe('send_event')
      const evt = (call.body as Record<string, unknown>).event as Record<string, unknown>
      expect(evt.type).toBe('custom')
      expect((evt.content as Record<string, unknown>).type).toBe('intera_widget_payload')
    })
  })

  describe('sendQuickReplies', () => {
    it('sends quick_replies rich message', async () => {
      await sendQuickReplies('chat1', 'Choose:', [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], token, license)
      const call = server.calls[0]!
      const evt = (call.body as Record<string, unknown>).event as Record<string, unknown>
      expect(evt.type).toBe('rich_message')
      expect(evt.template_id).toBe('quick_replies')
      expect((evt.elements as Array<unknown>)[0]).toHaveProperty('title', 'Choose:')
    })
  })

  describe('sendCard', () => {
    it('sends single card with buttons', async () => {
      await sendCard('chat1', {
        title: 'Order #123',
        subtitle: 'completed',
        imageUrl: 'https://img.example/1.png',
        buttons: [{ id: 'view', label: 'View', type: 'message' }],
      }, token, license)
      const call = server.calls[0]!
      const evt = (call.body as Record<string, unknown>).event as Record<string, unknown>
      expect(evt.template_id).toBe('cards')
      const el = (evt.elements as Array<Record<string, unknown>>)[0]!
      expect(el.title).toBe('Order #123')
      expect(el.subtitle).toBe('completed')
      expect(el.image).toEqual({ url: 'https://img.example/1.png' })
    })

    it('handles webview button type', async () => {
      await sendCard('chat1', {
        title: 'Test',
        buttons: [{ id: 'web', label: 'Open', type: 'webview', url: 'https://example.com' }],
      }, token, license)
      const el = ((server.calls[0]!.body as Record<string, unknown>).event as Record<string, unknown>).elements as Array<Record<string, unknown>>
      const btn = (el[0]!.buttons as Array<Record<string, unknown>>)[0]!
      expect(btn.type).toBe('webview')
      expect(btn.webview_height).toBe('tall')
    })
  })

  describe('sendCarousel', () => {
    it('caps at 10 cards', async () => {
      const cards = Array.from({ length: 15 }, (_, i) => ({
        title: `Card ${i}`,
        buttons: [{ id: 'btn', label: 'OK' }],
      }))
      await sendCarousel('chat1', cards, token, license)
      const evt = (server.calls[0]!.body as Record<string, unknown>).event as Record<string, unknown>
      expect((evt.elements as Array<unknown>)).toHaveLength(10)
    })
  })

  describe('sendImage', () => {
    it('sends file event with url', async () => {
      await sendImage('chat1', 'https://img.example/pic.png', 'caption', token, license)
      const call = server.calls[0]!
      const evt = (call.body as Record<string, unknown>).event as Record<string, unknown>
      expect(evt.type).toBe('file')
      expect(evt.url).toBe('https://img.example/pic.png')
      expect(evt.alternative_text).toBe('caption')
    })
  })

  describe('sendSystemMessage', () => {
    it('sends system_message event', async () => {
      await sendSystemMessage('chat1', 'System notice', token, license)
      const evt = (server.calls[0]!.body as Record<string, unknown>).event as Record<string, unknown>
      expect(evt.type).toBe('system_message')
      expect(evt.text).toBe('System notice')
    })
  })

  describe('setTypingIndicator', () => {
    it('sends typing on', async () => {
      await setTypingIndicator('chat1', true, token, license)
      const call = server.calls[0]!
      expect(call.action).toBe('send_typing_indicator')
      expect(call.body).toMatchObject({ chat_id: 'chat1', is_typing: true })
    })

    it('sends typing off', async () => {
      await setTypingIndicator('chat1', false, token, license)
      expect(server.calls[0]!.body).toMatchObject({ is_typing: false })
    })
  })

  describe('transferChat', () => {
    it('transfers to queue by default', async () => {
      await transferChat('chat1', { type: 'queue' }, token, license)
      const call = server.calls[0]!
      expect(call.action).toBe('transfer_chat')
      expect(call.body).toMatchObject({ id: 'chat1', target: { type: 'queue' } })
    })

    it('transfers to specific group', async () => {
      await transferChat('chat1', { type: 'group', ids: [5] }, token, license)
      expect(server.calls[0]!.body).toMatchObject({ target: { type: 'group', ids: [5] } })
    })
  })

  describe('updateChatProperties', () => {
    it('prefixes keys with intera.', async () => {
      await updateChatProperties('chat1', { case_id: 'c1' }, token, license)
      const props = (server.calls[0]!.body as Record<string, unknown>).properties as Record<string, unknown>
      expect(props).toHaveProperty('intera.case_id')
    })
  })
})
