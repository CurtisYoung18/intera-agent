import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFindUnique = vi.fn()

vi.mock('@intera/shared/prisma', () => ({
  prisma: {
    liveChatConfig: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
  },
}))

import { getLiveChatConfig } from '../../config-store'

describe('config-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getLiveChatConfig', () => {
    it('returns null when config not found', async () => {
      mockFindUnique.mockResolvedValue(null)
      const config = await getLiveChatConfig('cust-a')
      expect(config).toBeNull()
    })

    it('returns config when found', async () => {
      mockFindUnique.mockResolvedValue({
        vendorId: 'cust-b',
        botAccessToken: 'tok123',
        licenseId: 'lic456',
        showSkillStatus: true,
        enabled: true,
      })
      const config = await getLiveChatConfig('cust-b')
      expect(config).toEqual({
        vendorId: 'cust-b',
        botAccessToken: 'tok123',
        licenseId: 'lic456',
        showSkillStatus: true,
        enabled: true,
      })
    })

    it('returns null on prisma error', async () => {
      mockFindUnique.mockRejectedValue(new Error('DB down'))
      const config = await getLiveChatConfig('cust-c')
      expect(config).toBeNull()
    })
  })
})
