import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  assertAgentInOrg: vi.fn(async () => {}),
}))

vi.mock('@/lib/api/assert-agent-in-org', () => ({
  assertAgentInOrg: h.assertAgentInOrg,
}))

import { resolveAgentCaseScopeForChat } from '../_agent-scope'

function matchesWhere(row: Record<string, any>, where: Record<string, any> = {}): boolean {
  if (where.orgId && row.orgId !== where.orgId) return false
  if (where.chatId && typeof where.chatId === 'string' && row.chatId !== where.chatId) return false
  if (
    where.chatId &&
    typeof where.chatId === 'object' &&
    where.chatId.startsWith &&
    !row.chatId?.startsWith(where.chatId.startsWith)
  ) return false
  if (where.caseId?.in && !where.caseId.in.includes(row.caseId)) return false
  if (where.agentConfigId && row.agentConfigId !== where.agentConfigId) return false
  if (where.internalCaseId?.in && !where.internalCaseId.in.includes(row.internalCaseId)) return false
  if (where.internalCaseId?.not === null && row.internalCaseId == null) return false
  if (where.metadata?.path?.[0] === 'agentConfigId' && row.metadata?.agentConfigId !== where.metadata.equals) return false
  return true
}

function createRepo(overrides: {
  cases?: Array<Record<string, any>>
  runs?: Array<Record<string, any>>
  externalConversations?: Array<Record<string, any>>
} = {}) {
  const cases = overrides.cases ?? []
  const runs = overrides.runs ?? []
  const externalConversations = overrides.externalConversations ?? []

  return {
    orgId: 'default',
    raw: {
      procedureRun: {
        findMany: vi.fn(async (args: any) => runs.filter((row) => matchesWhere(row, args?.where))),
      },
      case: {
        findMany: vi.fn(async (args: any) => cases.filter((row) => matchesWhere(row, args?.where))),
      },
    },
    externalConversation: {
      findMany: vi.fn(async (args: any) => externalConversations.filter((row) => matchesWhere(row, args?.where))),
    },
  } as any
}

describe('resolveAgentCaseScopeForChat', () => {
  it('keeps no-run exact-chat cases without metadata out of arbitrary agent scope', async () => {
    const repo = createRepo({
      cases: [{ id: 'case-no-metadata', orgId: 'default', chatId: 'livechat-session-no-metadata' }],
    })

    const scope = await resolveAgentCaseScopeForChat(
      repo,
      'agent-1',
      'livechat-session-no-metadata',
    )

    expect(scope.caseIds).toEqual([])
    expect(scope.runIds).toEqual([])
    expect(scope.runs).toEqual([])
  })

  it('includes no-run exact-chat cases with matching LiveChat metadata', async () => {
    const repo = createRepo({
      cases: [{ id: 'case-livechat', orgId: 'default', chatId: 'livechat-session-matching' }],
      externalConversations: [{
        internalCaseId: 'case-livechat',
        metadata: { agentConfigId: 'agent-1' },
      }],
    })

    const scope = await resolveAgentCaseScopeForChat(
      repo,
      'agent-1',
      'livechat-session-matching',
    )

    expect(scope.caseIds).toEqual(['case-livechat'])
    expect(scope.runIds).toEqual([])
    expect(scope.runs).toEqual([])
  })

  it('includes ProcedureRun cases for the selected agent', async () => {
    const repo = createRepo({
      cases: [{ id: 'case-run', orgId: 'default', chatId: 'livechat-session-run' }],
      runs: [{ id: 'run-1', orgId: 'default', caseId: 'case-run', agentConfigId: 'agent-1' }],
    })

    const scope = await resolveAgentCaseScopeForChat(
      repo,
      'agent-1',
      'livechat-session-run',
    )

    expect(scope.caseIds).toEqual(['case-run'])
    expect(scope.runIds).toEqual(['run-1'])
    expect(scope.runs).toEqual([{ id: 'run-1', caseId: 'case-run', orgId: 'default', agentConfigId: 'agent-1' }])
  })

  it('adopts legacy playground cases when their ProcedureRuns only carry unknown agentConfigId', async () => {
    const repo = createRepo({
      cases: [{ id: 'case-1', orgId: 'default', chatId: 'pg_agent-1_12345_test' }],
      runs: [{ id: 'run-1', orgId: 'default', caseId: 'case-1', agentConfigId: 'unknown' }],
    })

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
    const repo = createRepo({
      cases: [{ id: 'case-2', orgId: 'default', chatId: 'livechat-session-2' }],
      runs: [{ id: 'run-2', orgId: 'default', caseId: 'case-2', agentConfigId: 'unknown' }],
    })

    const scope = await resolveAgentCaseScopeForChat(
      repo,
      'agent-1',
      'livechat-session-2',
    )

    expect(scope.caseIds).toEqual([])
  })

  it('does not widen a no-run LiveChat case stamped for a different agent', async () => {
    const repo = createRepo({
      cases: [{ id: 'case-foreign', orgId: 'default', chatId: 'livechat-session-foreign' }],
      externalConversations: [{
        internalCaseId: 'case-foreign',
        metadata: { agentConfigId: 'agent-2' },
      }],
    })

    const scope = await resolveAgentCaseScopeForChat(
      repo,
      'agent-1',
      'livechat-session-foreign',
    )

    expect(scope.caseIds).toEqual([])
  })
})
