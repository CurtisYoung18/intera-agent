import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetSession = vi.fn()
const mockRotateSessionCase = vi.fn()

vi.mock('@/lib/livechat/session-store', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  rotateSessionCase: (...args: unknown[]) => mockRotateSessionCase(...args),
}))

vi.mock('@/lib/utils', () => ({
  generateCaseId: () => 'case-next',
}))

import { POST } from './route'

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/livechat/widget-session-close', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/livechat/widget-session-close', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rotates only when chat, org, and agent match the stored session', async () => {
    mockGetSession.mockResolvedValue({
      chatId: 'chat-1',
      orgId: 'default',
      userId: 'user-1',
      caseId: 'case-1',
      agentConfigId: 'agent-1',
      state: 'idle',
      textBuffer: '',
    })

    const res = await POST(makeRequest({
      chatId: 'chat-1',
      orgId: 'default',
      agentConfigId: 'agent-1',
    }) as any)

    expect(res.status).toBe(200)
    expect(mockRotateSessionCase).toHaveBeenCalledWith('chat-1', 'case-next')
  })

  it('rejects a matching chatId with the wrong agent scope', async () => {
    mockGetSession.mockResolvedValue({
      chatId: 'chat-1',
      orgId: 'default',
      userId: 'user-1',
      caseId: 'case-1',
      agentConfigId: 'agent-1',
      state: 'idle',
      textBuffer: '',
    })

    const res = await POST(makeRequest({
      chatId: 'chat-1',
      orgId: 'default',
      agentConfigId: 'agent-2',
    }) as any)

    expect(res.status).toBe(403)
    expect(mockRotateSessionCase).not.toHaveBeenCalled()
  })
})
