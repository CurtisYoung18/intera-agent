import type {
  QueuedMessage,
  QueuedMessageInput,
  RuntimeEvent,
  RuntimeEventOrigin,
  RuntimeEventSource,
} from '@intera/runtime-core/runtime-events'

export type {
  QueuedMessage,
  QueuedMessageInput,
  RuntimeEvent,
  RuntimeEventOrigin,
  RuntimeEventSource,
} from '@intera/runtime-core/runtime-events'

/**
 * Single-consumer, multi-producer async queue.
 * Designed for one SSE-loop consumer awaiting messages sent by HTTP POST handlers.
 */
export class MessageQueue {
  private queue: QueuedMessage[] = []
  private waiter: ((msg: QueuedMessage) => void) | null = null

  /** Enqueue a message. If the consumer is already waiting, wake it immediately. */
  enqueue(msg: QueuedMessage): void {
    if (this.waiter) {
      const resolve = this.waiter
      this.waiter = null
      resolve(msg)
    } else {
      this.queue.push(msg)
    }
  }

  /** Await the next message. Returns immediately if one is already buffered. */
  dequeue(): Promise<QueuedMessage> {
    if (this.queue.length > 0) {
      return Promise.resolve(this.queue.shift()!)
    }
    return new Promise<QueuedMessage>((resolve) => {
      this.waiter = resolve
    })
  }

  /** Non-blocking dequeue: returns the next message or null if queue is empty. */
  dequeueNonBlocking(): QueuedMessage | null {
    if (this.queue.length > 0) return this.queue.shift()!
    return null
  }

  /** Abort the waiting consumer with a synthetic control message. */
  abort(): void {
    if (!this.waiter) return
    const resolve = this.waiter
    this.waiter = null
    resolve(createClosedQueuedMessage())
  }

  get pendingCount(): number {
    return this.queue.length
  }
}

function createClosedQueuedMessage(): QueuedMessage {
  const now = new Date().toISOString()
  return {
    eventId: crypto.randomUUID(),
    inputEpoch: 0,
    origin: 'system',
    source: 'control',
    createdAt: now,
    enqueuedAt: now,
    caseId: 'closed',
    sessionId: 'closed',
    content: '__SESSION_CLOSED__',
    isControl: true,
    priority: -100,
    enqueuePolicy: 'front',
  }
}
