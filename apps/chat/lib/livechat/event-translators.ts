// apps/chat/lib/livechat/event-translators.ts
// Pure functions mapping Intera SSE event data → BridgeAction.
// SSE data shapes verified against loop.ts (2026-05-26).

import type { BridgeAction, StatusTrackStep, FormField } from './types'
import type { SSEEvent } from '@intera/shared/types'

function skillLabel(name: string, displayVerb?: { text: string; icon: string }): string {
  // Prefer the displayVerb text from the skill definition (already i18n-friendly).
  if (displayVerb?.text) return displayVerb.text
  return name.replace(/_/g, ' ')
}

/** Translate a single SSE event to a BridgeAction. */
export function translateSSEEvent(
  event: SSEEvent,
  opts: { showSkillStatus: boolean; caseId: string },
): BridgeAction {
  const { showSkillStatus, caseId } = opts

  switch (event.type) {
    // ── tool_executing: { name, status: 'executing', displayVerb? } ──
    case 'tool_executing': {
      if (!showSkillStatus) return { type: 'noop' }
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

    // ── skill_result: { name, status: 'completed', result } ──
    case 'skill_result': {
      if (!showSkillStatus) return { type: 'noop' }
      const d = event.data as { name: string; status: string; result?: unknown }
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

    default:
      return { type: 'noop' }
  }
}
