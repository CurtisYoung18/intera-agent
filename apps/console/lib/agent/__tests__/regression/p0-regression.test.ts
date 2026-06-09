import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import { APIConnectionError } from '@anthropic-ai/sdk'
import { ToolRouter } from '../../tools'
import { withRetry, CannotRetryError } from '../../api/with-retry'

function makeAnthropicClient() {
  return {
    messages: {
      stream: vi.fn(),
      create: vi.fn(),
    },
  }
}

/** Helper: run withRetry and capture result/error with fake timers */
async function runWithRetryResult<T>(...args: Parameters<typeof withRetry<T>>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  const promise = withRetry(...args)
  return promise.then(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  )
}

describe('A1 — Stream creation retry', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('retries stream creation on transient network errors', async () => {
    const client = makeAnthropicClient()
    const connectionErr = new APIConnectionError({ message: 'ECONNREFUSED' } as any)

    client.messages.stream
      .mockRejectedValueOnce(connectionErr)
      .mockRejectedValueOnce(connectionErr)
      .mockResolvedValue({ [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }) })

    const resultPromise = runWithRetryResult(
      () => client.messages.stream({ model: 'claude-sonnet-4-20250514', max_tokens: 100, messages: [] }),
      { querySource: 'main_loop', model: 'claude-sonnet-4-20250514' },
      () => client as any,
    )
    await vi.runAllTimersAsync()
    const result = await resultPromise

    expect(result.ok).toBe(true)
    expect(client.messages.stream).toHaveBeenCalledTimes(3)
  })

  it('escalates after exhausting all retries', async () => {
    const client = makeAnthropicClient()
    const connectionErr = new APIConnectionError({ message: 'ECONNREFUSED' } as any)

    client.messages.stream.mockRejectedValue(connectionErr)

    const resultPromise = runWithRetryResult(
      () => client.messages.stream({ model: 'claude-sonnet-4-20250514', max_tokens: 100, messages: [] }),
      { querySource: 'main_loop', model: 'claude-sonnet-4-20250514' },
      () => client as any,
    )
    await vi.runAllTimersAsync()
    const result = await resultPromise

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBeInstanceOf(CannotRetryError)
  })

  it('context overflow with no room throws CannotRetryError', async () => {
    const client = makeAnthropicClient()
    const overflowErr = new Anthropic.APIError(
      400,
      undefined,
      'prompt is too long: 200000 tokens > 199999 maximum',
      undefined,
    )

    client.messages.stream.mockRejectedValue(overflowErr)

    // Context overflow with no room — throws immediately, no timer needed
    const result = await runWithRetryResult(
      () => client.messages.stream({ model: 'claude-sonnet-4-20250514', max_tokens: 100, messages: [] }),
      { querySource: 'main_loop', model: 'claude-sonnet-4-20250514' },
      () => client as any,
    )
    expect(result.ok).toBe(false)
  })
})

describe('A3 — Consultation model and retry', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('uses model from parameter, not hardcoded value', async () => {
    const client = makeAnthropicClient()
    client.messages.create.mockResolvedValue({
      content: [{ type: 'text', text: 'Investigation complete.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    })

    const model = 'claude-opus-4-7'

    const result = await runWithRetryResult(
      (retryClient) => retryClient.messages.create({
        model,
        max_tokens: 100,
        messages: [{ role: 'user', content: 'test' }],
      }),
      { querySource: 'consultation_loop', model },
      () => client as any,
    )

    expect(result.ok).toBe(true)
    expect(client.messages.create).toHaveBeenCalled()
    const callModel = (client.messages.create as any).mock.calls[0][0].model
    expect(callModel).toBe(model)
  })

  it('retries consultation LLM call on transient failure', async () => {
    const client = makeAnthropicClient()
    const connectionErr = new APIConnectionError({ message: 'socket hang up' } as any)

    client.messages.create
      .mockRejectedValueOnce(connectionErr)
      .mockRejectedValueOnce(connectionErr)
      .mockResolvedValue({
        content: [{ type: 'text', text: 'Done.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 5, output_tokens: 3 },
      })

    const resultPromise = runWithRetryResult(
      (retryClient) => retryClient.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 100,
        messages: [],
      }),
      { querySource: 'consultation_loop', model: 'claude-sonnet-4-20250514' },
      () => client as any,
    )
    await vi.runAllTimersAsync()
    const result = await resultPromise

    expect(result.ok).toBe(true)
    expect(client.messages.create).toHaveBeenCalledTimes(3)
  })
})

describe('A4 — start_procedure', () => {
  it('start_procedure is in BUILT_IN_TOOLS via ToolRouter', () => {
    const router = new ToolRouter()

    // ToolRouter constructor loads BUILT_IN_TOOLS
    const startDef = router.getTool('start_procedure')
    expect(startDef).toBeDefined()
    expect(startDef!.name).toBe('start_procedure')
    expect(startDef!.inputSchema).toBeDefined()
    expect(startDef!.inputSchema.properties).toHaveProperty('procedureId')
  })

  it('keeps dispatch_case_agent as disabled compatibility alias', () => {
    const router = new ToolRouter()
    const def = router.getTool('dispatch_case_agent')
    expect(def).toBeDefined()
    expect(def!.enabled).toBe(false)
    expect(def!.inputSchema.required).toEqual(['procedureId'])
    expect(def!.inputSchema.properties).toHaveProperty('procedureId')
    expect(def!.inputSchema.properties).toHaveProperty('caseType')
    expect(def!.inputSchema.properties).toHaveProperty('currentProcedureAction')
  })
})
