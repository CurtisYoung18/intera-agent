import type { AssistantMessage, CaseStatus, Message, SSEEvent } from '@intera/shared/types'
import { makeUserMessage } from './message-builder'
import type { TraceWriter } from './trace'

export type NoToolTurnAction =
  | {
      kind: 'continue'
      nudgeCount: number
      iterationDelta: -1
      assistantPushed: boolean
    }
  | {
      kind: 'terminal'
      assistantPushed: boolean
      result: {
        messages: Message[]
        caseStatus: CaseStatus
        transition: 'next_turn'
        currentStage: string
      }
    }

export interface NoToolTurnHandlerDeps {
  traceWriter: TraceWriter
  getMessages: () => Message[]
  addMessage: (message: Message) => void
  getCurrentStage: () => string
  now?: () => Date
}

export interface NoToolTurnInput {
  fullText: string
  nudgeCount: number
  iterationCount: number
  assistantMessage: AssistantMessage
  assistantPushed: boolean
  isProcedureMode: boolean
  isConsultation: boolean
  stopReason: string | null
  usage: Record<string, unknown> | null
  sendEvent: (event: SSEEvent) => void
}

export class NoToolTurnHandler {
  constructor(private readonly deps: NoToolTurnHandlerDeps) {}

  async handle(input: NoToolTurnInput): Promise<NoToolTurnAction> {
    if (input.isProcedureMode && !input.fullText) {
      const hasPendingToolResults = this.deps.getMessages()
        .slice(-6)
        .some((message) => isInternalProcedureUserMessage(message))
      if (hasPendingToolResults && input.nudgeCount < 3) {
        const nudgeCount = input.nudgeCount + 1
        const procedureNudge = '[SYSTEM] You just received investigation results but produced no response. ' +
          'You MUST now either: (1) call finalize_procedure with a conclusion, (2) call create_human_task if escalation is needed, ' +
          'or (3) respond to the customer with findings and next steps. ' +
          'Do not produce empty turns — act on the data you just received.'
        const assistantPushed = this.ensureAssistantPushed(input.assistantMessage, input.assistantPushed)
        this.deps.addMessage(makeUserMessage(procedureNudge))
        await this.deps.traceWriter.write('loop_decision', 'Procedure nudge: empty turn after tool results', {
          stage: this.deps.getCurrentStage(),
          nudgeCount,
          iteration: input.iterationCount,
        })
        input.sendEvent({
          type: 'message_stop',
          data: { reason: 'procedure_empty_turn_nudge', stage: this.deps.getCurrentStage() },
          timestamp: this.timestamp(),
        })
        return { kind: 'continue', nudgeCount, iterationDelta: -1, assistantPushed }
      }
    }

    await this.deps.traceWriter.write('loop_decision', 'Exit: no tools called', {
      stopReason: input.stopReason,
      iteration: input.iterationCount,
      textLength: input.fullText.length,
      stage: this.deps.getCurrentStage(),
    })
    const assistantPushed = this.ensureAssistantPushed(input.assistantMessage, input.assistantPushed)
    input.sendEvent({
      type: 'message_stop',
      data: { reason: 'no_tools', stopReason: input.stopReason, usage: input.usage },
      timestamp: this.timestamp(),
    })
    return {
      kind: 'terminal',
      assistantPushed,
      result: {
        messages: this.deps.getMessages(),
        caseStatus: (input.isConsultation ? 'waiting_human' : this.deps.getCurrentStage()) as CaseStatus,
        transition: 'next_turn',
        currentStage: this.deps.getCurrentStage(),
      },
    }
  }

  private ensureAssistantPushed(
    assistantMessage: AssistantMessage,
    assistantPushed: boolean,
  ): boolean {
    if (assistantPushed) return true
    this.deps.addMessage(assistantMessage)
    return true
  }

  private timestamp(): string {
    return (this.deps.now?.() ?? new Date()).toISOString()
  }
}

function isInternalProcedureUserMessage(message: Message): boolean {
  if (message.role !== 'user') return false

  const transcriptKind = message.providerMeta?.transcriptKind
  if (transcriptKind === 'tool_result' || transcriptKind === 'hook_feedback') {
    return true
  }

  if (Array.isArray(message.providerContent)) {
    if (message.providerContent.some((block: any) => block?.type === 'tool_result')) {
      return true
    }
  }

  if (Array.isArray(message.content)) {
    return message.content.some((block: any) => block?.type === 'tool_result')
  }

  return false
}
