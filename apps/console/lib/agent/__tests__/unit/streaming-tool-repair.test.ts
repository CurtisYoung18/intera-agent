import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ToolDefinition, ToolUse } from '@intera/shared/types'
import { StreamingToolExecutor } from '../../streaming-tool-executor'

function httpTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: 'get_bet_history',
    description: 'Test HTTP lookup',
    inputSchema: { type: 'object', properties: {} } as any,
    mode: 'http',
    endpoint: 'https://tools.example.test/lookup',
    httpMethod: 'POST',
    timeoutMs: 1000,
    isConcurrencySafe: true,
    enabled: true,
    toolCategory: 'operational',
    ...overrides,
  }
}

function toolUse(input: Record<string, unknown>, name = 'get_bet_history'): ToolUse {
  return {
    id: 'toolu_test',
    name,
    input,
  }
}

describe('StreamingToolExecutor tool repair', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('normalizes get_bet_history date-only input before executing', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ok: true, rows: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const results = await StreamingToolExecutor.executeAll(
      [httpTool()],
      [
        toolUse({
          member_id: 'JAYA1108F7C',
          from_date: '2026-06-10',
          to_date: '2026-06-18',
        }),
      ],
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(request.body))).toMatchObject({
      member_id: 'JAYA1108F7C',
      from_date: '2026-06-10 00:00:00',
      to_date: '2026-06-18 23:59:59',
    })
    expect(results[0]?.toolUse?.input).toMatchObject({
      from_date: '2026-06-10 00:00:00',
      to_date: '2026-06-18 23:59:59',
    })
    expect((results[0]?.output as { ok?: boolean }).ok).toBe(true)
  })

  it('preserves HTTP 400 response body and classifies validation failures', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      message: 'The from date does not match the format Y-m-d H:i:s.',
    }), {
      status: 400,
      statusText: 'Bad Request',
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const results = await StreamingToolExecutor.executeAll(
      [httpTool()],
      [
        toolUse({
          member_id: 'JAYA1108F7C',
          from_date: '2026-06-10 00:00:00',
          to_date: '2026-06-18 23:59:59',
        }),
      ],
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const toolResult = results[0]?.output as { ok?: boolean; output?: Record<string, unknown>; error?: string }
    expect(toolResult.ok).toBe(false)
    expect(toolResult.output).toMatchObject({
      ok: false,
      error_class: 'validation_error',
      http_status: 400,
      response_body: {
        message: 'The from date does not match the format Y-m-d H:i:s.',
      },
    })
    expect(toolResult.error).toContain('Y-m-d H:i:s')
  })

  it('classifies ok:false HTTP payloads as structured tool failures', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      ok: false,
      message: 'validation failed: method must be deposit or withdraw',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const results = await StreamingToolExecutor.executeAll(
      [httpTool({ name: 'get_transaction_history' })],
      [
        toolUse({
          member_id: 'JAYA1108F7C',
          method: 'deposit',
        }, 'get_transaction_history'),
      ],
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const toolResult = results[0]?.output as { ok?: boolean; output?: Record<string, unknown> }
    expect(toolResult.ok).toBe(false)
    expect(toolResult.output).toMatchObject({
      ok: false,
      error_class: 'validation_error',
      response_body: {
        ok: false,
        message: 'validation failed: method must be deposit or withdraw',
      },
    })
  })
})
