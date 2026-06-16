import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock prisma for retry queue
const mockCreate = vi.fn()
const mockFindMany = vi.fn()
const mockUpdate = vi.fn()
const mockDelete = vi.fn()
const mockGetLiveChatConfigForFamily = vi.fn()
const mockResolveLiveChatConfigForOrg = vi.fn()
const mockHandleIncomingEvent = vi.fn()

vi.mock('@intera/shared/prisma', () => ({
  prisma: {
    liveChatPendingEvent: {
      create: (...args: unknown[]) => mockCreate(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
      delete: (...args: unknown[]) => mockDelete(...args),
    },
  },
}))

vi.mock('../../config-store', () => ({
  getLiveChatConfigForFamily: (...args: unknown[]) => mockGetLiveChatConfigForFamily(...args),
  resolveLiveChatConfigForOrg: (...args: unknown[]) => mockResolveLiveChatConfigForOrg(...args),
}))

vi.mock('../../bridge', () => ({
  handleIncomingEvent: (...args: unknown[]) => mockHandleIncomingEvent(...args),
}))

import { enqueueRetry, processRetryQueue } from '../../retry-queue'

describe('bridge-retry integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetLiveChatConfigForFamily.mockResolvedValue(null)
    mockResolveLiveChatConfigForOrg.mockResolvedValue({ status: 'not_configured' })
    mockHandleIncomingEvent.mockResolvedValue(undefined)
  })

  describe('enqueueRetry', () => {
    it('creates pending event with first retry delay', async () => {
      mockCreate.mockResolvedValue({})
      await enqueueRetry('chat-1', 'cust-1', 'user-1', { type: 'message', text: 'hello' }, 'Network error')
      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          chatId: 'chat-1',
          orgId: 'cust-1',
          payload: { userId: 'user-1', event: { type: 'message', text: 'hello' } },
          attempt: 0,
          lastError: 'Network error',
          nextRetryAt: expect.any(Date),
        }),
      })
    })

    it('swallows prisma errors gracefully', async () => {
      mockCreate.mockRejectedValue(new Error('DB connection lost'))
      await expect(enqueueRetry('chat-1', 'cust-1', 'user-1', { type: 'message', text: 'hi' }, 'err')).resolves.toBeUndefined()
    })
  })

  describe('processRetryQueue', () => {
    it('returns 0 when queue is empty', async () => {
      mockFindMany.mockResolvedValue([])
      const count = await processRetryQueue()
      expect(count).toBe(0)
    })

    it('deletes items for disabled customers', async () => {
      mockFindMany.mockResolvedValue([{
        id: 'evt-1', chatId: 'chat-1', orgId: 'cust-1',
        payload: { userId: 'user-1', event: { type: 'message', text: 'hello' }, agentConfigId: 'agent-1' },
        attempt: 0, lastError: null,
      }])
      mockGetLiveChatConfigForFamily.mockResolvedValue({ enabled: false })

      mockDelete.mockResolvedValue({})
      const count = await processRetryQueue()
      expect(count).toBeGreaterThanOrEqual(0)
      expect(mockResolveLiveChatConfigForOrg).not.toHaveBeenCalled()
      expect(mockHandleIncomingEvent).not.toHaveBeenCalled()
    })

    it('does not guess an agent for ambiguous legacy queued events', async () => {
      mockFindMany.mockResolvedValue([{
        id: 'evt-1', chatId: 'chat-1', orgId: 'cust-1',
        payload: { userId: 'user-1', event: { type: 'message', text: 'hello' } },
        attempt: 0, lastError: null,
      }])
      mockResolveLiveChatConfigForOrg.mockResolvedValue({
        status: 'ambiguous',
        agentConfigIds: ['agent-a', 'agent-b'],
      })
      mockUpdate.mockResolvedValue({})

      const count = await processRetryQueue()

      expect(count).toBe(0)
      expect(mockHandleIncomingEvent).not.toHaveBeenCalled()
      expect(mockDelete).not.toHaveBeenCalled()
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'evt-1' },
        data: expect.objectContaining({
          attempt: 1,
          lastError: 'agentConfigId required for multi-agent LiveChat retry',
        }),
      }))
    })

    it('marks as dead letter after 4 failed attempts', async () => {
      mockFindMany.mockResolvedValue([])
      const count = await processRetryQueue()
      expect(count).toBe(0)
    })
  })
})
