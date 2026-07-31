import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => {
  let idSeq = 0
  const id = (prefix: string) => `${prefix}_${++idSeq}`
  const mockGetSession = vi.fn()
  const buildPilotDraftFingerprint = vi.fn()
  const agentConfigUpdate = vi.fn()
  const agentConfigs: Record<string, any> = {
    'agent-1': {
      id: 'agent-1',
      orgId: 'org-1',
      name: 'J1B',
      version: 2,
      isActive: false,
      temperature: 0.5,
      updatedAt: new Date('2026-06-26T00:00:00.000Z'),
    },
    'foreign-agent': {
      id: 'foreign-agent',
      orgId: 'org-2',
      name: 'Other',
      version: 1,
      isActive: false,
      temperature: 0.7,
      updatedAt: new Date('2026-06-26T00:00:00.000Z'),
    },
  }
  const tables = {
    pilotSessions: [] as any[],
    pilotMessages: [] as any[],
    pilotProposals: [] as any[],
    auditLogs: [] as any[],
  }
  const users = [{ id: 'user-1' }]

  const matches = (row: any, where: any = {}): boolean => Object.entries(where).every(([key, value]) => row[key] === value)
  const selectRow = (row: any, select?: Record<string, boolean>) => {
    if (!row || !select) return row
    return Object.fromEntries(Object.keys(select).map((key) => [key, row[key]]))
  }
  const orderRows = (rows: any[], orderBy: any) => {
    if (!orderBy) return rows
    const [key, dir] = Object.entries(orderBy)[0] as [string, string]
    return rows.slice().sort((left, right) => {
      const a = String(left[key] ?? '')
      const b = String(right[key] ?? '')
      return dir === 'desc' ? b.localeCompare(a) : a.localeCompare(b)
    })
  }
  const delegate = (rows: any[], prefix: string) => ({
    findFirst: vi.fn(async (args: any = {}) => selectRow(orderRows(rows.filter((row) => matches(row, args.where)), args.orderBy)[0] ?? null, args.select)),
    findMany: vi.fn(async (args: any = {}) => orderRows(rows.filter((row) => matches(row, args.where)), args.orderBy).map((row) => selectRow(row, args.select))),
    create: vi.fn(async (args: any) => {
      const row = { id: id(prefix), createdAt: new Date(), updatedAt: new Date(), ...args.data }
      rows.push(row)
      return row
    }),
    update: vi.fn(async (args: any) => {
      const row = rows.find((item) => item.id === args.where.id)
      if (!row) throw new Error(`${prefix} not found`)
      Object.assign(row, args.data, { updatedAt: new Date() })
      return row
    }),
    updateMany: vi.fn(async (args: any) => {
      let count = 0
      for (const row of rows) {
        if (matches(row, args.where)) {
          Object.assign(row, args.data, { updatedAt: new Date() })
          count += 1
        }
      }
      return { count }
    }),
  })

  return {
    id,
    mockGetSession,
    buildPilotDraftFingerprint,
    agentConfigUpdate,
    agentConfigs,
    tables,
    users,
    matches,
    selectRow,
    delegate,
  }
})

vi.mock('@/lib/auth', () => ({
  getSession: h.mockGetSession,
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/pilot/fingerprint', () => ({
  buildPilotDraftFingerprint: h.buildPilotDraftFingerprint,
}))

vi.mock('@/lib/config-pilot/apply', () => ({
  applyConfigPilotProposal: vi.fn(),
}))

vi.mock('@/lib/scenarios/store', () => ({
  listScenarios: vi.fn(async () => ({
    scenarios: [],
    validationState: 'Not validated',
    receipts: [],
    runtimeValidated: false,
    overrideRequired: true,
  })),
  getScenario: vi.fn(),
  appendScenarioReceipt: vi.fn(),
  getScenarioValidationSummary: vi.fn(async () => ({
    state: 'Not validated',
    runtimeValidated: false,
    overrideRequired: true,
  })),
}))

vi.mock('@/lib/scenarios/runner', () => ({
  runScenarioHarness: vi.fn(),
}))

vi.mock('@/lib/scenarios/runtime-runner', () => ({
  runScenarioAgentRuntime: vi.fn(),
}))

vi.mock('@/lib/db/repo-for-org', () => ({
  repoForOrg(orgId: string) {
    const agentConfig = {
      findUnique: vi.fn(async (args: any) => {
        const row = h.agentConfigs[args.where.id]
        if (!row || row.orgId !== orgId) return null
        return h.selectRow(row, args.select)
      }),
    }
    return {
      orgId,
      agentConfig,
      raw: {
        agentConfig: {
          findUnique: vi.fn(async (args: any) => h.selectRow(h.agentConfigs[args.where.id] ?? null, args.select)),
          update: h.agentConfigUpdate,
        },
        pilotSession: h.delegate(h.tables.pilotSessions, 'pilot_session'),
        pilotMessage: h.delegate(h.tables.pilotMessages, 'pilot_message'),
        pilotProposal: h.delegate(h.tables.pilotProposals, 'pilot_proposal'),
        pilotHandoff: { updateMany: vi.fn(async () => ({ count: 0 })) },
        user: {
          findUnique: vi.fn(async (args: any) => h.users.find((user) => user.id === args.where.id) ?? null),
        },
        auditLog: {
          create: vi.fn(async (args: any) => {
            const row = { id: h.id('audit'), createdAt: new Date(), ...args.data }
            h.tables.auditLogs.push(row)
            return row
          }),
        },
      },
    } as any
  },
}))

import { POST } from '../route'

const fingerprint = 'a'.repeat(64)

function validBody(agentId = 'agent-1', baseDraftFingerprint = fingerprint) {
  return {
    schemaVersion: 'agentops.proposal-create.v1',
    target: { agentId },
    baseDraftFingerprint,
    externalAgent: {
      name: 'Codex Worker P-intake',
      runId: 'worker-p-intake-1',
    },
    reason: 'GMT mismatch found in scoped forensic evidence.',
    evidenceRefs: ['chat:chat-1', 'forensic-pack:chat-1'],
    proposal: {
      id: 'client-ignored',
      pilotProposalId: 'client-ignored-too',
      baseDraftFingerprint,
      targetSurface: 'brain',
      title: 'Lower answer randomness',
      summary: 'Lower temperature for evidence-sensitive answers.',
      patches: [{
        surface: 'brain',
        operation: 'update',
        fields: { temperature: 0.2 },
      }],
      diffGroups: [],
      receiptSuggestions: [],
      runSuggestions: [],
      safetyNotes: [],
    },
  }
}

function req(agentId = 'agent-1', body: unknown = validBody(agentId)) {
  return new NextRequest(`http://localhost/api/agentops/agents/${agentId}/proposals`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function ctx(agentId = 'agent-1') {
  return { params: Promise.resolve({ agentId }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.mockGetSession.mockResolvedValue({ orgId: 'org-1', role: 'admin', userId: 'user-1' })
  h.buildPilotDraftFingerprint.mockResolvedValue(fingerprint)
  h.agentConfigs['agent-1'].temperature = 0.5
  for (const table of Object.values(h.tables)) table.length = 0
})

describe('POST /api/agentops/agents/[agentId]/proposals', () => {
  it('returns 401 without a session', async () => {
    h.mockGetSession.mockResolvedValue(null)

    const res = await POST(req(), ctx())

    expect(res.status).toBe(401)
    expect(h.tables.pilotProposals).toHaveLength(0)
  })

  it.each(['operator', 'viewer'])('returns 403 for %s role', async (role) => {
    h.mockGetSession.mockResolvedValue({ orgId: 'org-1', role, userId: `${role}-1` })

    const res = await POST(req(), ctx())
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error.code).toBe('forbidden')
    expect(h.tables.pilotProposals).toHaveLength(0)
  })

  it.each(['foreign-agent', 'fake-agent'])('returns 404 for non-owned agent %s', async (agentId) => {
    const res = await POST(req(agentId, validBody(agentId)), ctx(agentId))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error.code).toBe('not_found')
    expect(h.tables.pilotProposals).toHaveLength(0)
  })

  it('creates one drafted PilotProposal with safe AgentOps metadata and leaves AgentConfig unchanged', async () => {
    const before = { ...h.agentConfigs['agent-1'] }

    const res = await POST(req(), ctx())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data).toMatchObject({
      status: 'drafted',
      baseDraftFingerprint: fingerprint,
      evidenceRefs: ['chat:chat-1', 'forensic-pack:chat-1'],
      activeAgentConfigUnchanged: true,
    })
    expect(body.data.proposalId).toBeTruthy()
    expect(h.tables.pilotProposals).toHaveLength(1)
    expect(h.tables.pilotProposals[0]).toMatchObject({
      id: body.data.proposalId,
      status: 'drafted',
      baseAgentConfigId: 'agent-1',
      baseDraftFingerprint: fingerprint,
      patchCount: 1,
    })
    expect(h.tables.pilotProposals[0].proposal).not.toHaveProperty('pilotProposalId')
    expect(h.tables.pilotProposals[0].proposal.baseDraftFingerprint).toBe(fingerprint)
    expect(h.tables.pilotMessages.some((message) =>
      message.kind === 'trace'
      && message.structuredPayload?.source === 'agentops.proposal-create.v1'
      && message.structuredPayload?.proposalId === body.data.proposalId
      && message.structuredPayload?.externalAgent?.name === 'Codex Worker P-intake'
      && message.structuredPayload?.evidenceRefs?.[0] === 'chat:chat-1',
    )).toBe(true)
    expect(h.agentConfigUpdate).not.toHaveBeenCalled()
    expect(h.agentConfigs['agent-1']).toMatchObject(before)
  })

  it('uses the path agent when optional body target context is omitted', async () => {
    const { target: _target, ...bodyWithoutTarget } = validBody('agent-1')

    const res = await POST(req('agent-1', bodyWithoutTarget), ctx('agent-1'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.status).toBe('drafted')
    expect(h.tables.pilotProposals[0].baseAgentConfigId).toBe('agent-1')
  })

  it('returns 409 and creates nothing when the draft fingerprint is stale', async () => {
    h.buildPilotDraftFingerprint.mockResolvedValue('b'.repeat(64))

    const res = await POST(req(), ctx())
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.error.code).toBe('conflict')
    expect(h.tables.pilotProposals).toHaveLength(0)
    expect(h.tables.pilotMessages).toHaveLength(0)
  })

  it('rejects path/body target mismatch before persistence', async () => {
    const res = await POST(req('agent-1', validBody('agent-2')), ctx('agent-1'))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('validation')
    expect(h.tables.pilotProposals).toHaveLength(0)
  })

  it('rejects secret-like evidence refs and persists none of them', async () => {
    const secretLikeEvidenceRef = ['trace:api', 'key=sk', 'live', '1234567890'].join('_')
    const res = await POST(req('agent-1', {
      ...validBody('agent-1'),
      evidenceRefs: [secretLikeEvidenceRef],
    }), ctx('agent-1'))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('validation')
    expect(h.tables.pilotProposals).toHaveLength(0)
    expect(JSON.stringify(h.tables)).not.toContain('sk_live')
  })
})
