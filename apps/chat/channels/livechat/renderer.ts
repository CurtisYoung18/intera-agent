// apps/chat/channels/livechat/renderer.ts
// S5 Phase 5b — LiveChat renderer implementing ChannelRenderer<BridgeAction>.
// Refactored from apps/chat/lib/livechat/event-translators.ts.
// Zero behavior change — module relocation + interface conformance only.

import type { ChannelRenderer, RenderContext } from '@intera/shared/channels/renderer'
import { CHANNEL_CAPS } from '@intera/shared/channels/channel'
import type { Channel } from '@intera/shared/channels/channel'
import type { SSEEvent } from '@intera/shared/types'
import type { BridgeAction, StatusTrackStep, FormField } from '@/lib/livechat/types'
import { renderSkillByHint } from './render-skill-by-hint'
import type { LivechatRenderHint } from '@intera/shared/channels/render-hints'

function skillLabel(name: string, displayVerb?: { text: string; icon: string }): string {
  // Prefer the displayVerb text from the skill definition (already i18n-friendly).
  if (displayVerb?.text) return displayVerb.text
  return name.replace(/_/g, ' ')
}

export class LiveChatRenderer implements ChannelRenderer<BridgeAction> {
  readonly channel: Channel = 'livechat'
  readonly capabilities = CHANNEL_CAPS.livechat

  constructor(private readonly showSkillStatus: boolean) {}

  /** Translate a single SSE event into BridgeAction(s). */
  render(event: SSEEvent, ctx: RenderContext): BridgeAction[] {
    return [this.translateEvent(event, ctx)]
  }

  private translateEvent(event: SSEEvent, ctx: RenderContext): BridgeAction {
    const { caseId } = ctx

    switch (event.type) {
      // ── tool_executing: { name, status: 'executing', displayVerb? } ──
      case 'tool_executing': {
        if (!this.showSkillStatus) return { type: 'noop' }
        const d = event.data as { name: string; status: string; displayVerb?: { text: string; icon: string } }
        const step: StatusTrackStep = {
          id: d.name,
          label: skillLabel(d.name, d.displayVerb),
          state: 'running',
        }
        return {
          type: 'send_widget_payload',
          payload: { kind: 'status_track', caseId, step },
        }
      }

      // ── skill_result: { name, status: 'completed', result, renderHints? } ──
      case 'skill_result': {
        const d = event.data as {
          name: string; status: string; result?: unknown
          renderHints?: Record<string, unknown>
        }
        const livechatHint = d.renderHints?.livechat as LivechatRenderHint | undefined

        // If renderHints.livechat is configured, use it for rich message rendering
        if (livechatHint && d.result !== undefined) {
          return renderSkillByHint(d.result, livechatHint)
        }

        // Fallback: status_track widget
        if (!this.showSkillStatus) return { type: 'noop' }
        const step: StatusTrackStep = {
          id: d.name,
          label: skillLabel(d.name),
          state: 'done',
        }
        return {
          type: 'send_widget_payload',
          payload: { kind: 'status_track', caseId, step },
        }
      }

      // ── interaction_proposed: { caseId, title, description, options, multiSelect } ──
      case 'interaction_proposed': {
        const d = event.data as {
          caseId?: string
          title?: string
          description?: string
          options?: Array<{ id: string; label: string; description?: string; inputType?: 'none' | 'text'; inputPlaceholder?: string }>
          multiSelect?: boolean
        }
        return {
          type: 'send_widget_payload',
          payload: {
            kind: 'propose_interaction',
            caseId: d.caseId ?? caseId,
            options: d.options ?? [],
          },
        }
      }

      // ── form_request: { caseId, title, description, fields } ──
      case 'form_request': {
        const d = event.data as {
          caseId?: string
          title?: string
          description?: string
          fields?: Array<{ id: string; type: string; label: string; required?: boolean; options?: string[]; placeholder?: string }>
        }
        return {
          type: 'send_widget_payload',
          payload: {
            kind: 'request_user_input',
            caseId: d.caseId ?? caseId,
            fields: (d.fields ?? []) as FormField[],
          },
        }
      }

      // ── clarification: { cases: Array<{ caseType, summary }> } ──
      case 'clarification': {
        const d = event.data as { cases?: Array<{ caseType: string; summary: string }> }
        if (!d.cases?.length) return { type: 'noop' }
        return {
          type: 'send_quick_replies',
          text: '请选择您的问题类型：',
          options: d.cases.map((c) => ({ id: c.caseType, label: c.summary })),
        }
      }

      // ── escalated: { stage, reason } ──
      case 'escalated': {
        return { type: 'transfer_chat', caseId }
      }

      // ── case_created: { caseId, caseType, displayName, icon } ──
      case 'case_created': {
        const d = event.data as { caseId?: string; caseType?: string; displayName?: string; icon?: string }
        return {
          type: 'update_chat_properties',
          props: {
            case_id: d.caseId ?? caseId,
            case_type: d.caseType ?? 'general',
            case_name: d.displayName ?? '',
          },
        }
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
      case 'human_task_created': {
        const d = event.data as { taskId?: string; question?: string } | undefined
        const msg = d?.question
          ? `Your case has been escalated to a specialist. Question: ${d.question}`
          : 'Your case has been escalated to a specialist. A human operator will respond shortly.'
        return { type: 'send_text', text: msg }
      }

      default:
        return { type: 'noop' }
    }
  }
}
