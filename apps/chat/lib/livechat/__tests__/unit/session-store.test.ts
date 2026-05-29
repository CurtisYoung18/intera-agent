import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFindUnique = vi.fn()
const mockUpsert = vi.fn()
const mockUpdate = vi.fn()
const mockTx = vi.fn()

vi.mock('@intera/shared/prisma', () => ({
  prisma: {
    externalConversation: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      upsert: (...args: unknown[]) => mockUpsert(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
    $executeRaw: vi.fn(),
    $transaction: (...args: unknown[]) => mockTx(...args),
    $queryRaw: vi.fn(),
  },
}))

import { getSession, upsertSession, updateSessionState, closeSession } from '../../session-store'

describe('session-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getSession', () => {
    it('returns null when session not found', async () => {
      mockFindUnique.mockResolvedValue(null)
      const session = await getSession('chat-1')
      expect(session).toBeNull()
    })

    it('returns session row when found', async () => {
      mockFindUnique.mockResolvedValue({
        externalChatId: 'chat-1',
        vendorId: 'cust-1',
        internalCaseId: 'case-1',
        bridgeState: 'idle',
        textBuffer: '',
        metadata: { userId: 'user-1' },
      })
      const session = await getSession('chat-1')
      expect(session).toEqual({
        chatId: 'chat-1',
        vendorId: 'cust-1',
        userId: 'user-1',
        caseId: 'case-1',
        state: 'idle',
        textBuffer: '',
      })
    })

    it('returns null on prisma error', async () => {
      mockFindUnique.mockRejectedValue(new Error('DB down'))
      const session = await getSession('chat-1')
      expect(session).toBeNull()
    })
  })

  describe('upsertSession', () => {
    it('upserts with correct data', async () => {
      mockUpsert.mockResolvedValue({})
      await upsertSession({ chatId: 'chat-1', vendorId: 'cust-1', userId: 'user-1', caseId: 'case-1', state: 'idle', textBuffer: '' })
      expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({
        where: { platform_externalChatId: { platform: 'livechat', externalChatId: 'chat-1' } },
      }))
    })
  })

  describe('updateSessionState', () => {
    it('updates state successfully', async () => {
      mockUpdate.mockResolvedValue({})
      await updateSessionState('chat-1', 'thinking')
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { platform_externalChatId: { platform: 'livechat', externalChatId: 'chat-1' } },
        data: { bridgeState: 'thinking' },
      })
    })
  })

  describe('closeSession', () => {
    it('sets status to archived', async () => {
      mockUpdate.mockResolvedValue({})
      await closeSession('chat-1', 'archived_by_agent')
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { platform_externalChatId: { platform: 'livechat', externalChatId: 'chat-1' } },
        data: { status: 'archived', bridgeState: 'idle' },
      })
    })
  })
})
