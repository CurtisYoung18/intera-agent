import type { AssistantMessage, CaseStatus, Message, SSEEvent } from '@intera/shared/types'
import { escalationMessageFor, latestUserText } from './customer-messages'
import type { TraceWriter } from './trace'
import type { HumanHandoffNotePayload } from './human-handoff'

export interface PendingHumanTaskEscalation {
  taskId: string
  queue: string
  question: string
  handoffNote?: HumanHandoffNotePayload
}

export type HumanTaskHandoffResult = {
  messages: Message[]
  caseStatus: CaseStatus
  transition: 'waiting_human'
  currentStage: 'waiting_human'
  reason: 'human_task_created'
}

export interface HumanTaskHandoffHandlerDeps {
  traceWriter: TraceWriter
  getMessages: () => Message[]
  addMessage: (message: Message) => void
  createId?: () => string
  now?: () => Date
}

export class HumanTaskHandoffHandler {
  constructor(private readonly deps: HumanTaskHandoffHandlerDeps) {}

  async complete(
    pending: PendingHumanTaskEscalation,
    fullText: string,
    sendEvent: (event: SSEEvent) => void,
  ): Promise<HumanTaskHandoffResult> {
    const { taskId, queue, question, handoffNote } = pending

    if (!fullText.trim()) {
      const safeMessage = escalationMessageFor(latestUserText(this.deps.getMessages()))
      const fallbackMessage: AssistantMessage = {
        id: this.createId(),
        role: 'assistant',
        content: safeMessage,
        createdAt: this.deps.now?.() ?? new Date(),
        isStreaming: false,
      }
      this.deps.addMessage(fallbackMessage)
      sendEvent({
        type: 'text_delta',
        data: safeMessage,
        timestamp: this.timestamp(),
      })
    }

    sendEvent({
      type: 'human_task_created',
      data: { taskId, queue, question, status: 'pending', ...(handoffNote ?? {}) },
      timestamp: this.timestamp(),
    })
    await this.deps.traceWriter.writeEscalated('human_task_created', { taskId, queue })
    sendEvent({
      type: 'escalated',
      data: { reason: 'human_task_created', taskId, queue },
      timestamp: this.timestamp(),
    })
    sendEvent({
      type: 'message_stop',
      data: { reason: 'waiting_human', stage: 'waiting_human' },
      timestamp: this.timestamp(),
    })

    return {
      messages: this.deps.getMessages(),
      caseStatus: 'waiting_human',
      transition: 'waiting_human',
      currentStage: 'waiting_human',
      reason: 'human_task_created',
    }
  }

  private createId(): string {
    return this.deps.createId?.() ?? crypto.randomUUID()
  }

  private timestamp(): string {
    return (this.deps.now?.() ?? new Date()).toISOString()
  }
}
