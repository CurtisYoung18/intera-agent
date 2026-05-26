// apps/chat/lib/livechat/event-translators.ts

import type { BridgeAction, StatusTrackStep, FormField } from './types'
import type { SSEEvent } from '@intera/shared/types'

// Skill name → human-readable label (extend as new skills are added)
const SKILL_LABELS: Record<string, string> = {
  kb_hybrid_retrieve:   '知识库检索',
  propose_interaction:  '生成选项',
  request_user_input:   '收集信息',
  create_human_task:    '转接人工',
  create_case:          '建立案例',
  finalize_case:        '完成案例',
  propose_cases:        '意图确认',
  ocr_receipt:          'OCR 识别',
}

function skillLabel(toolName: string): string {
  return SKILL_LABELS[toolName] ?? toolName.replace(/_/g, ' ')
}

/** Translate a single SSE event to a BridgeAction. */
export function translateSSEEvent(
  event: SSEEvent,
  opts: { showSkillStatus: boolean; caseId: string },
): BridgeAction {
  const { showSkillStatus, caseId } = opts

  switch (event.type) {
    case 'tool_executing': {
      if (!showSkillStatus) return { type: 'noop' }
      const toolName = (event.data as { toolName?: string })?.toolName ?? 'unknown'
      const step: StatusTrackStep = {
        id: toolName,
        label: skillLabel(toolName),
        state: 'running',
      }
      return {
        type: 'send_widget_payload',
        payload: { kind: 'status_track', caseId, step },
      }
    }

    case 'skill_result': {
      if (!showSkillStatus) return { type: 'noop' }
      const d = event.data as { toolName?: string; durationMs?: number }
      const step: StatusTrackStep = {
        id: d.toolName ?? 'unknown',
        label: skillLabel(d.toolName ?? 'unknown'),
        state: 'done',
        durationMs: d.durationMs,
      }
      return {
        type: 'send_widget_payload',
        payload: { kind: 'status_track', caseId, step },
      }
    }

    case 'interaction_proposed': {
      const d = event.data as { options?: Array<{ id: string; label: string; description?: string; inputType?: 'none' | 'text'; inputPlaceholder?: string }> }
      return {
        type: 'send_widget_payload',
        payload: {
          kind: 'propose_interaction',
          caseId,
          options: d.options ?? [],
        },
      }
    }

    case 'form_request': {
      const d = event.data as { fields?: Array<{ id: string; type: string; label: string; required?: boolean; options?: string[]; placeholder?: string }> }
      return {
        type: 'send_widget_payload',
        payload: {
          kind: 'request_user_input',
          caseId,
          fields: (d.fields ?? []) as FormField[],
        },
      }
    }

    case 'clarification': {
      const d = event.data as { options?: Array<{ id: string; label: string }> }
      if (!d.options?.length) return { type: 'noop' }
      return {
        type: 'send_quick_replies',
        text: '请选择您的问题类型：',
        options: d.options,
      }
    }

    case 'escalated': {
      return { type: 'transfer_chat', caseId }
    }

    case 'case_created': {
      const d = event.data as { caseId?: string; caseType?: string }
      return {
        type: 'update_chat_properties',
        props: {
          case_id: d.caseId ?? caseId,
          case_type: d.caseType ?? 'general',
        },
      }
    }

    case 'text_delta': {
      const d = event.data as { text?: string }
      return { type: 'buffer_text', delta: d.text ?? '' }
    }

    case 'message_stop': {
      return { type: 'flush_text' }
    }

    default:
      return { type: 'noop' }
  }
}
