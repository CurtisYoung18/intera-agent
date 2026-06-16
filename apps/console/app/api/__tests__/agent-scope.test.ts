import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  assertAgentInOrg: vi.fn(async () => {}),
}))

vi.mock('@/lib/api/assert-agent-in-org', () => ({
  assertAgentInOrg: h.assertAgentInOrg,
}))

import { resolveAgentCaseScopeForChat } from '../_agent-scope'

describe('resolveAgentCaseScopeForChat', () => {
  it('adopts legacy playground cases when their ProcedureRuns only carry unknown agentConfigId', async () => {
    const repo = {
      orgId: 'default',
      raw: {
        procedureRun: {
          findMany: vi.fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ caseId: 'case-1', agentConfigId: 'unknown' }]),
        },
        case: {
          findMany: vi.fn().mockResolvedValue([{ id: 'case-1' }]),
        },
      },
    } as any

    const scope = await resolveAgentCaseScopeForChat(
      repo,
      'agent-1',
      'pg_agent-1_12345_test',
    )

    expect(scope.caseIds).toEqual(['case-1'])
    expect(scope.runs).toEqual([])
    expect(h.assertAgentInOrg).toHaveBeenCalledWith(repo, 'agent-1')
  })

  it('keeps unknown-agent ProcedureRuns out of scope for non-playground chats', async () => {
    const repo = {
      orgId: 'default',
      raw: {
        procedureRun: {
          findMany: vi.fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ caseId: 'case-2', agentConfigId: 'unknown' }]),
        },
        case: {
          findMany: vi.fn().mockResolvedValue([{ id: 'case-2' }]),
        },
      },
    } as any

    const scope = await resolveAgentCaseScopeForChat(
      repo,
      'agent-1',
      'livechat-session-2',
    )

    expect(scope.caseIds).toEqual([])
  })
})
