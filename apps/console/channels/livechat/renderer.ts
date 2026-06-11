// apps/chat/channels/livechat/renderer.ts
// S5 Phase 5b — LiveChat renderer implementing ChannelRenderer<BridgeAction>.
// Refactored from apps/chat/lib/livechat/event-translators.ts.
// Zero behavior change — module relocation + interface conformance only.

import type { ChannelRenderer, RenderContext } from '@intera/shared/channels/renderer'
import { CHANNEL_CAPS } from '@intera/shared/channels/channel'
import type { Channel } from '@intera/shared/channels/channel'
import type { SSEEvent } from '@intera/shared/types'
import type { BridgeAction, FormField } from '@/lib/livechat/types'

export class LiveChatRenderer implements ChannelRenderer<BridgeAction> {
  readonly channel: Channel = 'livechat'
  readonly capabilities = CHANNEL_CAPS.livechat

  constructor(private readonly showSkillStatus: boolean) {}

  /** Translate a single SSE event into BridgeAction(s). */
  render(event: SSEEvent, ctx: RenderContext): BridgeAction[] {
    const result = this.translateEvent(event, ctx)
    return Array.isArray(result) ? result : [result]
  }

  private translateEvent(event: SSEEvent, ctx: RenderContext): BridgeAction | BridgeAction[] {
    const { caseId } = ctx

    switch (event.type) {
      // ── tool_executing: { name, status: 'executing', displayVerb? } ──
      // Typing indicator provides the animation — no message sent.
      case 'tool_executing':
        return { type: 'noop' }

      // ── tool_result: { name, status: 'completed', result, renderHints? } ──
      case 'tool_result': {
        // Tool execution details stay out of the customer widget. The agent's
        // natural-language answer may summarize what matters, but raw tool
        // output and tool-shaped cards should never be shown to the customer.
        return { type: 'noop' }
      }

      // ── form_request: { caseId, title, description, fields } ──
      // Renders as a card with webview button → Moments iframe form.
      case 'form_request': {
        const d = event.data as {
          caseId?: string
          title?: string
          description?: string
          fields?: Array<{ id: string; type: string; label: string; required?: boolean; options?: string[]; placeholder?: string }>
        }
        const formCaseId = d.caseId ?? caseId
        const fields = d.fields ?? []
        const baseUrl = process.env.LIVECHAT_WIDGET_URL ?? 'https://demo.anytrans.ai/livechat-widget'
        const params = new URLSearchParams({
          view: 'form',
          caseId: formCaseId,
          // chatId lets the form webview deliver answers via /api/livechat/form-submit
          // (SDK-independent path — see BUG-F fix).
          chatId: ctx.sessionId,
          title: d.title ?? 'Please fill in the following',
          fields: JSON.stringify(fields),
        })
        return {
          type: 'send_card',
          card: {
            title: d.title ?? 'Information Required',
            subtitle: d.description ?? `${fields.length} field${fields.length !== 1 ? 's' : ''} to fill`,
            buttons: [{
              id: 'open_form',
              label: d.title ?? 'Fill Form',
              type: 'webview',
              url: `${baseUrl}?${params.toString()}`,
            }],
          },
        }
      }

      // ── escalated: { stage, reason } ──
      case 'escalated': {
        return { type: 'transfer_chat' }
      }

      // ── case_created: { caseId, caseType, displayName, icon } ──
      case 'case_created': {
        // The bridge/session store already persists case identity. Avoid relying on
        // ad hoc LiveChat custom properties unless the target namespace is
        // explicitly registered in the external app.
        return { type: 'noop' }
      }

      // ── text_delta: data is a raw string (not an object) ──
      case 'text_delta': {
        const text = typeof event.data === 'string' ? event.data : String(event.data ?? '')
        return { type: 'buffer_text', delta: text }
      }

      // ── message_stop: { reason, stage? } ──
      case 'message_stop': {
        return { type: 'flush_text' }
      }

      // ── human_task_created: { taskId, caseId, question? } ──
      // Show a compact handoff confirmation card before the actual transfer.
      case 'human_task_created': {
        return {
          type: 'send_card',
          card: {
            title: 'Human support requested',
            subtitle: 'A specialist will continue this conversation shortly.',
            buttons: [],
          },
        }
      }

      // ── error: { message?, reason? } ──
      // BUG-B: LLM errors during streaming must produce a user-visible message.
      case 'error': {
        const d = event.data as { message?: string; reason?: string } | undefined
        return { type: 'send_text', text: 'Service is temporarily unavailable. Please try again. If the issue persists, resend your message.' }
      }

      default:
        return { type: 'noop' }
    }
  }
}
