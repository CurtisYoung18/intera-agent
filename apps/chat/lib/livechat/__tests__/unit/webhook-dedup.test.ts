import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreate = vi.fn()
const mockDeleteMany = vi.fn()

vi.mock('@intera/shared/prisma', () => ({
  prisma: {
    webhookEvent: {
      create: (...args: unknown[]) => mockCreate(...args),
      deleteMany: (...args: unknown[]) => mockDeleteMany(...args),
    },
  },
}))

import { isDuplicateWebhook, pruneOldWebhookEvents } from '../../webhook-dedup'

describe('webhook-dedup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('isDuplicateWebhook', () => {
    it('returns false on first call (event is new)', async () => {
      mockCreate.mockResolvedValue({ id: 'evt-1' })
      const result = await isDuplicateWebhook('evt-1')
      expect(result).toBe(false)
      expect(mockCreate).toHaveBeenCalledWith({
        data: { id: 'evt-1', platform: 'livechat', processedAt: expect.any(Date) },
      })
    })

    it('returns true on duplicate (unique constraint)', async () => {
      mockCreate.mockRejectedValue({ code: 'P2002' })
      const result = await isDuplicateWebhook('evt-1')
      expect(result).toBe(true)
    })

    it('re-throws non-P2002 errors', async () => {
      mockCreate.mockRejectedValue(new Error('DB down'))
      await expect(isDuplicateWebhook('evt-1')).rejects.toThrow('DB down')
    })
  })

  describe('pruneOldWebhookEvents', () => {
    it('deletes events older than cutoff', async () => {
      mockDeleteMany.mockResolvedValue({ count: 5 })
      await pruneOldWebhookEvents(30)
      expect(mockDeleteMany).toHaveBeenCalledWith({
        where: { processedAt: { lt: expect.any(Date) } },
      })
    })
  })
})
