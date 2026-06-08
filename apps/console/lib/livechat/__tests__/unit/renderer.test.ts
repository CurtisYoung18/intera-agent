import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SSEEvent } from '@intera/shared/types'
import type { BridgeAction } from '../../types'
import { LiveChatRenderer } from '../../../../channels/livechat/renderer'
import type { RenderContext } from '@intera/shared/channels/renderer'
import type { ChannelBindingConfig } from '@intera/shared/channels/binding'

function makeCtx(overrides?: Partial<RenderContext>): RenderContext {
  return {
    caseId: 'case-1',
    orgId: 'cust-1',
    sessionId: 'chat-1',
    binding: { channel: 'livechat', enabled: true, credentials: {} } as ChannelBindingConfig,
    ...overrides,
  }
}

function makeEvent(type: SSEEvent['type'], data: unknown): SSEEvent {
  return { type, data, timestamp: new Date().toISOString() }
}

describe('LiveChatRenderer', () => {
  describe('text_delta', () => {
    it('returns buffer_text action', () => {
      const r = new LiveChatRenderer(true)
      const actions = r.render(makeEvent('text_delta', 'hello'), makeCtx())
      expect(actions).toHaveLength(1)
      expect(actions[0]!.type).toBe('buffer_text')
      expect((actions[0] as { type: 'buffer_text'; delta: string }).delta).toBe('hello')
    })
  })

  describe('message_stop', () => {
    it('returns flush_text action', () => {
      const r = new LiveChatRenderer(true)
      const actions = r.render(makeEvent('message_stop', {}), makeCtx())
      expect(actions[0]!.type).toBe('flush_text')
    })
  })

  describe('tool_executing', () => {
    it('returns noop (typing indicator provides animation)', () => {
      const r = new LiveChatRenderer(true)
      const actions = r.render(makeEvent('tool_executing', { name: 'query_order', status: 'executing' }), makeCtx())
      expect(actions[0]!.type).toBe('noop')
    })

    it('returns noop when showSkillStatus=false', () => {
      const r = new LiveChatRenderer(false)
      const actions = r.render(makeEvent('tool_executing', { name: 'query_order' }), makeCtx())
      expect(actions[0]!.type).toBe('noop')
    })
  })

  describe('tool_result', () => {
    it('returns send_text for done tool', () => {
      const r = new LiveChatRenderer(true)
      const actions = r.render(makeEvent('tool_result', { name: 'query_order', status: 'completed', result: {} }), makeCtx())
      const a = actions[0]!
      expect(a.type).toBe('send_text')
      expect((a as { type: 'send_text'; text: string }).text).toContain('query order')
    })

    it('returns send_card when renderHints.livechat has card hint', () => {
      const r = new LiveChatRenderer(true)
      const actions = r.render(makeEvent('tool_result', {
        name: 'query_order',
        status: 'completed',
        result: { order: { id: 'TX123', status: 'pending' } },
        renderHints: {
          livechat: {
            kind: 'card',
            titleField: '$.order.id',
            subtitleField: '$.order.status',
          },
        },
      }), makeCtx())
      expect(actions[0]!.type).toBe('send_card')
    })

    it('returns send_carousel when renderHints.livechat has carousel hint', () => {
      const r = new LiveChatRenderer(true)
      const actions = r.render(makeEvent('tool_result', {
        name: 'kb_search',
        status: 'completed',
        result: { results: [{ id: '1', title: 'Doc 1' }] },
        renderHints: {
          livechat: {
            kind: 'carousel',
            itemsField: '$.results',
            itemTemplate: { titleField: '$.title' },
          },
        },
      }), makeCtx())
      expect(actions[0]!.type).toBe('send_carousel')
    })

    it('falls back to send_text for unknown hint kind', () => {
      const r = new LiveChatRenderer(true)
      const actions = r.render(makeEvent('tool_result', {
        name: 'query_order',
        status: 'completed',
        result: { steps: [{ label: 'Order placed' }] },
        renderHints: {
          livechat: { kind: 'iframe', template: 'order_timeline' },
        },
      }), makeCtx())
      expect(actions[0]!.type).toBe('send_text')
    })

    it('returns noop for tool_result without renderHints when showSkillStatus=false', () => {
      const r = new LiveChatRenderer(false)
      const actions = r.render(makeEvent('tool_result', { name: 'x', status: 'completed', result: {} }), makeCtx())
      expect(actions[0]!.type).toBe('noop')
    })
  })

  describe('form_request', () => {
    it('returns send_card with webview button for Moments', () => {
      const r = new LiveChatRenderer(true)
      const actions = r.render(makeEvent('form_request', { fields: [{ id: 'name', type: 'text', label: 'Name' }] }), makeCtx())
      const a = actions[0]!
      expect(a.type).toBe('send_card')
      const card = (a as { type: 'send_card'; card: { title: string; buttons: Array<{ type: string; url: string }> } }).card
      expect(card.title).toBe('Information Required')
      expect(card.buttons[0]!.type).toBe('webview')
      expect(card.buttons[0]!.url).toContain('view=form')
    })
  })

  describe('escalated', () => {
    it('returns transfer_chat', () => {
      const r = new LiveChatRenderer(true)
      const actions = r.render(makeEvent('escalated', {}), makeCtx())
      expect(actions[0]!.type).toBe('transfer_chat')
    })
  })

  describe('case_created', () => {
    it('returns update_chat_properties', () => {
      const r = new LiveChatRenderer(true)
      const actions = r.render(makeEvent('case_created', { caseId: 'c1', caseType: 'deposit' }), makeCtx())
      const a = actions[0]!
      expect(a.type).toBe('update_chat_properties')
      expect((a as { props: Record<string, string> }).props).toMatchObject({ case_id: 'c1' })
    })
  })

  describe('human_task_created', () => {
    it('returns noop — agent tells customer in its own words', () => {
      const r = new LiveChatRenderer(true)
      const actions = r.render(makeEvent('human_task_created', {}), makeCtx())
      expect(actions[0]!.type).toBe('noop')
    })
  })

  describe('unknown event', () => {
    it('returns noop for unrecognized event type', () => {
      const r = new LiveChatRenderer(true)
      const actions = r.render(makeEvent('unknown_type' as SSEEvent['type'], { x: 1 }), makeCtx())
      expect(actions[0]!.type).toBe('noop')
    })
  })

  describe('error event', () => {
    it('returns send_text with retry message', () => {
      const r = new LiveChatRenderer(true)
      const actions = r.render(makeEvent('error', { message: 'LLM API error' }), makeCtx())
      const a = actions[0]!
      expect(a.type).toBe('send_text')
      expect((a as { text: string }).text).toContain('temporarily unavailable')
    })
  })
})
