import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetSession = vi.fn()
const mockGetLiveChatConfigForFamily = vi.fn()
const mockHandleIncomingEvent = vi.fn()

vi.mock('@/lib/api/define-route', () => ({
  defineRoute:
    ({ handler }: { handler: (ctx: { input: any }) => Promise<Response> }) =>
    async (request: Request) =>
      handler({ input: await request.json() }),
}))

vi.mock('@/lib/livechat/session-store', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}))

vi.mock('@/lib/livechat/config-store', () => ({
  getLiveChatConfigForFamily: (...args: unknown[]) => mockGetLiveChatConfigForFamily(...args),
}))

vi.mock('@/lib/livechat/bridge', () => ({
  handleIncomingEvent: (...args: unknown[]) => mockHandleIncomingEvent(...args),
}))

import { POST } from '@/app/api/livechat/form-submit/route'

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/livechat/form-submit', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockHandleIncomingEvent.mockResolvedValue(undefined)
  mockGetLiveChatConfigForFamily.mockResolvedValue(null)
})

describe('POST /api/livechat/form-submit', () => {
  it('uses the session agentConfigId when the chat was seeded from a per-agent webhook', async () => {
    const config = { enabled: true, botAccessToken: 'bot', licenseId: 'lic' }
    mockGetSession.mockResolvedValue({
      chatId: 'chat-1',
      orgId: 'default',
      userId: 'user-1',
      caseId: 'case-1',
      agentConfigId: 'agent-1',
      state: 'idle',
      textBuffer: '',
    })
    mockGetLiveChatConfigForFamily.mockResolvedValue(config)

    const res = await POST(makeRequest({
      chatId: 'chat-1',
      orgId: 'default',
      agentConfigId: 'agent-1',
      answers: { member_id: 'JAYA11C5184', amount: 800 },
    }) as any)

    expect(res.status).toBe(200)
    expect(mockGetLiveChatConfigForFamily).toHaveBeenCalledWith('agent-1')
    expect(mockHandleIncomingEvent).toHaveBeenCalledWith(
      'chat-1',
      'default',
      'user-1',
      {
        type: 'form_submit',
        form: {
          caseId: 'case-1',
          answers: { member_id: 'JAYA11C5184', amount: '800' },
        },
      },
      config,
      'agent-1',
    )
  })

  it('rejects form submission when request agent scope does not match the stored session', async () => {
    mockGetSession.mockResolvedValue({
      chatId: 'chat-1',
      orgId: 'default',
      userId: 'user-2',
      caseId: 'case-1',
      agentConfigId: 'agent-1',
      state: 'idle',
      textBuffer: '',
    })

    const res = await POST(makeRequest({
      chatId: 'chat-1',
      orgId: 'default',
      agentConfigId: 'agent-2',
      answers: { member_id: 'JAYA11C5184' },
    }) as any)

    expect(res.status).toBe(403)
    expect(mockGetLiveChatConfigForFamily).not.toHaveBeenCalled()
    expect(mockHandleIncomingEvent).not.toHaveBeenCalled()
  })

  it('returns 404 when the scoped agent LiveChat binding is not configured', async () => {
    mockGetSession.mockResolvedValue({
      chatId: 'chat-missing',
      orgId: 'default',
      userId: 'user-3',
      caseId: 'case-missing',
      agentConfigId: 'agent-1',
      state: 'idle',
      textBuffer: '',
    })

    const res = await POST(makeRequest({
      chatId: 'chat-missing',
      orgId: 'default',
      agentConfigId: 'agent-1',
      answers: { member_id: 'JAYA11C5184' },
    }) as any)

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: 'LiveChat channel not configured' })
    expect(mockHandleIncomingEvent).not.toHaveBeenCalled()
  })
})
