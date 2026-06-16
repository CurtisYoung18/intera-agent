import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockFindFirst: vi.fn(),
}))

vi.mock('@intera/shared/prisma', () => ({
  prisma: {
    agentConfig: {
      findUnique: h.mockFindUnique,
      findFirst: h.mockFindFirst,
    },
  },
}))

import { DEFAULT_MODEL } from '@intera/shared/defaults'
import { clearConfigCache } from '../../config-cache'
import { loadAgentConfig } from '../../config-loader'

describe('loadAgentConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearConfigCache()
  })

  it('returns built-in defaults without reading a global DB default when agentConfigId is missing', async () => {
    const config = await loadAgentConfig(undefined)

    expect(config.model).toBe(DEFAULT_MODEL)
    expect(h.mockFindUnique).not.toHaveBeenCalled()
    expect(h.mockFindFirst).not.toHaveBeenCalled()
  })

  it('loads a trimmed agentConfigId with an exact findUnique lookup', async () => {
    h.mockFindUnique.mockResolvedValue({
      id: 'agent-1',
      model: 'test-model',
      temperature: 0.1,
      thinkingBudget: 1024,
      maxIterations: 5,
      maxOutputTokens: 2048,
      extendedThinking: true,
      memoryStrategy: '{}',
      resumePrompt: 'resume',
      coreSystemPrompt: 'core',
    })

    const config = await loadAgentConfig(' agent-1 ')

    expect(h.mockFindUnique).toHaveBeenCalledWith({ where: { id: 'agent-1' } })
    expect(h.mockFindFirst).not.toHaveBeenCalled()
    expect(config.model).toBe('test-model')
    expect(config.resumePrompt).toBe('resume')
  })
})
