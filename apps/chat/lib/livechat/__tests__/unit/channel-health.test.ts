import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockUpsert = vi.fn()
const mockFindUnique = vi.fn()

vi.mock('@intera/shared/prisma', () => ({
  prisma: {
    channelHealth: {
      upsert: (...args: unknown[]) => mockUpsert(...args),
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
  },
}))

import { markChannelUnhealthy, markChannelHealthy, getChannelHealth } from '../../channel-health'

describe('channel-health', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('markChannelUnhealthy', () => {
    it('upserts with unhealthy status', async () => {
      mockUpsert.mockResolvedValue({})
      await markChannelUnhealthy('cust-1', 'livechat', 'token_expired', '401 Unauthorized')
      expect(mockUpsert).toHaveBeenCalledWith({
        where: { customerId_channel: { customerId: 'cust-1', channel: 'livechat' } },
        update: { status: 'token_expired', lastError: '401 Unauthorized', lastChecked: expect.any(Date) },
        create: expect.objectContaining({ status: 'token_expired' }),
      })
    })
  })

  describe('markChannelHealthy', () => {
    it('upserts with healthy status', async () => {
      mockUpsert.mockResolvedValue({})
      await markChannelHealthy('cust-1', 'livechat')
      expect(mockUpsert).toHaveBeenCalledWith({
        where: { customerId_channel: { customerId: 'cust-1', channel: 'livechat' } },
        update: { status: 'healthy', lastError: null, lastChecked: expect.any(Date) },
        create: expect.objectContaining({ status: 'healthy' }),
      })
    })
  })

  describe('getChannelHealth', () => {
    it('returns health status when exists', async () => {
      mockFindUnique.mockResolvedValue({
        status: 'healthy',
        lastChecked: new Date(),
        lastError: null,
      })
      const result = await getChannelHealth('cust-1', 'livechat')
      expect(result).toEqual({
        status: 'healthy',
        lastChecked: expect.any(Date),
        lastError: null,
      })
    })

    it('returns null when not found', async () => {
      mockFindUnique.mockResolvedValue(null)
      const result = await getChannelHealth('cust-1', 'livechat')
      expect(result).toBeNull()
    })
  })
})
