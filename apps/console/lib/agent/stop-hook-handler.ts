import type {
  AgentConfigData,
  AssistantMessage,
  CaseSchemaConfig,
  CaseStatus,
  Message,
  SSEEvent,
} from '@intera/shared/types'
import type { HookEvaluationResult } from './hook-engine'
import type { ChatMemoryManager } from './memory'
import type { PersistencePort } from './persistence-port'
import type { TraceWriter } from './trace'
import { escalationMessageForRuntime, latestUserText } from './customer-messages'
import {
  buildHumanHandoffQuestion,
  defaultHumanQueueForCaseSchema,
  normalizeHumanHandoffNotePayload,
} from './human-handoff'

export type StopHookTerminalResult = {
  messages: Message[]
  caseStatus: CaseStatus
  transition: 'waiting_human'
  currentStage: string
  reason: 'stop_hook_fallback'
}

export type StopHookAction =
  | { kind: 'retry'; feedbackMessage?: string }
  | { kind: 'terminal'; result: StopHookTerminalResult }

export interface StopHookHandlerDeps {
  config: AgentConfigData
  caseId: string
  orgId: string
  userId: string
  chatId?: string | null
  caseSchema?: CaseSchemaConfig | null
  chatMemory: ChatMemoryManager
  persistence: PersistencePort
  traceWriter: TraceWriter
  getMessages: () => Message[]
  addMessage: (message: Message) => void
  getCurrentStage: () => string
  createId?: () => string
  now?: () => Date
}

export class StopHookHandler {
  constructor(private readonly deps: StopHookHandlerDeps) {}

  async handle(
    stopEval: HookEvaluationResult,
    stopRetryCount: number,
    sendEvent: (event: SSEEvent) => void,
  ): Promise<StopHookAction> {
    const maxStopRetries = this.getMaxStopRetries()
    const shouldRetry = stopEval.summary === 'block' && stopRetryCount < maxStopRetries

    await this.deps.traceWriter.write('loop_decision', shouldRetry ? 'Stop Hook retry' : 'Stop Hook fallback', {
      checkpoint: 'Stop',
      summary: stopEval.summary,
      retry: stopRetryCount,
      maxStopRetries,
      hookNames: stopEval.results.filter((r) => r.action !== 'allow').map((r) => r.hookName),
    })

    if (shouldRetry) {
      sendEvent({
        type: 'withheld',
        data: 'Reply held for Hook repair.',
        timestamp: this.timestamp(),
      })
      return { kind: 'retry', feedbackMessage: stopEval.feedbackMessage }
    }

    const messages = this.deps.getMessages()
    const latestCustomerMessage = latestUserText(messages)
    const safeMessage = escalationMessageForRuntime(latestCustomerMessage, this.deps.config)

    const queue = defaultHumanQueueForCaseSchema(this.deps.caseSchema)

    try {
      const resolvedCaseType = this.deps.caseSchema?.type || 'general'
      await this.deps.persistence.ensureCase({
        id: this.deps.caseId,
        orgId: this.deps.orgId,
        userId: this.deps.userId,
        type: resolvedCaseType,
        status: 'escalated',
        blocker: `Stop Hook fallback: ${stopEval.results.map((r) => r.hookName).join(', ')}`,
        chatId: this.deps.chatId ?? this.deps.caseId,
      })
      await this.deps.persistence.saveMemory(this.deps.caseId, {
        caseId: this.deps.caseId,
        ...this.deps.chatMemory.getDbFields(),
        humanTaskStatus: 'pending',
      })
      const handoffNote = normalizeHumanHandoffNotePayload({
        known_facts: {
          case_type: resolvedCaseType,
          ...this.deps.chatMemory.getContextMap(),
        },
        chat_summary: latestCustomerMessage
          ? `Customer ko latest message: ${latestCustomerMessage}`
          : 'Customer ko issue automated response path bata safely resolve huna sakena.',
        handoff_reason: `Automated reply safety guard le ${stopRetryCount} retries pachhi pani customer-facing answer approve garena, tesaile human review chahiyo.`,
      })
      const question = buildHumanHandoffQuestion({
        baseQuestion: 'Customer-facing automated reply could not be sent safely after retries. Human review is required.',
        caseType: this.deps.caseSchema?.type,
        latestCustomerMessage,
        contextMap: this.deps.chatMemory.getContextMap(),
      })
      const task = await this.deps.persistence.createHumanTask({
        caseId: this.deps.caseId,
        queue,
        question,
        status: 'pending',
      })
      await this.deps.traceWriter.writeHumanTaskCreated(task.id, queue, {
        question,
        status: 'pending',
        suppressCustomerCard: true,
        ...handoffNote,
      })
      sendEvent({
        type: 'human_task_created',
        data: { taskId: task.id, queue, question, status: 'pending', suppressCustomerCard: true, ...handoffNote },
        timestamp: this.timestamp(),
      })
    } catch (err) {
      console.error('[AgentLoop] Failed to create Stop Hook fallback human task:', err)
    }

    const fallbackMessage: AssistantMessage = {
      id: this.createId(),
      role: 'assistant',
      content: safeMessage,
      createdAt: this.deps.now?.() ?? new Date(),
      isStreaming: false,
    }
    this.deps.addMessage(fallbackMessage)

    const currentStage = this.deps.getCurrentStage()
    sendEvent({
      type: 'text_delta',
      data: safeMessage,
      timestamp: this.timestamp(),
    })
    sendEvent({
      type: 'message_stop',
      data: { reason: 'stop_hook_fallback', stage: currentStage },
      timestamp: this.timestamp(),
    })
    sendEvent({
      type: 'escalated',
      data: { stage: currentStage, reason: 'stop_hook_fallback' },
      timestamp: this.timestamp(),
    })
    await this.deps.traceWriter.writeEscalated('stop_hook_fallback', { stage: currentStage })

    return {
      kind: 'terminal',
      result: {
        messages: this.deps.getMessages(),
        caseStatus: 'escalated',
        transition: 'waiting_human',
        currentStage,
        reason: 'stop_hook_fallback',
      },
    }
  }

  getMaxStopRetries(): number {
    const raw = (this.deps.config as AgentConfigData & { maxStopRetries?: unknown }).maxStopRetries
    return typeof raw === 'number' && raw >= 0 ? Math.floor(raw) : 2
  }

  private createId(): string {
    return this.deps.createId?.() ?? crypto.randomUUID()
  }

  private timestamp(): string {
    return (this.deps.now?.() ?? new Date()).toISOString()
  }
}
