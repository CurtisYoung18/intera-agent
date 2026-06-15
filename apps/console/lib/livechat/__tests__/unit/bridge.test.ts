import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SSEEvent } from '@intera/shared/types'
import type { IncomingEvent, LiveChatConfig } from '../../types'

const mockGetSession = vi.fn()
const mockUpsertSession = vi.fn()
const mockUpdateSessionState = vi.fn()
const mockAppendTextBuffer = vi.fn()
const mockFlushTextBuffer = vi.fn()
const mockCloseSession = vi.fn()

const mockSendTextMessage = vi.fn()
const mockSendWidgetPayload = vi.fn()
const mockSendQuickReplies = vi.fn()
const mockSendCard = vi.fn()
const mockSendCarousel = vi.fn()
const mockSendImage = vi.fn()
const mockSendSystemMessage = vi.fn()
const mockSetTypingIndicator = vi.fn()
const mockTransferChat = vi.fn()
const mockDeactivateChat = vi.fn()

const mockEnqueueRetry = vi.fn()
const mockFetch = vi.fn()
const mockResolveRenderableImageUrls = vi.fn()

vi.mock('../../session-store', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  upsertSession: (...args: unknown[]) => mockUpsertSession(...args),
  updateSessionState: (...args: unknown[]) => mockUpdateSessionState(...args),
  appendTextBuffer: (...args: unknown[]) => mockAppendTextBuffer(...args),
  flushTextBuffer: (...args: unknown[]) => mockFlushTextBuffer(...args),
  closeSession: (...args: unknown[]) => mockCloseSession(...args),
}))

vi.mock('../../livechat-api', () => ({
  sendTextMessage: (...args: unknown[]) => mockSendTextMessage(...args),
  sendWidgetPayload: (...args: unknown[]) => mockSendWidgetPayload(...args),
  sendQuickReplies: (...args: unknown[]) => mockSendQuickReplies(...args),
  sendCard: (...args: unknown[]) => mockSendCard(...args),
  sendCarousel: (...args: unknown[]) => mockSendCarousel(...args),
  sendImage: (...args: unknown[]) => mockSendImage(...args),
  sendSystemMessage: (...args: unknown[]) => mockSendSystemMessage(...args),
  setTypingIndicator: (...args: unknown[]) => mockSetTypingIndicator(...args),
  transferChat: (...args: unknown[]) => mockTransferChat(...args),
  deactivateChat: (...args: unknown[]) => mockDeactivateChat(...args),
}))

vi.mock('../../retry-queue', () => ({
  enqueueRetry: (...args: unknown[]) => mockEnqueueRetry(...args),
}))

vi.mock('../../image-utils', () => ({
  downloadAndEncode: vi.fn(),
  isSupportedImageType: vi.fn(() => false),
  resolveRenderableImageUrls: (...args: unknown[]) => mockResolveRenderableImageUrls(...args),
}))

vi.mock('../../internal-messages-url', () => ({
  getInternalMessagesUrl: () => 'https://internal.example/api/messages',
}))

vi.mock('@/lib/utils', () => ({
  generateCaseId: () => 'case-generated',
}))

import { handleIncomingEvent } from '../../bridge'

function makeConfig(overrides?: Partial<LiveChatConfig>): LiveChatConfig {
  return {
    orgId: 'org-1',
    botAccessToken: 'bot-token',
    licenseId: 'lic-1',
    showSkillStatus: false,
    enabled: true,
    transferGroupId: 12,
    ...overrides,
  }
}

function makeSession() {
  return {
    chatId: 'chat-1',
    orgId: 'org-1',
    userId: 'user-1',
    caseId: 'case-1',
    state: 'idle' as const,
    textBuffer: '',
  }
}

function makeSseResponse(events: SSEEvent[]): Response {
  const payload = `${events.map((event) => `data: ${JSON.stringify(event)}`).join('\n')}\n`
  return new Response(payload, { status: 200 })
}

describe('livechat bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(makeSession())
    mockFlushTextBuffer.mockResolvedValue('')
    mockUpdateSessionState.mockResolvedValue(undefined)
    mockAppendTextBuffer.mockResolvedValue(undefined)
    mockSendTextMessage.mockResolvedValue(undefined)
    mockSendImage.mockResolvedValue(undefined)
    mockSetTypingIndicator.mockResolvedValue(undefined)
    mockTransferChat.mockResolvedValue(undefined)
    mockDeactivateChat.mockResolvedValue(undefined)
    mockResolveRenderableImageUrls.mockResolvedValue([])
    mockFetch.mockResolvedValue(makeSseResponse([]))
    vi.stubGlobal('fetch', mockFetch)
  })

  it('keeps the bridge state transferred after a successful handoff', async () => {
    mockFetch.mockResolvedValueOnce(makeSseResponse([
      { type: 'escalated', data: {}, timestamp: '2026-06-11T09:34:44.000Z' },
    ]))

    await handleIncomingEvent(
      'chat-1',
      'org-1',
      'user-1',
      { type: 'message', text: 'human agent please' } satisfies IncomingEvent,
      makeConfig(),
    )

    expect(mockTransferChat).toHaveBeenCalledWith(
      'chat-1',
      { type: 'group', ids: [12] },
      'bot-token',
      'lic-1',
      undefined,
      undefined,
      undefined,
    )
    expect(mockUpdateSessionState).toHaveBeenCalledWith('chat-1', 'thinking')
    expect(mockUpdateSessionState).toHaveBeenCalledWith('chat-1', 'transferred')
    expect(mockUpdateSessionState).not.toHaveBeenCalledWith('chat-1', 'idle')
    expect(mockSetTypingIndicator).not.toHaveBeenCalledWith('chat-1', false, 'bot-token', 'lic-1', undefined, undefined, undefined)
  })

  it('flushes pending text before transfer and drops later post-transfer flushes', async () => {
    mockFlushTextBuffer.mockResolvedValueOnce('We created a support ticket.')
    mockFetch.mockResolvedValueOnce(makeSseResponse([
      { type: 'text_delta', data: 'We created a support ticket.', timestamp: '2026-06-11T09:34:43.000Z' },
      { type: 'escalated', data: {}, timestamp: '2026-06-11T09:34:44.000Z' },
      { type: 'message_stop', data: { reason: 'waiting_human' }, timestamp: '2026-06-11T09:34:45.000Z' },
    ]))

    await handleIncomingEvent(
      'chat-1',
      'org-1',
      'user-1',
      { type: 'message', text: 'please transfer me' } satisfies IncomingEvent,
      makeConfig(),
    )

    expect(mockAppendTextBuffer).toHaveBeenCalledWith('chat-1', 'We created a support ticket.')
    expect(mockFlushTextBuffer).toHaveBeenCalledTimes(1)
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1)
    expect(mockSendTextMessage).toHaveBeenCalledWith(
      'chat-1',
      'We created a support ticket.',
      'bot-token',
      'lic-1',
      undefined,
      undefined,
      undefined,
    )
    expect(mockTransferChat).toHaveBeenCalledTimes(1)
  })

  it('sends image events after flushing assistant text with renderable image urls', async () => {
    mockResolveRenderableImageUrls.mockResolvedValue([
      'https://i.postimg.cc/example/demo.jpg',
      'https://example.com/guide.png',
    ])
    mockFetch.mockResolvedValueOnce(makeSseResponse([
      {
        type: 'text_delta',
        data: '注册指引：https://postimg.cc/abc123 查看玩家 ID：https://example.com/guide.png',
        timestamp: '2026-06-11T09:34:43.000Z',
      },
      { type: 'message_stop', data: { reason: 'end_turn' }, timestamp: '2026-06-11T09:34:44.000Z' },
    ]))
    mockFlushTextBuffer.mockResolvedValueOnce('注册指引：https://postimg.cc/abc123 查看玩家 ID：https://example.com/guide.png')

    await handleIncomingEvent(
      'chat-1',
      'org-1',
      'user-1',
      { type: 'message', text: '有图片指引吗' } satisfies IncomingEvent,
      makeConfig(),
    )

    expect(mockSendTextMessage).toHaveBeenCalledWith(
      'chat-1',
      '注册指引：https://postimg.cc/abc123 查看玩家 ID：https://example.com/guide.png',
      'bot-token',
      'lic-1',
      undefined,
      undefined,
      undefined,
    )
    expect(mockResolveRenderableImageUrls).toHaveBeenCalledWith(
      '注册指引：https://postimg.cc/abc123 查看玩家 ID：https://example.com/guide.png',
    )
    expect(mockSendImage).toHaveBeenCalledTimes(2)
    expect(mockSendImage).toHaveBeenNthCalledWith(
      1,
      'chat-1',
      'https://i.postimg.cc/example/demo.jpg',
      undefined,
      'bot-token',
      'lic-1',
      undefined,
      undefined,
      undefined,
    )
    expect(mockSendImage).toHaveBeenNthCalledWith(
      2,
      'chat-1',
      'https://example.com/guide.png',
      undefined,
      'bot-token',
      'lic-1',
      undefined,
      undefined,
      undefined,
    )
  })

  it('resumes a transferred session when a new customer message returns to Intera', async () => {
    mockGetSession.mockResolvedValue({
      ...makeSession(),
      state: 'transferred',
    })
    mockFetch.mockResolvedValueOnce(makeSseResponse([
      { type: 'text_delta', data: 'Welcome back.', timestamp: '2026-06-15T03:30:00.000Z' },
      { type: 'message_stop', data: { reason: 'end_turn' }, timestamp: '2026-06-15T03:30:01.000Z' },
    ]))
    mockFlushTextBuffer.mockResolvedValueOnce('Welcome back.')

    await handleIncomingEvent(
      'chat-1',
      'org-1',
      'user-1',
      { type: 'message', text: 'hello again' } satisfies IncomingEvent,
      makeConfig(),
    )

    expect(mockUpsertSession).toHaveBeenCalledWith(expect.objectContaining({
      chatId: 'chat-1',
      caseId: 'case-1',
      state: 'idle',
      textBuffer: '',
    }))
    expect(mockUpdateSessionState).toHaveBeenCalledWith('chat-1', 'thinking')
    expect(mockSendTextMessage).toHaveBeenCalledWith(
      'chat-1',
      'Welcome back.',
      'bot-token',
      'lic-1',
      undefined,
      undefined,
      undefined,
    )
  })
})
