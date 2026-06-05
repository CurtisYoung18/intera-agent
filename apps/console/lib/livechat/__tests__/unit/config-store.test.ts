import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFindUnique = vi.fn()
const mockFindFirst = vi.fn()

vi.mock('@intera/shared/prisma', () => ({
  prisma: {
    liveChatConfig: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
    channelBinding: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
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
      mockFindFirst.mockResolvedValue(null)
      mockFindUnique.mockResolvedValue(null)
      const config = await getLiveChatConfig('cust-a')
      expect(config).toBeNull()
    })

    it('returns config when found (channel_bindings fallback to livechat_configs)', async () => {
      // channel_bindings query returns null — fallback to livechat_configs
      mockFindFirst.mockResolvedValue(null)
      mockFindUnique.mockResolvedValue({
        orgId: 'cust-b',
        botAccessToken: 'tok123',
        licenseId: 'lic456',
        showSkillStatus: true,
        enabled: true,
      })
      const config = await getLiveChatConfig('cust-b')
      expect(config).toEqual({
        orgId: 'cust-b',
        botAccessToken: 'tok123',
        licenseId: 'lic456',
        showSkillStatus: true,
        enabled: true,
      })
    })

    it('returns null on prisma error', async () => {
      mockFindFirst.mockRejectedValue(new Error('DB down'))
      const config = await getLiveChatConfig('cust-c')
      expect(config).toBeNull()
    })
  })
})
