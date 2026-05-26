// S2 — Error classifier for centralized retry.
// Ports CC's shouldRetry() + parseMaxTokensContextOverflow patterns.

import { APIError, APIConnectionError, APIUserAbortError } from '@anthropic-ai/sdk'

export type ErrorClass =
  | 'transient_network'
  | 'overloaded'
  | 'rate_limit'
  | 'context_overflow'
  | 'auth'
  | 'timeout'
  | 'server_error'
  | 'malformed_request'
  | 'aborted'
  | 'unknown'

export function classifyError(err: unknown): ErrorClass {
  if (err instanceof APIUserAbortError) return 'aborted'

  if (err instanceof APIConnectionError) {
    return 'transient_network'
  }

  if (err instanceof APIError) {
    const msg = (err.message || '').toLowerCase()
    const body = String((err as { error?: unknown }).error ?? '').toLowerCase()

    // 529 "overloaded" — MiniMax/DeepSeek return different shapes
    if (err.status === 529) return 'overloaded'
    if (msg.includes('overloaded_error') || body.includes('overloaded_error')) return 'overloaded'
    if (msg.includes('"type":"overloaded_error"')) return 'overloaded'

    if (err.status === 429) return 'rate_limit'
    if (err.status === 408) return 'timeout'
    if (err.status === 401 || err.status === 403) return 'auth'

    if (err.status === 400) {
      if (isContextOverflow(err)) return 'context_overflow'
      return 'malformed_request'
    }

    if (err.status >= 500) return 'server_error'

    // Some 413 responses appear as generic errors
    if (msg.includes('context_length_exceeded')) return 'context_overflow'
  }

  // Raw fetch errors (not wrapped by Anthropic SDK)
  const msg = String(err).toLowerCase()
  if (msg.includes('econnreset') || msg.includes('epipe') || msg.includes('socket hang up')) {
    return 'transient_network'
  }
  if (msg.includes('abort') || msg.includes('aborted')) return 'aborted'

  return 'unknown'
}

function isContextOverflow(err: APIError): boolean {
  const msg = (err.message || '').toLowerCase()
  if (msg.includes('prompt is too long')) return true
  if (msg.includes('context_length_exceeded')) return true
  if (msg.includes('max_tokens') && msg.includes('exceed')) return true
  if (msg.includes('input tokens too long')) return true

  // Check structured error body for Anthropic format
  try {
    const body = typeof (err as { error?: unknown }).error === 'string'
      ? JSON.parse((err as { error?: unknown }).error as string)
      : (err as { error?: unknown }).error
    if (body && typeof body === 'object') {
      const type = (body as Record<string, unknown>).type as string
      if (type === 'invalid_request_error') {
        const subMsg = String((body as Record<string, unknown>).message || '').toLowerCase()
        if (subMsg.includes('prompt is too long') || subMsg.includes('context_length_exceeded')) return true
      }
    }
  } catch { /* not JSON */ }

  return false
}

/**
 * Parse the error message for "<inputTokens> + <maxTokens> > <contextLimit>".
 * Returns { inputTokens, maxTokens, contextLimit } or null.
 */
export function parseMaxTokensContextOverflow(
  err: unknown,
): { inputTokens: number; maxTokens: number; contextLimit: number } | null {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  // Anthropic format: "prompt is too long: 200000 tokens > 199999 maximum"
  const anthropicMatch = msg.match(/(\d[\d,]*)\s*tokens?\s*>\s*(\d[\d,]*)\s*maximum/)
  if (anthropicMatch) {
    return {
      inputTokens: parseInt(anthropicMatch[1].replace(/,/g, ''), 10),
      maxTokens: 0,
      contextLimit: parseInt(anthropicMatch[2].replace(/,/g, ''), 10),
    }
  }
  return null
}
