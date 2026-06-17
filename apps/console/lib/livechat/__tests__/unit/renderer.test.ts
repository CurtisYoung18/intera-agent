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
    it('returns flush_text action for a completed turn', () => {
      const r = new LiveChatRenderer(true)
      const actions = r.render(makeEvent('message_stop', { reason: 'end_turn' }), makeCtx())
      expect(actions[0]!.type).toBe('flush_text')
    })

    it('suppresses flush_text when the turn is waiting for a form submission', () => {
      const r = new LiveChatRenderer(true)
      const actions = r.render(makeEvent('message_stop', { transition: 'waiting_form' }), makeCtx())
      expect(actions[0]!.type).toBe('noop')
    })

    it('keeps buffered text while the loop is continuing to another tool turn', () => {
      const r = new LiveChatRenderer(true)
      const actions = r.render(makeEvent('message_stop', { reason: 'next_turn' }), makeCtx())
      expect(actions[0]!.type).toBe('noop')
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
    it('returns noop for done tool without explicit render hint', () => {
      const r = new LiveChatRenderer(true)
      const actions = r.render(makeEvent('tool_result', { name: 'query_order', status: 'completed', result: {} }), makeCtx())
      const a = actions[0]!
      expect(a.type).toBe('noop')
    })

    it('returns noop even when renderHints.livechat asks for a card', () => {
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
      expect(actions[0]!.type).toBe('noop')
    })

    it('returns noop even when renderHints.livechat asks for a carousel', () => {
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
      expect(actions[0]!.type).toBe('noop')
    })

    it('returns noop for unknown hint kind too', () => {
      const r = new LiveChatRenderer(true)
      const actions = r.render(makeEvent('tool_result', {
        name: 'query_order',
        status: 'completed',
        result: { steps: [{ label: 'Order placed' }] },
        renderHints: {
          livechat: { kind: 'iframe', template: 'order_timeline' },
        },
      }), makeCtx())
      expect(actions[0]!.type).toBe('noop')
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
      const actions = r.render(makeEvent('form_request', {
        title: 'Deposit details',
        description: 'Please fill in the requested details.',
        fields: [{ id: 'name', type: 'text', label: 'Name' }],
      }), makeCtx())
      const a = actions[0]!
      expect(a.type).toBe('send_card')
      const card = (a as { type: 'send_card'; card: { title: string; subtitle?: string; buttons: Array<{ label: string; type: string; url: string }> } }).card
      expect(card.title).toBe('Deposit details')
      expect(card.subtitle).toBe('Please fill in the requested details.')
      expect(card.buttons[0]!.label).toBe('Fill details')
      expect(card.buttons[0]!.type).toBe('webview')
      expect(card.buttons[0]!.url).toContain('view=form')
      expect(card.buttons[0]!.url).toContain('description=Please+fill+in+the+requested+details.')
    })

    it('localizes the button label when the form request is Chinese', () => {
      const r = new LiveChatRenderer(true)
      const actions = r.render(makeEvent('form_request', {
        title: '查询最近一次存款详情',
        description: '请提供您最近一次存款的具体信息，以便我们帮您查询。',
        fields: [{ key: 'amount', type: 'number', label: '存款金额' }],
      }), makeCtx())
      const a = actions[0]!
      expect(a.type).toBe('send_card')
      const card = (a as { type: 'send_card'; card: { buttons: Array<{ label: string }> } }).card
      expect(card.buttons[0]!.label).toBe('填写信息')
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
    it('returns noop because case identity lives in Intera state', () => {
      const r = new LiveChatRenderer(true)
      const actions = r.render(makeEvent('case_created', { caseId: 'c1', caseType: 'deposit' }), makeCtx())
      const a = actions[0]!
      expect(a.type).toBe('noop')
    })
  })

  describe('human_task_created', () => {
    it('returns a handoff confirmation card', () => {
      const r = new LiveChatRenderer(true)
      const actions = r.render(makeEvent('human_task_created', {
        question: '客户反馈存款未到账，需要人工跟进。',
      }), makeCtx())
      const a = actions[0]!
      expect(a.type).toBe('send_card')
      const card = (a as { type: 'send_card'; card: { title: string; subtitle?: string; buttons: Array<{ label: string; type?: string }> } }).card
      expect(card.title).toBe('已转交人工客服')
      expect(card.subtitle).toContain('存款未到账')
      expect(card.buttons).toEqual([
        expect.objectContaining({
          label: '补充订单号或截图',
          type: 'message',
        }),
      ])
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
