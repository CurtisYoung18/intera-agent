/**
 * session-store.ts — In-memory session registry for CC-aligned persistent agent loops.
 *
 * Architecture (mirrors Claude Code's single-process model):
 *   GET /api/cases/[caseId]/stream  → opens a long-lived SSE, runs a sessionLoop()
 *                                     that awaits messages from the queue and calls
 *                                     agentLoop.run() for each.
 *   POST /api/cases/[caseId]/message → enqueues a message; returns 200 immediately.
 *
 * Key design:
 *   - MessageQueue handles the race between POST (enqueue) and SSE (dequeue).
 *     If POST fires before SSE loop calls dequeue(), the message is buffered.
 *     If SSE loop is already waiting, it's notified immediately.
 *   - Sessions are kept in a WeakRef-free Map with a TTL; a periodic cleanup
 *     purges sessions idle for > SESSION_TTL_MS.
 *   - On server restart all sessions are lost; the SSE endpoint reinitialises
 *     AgentLoop from DB (same as the old per-message /api/messages path).
 */

import type { AgentLoop } from './loop'
import type { AgentMessage } from '@intera/shared/types'

// ─── MessageBus — Agent 间实时通信 ────────────────────────────────────────────

export class MessageBus {
  private channels = new Map<string, AgentMessage[]>()

  send(to: string, msg: AgentMessage): void {
    if (to === '*') {
      for (const [agentId, msgs] of this.channels) {
        msgs.push(msg)
      }
      return
    }
    const msgs = this.channels.get(to)
    if (msgs) msgs.push(msg)
    else this.channels.set(to, [msg])
  }

  poll(agentId: string): AgentMessage[] {
    const msgs = this.channels.get(agentId)
    if (!msgs || msgs.length === 0) return []
    const result = [...msgs]
    msgs.length = 0
    return result
  }

  /** Register an agent on this bus (creates its inbox). */
  register(agentId: string): void {
    if (!this.channels.has(agentId)) this.channels.set(agentId, [])
  }

  /** Remove an agent from the bus after completion. */
  unregister(agentId: string): void {
    this.channels.delete(agentId)
  }
}

// ─── Queued message shape ─────────────────────────────────────────────────────

import type { ContentBlock } from '@intera/shared/types'

export interface QueuedMessage {
  content: string
  contentBlocks?: ContentBlock[]
  formAnswers?: Record<string, string>
}

// ─── MessageQueue ─────────────────────────────────────────────────────────────

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

  /** Abort the waiting consumer with an error (e.g. on session close). */
  abort(): void {
    if (this.waiter) {
      this.waiter({ content: '__SESSION_CLOSED__' })
      this.waiter = null
    }
  }

  get pendingCount(): number {
    return this.queue.length
  }
}

// ─── CaseSession ─────────────────────────────────────────────────────────────

export interface CaseSession {
  caseId: string
  /** Populated after AgentLoop.create() resolves inside the SSE handler. */
  loop: AgentLoop | null
  /** True once the SSE handler has started its session loop. */
  initialized: boolean
  /** True once the agent loop has completed (case resolved/escalated). */
  resolved: boolean
  queue: MessageQueue
  bus: MessageBus
  aborted: boolean
  lastActiveAt: number
}

// ─── Registry ────────────────────────────────────────────────────────────────

const sessions = new Map<string, CaseSession>()

/** TTL for idle sessions (30 minutes). */
const SESSION_TTL_MS = 30 * 60 * 1000

/**
 * Return the existing session for caseId, or create a new one.
 * Called by both the SSE route (first consumer) and the POST route (first producer).
 */
export function getOrCreateSession(caseId: string): CaseSession {
  const existing = sessions.get(caseId)
  if (existing) return existing

  const session: CaseSession = {
    caseId,
    loop: null,
    initialized: false,
    resolved: false,
    queue: new MessageQueue(),
    bus: new MessageBus(),
    aborted: false,
    lastActiveAt: Date.now(),
  }
  sessions.set(caseId, session)
  return session
}

/**
 * Enqueue a message for an existing session.
 * Returns false if the session doesn't exist or is aborted.
 */
export function enqueueMessage(caseId: string, msg: QueuedMessage): boolean {
  const session = sessions.get(caseId)
  if (!session || session.aborted) return false
  session.lastActiveAt = Date.now()
  session.queue.enqueue(msg)
  return true
}

/**
 * Enqueue a message, creating the session if it doesn't exist yet.
 * Used when POST arrives before SSE opens (race condition on first message).
 * The SSE handler calls getOrCreateSession() which will find the pre-created entry.
 */
export function enqueueMessageOrCreate(caseId: string, msg: QueuedMessage): CaseSession {
  let session = sessions.get(caseId)
  if (!session) {
    session = {
      caseId,
      loop: null,
      initialized: false,
      resolved: false,
      queue: new MessageQueue(),
      bus: new MessageBus(),
      aborted: false,
      lastActiveAt: Date.now(),
    }
    sessions.set(caseId, session)
  }
  session.lastActiveAt = Date.now()
  session.queue.enqueue(msg)
  return session
}

/** Mark a session as aborted and remove it from the registry. */
export function closeSession(caseId: string): void {
  const session = sessions.get(caseId)
  if (session) {
    session.aborted = true
    session.queue.abort()
    sessions.delete(caseId)
  }
}

/** Check whether a live session exists for this caseId. */
export function hasSession(caseId: string): boolean {
  const s = sessions.get(caseId)
  return !!s && !s.aborted && !s.resolved
}

// ─── TTL cleanup ──────────────────────────────────────────────────────────────

/** Purge sessions idle longer than SESSION_TTL_MS. Runs every 5 minutes. */
function cleanupStaleSessions() {
  const now = Date.now()
  for (const [caseId, session] of sessions.entries()) {
    if (now - session.lastActiveAt > SESSION_TTL_MS) {
      console.log(`[SessionStore] Evicting idle session: ${caseId}`)
      session.aborted = true
      session.queue.abort()
      sessions.delete(caseId)
    }
  }
}

// Only register the interval once per process (module is a singleton).
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupStaleSessions, 5 * 60 * 1000).unref?.()
}

/** Session count — for observability. */
export function sessionCount(): number {
  return sessions.size
}
