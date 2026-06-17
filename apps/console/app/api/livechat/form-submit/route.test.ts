import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetSession = vi.fn()
const mockGetLiveChatConfigForFamily = vi.fn()
const mockGetLiveChatConfigForOrg = vi.fn()
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
  getLiveChatConfigForOrg: (...args: unknown[]) => mockGetLiveChatConfigForOrg(...args),
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
  mockGetLiveChatConfigForOrg.mockResolvedValue(null)
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
      answers: { member_id: 'JAYA11C5184', amount: 800 },
    }) as any)

    expect(res.status).toBe(200)
    expect(mockGetLiveChatConfigForFamily).toHaveBeenCalledWith('agent-1')
    expect(mockGetLiveChatConfigForOrg).not.toHaveBeenCalled()
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

  it('falls back to the org active binding for legacy sessions that predate agentConfig persistence', async () => {
    const config = { enabled: true, botAccessToken: 'bot', licenseId: 'lic' }
    mockGetSession.mockResolvedValue({
      chatId: 'chat-legacy',
      orgId: 'default',
      userId: 'user-2',
      caseId: 'case-legacy',
      state: 'idle',
      textBuffer: '',
    })
    mockGetLiveChatConfigForOrg.mockResolvedValue({
      agentConfigId: 'agent-active',
      config,
    })

    const res = await POST(makeRequest({
      chatId: 'chat-legacy',
      caseId: 'case-legacy',
      answers: { member_id: 'JAYA11C5184' },
    }) as any)

    expect(res.status).toBe(200)
    expect(mockGetLiveChatConfigForFamily).not.toHaveBeenCalled()
    expect(mockGetLiveChatConfigForOrg).toHaveBeenCalledWith('default')
    expect(mockHandleIncomingEvent).toHaveBeenCalledWith(
      'chat-legacy',
      'default',
      'user-2',
      {
        type: 'form_submit',
        form: {
          caseId: 'case-legacy',
          answers: { member_id: 'JAYA11C5184' },
        },
      },
      config,
      'agent-active',
    )
  })

  it('returns 404 when neither the session binding nor the org fallback is configured', async () => {
    mockGetSession.mockResolvedValue({
      chatId: 'chat-missing',
      orgId: 'default',
      userId: 'user-3',
      caseId: 'case-missing',
      state: 'idle',
      textBuffer: '',
    })

    const res = await POST(makeRequest({
      chatId: 'chat-missing',
      answers: { member_id: 'JAYA11C5184' },
    }) as any)

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: 'LiveChat channel not configured' })
    expect(mockHandleIncomingEvent).not.toHaveBeenCalled()
  })
})
