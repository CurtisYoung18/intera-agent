// Route-level test for POST /api/admin/playground/save-to-chat
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const mockCaseCreate = vi.fn()
  const mockMessageCreate = vi.fn()
  const mockActionTraceCreate = vi.fn()
  const mockUserProfileUpdate = vi.fn()
  const mockGetSession = vi.fn()

  return { mockCaseCreate, mockMessageCreate, mockActionTraceCreate, mockUserProfileUpdate, mockGetSession }
})

vi.mock('@/lib/db/repo-for-org', () => ({
  repoForOrg(orgId: string) {
    return {
      orgId,
      case: {
        create: h.mockCaseCreate,
      },
      raw: {
        message: {
          create: h.mockMessageCreate,
        },
        actionTrace: {
          create: h.mockActionTraceCreate,
        },
        userProfile: {
          update: h.mockUserProfileUpdate,
        },
      },
    } as any
  },
}))

vi.mock('@/lib/auth', () => ({
  getSession: h.mockGetSession,
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { POST } from '@/app/api/admin/playground/save-to-chat/route'

function makeRequest(body?: unknown) {
  return {
    method: 'POST',
    json: async () => body ?? {},
    nextUrl: new URL('http://localhost/api/admin/playground/save-to-chat'),
  } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  h.mockGetSession.mockResolvedValue({ orgId: 'test-org', role: 'admin', userId: 'user-1' })
  h.mockCaseCreate.mockResolvedValue({ id: 'case-123' })
  h.mockMessageCreate.mockResolvedValue({ id: 'msg-1' })
})

describe('POST /api/admin/playground/save-to-chat', () => {
  it('creates a Case with source=playground and status=resolved', async () => {
    const input = {
      agentId: 'agent-1',
      messages: [{ role: 'user', content: 'Hello' }],
    }

    const res = await POST(makeRequest(input))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.data.caseId).toBe('case-123')
    expect(typeof body.data.chatId).toBe('string')
    expect(body.data.chatId).toMatch(/^pg_saved_/)

    // Case created with correct fields
    expect(h.mockCaseCreate).toHaveBeenCalledTimes(1)
    const caseCall = h.mockCaseCreate.mock.calls[0][0]
    expect(caseCall.data.source).toBe('playground')
    expect(caseCall.data.type).toBe('playground')
    expect(caseCall.data.status).toBe('resolved')
    expect(caseCall.data.userId).toMatch(/^playground-test-/)
    expect(caseCall.data.chatId).toMatch(/^pg_saved_/)
    expect(caseCall.data.goal).toContain('agent-1')
  })

  it('creates a Message row for each input message', async () => {
    const input = {
      agentId: 'agent-1',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'Help me' },
      ],
    }

    await POST(makeRequest(input))

    expect(h.mockMessageCreate).toHaveBeenCalledTimes(3)
    for (let i = 0; i < 3; i++) {
      const msgCall = h.mockMessageCreate.mock.calls[i][0]
      expect(msgCall.data.caseId).toBe('case-123')
      expect(msgCall.data.role).toBe(input.messages[i].role)
      expect(msgCall.data.content).toBe(input.messages[i].content)
    }
  })

  it('bypasses analytics — does NOT touch UserProfile', async () => {
    const input = {
      agentId: 'agent-1',
      messages: [{ role: 'user', content: 'Hello' }],
    }

    await POST(makeRequest(input))

    // Verify no UserProfile mutations occurred
    expect(h.mockUserProfileUpdate).not.toHaveBeenCalled()
  })

  it('returns 401 when no session', async () => {
    h.mockGetSession.mockResolvedValue(null)

    const res = await POST(makeRequest({ agentId: 'x', messages: [] }))
    const body = await res.json()

    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('unauthorized')
    expect(res.status).toBe(401)
  })

  it('returns 403 for viewer role', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'test-org', role: 'viewer', userId: 'user-1' })

    const res = await POST(makeRequest({ agentId: 'x', messages: [] }))
    const body = await res.json()

    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('forbidden')
    expect(res.status).toBe(403)
  })

  it('returns validation error when input is missing required fields', async () => {
    const res = await POST(makeRequest({}))
    const body = await res.json()

    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('validation')
    expect(res.status).toBe(400)
  })

  it('persists ActionTrace rows when traces are provided', async () => {
    const input = {
      agentId: 'agent-1',
      messages: [{ role: 'user', content: 'Hello' }],
      traces: [[
        { stage: 'Model generation', summary: 'LLM request', ms: 2700, fired: true, usage: { inputTokens: 120, outputTokens: 40, totalTokens: 160 } },
        { stage: 'Guardrails', summary: 'no events', ms: 0, fired: false },
      ]],
    }

    await POST(makeRequest(input))

    // Should create 1 trace row (fired=true only? Actually we save all)
    expect(h.mockActionTraceCreate).toHaveBeenCalledTimes(2)
    // Check first call has token info in detail
    const firstCall = h.mockActionTraceCreate.mock.calls[0][0]
    expect(firstCall.data.actionType).toBe('Model generation')
    expect(firstCall.data.detail).toContain('2700ms')
    expect(firstCall.data.detail).toContain('↑120↓40')
    expect(firstCall.data.payload).toContain('"inputTokens":120')
  })

  it('prefers canonical runtime trace rows when provided by Playground export', async () => {
    const input = {
      agentId: 'agent-1',
      messages: [{ role: 'user', content: 'Hello' }],
      traces: [[
        {
          stage: 'Tools',
          summary: 'Tool: ask_user_questions',
          ms: 1,
          fired: true,
          json: [
            {
              actionType: 'tool_result',
              title: 'Tool: ask_user_questions',
              detail: null,
              payload: {
                toolName: 'ask_user_questions',
                latencyMs: 1,
                input: { title: 'Need member id' },
                output: { _dryRun: true },
              },
            },
          ],
        },
        {
          stage: 'Model generation',
          summary: 'LLM response: tool_use',
          ms: 2659,
          fired: true,
          json: [
            {
              actionType: 'llm_response',
              title: 'LLM response: tool_use',
              detail: 'stopReason: tool_use',
              payload: {
                usage: {
                  input_tokens: 23,
                  output_tokens: 221,
                  cache_read_input_tokens: 3840,
                },
                model: 'deepseek-v4-flash',
                toolCalls: ['ask_user_questions'],
              },
            },
          ],
        },
      ]],
    }

    await POST(makeRequest(input))

    expect(h.mockActionTraceCreate).toHaveBeenCalledTimes(2)

    const firstCall = h.mockActionTraceCreate.mock.calls[0][0]
    expect(firstCall.data.actionType).toBe('tool_result')
    expect(firstCall.data.title).toBe('Tool: ask_user_questions')
    expect(firstCall.data.payload).toContain('"toolName":"ask_user_questions"')

    const secondCall = h.mockActionTraceCreate.mock.calls[1][0]
    expect(secondCall.data.actionType).toBe('llm_response')
    expect(secondCall.data.title).toBe('LLM response: tool_use')
    expect(secondCall.data.detail).toBe('stopReason: tool_use')
    expect(secondCall.data.payload).toContain('"input_tokens":23')
    expect(secondCall.data.payload).toContain('"cache_read_input_tokens":3840')
  })

  it('returns 200 with correct response shape', async () => {
    const input = {
      agentId: 'agent-1',
      messages: [{ role: 'user', content: 'Hello' }],
    }

    const res = await POST(makeRequest(input))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data).toEqual({
      caseId: 'case-123',
      chatId: expect.stringMatching(/^pg_saved_/),
    })
  })
})
