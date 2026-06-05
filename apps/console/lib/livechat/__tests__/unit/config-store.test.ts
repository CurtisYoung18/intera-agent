import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFindFirst = vi.fn()

vi.mock('@intera/shared/prisma', () => ({
  prisma: {
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
    it('returns null when no channel_bindings row exists', async () => {
      mockFindFirst.mockResolvedValue(null)
      const config = await getLiveChatConfig('cust-a')
      expect(config).toBeNull()
    })

    it('returns config when found in channel_bindings', async () => {
      mockFindFirst.mockResolvedValue({
        orgId: 'cust-b',
        botAccessToken: 'tok123',
        licenseId: 'lic456',
        showSkillStatus: true,
        enabled: true,
        credentials: '{}',
      })
      const config = await getLiveChatConfig('cust-b')
      expect(config).not.toBeNull()
      expect(config!.botAccessToken).toBe('tok123')
      expect(config!.licenseId).toBe('lic456')
      expect(config!.enabled).toBe(true)
    })

    it('returns null on prisma error', async () => {
      mockFindFirst.mockRejectedValue(new Error('DB down'))
      const config = await getLiveChatConfig('cust-c')
      expect(config).toBeNull()
    })
  })
})
