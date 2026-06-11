// Route-level guard test for /api/admin/tools
// Scoped by agentConfigId (not orgId).

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const toolsByAgent: Record<string, Record<string, unknown>[]> = {
    'agent_default_v1': [
      { id: 't1', agentConfigId: 'agent_default_v1', name: 'system_info', description: 'System info tool', mode: 'static', inputSchema: '{}', outputSchema: '{}', isConcurrencySafe: true, enabled: true, guardPhase: 'post', endpoint: null, httpMethod: 'POST', headers: null, timeoutMs: 8000, mockFixture: null, displayVerb: null, renderHints: null, toolCategory: 'system_info', createdAt: new Date(), updatedAt: new Date() },
      { id: 't2', agentConfigId: 'agent_default_v1', name: 'lookup_order', description: 'Look up order', mode: 'http', inputSchema: '{}', outputSchema: '{}', isConcurrencySafe: true, enabled: true, guardPhase: 'post', endpoint: 'https://api.example.com', httpMethod: 'POST', headers: null, timeoutMs: 8000, mockFixture: null, displayVerb: null, renderHints: null, toolCategory: null, createdAt: new Date(), updatedAt: new Date() },
    ],
    'test-agent': [
      { id: 't3', agentConfigId: 'test-agent', name: 'orgb_tool', description: 'Test agent tool', mode: 'static', inputSchema: '{}', outputSchema: '{}', isConcurrencySafe: true, enabled: true, guardPhase: 'post', endpoint: null, httpMethod: 'POST', headers: null, timeoutMs: 8000, mockFixture: null, displayVerb: null, renderHints: null, toolCategory: null, createdAt: new Date(), updatedAt: new Date() },
    ],
  }
  const agentConfigs: Record<string, { id: string; orgId: string }> = {
    'agent_default_v1': { id: 'agent_default_v1', orgId: 'default' },
    'test-agent': { id: 'test-agent', orgId: 'test-org' },
  }
  const createdTools: Record<string, unknown>[] = []
  const mockGetSession = vi.fn()

  return { toolsByAgent, agentConfigs, createdTools, mockGetSession }
})

vi.mock('@/lib/db/repo-for-org', () => ({
  repoForOrg(orgId: string) {
    return {
      orgId,
      agentConfig: {
        findUnique: vi.fn(async (args: any) => {
          const id = args?.where?.id
          const ac = h.agentConfigs[id]
          if (!ac) return null
          if (ac.orgId !== orgId) return null
          return ac
        }),
      },
      raw: {
        tool: {
          findMany: vi.fn(async (args?: any) => {
            const where = args?.where || {}
            const agentConfigId = where.agentConfigId as string | undefined
            return agentConfigId ? (h.toolsByAgent[agentConfigId] ?? []) : []
          }),
          findUnique: vi.fn(async (args: any) => {
            const { agentConfigId, name } = args?.where?.agentConfigId_name ?? {}
            return (h.toolsByAgent[agentConfigId] ?? []).find((t: any) => t.name === name) ?? null
          }),
          create: vi.fn(async (args: any) => {
            const tool = { id: `t_new_${h.createdTools.length}`, ...args.data, createdAt: new Date(), updatedAt: new Date() }
            h.createdTools.push(tool)
            const ac = args.data.agentConfigId
            if (!h.toolsByAgent[ac]) h.toolsByAgent[ac] = []
            h.toolsByAgent[ac].push(tool)
            return tool
          }),
          upsert: vi.fn(async (args: any) => {
            const { agentConfigId, name } = args.where.agentConfigId_name
            const existing = (h.toolsByAgent[agentConfigId] ?? []).find((t: any) => t.name === name)
            if (existing) { Object.assign(existing, args.update); return existing }
            const tool = { id: `t_${name}`, ...args.create, agentConfigId, createdAt: new Date(), updatedAt: new Date() }
            if (!h.toolsByAgent[agentConfigId]) h.toolsByAgent[agentConfigId] = []
            h.toolsByAgent[agentConfigId].push(tool)
            return tool
          }),
          update: vi.fn(async (args: any) => {
            const { agentConfigId, name } = args.where.agentConfigId_name
            const tools = h.toolsByAgent[agentConfigId] ?? []
            const tool = tools.find((t: any) => t.name === name)
            if (!tool) throw new Error('Not found')
            Object.assign(tool, args.data)
            return tool
          }),
          delete: vi.fn(async (args: any) => {
            const { agentConfigId, name } = args.where.agentConfigId_name
            const tools = h.toolsByAgent[agentConfigId] ?? []
            const idx = tools.findIndex((t: any) => t.name === name)
            if (idx === -1) throw new Error('Not found')
            tools.splice(idx, 1)
          }),
        },
        organization: {
          upsert: vi.fn(async () => ({ id: orgId, name: 'Demo Org' })),
        },
      },
    } as any
  },
}))

vi.mock('@/lib/auth', () => ({
  getSession: h.mockGetSession,
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/tool-classifications', () => ({
  SYSTEM_TOOL_NAMES: new Set(['system_info']),
  SPECIAL_TOOL_NAMES: new Set<string>(),
  CHANNEL_TOOL_NAMES: new Set<string>(),
  RETIRED_TOOL_NAMES: new Set(['dispatch_case_agent', 'finalize_case']),
}))

import { GET, POST } from '@/app/api/admin/tools/route'
import { GET as GetByName, PUT, DELETE } from '@/app/api/admin/tools/[name]/route'

function makeRequest(body?: unknown) {
  return { method: body ? 'POST' : 'GET', json: async () => body ?? {}, nextUrl: new URL('http://localhost/api/admin/tools?agentConfigId=agent_default_v1') } as any
}

function makeRequestForAgent(agentConfigId: string, body?: unknown) {
  return { method: body ? 'POST' : 'GET', json: async () => body ?? {}, nextUrl: new URL(`http://localhost/api/admin/tools?agentConfigId=${agentConfigId}`) } as any
}

function routeCtx(name: string) {
  return { params: Promise.resolve({ name }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.createdTools.length = 0
  h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'admin' })
  h.toolsByAgent['agent_default_v1'] = [
    { id: 't1', agentConfigId: 'agent_default_v1', name: 'system_info', description: 'System info tool', mode: 'static', inputSchema: '{}', outputSchema: '{}', isConcurrencySafe: true, enabled: true, guardPhase: 'post', endpoint: null, httpMethod: 'POST', headers: null, timeoutMs: 8000, mockFixture: null, displayVerb: null, renderHints: null, toolCategory: 'system_info', createdAt: new Date(), updatedAt: new Date() },
    { id: 't2', agentConfigId: 'agent_default_v1', name: 'lookup_order', description: 'Look up order', mode: 'http', inputSchema: '{}', outputSchema: '{}', isConcurrencySafe: true, enabled: true, guardPhase: 'post', endpoint: 'https://api.example.com', httpMethod: 'POST', headers: null, timeoutMs: 8000, mockFixture: null, displayVerb: null, renderHints: null, toolCategory: null, createdAt: new Date(), updatedAt: new Date() },
  ]
  h.toolsByAgent['test-agent'] = [
    { id: 't3', agentConfigId: 'test-agent', name: 'orgb_tool', description: 'Test agent tool', mode: 'static', inputSchema: '{}', outputSchema: '{}', isConcurrencySafe: true, enabled: true, guardPhase: 'post', endpoint: null, httpMethod: 'POST', headers: null, timeoutMs: 8000, mockFixture: null, displayVerb: null, renderHints: null, toolCategory: null, createdAt: new Date(), updatedAt: new Date() },
  ]
})

describe('G1 — Uniform envelope', () => {
  it('GET returns ApiOk<{tools}> envelope', async () => {
    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.data).toBeDefined()
    expect(Array.isArray(body.data.tools)).toBe(true)
    expect(body.data.tools.length).toBeGreaterThanOrEqual(1)
  })

  it('POST with empty body returns validation error envelope (400)', async () => {
    const res = await POST(makeRequest({}))
    const body = await res.json()

    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('validation')
    expect(res.status).toBe(400)
  })

  it('POST with valid input returns ApiOk<{tool}> envelope (201)', async () => {
    const res = await POST(makeRequest({ agentConfigId: 'agent_default_v1', name: 'new_tool', description: 'A new tool' }))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.data.tool).toBeDefined()
    expect(body.data.tool.name).toBe('new_tool')
    expect(res.status).toBe(201)
  })

  it('POST rejects creating retired tool names', async () => {
    const res = await POST(makeRequest({ agentConfigId: 'agent_default_v1', name: 'dispatch_case_agent', description: 'Old alias' }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('validation')
  })
})

describe('G2 — Tenant isolation via agentConfigId', () => {
  it('agent_default_v1 only sees its own tools', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'admin' })
    h.toolsByAgent.agent_default_v1.push({
      id: 't_legacy',
      agentConfigId: 'agent_default_v1',
      name: 'dispatch_case_agent',
      description: 'Legacy alias',
      mode: 'system_managed',
      inputSchema: '{}',
      outputSchema: '{}',
      isConcurrencySafe: true,
      enabled: true,
      guardPhase: 'post',
      endpoint: null,
      httpMethod: 'POST',
      headers: null,
      timeoutMs: 8000,
      mockFixture: null,
      displayVerb: null,
      renderHints: null,
      toolCategory: 'system_info',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const res = await GET(makeRequestForAgent('agent_default_v1'))
    const body = await res.json()

    expect(body.data.tools.length).toBeGreaterThanOrEqual(1)
    expect(body.data.tools.every((t: any) => t.agentConfigId === 'agent_default_v1')).toBe(true)
    expect(body.data.tools.find((t: any) => t.name === 'dispatch_case_agent')).toBeUndefined()
  })

  it('test-agent only sees its own tools', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'test-org', role: 'admin' })
    const res = await GET(makeRequestForAgent('test-agent'))
    const body = await res.json()

    expect(body.data.tools.length).toBeGreaterThanOrEqual(1)
    expect(body.data.tools.every((t: any) => t.agentConfigId === 'test-agent')).toBe(true)
  })

  it('POST creates tool scoped to agentConfigId from body', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'test-org', role: 'admin' })
    const res = await POST(makeRequestForAgent('test-agent', { agentConfigId: 'test-agent', name: 'new_agent_tool' }))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.data.tool.agentConfigId).toBe('test-agent')
  })

  it('agent_default_v1 CANNOT see test-agent tools by name lookup', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'admin' })
    const res = await GetByName(makeRequestForAgent('agent_default_v1'), routeCtx('orgb_tool'))
    const body = await res.json()

    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('not_found')
    expect(res.status).toBe(404)
  })

  it('retired tools return not_found by name lookup', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'admin' })
    const res = await GetByName(makeRequestForAgent('agent_default_v1'), routeCtx('dispatch_case_agent'))
    const body = await res.json()

    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('not_found')
    expect(res.status).toBe(404)
  })
})

describe('G3 — Route-level mutations complete successfully', () => {
  it('POST creates tool and returns correct envelope', async () => {
    const res = await POST(makeRequest({
      agentConfigId: 'agent_default_v1',
      name: 'audited_tool',
      description: 'Should complete successfully',
      mode: 'mock',
    }))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.data.tool.name).toBe('audited_tool')
  })

  it('DELETE removes tool and returns success', async () => {
    const res = await DELETE(makeRequestForAgent('agent_default_v1'), routeCtx('lookup_order'))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.data.success).toBe(true)
  })

  it('PUT updates tool and returns updated record', async () => {
    const res = await PUT(
      makeRequestForAgent('agent_default_v1', { agentConfigId: 'agent_default_v1', description: 'Updated description' }),
      routeCtx('lookup_order'),
    )
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.data.tool.description).toBe('Updated description')
  })
})

describe('Error code -> HTTP status mapping', () => {
  it('returns 401 when no session', async () => {
    h.mockGetSession.mockResolvedValue(null)
    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('unauthorized')
    expect(res.status).toBe(401)
  })

  it('returns 404 for non-existent tool', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'admin' })
    const res = await GetByName(makeRequestForAgent('agent_default_v1'), routeCtx('nonexistent'))
    const body = await res.json()

    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('not_found')
    expect(res.status).toBe(404)
  })

  it('returns 403 for deleting a protected tool', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'admin' })
    const res = await DELETE(makeRequestForAgent('agent_default_v1'), routeCtx('system_info'))
    const body = await res.json()

    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('forbidden')
    expect(res.status).toBe(403)
  })
})
