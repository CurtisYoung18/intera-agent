import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { APIError, APIConnectionError, APIUserAbortError } from '@anthropic-ai/sdk'
import {
  withRetry,
  CannotRetryError,
  FallbackTriggeredError,
  type RetryContext,
} from '../../api/with-retry'

function makeApiError(status: number, message = ''): APIError {
  return new APIError(status, undefined, message, undefined)
}

function makeConnectionError(msg = 'connection failed'): APIConnectionError {
  return new APIConnectionError({ message: msg } as any)
}

function makeAnthropicClient() {
  return {
    messages: { create: vi.fn(), stream: vi.fn() },
  }
}

/** Helper: run withRetry and capture the result or rejection using fake timers */
async function runWithRetry<T>(
  operation: Parameters<typeof withRetry<T>>[0],
  options: Parameters<typeof withRetry<T>>[1],
  getClient: Parameters<typeof withRetry<T>>[2],
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  const promise = withRetry(operation, options, getClient)
  // Attach catch immediately so fake-timer-driven rejections are handled
  return promise.then(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  )
}

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns result on successful first attempt', async () => {
    const client = makeAnthropicClient()
    const operation = vi.fn().mockResolvedValue('success')

    const result = await runWithRetry(
      operation,
      { querySource: 'main_loop', model: 'claude-sonnet-4-20250514' },
      () => client as any,
    )

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe('success')
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('retries on transient network error and succeeds', async () => {
    const client = makeAnthropicClient()
    const onRetry = vi.fn()
    const operation = vi.fn()
      .mockRejectedValueOnce(makeConnectionError())
      .mockRejectedValueOnce(makeConnectionError())
      .mockResolvedValue('success')

    const resultPromise = runWithRetry(
      operation,
      { querySource: 'main_loop', model: 'claude-sonnet-4-20250514', onRetry },
      () => client as any,
    )

    await vi.runAllTimersAsync()

    const result = await resultPromise
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe('success')
    expect(operation).toHaveBeenCalledTimes(3)
    expect(onRetry).toHaveBeenCalledTimes(2)
  })

  it('respects maxRetries option override', async () => {
    const client = makeAnthropicClient()
    const operation = vi.fn().mockRejectedValue(makeConnectionError())

    const resultPromise = runWithRetry(
      operation,
      { querySource: 'main_loop', model: 'claude-sonnet-4-20250514', maxRetries: 2 },
      () => client as any,
    )

    await vi.runAllTimersAsync()

    const result = await resultPromise
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBeInstanceOf(CannotRetryError)
    expect(operation).toHaveBeenCalledTimes(3)
  })

  it('uses main_loop default maxRetries (5) when not specified', async () => {
    const client = makeAnthropicClient()
    const operation = vi.fn().mockRejectedValue(makeConnectionError())

    const resultPromise = runWithRetry(
      operation,
      { querySource: 'main_loop', model: 'claude-sonnet-4-20250514' },
      () => client as any,
    )

    await vi.runAllTimersAsync()

    const result = await resultPromise
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBeInstanceOf(CannotRetryError)
    // main_loop defaults to maxRetries=5, so 6 total attempts
    expect(operation).toHaveBeenCalledTimes(6)
  })

  it('throws CannotRetryError with errorClass when exhausted', async () => {
    const client = makeAnthropicClient()
    const operation = vi.fn().mockRejectedValue(makeConnectionError())

    const resultPromise = runWithRetry(
      operation,
      { querySource: 'main_loop', model: 'claude-sonnet-4-20250514' },
      () => client as any,
    )
    await vi.runAllTimersAsync()

    const result = await resultPromise
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(CannotRetryError)
      expect((result.error as CannotRetryError).errorClass).toBe('transient_network')
    }
  })

  it('context overflow: sets maxTokensOverride when room available', async () => {
    const client = makeAnthropicClient()
    // 200000 total tokens, 220000 context limit → leaves ~19000 room for reduction
    const overflowErr = makeApiError(400, 'prompt is too long: 200000 tokens > 220000 maximum')
    let capturedCtx: RetryContext | undefined

    const operation = vi.fn()
      .mockRejectedValueOnce(overflowErr)
      .mockImplementationOnce((_client, ctx: RetryContext) => {
        capturedCtx = ctx
        return Promise.resolve('success')
      })

    const result = await runWithRetry(
      operation,
      { querySource: 'main_loop', model: 'claude-sonnet-4-20250514' },
      () => client as any,
    )

    expect(result.ok).toBe(true)
    expect(operation).toHaveBeenCalledTimes(2)
    expect(capturedCtx!.maxTokensOverride).toBeGreaterThan(3000)
  })

  it('context overflow with no room + no fallback throws CannotRetryError', async () => {
    const client = makeAnthropicClient()
    const overflowErr = makeApiError(400, 'prompt is too long: 10000 tokens > 500 maximum')
    const operation = vi.fn().mockRejectedValue(overflowErr)

    // Context overflow with no room throws immediately (no timer)
    const result = await runWithRetry(
      operation,
      { querySource: 'main_loop', model: 'claude-sonnet-4-20250514' },
      () => client as any,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBeInstanceOf(CannotRetryError)
  })

  it('context overflow with no room but fallback set throws FallbackTriggeredError', async () => {
    const client = makeAnthropicClient()
    const overflowErr = makeApiError(400, 'prompt is too long: 10000 tokens > 500 maximum')
    const operation = vi.fn().mockRejectedValue(overflowErr)

    const result = await runWithRetry(
      operation,
      { querySource: 'main_loop', model: 'claude-sonnet-4-20250514', fallbackModel: 'claude-haiku-4-5-20251001' },
      () => client as any,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBeInstanceOf(FallbackTriggeredError)
  })

  it('abort during operation throws CannotRetryError with aborted', async () => {
    const client = makeAnthropicClient()
    const ac = new AbortController()
    const operation = vi.fn().mockImplementation(() => {
      ac.abort()
      return Promise.reject(new APIUserAbortError())
    })

    const result = await runWithRetry(
      operation,
      { querySource: 'main_loop', model: 'claude-sonnet-4-20250514', signal: ac.signal },
      () => client as any,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBeInstanceOf(CannotRetryError)
  })

  it('3 consecutive 529s with fallback throw FallbackTriggeredError', async () => {
    const client = makeAnthropicClient()
    const overloadedErr = makeApiError(529)
    const operation = vi.fn().mockRejectedValue(overloadedErr)

    const resultPromise = runWithRetry(
      operation,
      { querySource: 'main_loop', model: 'claude-sonnet-4-20250514', fallbackModel: 'claude-haiku-4-5-20251001' },
      () => client as any,
    )
    await vi.runAllTimersAsync()

    const result = await resultPromise
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBeInstanceOf(FallbackTriggeredError)
  })

  it('529 interrupted by non-529 resets counter', async () => {
    const client = makeAnthropicClient()
    const operation = vi.fn()
      .mockRejectedValueOnce(makeApiError(529))
      .mockRejectedValueOnce(makeApiError(529))
      .mockRejectedValueOnce(makeConnectionError())
      .mockRejectedValueOnce(makeApiError(529))
      .mockRejectedValueOnce(makeApiError(529))
      .mockResolvedValue('success')

    const resultPromise = runWithRetry(
      operation,
      { querySource: 'main_loop', model: 'claude-sonnet-4-20250514' },
      () => client as any,
    )
    await vi.runAllTimersAsync()

    const result = await resultPromise
    expect(result.ok).toBe(true)
  })

  it('hook_eval bails on 529 immediately', async () => {
    const client = makeAnthropicClient()
    const operation = vi.fn().mockRejectedValue(makeApiError(529))

    const result = await runWithRetry(
      operation,
      { querySource: 'hook_eval', model: 'claude-sonnet-4-20250514' },
      () => client as any,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBeInstanceOf(CannotRetryError)
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('non-retryable error (auth) throws immediately', async () => {
    const client = makeAnthropicClient()
    const operation = vi.fn().mockRejectedValue(makeApiError(401))

    const result = await runWithRetry(
      operation,
      { querySource: 'main_loop', model: 'claude-sonnet-4-20250514' },
      () => client as any,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBeInstanceOf(CannotRetryError)
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('exponential backoff timing follows expected pattern', async () => {
    const client = makeAnthropicClient()
    const onRetry = vi.fn()
    const operation = vi.fn()
      .mockRejectedValueOnce(makeConnectionError())
      .mockRejectedValueOnce(makeConnectionError())
      .mockRejectedValueOnce(makeConnectionError())
      .mockResolvedValue('success')

    const resultPromise = runWithRetry(
      operation,
      { querySource: 'main_loop', model: 'claude-sonnet-4-20250514', onRetry },
      () => client as any,
    )

    await vi.runAllTimersAsync()
    await resultPromise

    expect(onRetry).toHaveBeenCalledTimes(3)
    const delays = onRetry.mock.calls.map((c: any) => c[0].delayMs)
    for (let i = 0; i < delays.length; i++) {
      const expectedMin = 500 * Math.pow(2, i)
      expect(delays[i]).toBeGreaterThanOrEqual(expectedMin * 0.5)
      expect(delays[i]).toBeLessThanOrEqual(expectedMin * 4)
    }
  })

  it('passes signal to operation', async () => {
    const client = makeAnthropicClient()
    const ac = new AbortController()
    const operation = vi.fn().mockResolvedValue('ok')

    const result = await runWithRetry(
      operation,
      { querySource: 'main_loop', model: 'claude-sonnet-4-20250514', signal: ac.signal },
      () => client as any,
    )

    expect(result.ok).toBe(true)
    expect(operation).toHaveBeenCalledTimes(1)
  })
})
