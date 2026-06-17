import type { CaseStatus, Message, SSEEvent } from '@intera/shared/types'
import type { ChatMemoryManager } from './memory'
import type { TraceWriter } from './trace'
import type { HookEngine } from './hook-engine'

export type TurnPreflightResult =
  | { kind: 'continue' }
  | {
      kind: 'terminal'
      result: {
        messages: Message[]
        caseStatus: CaseStatus
        transition: 'error'
        currentStage: string
        reason: 'max_hook_hits'
      }
    }

export interface TurnPreflightDeps {
  caseId: string
  chatMemory: ChatMemoryManager
  traceWriter: TraceWriter
  getHookEngine: () => HookEngine
  getMessages: () => Message[]
  addMessage: (message: Message) => void
  getCurrentStage: () => string
  getIterationCount: () => number
  createId?: () => string
  now?: () => Date
}

export function buildHookHitCounts(hookEngine: HookEngine, chatMemory: ChatMemoryManager): Map<string, number> {
  const counts = new Map<string, number>()
  for (const name of hookEngine.getHookNames()) {
    const count = chatMemory.getHookHitCount(name)
    if (count > 0) counts.set(name, count)
  }
  return counts
}

export class TurnPreflight {
  constructor(private readonly deps: TurnPreflightDeps) {}

  async run(sendEvent: (event: SSEEvent) => void): Promise<TurnPreflightResult> {
    await this.consumeQueuedMessages(sendEvent)
    return this.checkHookHitEscalation(sendEvent)
  }

  private async consumeQueuedMessages(sendEvent: (event: SSEEvent) => void): Promise<void> {
    try {
      const { hasSession, getOrCreateSession } = await import('./session-store')
      if (!this.deps.caseId || !hasSession(this.deps.caseId)) return

      const session = getOrCreateSession(this.deps.caseId)
      let pending
      while ((pending = session.queue.dequeueNonBlocking())) {
        if (pending.content === '__SESSION_CLOSED__') continue
        const hasImages = pending.contentBlocks?.some((block) => block.type === 'image')
        this.deps.addMessage({
          id: this.createId(),
          role: 'user',
          content: hasImages ? pending.content : `[SYSTEM] Runtime input event (${pending.source}, epoch ${pending.inputEpoch}) arrived while you were working. Do not classify the customer's intent. Use the latest inputEpoch before advancing any active ProcedureRun. Content: ${pending.content}`,
          contentBlocks: pending.contentBlocks,
          createdAt: this.deps.now?.() ?? new Date(),
        })
        sendEvent({
          type: 'withheld',
          data: 'Processing additional user input...',
          timestamp: this.timestamp(),
        })
      }
    } catch {
      // session-store is unavailable in some build/test contexts; preserve the prior no-op behavior.
    }
  }

  private async checkHookHitEscalation(sendEvent: (event: SSEEvent) => void): Promise<TurnPreflightResult> {
    let maxHookHits = 0
    for (const count of buildHookHitCounts(this.deps.getHookEngine(), this.deps.chatMemory).values()) {
      if (count > maxHookHits) maxHookHits = count
    }

    if (maxHookHits < 3) {
      return { kind: 'continue' }
    }

    await this.deps.traceWriter.write('loop_decision', 'Exit: max Hook hits', {
      hookEscalation: true,
      maxHookHits,
      iteration: this.deps.getIterationCount(),
    })
    sendEvent({
      type: 'error',
      data: `Agent repeatedly hit Hooks (${maxHookHits} hits) - needs human intervention`,
      timestamp: this.timestamp(),
    })
    return {
      kind: 'terminal',
      result: {
        messages: this.deps.getMessages(),
        caseStatus: 'escalated',
        transition: 'error',
        currentStage: this.deps.getCurrentStage(),
        reason: 'max_hook_hits',
      },
    }
  }

  private createId(): string {
    return this.deps.createId?.() ?? crypto.randomUUID()
  }

  private timestamp(): string {
    return (this.deps.now?.() ?? new Date()).toISOString()
  }
}
