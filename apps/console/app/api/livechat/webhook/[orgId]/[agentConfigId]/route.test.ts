import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const mockHandleIncomingEvent = vi.fn()
  const mockSendTextMessage = vi.fn()
  const mockIsDuplicateWebhook = vi.fn()
  const mockGetLiveChatConfig = vi.fn()
  const mockCheckRateLimit = vi.fn()
  const agentConfigs: Record<string, { id: string; name: string; orgId: string; isActive: boolean }> = {
    'active-agent': { id: 'active-agent', name: 'J1B', orgId: 'default', isActive: true },
  }

  return {
    agentConfigs,
    mockHandleIncomingEvent,
    mockSendTextMessage,
    mockIsDuplicateWebhook,
    mockGetLiveChatConfig,
    mockCheckRateLimit,
  }
})

vi.mock('@/lib/api/define-route', () => {
  class UnauthorizedError extends Error {}
  class NotFoundError extends Error {}

  return {
    UnauthorizedError,
    NotFoundError,
    defineRoute:
      ({ handler }: { handler: (ctx: { params: { orgId: string; agentConfigId: string }; repo: any }) => Promise<Response> }) =>
      async (_request: any, ctx: { params: Promise<{ orgId: string; agentConfigId: string }> }) => {
        const params = await ctx.params
        const repo = {
          agentConfig: {
            findFirst: vi.fn(async ({ where }: { where: { id: string; isActive: boolean } }) => {
              const config = h.agentConfigs[where.id]
              if (!config || !config.isActive) return null
              return { id: config.id, name: config.name, orgId: config.orgId }
            }),
          },
        }

        try {
          return await handler({ params, repo })
        } catch (error) {
          if (error instanceof UnauthorizedError) return Response.json({ error: error.message }, { status: 401 })
          if (error instanceof NotFoundError) return Response.json({ error: error.message }, { status: 404 })
          throw error
        }
      },
  }
})

vi.mock('@/lib/livechat/bridge', () => ({
  handleIncomingEvent: h.mockHandleIncomingEvent,
}))

vi.mock('@/lib/livechat/livechat-api', () => ({
  sendTextMessage: h.mockSendTextMessage,
}))

vi.mock('@/lib/livechat/webhook-dedup', () => ({
  isDuplicateWebhook: h.mockIsDuplicateWebhook,
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: h.mockCheckRateLimit,
}))

vi.mock('@/lib/livechat/config-store', () => ({
  getLiveChatConfig: h.mockGetLiveChatConfig,
}))

import { POST } from '@/app/api/livechat/webhook/[orgId]/[agentConfigId]/route'

function makeRequest(body: Record<string, unknown>) {
  return {
    text: async () => JSON.stringify(body),
  } as any
}

function makeCtx() {
  return { params: Promise.resolve({ orgId: 'default', agentConfigId: 'active-agent' }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59, resetAt: Date.now() + 60_000 })
  h.mockIsDuplicateWebhook.mockResolvedValue(false)
  h.mockSendTextMessage.mockResolvedValue(undefined)
  h.mockHandleIncomingEvent.mockResolvedValue(undefined)
  h.mockGetLiveChatConfig.mockResolvedValue({
    enabled: true,
    webhookSecret: 'sec_livechat',
    agentAccountId: 'agent-1',
    botAccessToken: 'token',
    licenseId: 'license',
    region: 'dal',
    authType: 'auto',
    accountId: 'acct',
    showSkillStatus: true,
  })
})

describe('per-agent LiveChat webhook route', () => {
  it('forwards incoming_event text messages into the bridge as message events', async () => {
    const res = await POST(
      makeRequest({
        action: 'incoming_event',
        chat_id: 'chat-1',
        secret_key: 'sec_livechat',
        payload: {
          event: {
            id: 'evt-1',
            type: 'message',
            text: 'Deposit still missing',
            author: { id: 'customer-1' },
          },
        },
      }),
      makeCtx(),
    )

    expect(res.status).toBe(200)
    expect(h.mockHandleIncomingEvent).toHaveBeenCalledWith(
      'chat-1',
      'default',
      'customer-1',
      { type: 'message', text: 'Deposit still missing' },
      expect.objectContaining({ enabled: true }),
      'active-agent',
    )
    expect(h.mockSendTextMessage).not.toHaveBeenCalled()
  })

  it('processes the first incoming_chat thread message instead of short-circuiting to chat_started', async () => {
    const res = await POST(
      makeRequest({
        action: 'incoming_chat',
        chat_id: 'chat-2',
        secret_key: 'sec_livechat',
        payload: {
          chat: {
            thread: {
              events: [
                {
                  id: 'evt-first',
                  type: 'message',
                  text: 'I cannot log in',
                  author_id: 'customer-2',
                },
              ],
            },
          },
        },
      }),
      makeCtx(),
    )

    expect(res.status).toBe(200)
    expect(h.mockIsDuplicateWebhook).toHaveBeenCalledWith('livechat:evt-first')
    expect(h.mockHandleIncomingEvent).toHaveBeenCalledWith(
      'chat-2',
      'default',
      'customer-2',
      { type: 'message', text: 'I cannot log in' },
      expect.objectContaining({ enabled: true }),
      'active-agent',
    )
    expect(h.mockSendTextMessage).not.toHaveBeenCalled()
  })
})
