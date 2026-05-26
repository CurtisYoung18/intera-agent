// S2 — Centralized retry & fallback wrapper.
// Ports CC's withRetry pattern: classified errors, exponential backoff with jitter,
// per-QuerySource retry policy, model fallback on consecutive 529s, and trace on every exit.
//
// Every LLM API call goes through this wrapper. No silent breaks.

import Anthropic from '@anthropic-ai/sdk'
import {
  classifyError,
  parseMaxTokensContextOverflow,
  type ErrorClass,
} from './error-classifier'

// ── Types ────────────────────────────────────────────────────────────────

export type QuerySource =
  | 'main_loop'
  | 'sub_agent_loop'
  | 'consultation_loop'
  | 'classifier'
  | 'sanitizer'
  | 'policy_eval'
  | 'compact'

export interface RetryOptions {
  querySource: QuerySource
  model: string
  fallbackModel?: string
  signal?: AbortSignal
  maxRetries?: number
  /** SSE bridge — emits retry_pending events without blocking. */
  onRetry?: (info: { attempt: number; delayMs: number; errorClass: ErrorClass; message: string }) => void
}

export interface RetryContext {
  model: string
  maxTokensOverride?: number
  attempt: number
}

export class CannotRetryError extends Error {
  constructor(
    public readonly errorClass: ErrorClass,
    public readonly originalError: unknown,
    public readonly retryContext: RetryContext,
  ) {
    super(`[Retry] Cannot retry (${errorClass}): ${originalError instanceof Error ? originalError.message.slice(0, 200) : String(originalError).slice(0, 200)}`)
    this.name = 'CannotRetryError'
  }
}

export class FallbackTriggeredError extends Error {
  constructor(
    public readonly originalModel: string,
    public readonly fallbackModel: string,
    public readonly reason: 'consecutive_529' | 'context_overflow_no_room',
  ) {
    super(`Model fallback: ${originalModel} → ${fallbackModel} (${reason})`)
    this.name = 'FallbackTriggeredError'
  }
}

// ── Per-source retry policy ──────────────────────────────────────────────

const RETRYABLE: Set<ErrorClass> = new Set([
  'transient_network', 'overloaded', 'rate_limit', 'timeout', 'server_error', 'context_overflow',
])

interface Policy {
  maxRetries: number
  retryOn: Set<ErrorClass>
  /** If true, bail immediately on 529 instead of retrying (background sources). */
  bailOn529: boolean
}

const RETRY_POLICY: Record<QuerySource, Policy> = {
  main_loop:         { maxRetries: 5, retryOn: RETRYABLE, bailOn529: false },
  sub_agent_loop:    { maxRetries: 5, retryOn: RETRYABLE, bailOn529: false },
  consultation_loop: { maxRetries: 5, retryOn: RETRYABLE, bailOn529: false },
  classifier:        { maxRetries: 2, retryOn: new Set(['transient_network', 'timeout']), bailOn529: true },
  sanitizer:         { maxRetries: 2, retryOn: new Set(['transient_network', 'timeout']), bailOn529: true },
  policy_eval:       { maxRetries: 3, retryOn: new Set(['transient_network', 'timeout', 'server_error']), bailOn529: true },
  compact:           { maxRetries: 5, retryOn: RETRYABLE, bailOn529: false },
}

const MAX_529_RETRIES = 3
const CONTEXT_OVERFLOW_SAFETY_BUFFER = 1000
const CONTEXT_OVERFLOW_FLOOR_TOKENS = 3000

// ── Backoff ──────────────────────────────────────────────────────────────

function getRetryDelay(
  attempt: number,
  retryAfterHeader: string | null,
  errorClass: ErrorClass,
): number {
  // Honor server's retry-after header
  if (retryAfterHeader) {
    const parsed = parseFloat(retryAfterHeader)
    if (!isNaN(parsed) && parsed > 0) return Math.min(parsed * 1000, 60_000)
  }

  // Exponential: min(500ms * 2^(attempt-1), 32s) + jitter (0–25%)
  const base = Math.min(500 * Math.pow(2, attempt - 1), 32_000)
  const jitter = Math.random() * base * 0.25
  let delay = base + jitter

  // Overloaded gets extra floor
  if (errorClass === 'overloaded') {
    delay = Math.max(delay, 1000)
  }

  return Math.floor(delay)
}

// ── Core wrapper ─────────────────────────────────────────────────────────

const SAFETY_BUFFER_TOKENS = 1000
const CONTEXT_FLOOR_TOKENS = 3000

/**
 * Wraps an LLM API call with classified retry, backoff, and model fallback.
 *
 * The `operation` is called with the Anthropic client and a RetryContext.
 * On failure, errors are classified, and if retryable, the operation is re-called
 * after exponential backoff. Non-retryable errors throw CannotRetryError immediately.
 *
 * Consecutive 529s trigger FallbackTriggeredError if fallbackModel is set.
 * Context-overflow errors attempt a max_tokens reduction before giving up.
 */
export async function withRetry<T>(
  operation: (client: Anthropic, ctx: RetryContext) => Promise<T>,
  options: RetryOptions,
  getClient: () => Anthropic,
): Promise<T> {
  const policy = RETRY_POLICY[options.querySource]
  const maxRetries = options.maxRetries ?? policy.maxRetries
  const ctx: RetryContext = { model: options.model, attempt: 0 }
  let consecutive529 = 0
  let totalDelayMs = 0
  let lastErrorClass: ErrorClass = 'unknown'

  while (ctx.attempt <= maxRetries) {
    try {
      const client = getClient()
      return await operation(client, ctx)
    } catch (err: unknown) {
      if (options.signal?.aborted) {
        throw new CannotRetryError('aborted', err, ctx)
      }

      const errorClass = classifyError(err)
      lastErrorClass = errorClass

      // Context overflow: try reducing max_tokens first (doesn't count toward maxRetries)
      if (errorClass === 'context_overflow') {
        const parsed = parseMaxTokensContextOverflow(err)
        if (parsed && parsed.contextLimit > 0) {
          const inputTokens = parsed.inputTokens || 0
          const available = parsed.contextLimit - inputTokens - CONTEXT_OVERFLOW_SAFETY_BUFFER
          if (available >= CONTEXT_OVERFLOW_FLOOR_TOKENS) {
            ctx.maxTokensOverride = available
            ctx.attempt++ // still increment so we don't infinite-loop on non-recoverable context issues
            continue
          }
        }
        // No room — trigger fallback or fail
        if (options.fallbackModel) {
          throw new FallbackTriggeredError(options.model, options.fallbackModel, 'context_overflow_no_room')
        }
        throw new CannotRetryError(errorClass, err, ctx)
      }

      // 529 overloaded — track consecutive count, bail for background sources
      if (errorClass === 'overloaded') {
        consecutive529++
        if (policy.bailOn529) {
          throw new CannotRetryError(errorClass, err, ctx)
        }
        if (consecutive529 >= MAX_529_RETRIES && options.fallbackModel) {
          throw new FallbackTriggeredError(options.model, options.fallbackModel, 'consecutive_529')
        }
      } else {
        consecutive529 = 0
      }

      // Not retryable for this source
      if (!policy.retryOn.has(errorClass)) {
        throw new CannotRetryError(errorClass, err, ctx)
      }

      // Aborted during operation — don't retry
      if (errorClass === 'aborted') {
        throw new CannotRetryError(errorClass, err, ctx)
      }

      ctx.attempt++
      if (ctx.attempt > maxRetries) {
        throw new CannotRetryError(errorClass, err, ctx)
      }

      const retryAfter = (err as { headers?: { get?: (k: string) => string | null } }).headers?.get?.('retry-after') ?? null
      const delay = getRetryDelay(ctx.attempt, retryAfter, errorClass)
      totalDelayMs += delay

      options.onRetry?.({
        attempt: ctx.attempt,
        delayMs: delay,
        errorClass,
        message: `Retrying in ${Math.round(delay / 1000)}s (${errorClass})`,
      })

      await new Promise((resolve) => {
        const timer = setTimeout(resolve, delay)
        if (options.signal) {
          const onAbort = () => { clearTimeout(timer); resolve(undefined) }
          options.signal.addEventListener('abort', onAbort, { once: true })
        }
      })
    }
  }

  throw new CannotRetryError(lastErrorClass, null, ctx)
}
