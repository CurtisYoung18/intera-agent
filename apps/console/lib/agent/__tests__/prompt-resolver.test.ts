import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  caseTypes: [] as Array<{ type: string; displayName: string; description?: string | null }>,
  hookBindings: [] as Array<{
    hook: { name: string; checkpoint: string; description?: string | null } | null
  }>,
}))

vi.mock('@intera/shared/prisma', () => ({
  prisma: {
    caseType: {
      findMany: vi.fn(async () => h.caseTypes),
    },
    hookBinding: {
      findMany: vi.fn(async () => h.hookBindings),
    },
  },
}))

import { prisma } from '@intera/shared/prisma'
import { buildPromptContext } from '@/lib/agent/prompt-resolver'

describe('buildPromptContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.caseTypes = []
    h.hookBindings = []
  })

  it('only surfaces hooks that have enabled bindings and deduplicates repeated bindings', async () => {
    h.caseTypes = [
      { type: 'deposit_issue', displayName: 'Deposit issue', description: 'Handle deposit failures' },
    ]
    h.hookBindings = [
      { hook: { name: 'zeta_stop_hook', checkpoint: 'Stop', description: 'Stop rule' } },
      { hook: { name: 'alpha_pretool_hook', checkpoint: 'PreToolUse', description: 'PreTool rule' } },
      { hook: { name: 'zeta_stop_hook', checkpoint: 'Stop', description: 'Stop rule' } },
      { hook: null },
    ]

    const ctx = await buildPromptContext({ agentConfigId: 'agent_test' })

    expect(prisma.hookBinding.findMany).toHaveBeenCalledWith({
      where: {
        agentConfigId: 'agent_test',
        enabled: true,
        hook: { enabled: true },
      },
      distinct: ['hookId'],
      select: {
        hook: {
          select: { name: true, checkpoint: true, description: true },
        },
      },
    })
    expect(ctx.case_types).toEqual([
      { type: 'deposit_issue', displayName: 'Deposit issue', description: 'Handle deposit failures' },
    ])
    expect(ctx.active_hooks).toEqual([
      { name: 'alpha_pretool_hook', checkpoint: 'PreToolUse', description: 'PreTool rule' },
      { name: 'zeta_stop_hook', checkpoint: 'Stop', description: 'Stop rule' },
    ])
  })
})
