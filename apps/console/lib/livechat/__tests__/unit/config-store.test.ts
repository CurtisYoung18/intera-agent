import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFindFirst = vi.fn()
const mockAgentFindUnique = vi.fn()
const mockAgentFindFirst = vi.fn()

vi.mock('@intera/shared/prisma', () => ({
  prisma: {
    channelBinding: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
    },
    agentConfig: {
      findUnique: (...args: unknown[]) => mockAgentFindUnique(...args),
      findFirst: (...args: unknown[]) => mockAgentFindFirst(...args),
    },
  },
}))

import {
  getLiveChatConfig,
  getLiveChatConfigForFamily,
  getLiveChatConfigForOrg,
  invalidateLiveChatConfig,
  resolveLiveChatFamilyAnchorId,
  resolveLiveChatAgentConfigIdForOrg,
} from '../../config-store'

describe('config-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAgentFindUnique.mockResolvedValue(null)
    mockAgentFindFirst.mockResolvedValue(null)
    invalidateLiveChatConfig('cust-a')
    invalidateLiveChatConfig('cust-b')
    invalidateLiveChatConfig('cust-c')
    invalidateLiveChatConfig('draft-3')
    invalidateLiveChatConfig('root-1')
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
        credentials: JSON.stringify({
          failureMessages: {
            engine_unreachable: 'Custom unavailable message',
          },
        }),
      })
      const config = await getLiveChatConfig('cust-b')
      expect(config).not.toBeNull()
      expect(config!.botAccessToken).toBe('tok123')
      expect(config!.licenseId).toBe('lic456')
      expect(config!.enabled).toBe(true)
      expect(config!.failureMessages?.engine_unreachable).toBe('Custom unavailable message')
    })

    it('downgrades enabled bindings with missing credentials to disabled runtime config', async () => {
      mockFindFirst.mockResolvedValue({
        orgId: 'cust-b',
        agentConfigId: 'cust-b',
        botAccessToken: '',
        licenseId: '',
        enabled: true,
        credentials: JSON.stringify({ webhookSecret: '' }),
      })

      const config = await getLiveChatConfig('cust-b')
      expect(config).not.toBeNull()
      expect(config!.enabled).toBe(false)
    })

    it('returns null on prisma error', async () => {
      mockFindFirst.mockRejectedValue(new Error('DB down'))
      const config = await getLiveChatConfig('cust-c')
      expect(config).toBeNull()
    })
  })

  describe('resolveLiveChatFamilyAnchorId', () => {
    it('returns the oldest reachable parent id for an agent family', async () => {
      mockAgentFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
        if (where.id === 'draft-3') return { id: 'draft-3', parentId: 'live-2' }
        if (where.id === 'live-2') return { id: 'live-2', parentId: 'root-1' }
        if (where.id === 'root-1') return { id: 'root-1', parentId: null }
        return null
      })

      await expect(resolveLiveChatFamilyAnchorId('draft-3')).resolves.toBe('root-1')
    })
  })

  describe('getLiveChatConfigForFamily', () => {
    it('prefers the family anchor binding when one exists', async () => {
      mockAgentFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
        if (where.id === 'draft-3') return { id: 'draft-3', parentId: 'root-1' }
        if (where.id === 'root-1') return { id: 'root-1', parentId: null }
        return null
      })
      mockFindFirst.mockImplementation(async ({ where }: { where: { agentConfigId: string } }) => {
        if (where.agentConfigId === 'root-1') {
          return {
            orgId: 'default',
            agentConfigId: 'root-1',
            botAccessToken: 'root-token',
            licenseId: 'root-license',
            enabled: true,
            credentials: '{}',
          }
        }
        if (where.agentConfigId === 'draft-3') {
          return {
            orgId: 'default',
            agentConfigId: 'draft-3',
            botAccessToken: 'draft-token',
            licenseId: 'draft-license',
            enabled: true,
            credentials: '{}',
          }
        }
        return null
      })

      const config = await getLiveChatConfigForFamily('draft-3')
      expect(config?.botAccessToken).toBe('root-token')
    })

    it('falls back to the selected version binding when the family anchor is not configured yet', async () => {
      mockAgentFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
        if (where.id === 'draft-3') return { id: 'draft-3', parentId: 'root-1' }
        if (where.id === 'root-1') return { id: 'root-1', parentId: null }
        return null
      })
      mockFindFirst.mockImplementation(async ({ where }: { where: { agentConfigId: string } }) => {
        if (where.agentConfigId === 'draft-3') {
          return {
            orgId: 'default',
            agentConfigId: 'draft-3',
            botAccessToken: 'draft-token',
            licenseId: 'draft-license',
            enabled: true,
            credentials: '{}',
          }
        }
        return null
      })

      const config = await getLiveChatConfigForFamily('draft-3')
      expect(config?.botAccessToken).toBe('draft-token')
    })
  })

  describe('org-scoped fallback resolution', () => {
    it('resolves the active livechat agent for an org', async () => {
      mockAgentFindFirst.mockResolvedValue({ id: 'active-agent' })

      await expect(resolveLiveChatAgentConfigIdForOrg('default')).resolves.toBe('active-agent')
      expect(mockAgentFindFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          orgId: 'default',
          isActive: true,
          channelBindings: {
            some: {
              channel: 'livechat',
              enabled: true,
            },
          },
        }),
      }))
    })

    it('loads the active org binding through family resolution', async () => {
      mockAgentFindFirst.mockResolvedValue({ id: 'active-agent' })
      mockAgentFindUnique.mockResolvedValue({ id: 'active-agent', parentId: null })
      mockFindFirst.mockResolvedValue({
        orgId: 'default',
        agentConfigId: 'active-agent',
        botAccessToken: 'active-token',
        licenseId: 'active-license',
        enabled: true,
        credentials: '{}',
      })

      await expect(getLiveChatConfigForOrg('default')).resolves.toEqual({
        agentConfigId: 'active-agent',
        config: expect.objectContaining({
          botAccessToken: 'active-token',
          licenseId: 'active-license',
          enabled: true,
        }),
      })
    })
  })
})
