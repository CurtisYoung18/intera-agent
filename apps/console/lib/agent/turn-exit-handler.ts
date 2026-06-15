import type { CaseStatus, Message, SSEEvent } from '@intera/shared/types'
import type { TraceWriter } from './trace'

export type TurnExitResult = {
  messages: Message[]
  caseStatus: CaseStatus
  transition: 'next_turn' | 'waiting_human' | 'error'
  currentStage: string
  reason?: string
}

export interface TurnExitHandlerDeps {
  traceWriter: TraceWriter
  getMessages: () => Message[]
  getCurrentStage: () => string
  getIterationCount: () => number
  getNudgeCount: () => number
  now?: () => Date
}

export class TurnExitHandler {
  constructor(private readonly deps: TurnExitHandlerDeps) {}

  completePostToolTurn(
    input: {
      pendingEscalation: boolean
      stopReason: string | null
    },
    sendEvent: (event: SSEEvent) => void,
  ): { kind: 'continue' } | { kind: 'terminal'; result: TurnExitResult } {
    const currentStage = this.deps.getCurrentStage()
    sendEvent({
      type: 'message_stop',
      data: { reason: 'next_turn', stage: currentStage },
      timestamp: this.timestamp(),
    })

    if (input.pendingEscalation) {
      return {
        kind: 'terminal',
        result: {
          messages: this.deps.getMessages(),
          caseStatus: 'escalated',
          transition: 'waiting_human',
          currentStage,
          reason: 'auto_escalated_by_hook',
        },
      }
    }

    if (input.stopReason === 'end_turn' || input.stopReason === 'max_tokens') {
      return {
        kind: 'terminal',
        result: {
          messages: this.deps.getMessages(),
          caseStatus: currentStage as CaseStatus,
          transition: 'next_turn',
          currentStage,
          reason: input.stopReason ?? undefined,
        },
      }
    }

    return { kind: 'continue' }
  }

  async maxIterations(
    stopReason: string | null,
    sendEvent: (event: SSEEvent) => void,
  ): Promise<TurnExitResult> {
    const currentStage = this.deps.getCurrentStage()
    const messages = this.deps.getMessages()
    await this.deps.traceWriter.write('loop_decision', 'Exit: max iterations', {
      stopReason,
      iteration: this.deps.getIterationCount(),
      messageCount: messages.length,
    })

    const shouldEscalate = this.deps.getNudgeCount() >= 3
    sendEvent({
      type: shouldEscalate ? 'escalated' : 'message_stop',
      data: shouldEscalate
        ? { reason: 'max_iterations', stage: currentStage }
        : { reason: 'max_iterations', stopReason, stage: currentStage },
      timestamp: this.timestamp(),
    })

    return {
      messages,
      caseStatus: shouldEscalate ? 'escalated' : (currentStage as CaseStatus),
      transition: shouldEscalate ? 'error' : 'next_turn',
      currentStage,
      reason: 'max_iterations',
    }
  }

  private timestamp(): string {
    return (this.deps.now?.() ?? new Date()).toISOString()
  }
}
