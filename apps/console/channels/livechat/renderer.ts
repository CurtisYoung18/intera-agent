// apps/chat/channels/livechat/renderer.ts
// S5 Phase 5b — LiveChat renderer implementing ChannelRenderer<BridgeAction>.
// Refactored from apps/chat/lib/livechat/event-translators.ts.
// Zero behavior change — module relocation + interface conformance only.

import type { ChannelRenderer, RenderContext } from '@intera/shared/channels/renderer'
import { CHANNEL_CAPS } from '@intera/shared/channels/channel'
import type { Channel } from '@intera/shared/channels/channel'
import type { SSEEvent } from '@intera/shared/types'
import type { BridgeAction, FormField } from '@/lib/livechat/types'
import { detectWidgetLocale, getWidgetCopy } from '@/lib/livechat/form-widget'

function summarizeHandoffFocus(question: string | undefined, locale: 'zh' | 'en'): string | undefined {
  const trimmed = question?.trim()
  if (!trimmed) return undefined

  const patterns = locale === 'zh'
    ? [/客户最新消息:\s*(.+)/i, /已知事实:\s*(.+)/i]
    : [/Latest customer message:\s*(.+)/i, /Known facts:\s*(.+)/i]

  for (const pattern of patterns) {
    const match = trimmed.match(pattern)
    const snippet = match?.[1]?.trim()
    if (snippet) return snippet.slice(0, 90)
  }

  const firstLine = trimmed
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
  return firstLine ? firstLine.slice(0, 90) : undefined
}

function getHandoffCopy(locale: 'zh' | 'en', focus?: string) {
  if (locale === 'zh') {
    return {
      title: '已转交人工客服',
      subtitle: focus
        ? `已记录问题: ${focus}\n人工专员会继续跟进。若需补充订单号、金额、时间或截图，请直接继续发送到当前对话。`
        : '人工专员会继续跟进。若需补充订单号、金额、时间或截图，请直接继续发送到当前对话。',
      followupLabel: '补充订单号或截图',
    }
  }

  return {
    title: 'Human support is taking over',
    subtitle: focus
      ? `We noted: ${focus}\nA specialist will continue from here. If you want to add the amount, time, order ID, or screenshots, send them directly in this chat.`
      : 'A specialist will continue from here. If you want to add the amount, time, order ID, or screenshots, send them directly in this chat.',
    followupLabel: 'Add order ID or screenshots',
  }
}

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
          toolCallId?: string
          title?: string
          description?: string
          fields?: Array<{ id: string; type: string; label: string; required?: boolean; options?: string[]; placeholder?: string }>
        }
        const formCaseId = d.caseId ?? caseId
        const fields = d.fields ?? []
        const locale = detectWidgetLocale({
          title: d.title,
          description: d.description,
          fields: fields.map((field) => ({
            label: typeof field.label === 'string' ? field.label : '',
            placeholder: typeof field.placeholder === 'string' ? field.placeholder : undefined,
          })),
        })
        const copy = getWidgetCopy(locale)
        const baseUrl = process.env.LIVECHAT_WIDGET_URL ?? 'https://demo.anytrans.ai/livechat-widget'
        const params = new URLSearchParams({
          view: 'form',
          caseId: formCaseId,
          // chatId lets the form webview deliver answers via /api/livechat/form-submit
          // (SDK-independent path — see BUG-F fix).
          chatId: ctx.sessionId,
          ...(typeof d.toolCallId === 'string' && d.toolCallId.trim()
            ? { toolCallId: d.toolCallId.trim() }
            : {}),
          title: d.title ?? copy.fallbackTitle,
          description: d.description ?? copy.fallbackDescription,
          fields: JSON.stringify(fields),
        })
        return {
          type: 'send_card',
          card: {
            title: d.title ?? copy.fallbackTitle,
            subtitle: d.description ?? copy.fallbackDescription,
            buttons: [{
              id: 'open_form',
              label: copy.openForm,
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
        const data = (event.data && typeof event.data === 'object')
          ? event.data as { reason?: string; transition?: string }
          : undefined
        if (data?.transition === 'waiting_form') {
          return { type: 'noop' }
        }
        if (data?.reason === 'next_turn') {
          return { type: 'noop' }
        }
        return { type: 'flush_text' }
      }

      // ── human_task_created: { taskId, caseId, question? } ──
      // Show a compact handoff confirmation card before the actual transfer.
      case 'human_task_created': {
        const d = event.data as { question?: string; queue?: string } | undefined
        const locale = detectWidgetLocale({
          title: d?.question,
          description: d?.queue,
        })
        const copy = getHandoffCopy(locale, summarizeHandoffFocus(d?.question, locale))
        return {
          type: 'send_card',
          card: {
            title: copy.title,
            subtitle: copy.subtitle,
            buttons: [{
              id: 'handoff_followup',
              label: copy.followupLabel,
              type: 'message',
            }],
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
