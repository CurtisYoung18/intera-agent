import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SSEEvent } from '@intera/shared/types'
import type { IncomingEvent, LiveChatConfig } from '../../types'

const mockGetSession = vi.fn()
const mockUpsertSession = vi.fn()
const mockUpdateSessionState = vi.fn()
const mockAppendTextBuffer = vi.fn()
const mockFlushTextBuffer = vi.fn()
const mockCloseSession = vi.fn()
const mockRotateSessionCase = vi.fn()
const mockConfirmProcedureHumanHandoff = vi.fn()

const mockSendTextMessage = vi.fn()
const mockSendAgentNote = vi.fn()
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
const mockDownloadAndEncode = vi.fn()
const mockIsLikelyImageAttachment = vi.fn()
const mockResolveRenderableImageUrls = vi.fn()
const mockActionTraceCreate = vi.hoisted(() => vi.fn())

vi.mock('@intera/shared/prisma', () => ({
  prisma: {
    actionTrace: {
      create: (...args: unknown[]) => mockActionTraceCreate(...args),
    },
  },
}))

vi.mock('../../session-store', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  upsertSession: (...args: unknown[]) => mockUpsertSession(...args),
  updateSessionState: (...args: unknown[]) => mockUpdateSessionState(...args),
  appendTextBuffer: (...args: unknown[]) => mockAppendTextBuffer(...args),
  flushTextBuffer: (...args: unknown[]) => mockFlushTextBuffer(...args),
  closeSession: (...args: unknown[]) => mockCloseSession(...args),
  rotateSessionCase: (...args: unknown[]) => mockRotateSessionCase(...args),
}))

vi.mock('@/lib/agent/session-store', () => ({
  confirmProcedureHumanHandoff: (...args: unknown[]) => mockConfirmProcedureHumanHandoff(...args),
}))

vi.mock('../../livechat-api', () => ({
  sendAgentNote: (...args: unknown[]) => mockSendAgentNote(...args),
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
  downloadAndEncode: (...args: unknown[]) => mockDownloadAndEncode(...args),
  isLikelyImageAttachment: (...args: unknown[]) => mockIsLikelyImageAttachment(...args),
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
    mockRotateSessionCase.mockResolvedValue(undefined)
    mockConfirmProcedureHumanHandoff.mockResolvedValue({ ok: true })
    mockSendTextMessage.mockResolvedValue(undefined)
    mockSendAgentNote.mockResolvedValue(undefined)
    mockSendImage.mockResolvedValue(undefined)
    mockSetTypingIndicator.mockResolvedValue(undefined)
    mockTransferChat.mockResolvedValue(undefined)
    mockDeactivateChat.mockResolvedValue(undefined)
    mockDownloadAndEncode.mockResolvedValue({ contentType: 'image/png', data: 'base64-image' })
    mockIsLikelyImageAttachment.mockReturnValue(false)
    mockResolveRenderableImageUrls.mockResolvedValue([])
    mockActionTraceCreate.mockResolvedValue({})
    mockFetch.mockResolvedValue(makeSseResponse([]))
    vi.stubGlobal('fetch', mockFetch)
  })

  it('keeps the bridge state transferred after a successful handoff', async () => {
    mockFetch.mockResolvedValueOnce(makeSseResponse([
      { type: 'human_task_created', data: { taskId: 'task-1', queue: 'general' }, timestamp: '2026-06-11T09:34:43.500Z' },
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
    expect(mockConfirmProcedureHumanHandoff).toHaveBeenCalledWith('case-1', {
      agentConfigId: undefined,
      taskId: 'task-1',
      queue: 'general',
    })
    expect(mockUpdateSessionState).toHaveBeenCalledWith('chat-1', 'thinking')
    expect(mockUpdateSessionState).toHaveBeenCalledWith('chat-1', 'transferred')
    expect(mockUpdateSessionState).not.toHaveBeenCalledWith('chat-1', 'idle')
    expect(mockSetTypingIndicator).not.toHaveBeenCalledWith('chat-1', false, 'bot-token', 'lic-1', undefined, undefined, undefined)
  })

  it('flushes model handoff text before transferring without requiring a handoff card', async () => {
    mockFlushTextBuffer.mockResolvedValueOnce('Maile human support task create gareko chu.')
    mockFetch.mockResolvedValueOnce(makeSseResponse([
      { type: 'human_task_created', data: { taskId: 'task-1', queue: 'general' }, timestamp: '2026-06-11T09:34:43.500Z' },
      { type: 'escalated', data: {}, timestamp: '2026-06-11T09:34:44.000Z' },
    ]))

    await handleIncomingEvent(
      'chat-1',
      'org-1',
      'user-1',
      { type: 'message', text: 'human agent please' } satisfies IncomingEvent,
      makeConfig(),
    )

    expect(mockSendTextMessage).toHaveBeenCalledWith(
      'chat-1',
      'Maile human support task create gareko chu.',
      'bot-token',
      'lic-1',
      undefined,
      undefined,
      undefined,
    )
    expect(mockSendCard).not.toHaveBeenCalled()
    expect(mockTransferChat).toHaveBeenCalled()
    expect(mockSendTextMessage.mock.invocationCallOrder[0]).toBeLessThan(mockTransferChat.mock.invocationCallOrder[0])
  })

  it('posts an agent-only handoff note from create_human_task summary fields', async () => {
    mockFetch.mockResolvedValueOnce(makeSseResponse([
      {
        type: 'human_task_created',
        data: {
          taskId: 'task-1',
          queue: 'payment_ops',
          question: 'Please review this deposit issue.',
          chat_summary: 'Customer le deposit gareko cha tara balance update bhayeko chaina.',
          known_facts: {
            member_id: 'JAYA1197202',
            amount: '500 NPR',
            automated_tools: 'kb_search_deposit, check_latest_deposit_status, start_procedure',
          },
          handoff_reason: 'Tool evidence ra customer report milena, human payment team le verify garnu parcha.',
        },
        timestamp: '2026-06-11T09:34:43.500Z',
      },
      { type: 'escalated', data: {}, timestamp: '2026-06-11T09:34:44.000Z' },
    ]))

    await handleIncomingEvent(
      'chat-1',
      'org-1',
      'user-1',
      { type: 'message', text: 'human agent please' } satisfies IncomingEvent,
      makeConfig(),
    )

    expect(mockSendAgentNote).toHaveBeenCalledWith(
      'chat-1',
      expect.stringContaining('[Intera] Human handoff'),
      'bot-token',
      'lic-1',
      undefined,
      undefined,
      undefined,
    )
    const note = String(mockSendAgentNote.mock.calls[0]?.[1] ?? '')
    expect(note).not.toContain('Queue:')
    expect(note).not.toContain('Task ID:')
    expect(note).not.toContain('payment_ops')
    expect(note).toContain('Customer le deposit gareko cha')
    expect(note).toContain('Member ID: JAYA1197202')
    expect(note).toContain('Amount: 500 NPR')
    expect(note).not.toContain('kb_search_deposit')
    expect(note).not.toContain('check_latest_deposit_status')
    expect(note).toContain('human payment team le verify garnu parcha')
    expect(mockTransferChat).toHaveBeenCalled()
  })

  it('supports route-level handoff without a customer card before transfer', async () => {
    mockFlushTextBuffer
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('Maile human support task create gareko chu.')
    mockFetch.mockResolvedValueOnce(makeSseResponse([
      {
        type: 'human_task_created',
        data: {
          taskId: 'task-1',
          queue: 'payment_ops',
          suppressCustomerCard: true,
          chat_summary: 'Customer le deposit support pachhi pani issue solve bhayena bhanera report gareko cha.',
          known_facts: {
            case_type: 'j1n_deposit_status',
            member_id: 'JAYA1197202',
          },
          handoff_reason: 'Customer le human agent lai transfer garnuhos bhanera spashta request gareko cha.',
        },
        timestamp: '2026-06-11T09:34:43.500Z',
      },
      {
        type: 'text_delta',
        data: 'Maile human support task create gareko chu.',
        timestamp: '2026-06-11T09:34:43.750Z',
      },
      { type: 'escalated', data: { reason: 'human_task_created', taskId: 'task-1', queue: 'payment_ops' }, timestamp: '2026-06-11T09:34:44.000Z' },
    ]))

    await handleIncomingEvent(
      'chat-1',
      'org-1',
      'user-1',
      { type: 'message', text: 'human agent please' } satisfies IncomingEvent,
      makeConfig(),
    )

    expect(mockSendCard).not.toHaveBeenCalled()
    expect(mockSendAgentNote).toHaveBeenCalled()
    const note = String(mockSendAgentNote.mock.calls[0]?.[1] ?? '')
    expect(note).toContain('Issue summary:')
    expect(note).toContain('Known facts collected:')
    expect(note).toContain('Member ID: JAYA1197202')
    expect(note).toContain('Reason for handoff:')
    expect(note).not.toContain('Queue:')
    expect(note).not.toContain('Task ID:')
    expect(note).not.toContain('case_type')
    expect(note).not.toContain('j1n_deposit_status')
    expect(mockSendTextMessage).toHaveBeenCalledWith(
      'chat-1',
      'Maile human support task create gareko chu.',
      'bot-token',
      'lic-1',
      undefined,
      undefined,
      undefined,
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
    expect(mockSendTextMessage.mock.invocationCallOrder[0]).toBeLessThan(mockTransferChat.mock.invocationCallOrder[0])
  })

  it('posts an agent-only note when a form is requested', async () => {
    mockFetch.mockResolvedValueOnce(makeSseResponse([
      {
        type: 'form_request',
        data: {
          caseId: 'case-1',
          title: 'Member ID Required',
          description: 'Please share your member id.',
          fields: [
            { id: 'member_id', type: 'text', label: 'Member ID', required: true },
          ],
        },
        timestamp: '2026-06-17T10:00:00.000Z',
      },
      { type: 'message_stop', data: { reason: 'end_turn' }, timestamp: '2026-06-17T10:00:01.000Z' },
    ]))

    await handleIncomingEvent(
      'chat-1',
      'org-1',
      'user-1',
      { type: 'message', text: 'check deposit' } satisfies IncomingEvent,
      makeConfig(),
    )

    expect(mockSendAgentNote).toHaveBeenCalledWith(
      'chat-1',
      expect.stringContaining('[Intera] Form requested'),
      'bot-token',
      'lic-1',
      undefined,
      undefined,
      undefined,
    )
    expect(mockSendCard).toHaveBeenCalled()
    expect(mockActionTraceCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        caseId: 'case-1',
        orgId: 'org-1',
        chatId: 'chat-1',
        actionType: 'channel_rich_message',
        title: 'LiveChat rich message: card',
        payload: expect.stringContaining('"sourceEventType":"form_request"'),
      }),
    })
  })

  it('sends renderable guide images from form request text before the form card', async () => {
    mockResolveRenderableImageUrls.mockResolvedValueOnce(['https://i.postimg.cc/example/player-id-guide.jpg'])
    mockFetch.mockResolvedValueOnce(makeSseResponse([
      {
        type: 'form_request',
        data: {
          caseId: 'case-1',
          title: 'Member ID Required',
          description: 'Please share your member id. Guide: https://postimg.cc/9RS75mwK',
          fields: [
            { id: 'member_id', type: 'text', label: 'Member ID', required: true },
          ],
        },
        timestamp: '2026-06-17T10:00:00.000Z',
      },
      { type: 'message_stop', data: { reason: 'end_turn' }, timestamp: '2026-06-17T10:00:01.000Z' },
    ]))

    await handleIncomingEvent(
      'chat-1',
      'org-1',
      'user-1',
      { type: 'message', text: 'check account status' } satisfies IncomingEvent,
      makeConfig(),
    )

    expect(mockResolveRenderableImageUrls).toHaveBeenCalledWith(expect.stringContaining('https://postimg.cc/9RS75mwK'))
    expect(mockSendImage).toHaveBeenCalledWith(
      'chat-1',
      'https://i.postimg.cc/example/player-id-guide.jpg',
      undefined,
      'bot-token',
      'lic-1',
      undefined,
      undefined,
      undefined,
    )
    expect(mockSendCard).toHaveBeenCalled()
    expect(mockSendImage.mock.invocationCallOrder[0]).toBeLessThan(mockSendCard.mock.invocationCallOrder[0])
  })

  it('adds the player id guide image for member id forms even when the model omits the link', async () => {
    mockResolveRenderableImageUrls.mockResolvedValueOnce(['https://i.postimg.cc/example/player-id-guide.jpg'])
    mockFetch.mockResolvedValueOnce(makeSseResponse([
      {
        type: 'form_request',
        data: {
          caseId: 'case-1',
          title: 'Member ID Required for Account Status',
          description: 'Please provide your Jayabaji Member ID so I can check your account status.',
          fields: [
            { id: 'member_id', type: 'text', label: 'Member ID', required: true },
          ],
        },
        timestamp: '2026-06-17T10:00:00.000Z',
      },
      { type: 'message_stop', data: { reason: 'end_turn' }, timestamp: '2026-06-17T10:00:01.000Z' },
    ]))

    await handleIncomingEvent(
      'chat-1',
      'org-1',
      'user-1',
      { type: 'message', text: 'can u check my account status' } satisfies IncomingEvent,
      makeConfig({ playerIdGuideImageUrl: 'https://postimg.cc/9RS75mwK' }),
    )

    expect(mockResolveRenderableImageUrls).toHaveBeenCalledWith(expect.stringContaining('https://postimg.cc/9RS75mwK'))
    expect(mockSendImage).toHaveBeenCalledTimes(1)
    expect(mockSendCard).toHaveBeenCalled()
    expect(mockSendImage.mock.invocationCallOrder[0]).toBeLessThan(mockSendCard.mock.invocationCallOrder[0])
  })

  it('uses configured player id keywords to decide when to send the guide image', async () => {
    mockResolveRenderableImageUrls.mockResolvedValueOnce(['https://i.postimg.cc/example/player-id-guide.jpg'])
    mockFetch.mockResolvedValueOnce(makeSseResponse([
      {
        type: 'form_request',
        data: {
          caseId: 'case-1',
          title: 'Account Code Required',
          description: 'Please provide your account code so I can check your account status.',
          fields: [
            { id: 'account_code', type: 'text', label: 'Account Code', required: true },
          ],
        },
        timestamp: '2026-06-17T10:00:00.000Z',
      },
      { type: 'message_stop', data: { reason: 'end_turn' }, timestamp: '2026-06-17T10:00:01.000Z' },
    ]))

    await handleIncomingEvent(
      'chat-1',
      'org-1',
      'user-1',
      { type: 'message', text: 'can u check my account status' } satisfies IncomingEvent,
      makeConfig({
        playerIdGuideImageUrl: 'https://postimg.cc/account-guide',
        playerIdGuideKeywords: ['account code'],
      }),
    )

    expect(mockResolveRenderableImageUrls).toHaveBeenCalledWith(expect.stringContaining('https://postimg.cc/account-guide'))
    expect(mockSendImage).toHaveBeenCalledTimes(1)
    expect(mockSendCard).toHaveBeenCalled()
  })

  it('posts an agent-only note when a form is submitted', async () => {
    mockFetch.mockResolvedValueOnce(makeSseResponse([
      { type: 'message_stop', data: { reason: 'end_turn' }, timestamp: '2026-06-17T10:00:01.000Z' },
    ]))

    await handleIncomingEvent(
      'chat-1',
      'org-1',
      'user-1',
      {
        type: 'form_submit',
        form: {
          caseId: 'case-1',
          title: 'Member ID Required',
          fields: [
            { id: 'member_id', type: 'text', label: 'Member ID', required: true },
          ],
          answers: { member_id: 'JAYA117FFEB' },
        },
      } satisfies IncomingEvent,
      makeConfig(),
    )

    expect(mockSendAgentNote).toHaveBeenCalledWith(
      'chat-1',
      expect.stringContaining('[Intera] Form submitted'),
      'bot-token',
      'lic-1',
      undefined,
      undefined,
      undefined,
    )
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
    const [, fetchInit] = mockFetch.mock.calls[0]!
    expect(JSON.parse(String(fetchInit.body))).not.toHaveProperty('disableCaseRouting')
    expect(JSON.parse(String(fetchInit.body))).not.toHaveProperty('sessionCasePinned')
  })

  it('drops buffered preamble text when a later turn renders a form card', async () => {
    mockFlushTextBuffer
      .mockResolvedValueOnce('Transaction history hernu ko lagi malai tapaiko Member ID chahincha.')
      .mockResolvedValueOnce('')

    mockFetch.mockResolvedValueOnce(makeSseResponse([
      {
        type: 'text_delta',
        data: 'Transaction history hernu ko lagi malai tapaiko Member ID chahincha.',
        timestamp: '2026-06-17T05:32:02.267Z',
      },
      { type: 'message_stop', data: { reason: 'next_turn' }, timestamp: '2026-06-17T05:32:02.271Z' },
      {
        type: 'form_request',
        data: {
          caseId: 'case-1',
          title: 'Transaction History',
          description: 'Please share your details so I can continue.',
          fields: [{ key: 'member_id', label: 'Member ID', type: 'text', required: true }],
        },
        timestamp: '2026-06-17T05:32:04.692Z',
      },
      { type: 'message_stop', data: { transition: 'waiting_form' }, timestamp: '2026-06-17T05:32:04.713Z' },
    ]))

    await handleIncomingEvent(
      'chat-1',
      'org-1',
      'user-1',
      { type: 'message', text: 'I need my transaction history' } satisfies IncomingEvent,
      makeConfig(),
    )

    expect(mockAppendTextBuffer).toHaveBeenCalledWith(
      'chat-1',
      'Transaction history hernu ko lagi malai tapaiko Member ID chahincha.',
    )
    expect(mockFlushTextBuffer).toHaveBeenCalledTimes(1)
    expect(mockSendTextMessage).not.toHaveBeenCalledWith(
      'chat-1',
      expect.stringContaining('Member ID chahincha'),
      'bot-token',
      'lic-1',
      undefined,
      undefined,
      undefined,
    )
    expect(mockSendCard).toHaveBeenCalledTimes(1)
  })

  it('sends LiveChat image attachments to the agent as multimodal content blocks', async () => {
    mockIsLikelyImageAttachment.mockReturnValueOnce(true)
    mockDownloadAndEncode.mockResolvedValueOnce({
      contentType: 'image/png',
      data: 'encoded-receipt',
    })
    mockFetch.mockResolvedValueOnce(makeSseResponse([
      { type: 'message_stop', data: { reason: 'end_turn' }, timestamp: '2026-06-17T10:00:01.000Z' },
    ]))

    await handleIncomingEvent(
      'chat-1',
      'org-1',
      'user-1',
      {
        type: 'attachment',
        attachment: {
          url: 'https://files.livechatinc.com/receipt-download',
          contentType: 'application/octet-stream',
          filename: 'receipt.png',
        },
      } satisfies IncomingEvent,
      makeConfig(),
      'agent-1',
    )

    expect(mockIsLikelyImageAttachment).toHaveBeenCalledWith({
      url: 'https://files.livechatinc.com/receipt-download',
      contentType: 'application/octet-stream',
      filename: 'receipt.png',
    })
    expect(mockDownloadAndEncode).toHaveBeenCalledWith(
      'https://files.livechatinc.com/receipt-download',
      { contentType: 'application/octet-stream', filename: 'receipt.png' },
    )
    const [, fetchInit] = mockFetch.mock.calls[0]!
    expect(JSON.parse(String(fetchInit.body))).toMatchObject({
      chatId: 'chat-1',
      caseId: 'case-1',
      message: 'Customer uploaded image: receipt.png',
      contentBlocks: [
        { type: 'text', text: 'Customer uploaded image: receipt.png' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'encoded-receipt' } },
      ],
      sessionCasePinned: true,
      disableCaseRouting: true,
    })
  })

  it('queues a retry when /api/messages rejects a bridge request', async () => {
    const event = { type: 'message', text: 'hello' } satisfies IncomingEvent
    mockFetch.mockResolvedValueOnce(new Response('Request body too large', { status: 502 }))

    await handleIncomingEvent(
      'chat-1',
      'org-1',
      'user-1',
      event,
      makeConfig(),
      'agent-1',
    )

    expect(mockSendTextMessage).toHaveBeenCalledWith(
      'chat-1',
      'Service is temporarily unavailable. Our systems are recovering - please try again shortly.',
      'bot-token',
      'lic-1',
      undefined,
      undefined,
      undefined,
    )
    expect(mockEnqueueRetry).toHaveBeenCalledWith(
      'chat-1',
      'org-1',
      'user-1',
      event,
      expect.stringContaining('api_messages_502: Request body too large'),
      'agent-1',
    )
    expect(mockUpdateSessionState).toHaveBeenCalledWith('chat-1', 'idle')
  })

  it('pins a new customer message to the current case while the bridge is still thinking', async () => {
    mockGetSession.mockResolvedValue({
      ...makeSession(),
      state: 'thinking',
    })
    mockFetch.mockResolvedValueOnce(makeSseResponse([
      { type: 'message_stop', data: { reason: 'queued' }, timestamp: '2026-06-15T03:30:01.000Z' },
    ]))

    await handleIncomingEvent(
      'chat-1',
      'org-1',
      'user-1',
      { type: 'message', text: '补充一句' } satisfies IncomingEvent,
      makeConfig(),
    )

    const [, fetchInit] = mockFetch.mock.calls[0]!
    expect(JSON.parse(String(fetchInit.body))).toMatchObject({
      chatId: 'chat-1',
      caseId: 'case-1',
      sessionCasePinned: true,
      disableCaseRouting: true,
      message: '补充一句',
    })
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
      caseId: 'case-generated',
      state: 'idle',
      textBuffer: '',
    }))
    const [, fetchInit] = mockFetch.mock.calls[0]!
    expect(JSON.parse(String(fetchInit.body))).toMatchObject({
      chatId: 'chat-1',
      caseId: 'case-generated',
      sessionCasePinned: true,
      message: 'hello again',
    })
    expect(JSON.parse(String(fetchInit.body))).not.toHaveProperty('disableCaseRouting')
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

  it('uses configured customer copy when /api/messages is unavailable', async () => {
    const event = { type: 'message', text: 'hello' } satisfies IncomingEvent
    mockFetch.mockResolvedValueOnce(new Response('Request body too large', { status: 502 }))

    await handleIncomingEvent(
      'chat-1',
      'org-1',
      'user-1',
      event,
      makeConfig({
        failureMessages: {
          engine_unreachable: 'We are reconnecting the assistant. Please try again in a moment.',
        },
      }),
      'agent-1',
    )

    expect(mockSendTextMessage).toHaveBeenCalledWith(
      'chat-1',
      'We are reconnecting the assistant. Please try again in a moment.',
      'bot-token',
      'lic-1',
      undefined,
      undefined,
      undefined,
    )
  })

  it('falls back to queue transfer when the configured group cannot accept the chat', async () => {
    mockFetch.mockResolvedValueOnce(makeSseResponse([
      { type: 'escalated', data: {}, timestamp: '2026-06-11T09:34:44.000Z' },
    ]))
    mockTransferChat
      .mockRejectedValueOnce(new Error('LiveChat API transfer_chat failed (422): {"error":{"type":"validation","message":"Cannot assign any agent from requested groups"}}'))
      .mockResolvedValueOnce(undefined)

    await handleIncomingEvent(
      'chat-1',
      'org-1',
      'user-1',
      { type: 'message', text: 'need a human' } satisfies IncomingEvent,
      makeConfig(),
    )

    expect(mockTransferChat).toHaveBeenNthCalledWith(
      1,
      'chat-1',
      { type: 'group', ids: [12] },
      'bot-token',
      'lic-1',
      undefined,
      undefined,
      undefined,
    )
    expect(mockTransferChat).toHaveBeenNthCalledWith(
      2,
      'chat-1',
      { type: 'queue' },
      'bot-token',
      'lic-1',
      undefined,
      undefined,
      undefined,
    )
    expect(mockRotateSessionCase).not.toHaveBeenCalled()
    expect(mockSendTextMessage).not.toHaveBeenCalledWith(
      'chat-1',
      expect.stringContaining('technical issue'),
      'bot-token',
      'lic-1',
      undefined,
      undefined,
      undefined,
    )
  })

  it('falls back to queue transfer for generic group validation failures', async () => {
    mockFetch.mockResolvedValueOnce(makeSseResponse([
      { type: 'escalated', data: {}, timestamp: '2026-06-11T09:34:44.000Z' },
    ]))
    mockTransferChat
      .mockRejectedValueOnce(new Error('LiveChat API transfer_chat failed (422): {"error":{"type":"validation","message":"Invalid transfer target"}}'))
      .mockResolvedValueOnce(undefined)

    await handleIncomingEvent(
      'chat-1',
      'org-1',
      'user-1',
      { type: 'message', text: 'need a human' } satisfies IncomingEvent,
      makeConfig(),
    )

    expect(mockTransferChat).toHaveBeenNthCalledWith(
      1,
      'chat-1',
      { type: 'group', ids: [12] },
      'bot-token',
      'lic-1',
      undefined,
      undefined,
      undefined,
    )
    expect(mockTransferChat).toHaveBeenNthCalledWith(
      2,
      'chat-1',
      { type: 'queue' },
      'bot-token',
      'lic-1',
      undefined,
      undefined,
      undefined,
    )
    expect(mockRotateSessionCase).not.toHaveBeenCalled()
  })

  it('notifies the customer and rotates the session when transfer ultimately fails', async () => {
    mockFetch.mockResolvedValueOnce(makeSseResponse([
      { type: 'escalated', data: {}, timestamp: '2026-06-11T09:34:44.000Z' },
    ]))
    mockTransferChat.mockRejectedValue(new Error('LiveChat API transfer_chat failed (500): boom'))

    await handleIncomingEvent(
      'chat-1',
      'org-1',
      'user-1',
      { type: 'message', text: 'need a human' } satisfies IncomingEvent,
      makeConfig(),
    )

    expect(mockRotateSessionCase).toHaveBeenCalledWith('chat-1', 'case-generated')
    expect(mockSendTextMessage).toHaveBeenCalledWith(
      'chat-1',
      'A technical issue occurred and has been logged. If you do not receive a response soon, please contact support.',
      'bot-token',
      'lic-1',
      undefined,
      undefined,
      undefined,
    )
  })

  it('does not deactivate the chat again when LiveChat sends a closure system message', async () => {
    await handleIncomingEvent(
      'chat-1',
      'org-1',
      'user-1',
      { type: 'message', text: 'You have closed the chat.' } satisfies IncomingEvent,
      makeConfig(),
    )

    expect(mockDeactivateChat).not.toHaveBeenCalled()
    expect(mockCloseSession).toHaveBeenCalledWith('chat-1', 'idle_timeout')
    expect(mockUpsertSession).toHaveBeenCalledWith(expect.objectContaining({
      chatId: 'chat-1',
      caseId: 'case-generated',
      state: 'idle',
      textBuffer: '',
    }))
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
