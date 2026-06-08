// AUDIT-L5 cross-tenant isolation guard test for agent sub-module routes.
//
// Background (HARD_BUGS §L5): the 2026-06-06 migration moved Tool/Policy/CaseType/
// KnowledgeSource/ChannelBinding from org-scoped to agent-scoped — their `org_id`
// column was DROPPED, leaving only `agent_config_id`. The sub-module admin routes
// therefore use `repo.raw.tool.*` (UNSCOPED Prisma) keyed by a CLIENT-SUPPLIED
// `agentConfigId`, with NO check that the agentConfig belongs to the caller's
// `session.orgId`. The real isolation boundary is now: "does this agentConfigId
// belong to session.orgId?" — and it is currently NOT enforced at the route seam.
//
// This test reproduces the production data model faithfully:
//   • Tool rows have NO org_id; they can only be filtered by agentConfigId
//     (exactly what `repo.raw.tool` does in prod).
//   • The AgentConfig table DOES retain org_id; ownership can only be proven by
//     joining agentConfigId -> AgentConfig.orgId.
//
// Scenario: a session for ORG A calls /api/admin/tools with an agentConfigId that
// belongs to ORG B's agent. A correct handler MUST 403/404 and return NO org-B
// data, and (for writes) MUST NOT mutate org-B's rows.
//
// EXPECTED RESULT AGAINST CURRENT CODE: RED. The handler trusts the client id and
// leaks / mutates org-B data. Flip to GREEN once an ownership check
// (e.g. assertAgentInOrg) is wired into the sub-module routes.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted fixture: faithful model of the post-migration schema ──
const h = vi.hoisted(() => {
  // AgentConfig retains org_id. agent_a belongs to org-A, agent_b to org-B.
  const agentConfigs: Record<string, { id: string; orgId: string; name: string }> = {
    agent_a: { id: 'agent_a', orgId: 'org-A', name: 'Alpha' },
    agent_b: { id: 'agent_b', orgId: 'org-B', name: 'Bravo' },
  }
  // Tool rows: NO org_id column (dropped by migration). Only agentConfigId.
  const toolsByAgent: Record<string, Record<string, unknown>[]> = {
    agent_a: [
      { id: 'ta1', agentConfigId: 'agent_a', name: 'alpha_tool', description: 'Org A tool', mode: 'mock', inputSchema: '{}', outputSchema: '{}', isConcurrencySafe: true, enabled: true, guardPhase: 'post', endpoint: null, httpMethod: 'POST', headers: null, timeoutMs: 8000, mockFixture: null, displayVerb: null, renderHints: null, toolCategory: null, createdAt: new Date(), updatedAt: new Date() },
    ],
    agent_b: [
      { id: 'tb1', agentConfigId: 'agent_b', name: 'bravo_secret_tool', description: 'Org B PRIVATE tool', mode: 'http', inputSchema: '{}', outputSchema: '{}', isConcurrencySafe: true, enabled: true, guardPhase: 'post', endpoint: 'https://orgb.internal/secret', httpMethod: 'POST', headers: null, timeoutMs: 8000, mockFixture: null, displayVerb: null, renderHints: null, toolCategory: null, createdAt: new Date(), updatedAt: new Date() },
    ],
  }
  const mockGetSession = vi.fn()
  return { agentConfigs, toolsByAgent, mockGetSession }
})

// ── Mock repoForOrg ──
// `raw.*` is UNSCOPED (mirrors real Prisma): it filters tools ONLY by
// agentConfigId, because there is no org_id column to filter on. The scoped
// `agentConfig` model DOES enforce orgId (mirrors the runtime proxy), so a
// correct handler could use it to prove ownership.
vi.mock('@/lib/db/repo-for-org', () => ({
  repoForOrg(orgId: string) {
    return {
      orgId,
      // Scoped agentConfig: findUnique/findFirst only return rows in this org.
      agentConfig: {
        findUnique: vi.fn(async (args: any) => {
          const id = args?.where?.id
          const ac = h.agentConfigs[id]
          if (!ac) return null
          // Proxy injects orgId for findUnique when where lacks it -> cross-org miss.
          if (ac.orgId !== orgId) return null
          return ac
        }),
        findFirst: vi.fn(async (args: any) => {
          return Object.values(h.agentConfigs).find(
            (ac) => ac.orgId === orgId && (args?.where?.id ? ac.id === args.where.id : true),
          ) ?? null
        }),
      },
      raw: {
        tool: {
          findMany: vi.fn(async (args?: any) => {
            const agentConfigId = args?.where?.agentConfigId as string | undefined
            return agentConfigId ? (h.toolsByAgent[agentConfigId] ?? []) : []
          }),
          findUnique: vi.fn(async (args: any) => {
            const { agentConfigId, name } = args?.where?.agentConfigId_name ?? {}
            return (h.toolsByAgent[agentConfigId] ?? []).find((t: any) => t.name === name) ?? null
          }),
          create: vi.fn(async (args: any) => {
            const ac = args.data.agentConfigId
            const tool = { id: `t_new_${Math.random().toString(36).slice(2)}`, ...args.data, createdAt: new Date(), updatedAt: new Date() }
            if (!h.toolsByAgent[ac]) h.toolsByAgent[ac] = []
            h.toolsByAgent[ac].push(tool)
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
      },
    } as any
  },
}))

vi.mock('@/lib/auth', () => ({ getSession: h.mockGetSession }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/tool-classifications', () => ({
  SYSTEM_TOOL_NAMES: new Set<string>(),
  SPECIAL_TOOL_NAMES: new Set<string>(),
  CHANNEL_TOOL_NAMES: new Set<string>(),
}))
// BUILT_IN_TOOLS empty so GET does not auto-create rows that confuse the count.
vi.mock('@/lib/agent/tools', () => ({ BUILT_IN_TOOLS: [] }))

import { GET, POST } from '@/app/api/admin/tools/route'
import { GET as GetByName, DELETE } from '@/app/api/admin/tools/[name]/route'

// Session is ORG A; request supplies ORG B's agentConfigId (agent_b).
const ORG_A = 'org-A'
const ORG_B_AGENT = 'agent_b'

function reqForAgent(agentConfigId: string, body?: unknown) {
  return {
    method: body ? 'POST' : 'GET',
    json: async () => body ?? {},
    nextUrl: new URL(`http://localhost/api/admin/tools?agentConfigId=${agentConfigId}`),
  } as any
}
function nameCtx(name: string) {
  return { params: Promise.resolve({ name }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.mockGetSession.mockResolvedValue({ orgId: ORG_A, role: 'admin', userId: 'uA' })
  h.toolsByAgent.agent_b = [
    { id: 'tb1', agentConfigId: 'agent_b', name: 'bravo_secret_tool', description: 'Org B PRIVATE tool', mode: 'http', inputSchema: '{}', outputSchema: '{}', isConcurrencySafe: true, enabled: true, guardPhase: 'post', endpoint: 'https://orgb.internal/secret', httpMethod: 'POST', headers: null, timeoutMs: 8000, mockFixture: null, displayVerb: null, renderHints: null, toolCategory: null, createdAt: new Date(), updatedAt: new Date() },
  ]
})

describe('AUDIT-L5 — org A cannot reach org B agent sub-modules by agentConfigId', () => {
  it('GET /tools: org A supplying org B agentConfigId must NOT receive org B tools', async () => {
    const res = await GET(reqForAgent(ORG_B_AGENT))
    const body = await res.json()

    // A correct handler 403/404s instead of returning org-B data.
    expect([403, 404]).toContain(res.status)
    expect(body.ok).toBe(false)
    // And under no circumstances may org-B's private tool leak in the payload.
    const leaked = JSON.stringify(body)
    expect(leaked).not.toContain('bravo_secret_tool')
    expect(leaked).not.toContain('orgb.internal')
  })

  it('GET /tools/[name]: org A cannot read org B tool by name', async () => {
    const res = await GetByName(reqForAgent(ORG_B_AGENT), nameCtx('bravo_secret_tool'))
    const body = await res.json()

    expect([403, 404]).toContain(res.status)
    expect(body.ok).toBe(false)
    expect(JSON.stringify(body)).not.toContain('orgb.internal')
  })

  it('POST /tools: org A cannot create a tool under org B agent (no write to org B)', async () => {
    const before = h.toolsByAgent.agent_b.length
    const res = await POST(
      reqForAgent(ORG_B_AGENT, { agentConfigId: ORG_B_AGENT, name: 'injected_by_orgA', description: 'x' }),
    )
    const body = await res.json()

    expect([403, 404]).toContain(res.status)
    expect(body.ok).toBe(false)
    // CRITICAL: no row was written into org B's agent.
    expect(h.toolsByAgent.agent_b.length).toBe(before)
    expect(h.toolsByAgent.agent_b.some((t: any) => t.name === 'injected_by_orgA')).toBe(false)
  })

  it('DELETE /tools/[name]: org A cannot delete org B tool', async () => {
    const before = h.toolsByAgent.agent_b.length
    const res = await DELETE(reqForAgent(ORG_B_AGENT), nameCtx('bravo_secret_tool'))
    const body = await res.json()

    expect([403, 404]).toContain(res.status)
    expect(body.ok).toBe(false)
    // CRITICAL: org B's tool still exists.
    expect(h.toolsByAgent.agent_b.length).toBe(before)
    expect(h.toolsByAgent.agent_b.some((t: any) => t.name === 'bravo_secret_tool')).toBe(true)
  })

  it('sanity: org A CAN reach its OWN agent (control — proves the guard is not over-broad)', async () => {
    const res = await GET(reqForAgent('agent_a'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data.tools.some((t: any) => t.name === 'alpha_tool')).toBe(true)
  })
})
