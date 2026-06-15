import type { ContentBlock } from '@intera/shared/types'

export type RuntimeEventOrigin = 'customer' | 'operator' | 'system' | 'human'
export type RuntimeEventSource =
  | 'customer_message'
  | 'customer_form_result'
  | 'human_task_result'
  | 'tool_call'
  | 'tool_result'
  | 'text_reply'
  | 'evaluator'
  | 'hook_decision'
  | 'reconcile'
  | 'remember'
  | 'control'

export interface RuntimeEvent {
  eventId: string
  inputEpoch: number
  origin: RuntimeEventOrigin
  source: RuntimeEventSource
  createdAt: string
  enqueuedAt: string
  caseId: string
  sessionId: string
  runId?: string
  content?: string
  contentBlocks?: ContentBlock[]
  formAnswers?: Record<string, string>
  isMeta?: boolean
  isControl?: boolean
  priority: number
  enqueuePolicy: 'fifo' | 'front' | 'replace'
  basedOnInputEpoch?: number
  summary?: string
  metadata?: Record<string, unknown>
}

export interface QueuedMessage extends RuntimeEvent {
  content: string
}

export type QueuedMessageInput = {
  content: string
  contentBlocks?: ContentBlock[]
  formAnswers?: Record<string, string>
  origin?: RuntimeEventOrigin
  source?: RuntimeEventSource
  runId?: string
  isMeta?: boolean
  isControl?: boolean
  priority?: number
  enqueuePolicy?: 'fifo' | 'front' | 'replace'
  basedOnInputEpoch?: number
  summary?: string
  metadata?: Record<string, unknown>
}
