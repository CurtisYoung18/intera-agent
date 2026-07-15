import type { AgentConfigData, CaseStatus, Message, SSEEvent } from '@intera/shared/types'
import { escalationMessageForRuntime, latestUserText } from './customer-messages'
import type { TraceWriter } from './trace'
import type { HumanHandoffNotePayload } from './human-handoff'
import { ensureRuntimeCustomerReply } from './runtime-customer-reply'

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
  config: AgentConfigData
  traceWriter: TraceWriter
  getMessages: () => Message[]
  addMessage: (message: Message) => void
  createId?: () => string
  now?: () => Date
}

export interface RuntimeHandoffReceiptInput {
  customerVisibleText: string
  config: AgentConfigData
  messages: Message[]
  addMessage: (message: Message) => void
  sendEvent: (event: SSEEvent) => void
  createId?: () => string
  now?: () => Date
}

export function ensureRuntimeHandoffReceipt(input: RuntimeHandoffReceiptInput): void {
  ensureRuntimeCustomerReply({
    customerVisibleText: input.customerVisibleText,
    runtimeText: escalationMessageForRuntime(latestUserText(input.messages), input.config),
    addMessage: input.addMessage,
    sendEvent: input.sendEvent,
    createId: input.createId,
    now: input.now,
  })
}

export class HumanTaskHandoffHandler {
  constructor(private readonly deps: HumanTaskHandoffHandlerDeps) {}

  async complete(
    pending: PendingHumanTaskEscalation,
    fullText: string,
    sendEvent: (event: SSEEvent) => void,
  ): Promise<HumanTaskHandoffResult> {
    const { taskId, queue, question, handoffNote } = pending

    ensureRuntimeHandoffReceipt({
      customerVisibleText: fullText,
      config: this.deps.config,
      messages: this.deps.getMessages(),
      addMessage: this.deps.addMessage,
      sendEvent,
      createId: this.deps.createId,
      now: this.deps.now,
    })

    sendEvent({
      type: 'human_task_created',
      data: { taskId, queue, question, status: 'pending', ...(handoffNote ?? {}) },
      timestamp: this.timestamp(),
    })
    await this.deps.traceWriter.writeEscalated('human_task_created', {
      taskId,
      queue,
      question,
      status: 'pending',
      ...(handoffNote ?? {}),
    })
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

  private timestamp(): string {
    return (this.deps.now?.() ?? new Date()).toISOString()
  }
}
