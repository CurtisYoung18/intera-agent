'use client'

import {
  Bot,
  Cpu,
  GitBranch,
  Radio,
  Scale,
  ScrollText,
  Sparkles,
  Timer,
  User,
  Wrench,
  type LucideIcon,
} from 'lucide-react'

export interface AccentColors {
  stroke: string
  fill: string
  icon: LucideIcon
}

export const ACCENTS: Record<string, AccentColors> = {
  user_message: { stroke: '#5b8af7', fill: 'rgba(91, 138, 247, 0.08)', icon: User },
  case_created: { stroke: '#a09888', fill: 'rgba(160, 152, 136, 0.08)', icon: ScrollText },
  fact_extracted: { stroke: '#d4912e', fill: 'rgba(212, 145, 46, 0.10)', icon: Sparkles },
  hook_hit: { stroke: '#e64539', fill: 'rgba(230, 69, 57, 0.08)', icon: Scale },
  tool_call: { stroke: '#d4912e', fill: 'rgba(212, 145, 46, 0.10)', icon: Wrench },
  tool_result: { stroke: '#2ea04a', fill: 'rgba(46, 160, 74, 0.08)', icon: Cpu },
  form_request: { stroke: '#5b8af7', fill: 'rgba(91, 138, 247, 0.08)', icon: ScrollText },
  form_submit: { stroke: '#2ea04a', fill: 'rgba(46, 160, 74, 0.08)', icon: ScrollText },
  channel_rich_message: { stroke: '#8b6ff5', fill: 'rgba(139, 111, 245, 0.07)', icon: Radio },
  human_task_created: { stroke: '#d4912e', fill: 'rgba(212, 145, 46, 0.12)', icon: Timer },
  human_task_resolved: { stroke: '#2ea04a', fill: 'rgba(46, 160, 74, 0.10)', icon: Timer },
  final_resolution: { stroke: '#2ea04a', fill: 'rgba(46, 160, 74, 0.10)', icon: ScrollText },
  loop_decision: { stroke: '#6b6758', fill: 'rgba(107, 103, 88, 0.06)', icon: GitBranch },
  stream_event: { stroke: '#8b6ff5', fill: 'rgba(139, 111, 245, 0.07)', icon: Radio },
  llm_request_start: { stroke: '#5b8af7', fill: 'rgba(91, 138, 247, 0.09)', icon: Cpu },
  llm_response: { stroke: '#5b8af7', fill: 'rgba(91, 138, 247, 0.10)', icon: Bot },
}

export function statusColor(status: string): string {
  const mapping: Record<string, string> = {
    ok: '#2ea04a',
    success: '#2ea04a',
    tool_result: '#2ea04a',
    resolved: '#2ea04a',
    block: '#e64539',
    error: '#e64539',
    fail: '#e64539',
    hook_hit: '#e64539',
    escalated: '#e64539',
    warn: '#d4912e',
    tool_call: '#d4912e',
    human_task: '#d4912e',
    waiting_human: '#d4912e',
    in_progress: '#d4912e',
    info: '#5b8af7',
    llm: '#5b8af7',
  }
  return mapping[status] || '#a09888'
}

export function StatusDot({ status, size = 8 }: { status: string; size?: number }) {
  const color = statusColor(status)
  return (
    <span style={{
      display: 'inline-block',
      width: size,
      height: size,
      borderRadius: '50%',
      background: color,
      flexShrink: 0,
    }} />
  )
}
