// Route-level guard tests for /api/admin/hooks
// Scoped by agentConfigId (not orgId).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const hooksByAgent: Record<string, Record<string, any>[]> = {
    agent_default_v1: [
      {
        id: 'h1',
        agentConfigId: 'agent_default_v1',
        name: 'investigate_before_transfer',
        displayName: 'Investigate before transfer',
        description: 'Require investigation',
        checkpoint: 'PreToolUse',
        handlerKind: 'declarative',
        handler: JSON.stringify({ kind: 'declarative', check: {}, effect: { action: 'block' } }),
        enabled: true,
        severity: 'high',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    'test-agent': [
      {
        id: 'h2',
        agentConfigId: 'test-agent',
        name: 'org_b_hook',
        displayName: 'Org B Hook',
        description: 'Private hook',
        checkpoint: 'Stop',
        handlerKind: 'code',
        handler: JSON.stringify({ kind: 'code', runtime: 'javascript', source: 'async function hook() { return { action: "allow" } }' }),
        enabled: true,
        severity: 'medium',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  }
  const bindingsByAgent: Record<string, Record<string, any>[]> = {
    agent_default_v1: [
      {
        id: 'b1',
        agentConfigId: 'agent_default_v1',
        hookId: 'h1',
        scopeType: 'agent',
        scopeKey: 'agent',
        caseTypeId: null,
        procedureStepId: null,
        toolId: null,
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    'test-agent': [],
  }
  const caseTypesByAgent: Record<string, Record<string, any>[]> = {
    agent_default_v1: [
      {
        id: 'ct1',
        agentConfigId: 'agent_default_v1',
        type: 'deposit_issue',
        displayName: 'Deposit Issue',
        enabled: true,
        procedure: JSON.stringify({
          steps: [
            { id: 'collect_facts', action: 'ask', required: true },
            { id: 'lookup_deposit', action: 'use', target: 'get_latest_deposit' },
          ],
        }),
      },
    ],
    'test-agent': [
      {
        id: 'ct2',
        agentConfigId: 'test-agent',
        type: 'org_b_case',
        displayName: 'Org B Case',
        enabled: true,
        procedure: JSON.stringify({ steps: [{ id: 'private_step', action: 'ask' }] }),
      },
    ],
  }
  const toolsByAgent: Record<string, Record<string, any>[]> = {
    agent_default_v1: [
      { id: 't1', agentConfigId: 'agent_default_v1', name: 'get_latest_deposit', description: 'Deposit lookup', mode: 'http', enabled: true },
    ],
    'test-agent': [
      { id: 't2', agentConfigId: 'test-agent', name: 'org_b_tool', description: 'Private tool', mode: 'http', enabled: true },
    ],
  }
  const agentConfigs: Record<string, { id: string; orgId: string }> = {
    agent_default_v1: { id: 'agent_default_v1', orgId: 'default' },
    'test-agent': { id: 'test-agent', orgId: 'test-org' },
  }
  const createdHooks: Record<string, any>[] = []
  const createdBindings: Record<string, any>[] = []
  const mockGetSession = vi.fn()

  return { hooksByAgent, bindingsByAgent, caseTypesByAgent, toolsByAgent, agentConfigs, createdHooks, createdBindings, mockGetSession }
})

vi.mock('@/lib/db/repo-for-org', () => ({
  repoForOrg(orgId: string) {
    return {
      orgId,
      agentConfig: {
        findUnique: vi.fn(async (args: any) => {
          const id = args?.where?.id
          const config = h.agentConfigs[id]
          if (!config || config.orgId !== orgId) return null
          return config
        }),
      },
      raw: {
        hook: {
          findMany: vi.fn(async (args?: any) => {
            const agentConfigId = args?.where?.agentConfigId
            return agentConfigId ? (h.hooksByAgent[agentConfigId] ?? []) : []
          }),
          findUnique: vi.fn(async (args: any) => {
            const { agentConfigId, name } = args?.where?.agentConfigId_name ?? {}
            return (h.hooksByAgent[agentConfigId] ?? []).find((hook: any) => hook.name === name) ?? null
          }),
          create: vi.fn(async (args: any) => {
            const hook = { id: `h_new_${h.createdHooks.length}`, ...args.data, createdAt: new Date(), updatedAt: new Date() }
            h.createdHooks.push(hook)
            const agentConfigId = args.data.agentConfigId
            if (!h.hooksByAgent[agentConfigId]) h.hooksByAgent[agentConfigId] = []
            h.hooksByAgent[agentConfigId].push(hook)
            return hook
          }),
          update: vi.fn(async (args: any) => {
            const { agentConfigId, name } = args.where.agentConfigId_name
            const hook = (h.hooksByAgent[agentConfigId] ?? []).find((item: any) => item.name === name)
            if (!hook) throw new Error('Hook not found')
            Object.assign(hook, args.data)
            return hook
          }),
          delete: vi.fn(async (args: any) => {
            const { agentConfigId, name } = args.where.agentConfigId_name
            const hooks = h.hooksByAgent[agentConfigId] ?? []
            const idx = hooks.findIndex((item: any) => item.name === name)
            if (idx >= 0) hooks.splice(idx, 1)
          }),
        },
        hookBinding: {
          findMany: vi.fn(async (args?: any) => {
            const where = args?.where ?? {}
            const rows = h.bindingsByAgent[where.agentConfigId] ?? []
            return rows.filter((binding: any) => !where.hookId || binding.hookId === where.hookId)
          }),
          findFirst: vi.fn(async (args?: any) => {
            const where = args?.where ?? {}
            const rows = h.bindingsByAgent[where.agentConfigId] ?? []
            return rows.find((binding: any) => {
              if (where.id && binding.id !== where.id) return false
              if (where.hookId && binding.hookId !== where.hookId) return false
              if (where.scopeKey && binding.scopeKey !== where.scopeKey) return false
              return true
            }) ?? null
          }),
          create: vi.fn(async (args: any) => {
            const binding = { id: `b_new_${h.createdBindings.length}`, ...args.data, createdAt: new Date(), updatedAt: new Date() }
            h.createdBindings.push(binding)
            const agentConfigId = args.data.agentConfigId
            if (!h.bindingsByAgent[agentConfigId]) h.bindingsByAgent[agentConfigId] = []
            h.bindingsByAgent[agentConfigId].push(binding)
            return binding
          }),
          update: vi.fn(async (args: any) => {
            const rows = Object.values(h.bindingsByAgent).flat()
            const binding = rows.find((item: any) => item.id === args.where.id)
            if (!binding) throw new Error('Binding not found')
            Object.assign(binding, args.data)
            return binding
          }),
          delete: vi.fn(async (args: any) => {
            for (const rows of Object.values(h.bindingsByAgent)) {
              const idx = rows.findIndex((item: any) => item.id === args.where.id)
              if (idx >= 0) rows.splice(idx, 1)
            }
          }),
        },
        caseType: {
          findMany: vi.fn(async (args?: any) => {
            const agentConfigId = args?.where?.agentConfigId
            return agentConfigId ? (h.caseTypesByAgent[agentConfigId] ?? []) : []
          }),
          findFirst: vi.fn(async (args?: any) => {
            const where = args?.where ?? {}
            return (h.caseTypesByAgent[where.agentConfigId] ?? []).find((ct: any) => ct.id === where.id) ?? null
          }),
        },
        tool: {
          findMany: vi.fn(async (args?: any) => {
            const agentConfigId = args?.where?.agentConfigId
            return agentConfigId ? (h.toolsByAgent[agentConfigId] ?? []) : []
          }),
          findFirst: vi.fn(async (args?: any) => {
            const where = args?.where ?? {}
            return (h.toolsByAgent[where.agentConfigId] ?? []).find((tool: any) => tool.id === where.id) ?? null
          }),
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

import { GET, POST } from '@/app/api/admin/hooks/route'
import { GET as GetHook, PUT as PutHook, DELETE as DeleteHook } from '@/app/api/admin/hooks/[name]/route'
import { POST as PostBinding } from '@/app/api/admin/hooks/[name]/bindings/route'
import { PUT as PutBinding, DELETE as DeleteBinding } from '@/app/api/admin/hooks/[name]/bindings/[id]/route'

function makeRequest(path = '/api/admin/hooks?agentConfigId=agent_default_v1', body?: unknown) {
  return {
    method: body ? 'POST' : 'GET',
    json: async () => body ?? {},
    nextUrl: new URL(`http://localhost${path}`),
  } as any
}

function routeCtx(params: Record<string, string>) {
  return { params: Promise.resolve(params) }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.createdHooks.length = 0
  h.createdBindings.length = 0
  h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'admin' })
  h.hooksByAgent.agent_default_v1 = [
    {
      id: 'h1',
      agentConfigId: 'agent_default_v1',
      name: 'investigate_before_transfer',
      displayName: 'Investigate before transfer',
      description: 'Require investigation',
      checkpoint: 'PreToolUse',
      handlerKind: 'declarative',
      handler: JSON.stringify({ kind: 'declarative', check: {}, effect: { action: 'block' } }),
      enabled: true,
      severity: 'high',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]
  h.hooksByAgent['test-agent'] = [
    {
      id: 'h2',
      agentConfigId: 'test-agent',
      name: 'org_b_hook',
      displayName: 'Org B Hook',
      description: 'Private hook',
      checkpoint: 'Stop',
      handlerKind: 'code',
      handler: JSON.stringify({ kind: 'code', runtime: 'javascript', source: 'async function hook() { return { action: "allow" } }' }),
      enabled: true,
      severity: 'medium',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]
  h.bindingsByAgent.agent_default_v1 = [
    {
      id: 'b1',
      agentConfigId: 'agent_default_v1',
      hookId: 'h1',
      scopeType: 'agent',
      scopeKey: 'agent',
      caseTypeId: null,
      procedureStepId: null,
      toolId: null,
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]
  h.bindingsByAgent['test-agent'] = []
})

describe('F4 Hook API', () => {
  it('GET returns hooks plus binding picker data for the selected agent', async () => {
    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.data.hooks).toHaveLength(1)
    expect(body.data.hooks[0].name).toBe('investigate_before_transfer')
    expect(body.data.hooks[0].handler.kind).toBe('declarative')
    expect(body.data.procedureSteps.map((step: any) => step.id)).toContain('lookup_deposit')
    expect(body.data.tools.map((tool: any) => tool.name)).toContain('get_latest_deposit')
  })

  it('does not let one org list another org agent hooks', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'admin' })
    const res = await GET(makeRequest('/api/admin/hooks?agentConfigId=test-agent'))
    const body = await res.json()

    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('not_found')
    expect(res.status).toBe(404)
  })

  it('does not let one org read another org hook by name', async () => {
    const res = await GetHook(makeRequest(), routeCtx({ name: 'org_b_hook' }))
    const body = await res.json()

    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('not_found')
    expect(res.status).toBe(404)
  })

  it('POST creates a Hook with validated handler payload', async () => {
    const res = await POST(makeRequest('/api/admin/hooks', {
      agentConfigId: 'agent_default_v1',
      name: 'stop_unsafe_promise',
      checkpoint: 'Stop',
      handlerKind: 'code',
      handler: { kind: 'code', runtime: 'javascript', source: 'async function hook() { return { action: "allow" } }' },
      severity: 'critical',
    }))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(res.status).toBe(201)
    expect(body.data.hook.name).toBe('stop_unsafe_promise')
    expect(body.data.hook.handler.kind).toBe('code')
  })

  it('POST rejects handlerKind and handler.kind mismatches', async () => {
    const res = await POST(makeRequest('/api/admin/hooks', {
      agentConfigId: 'agent_default_v1',
      name: 'bad_handler',
      checkpoint: 'Stop',
      handlerKind: 'http',
      handler: { kind: 'declarative', check: {}, effect: {} },
    }))
    const body = await res.json()

    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('validation')
    expect(res.status).toBe(400)
  })

  it('POST rejects declarative Rule Tool names that do not exist on the Agent', async () => {
    const res = await POST(makeRequest('/api/admin/hooks', {
      agentConfigId: 'agent_default_v1',
      name: 'bad_tool_rule',
      checkpoint: 'PostToolUse',
      handlerKind: 'declarative',
      handler: {
        kind: 'declarative',
        check: {
          kind: 'rule',
          match: { tools: ['missing_tool'] },
          always: true,
        },
        effect: { decision: 'warn' },
      },
    }))
    const body = await res.json()

    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('validation')
    expect(res.status).toBe(400)
  })

  it('PUT updates an existing Hook and keeps bindings attached', async () => {
    const res = await PutHook(makeRequest('/api/admin/hooks/investigate_before_transfer', {
      agentConfigId: 'agent_default_v1',
      displayName: 'Investigate first',
      enabled: false,
    }), routeCtx({ name: 'investigate_before_transfer' }))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.data.hook.displayName).toBe('Investigate first')
    expect(body.data.hook.enabled).toBe(false)
    expect(body.data.hook.bindings).toHaveLength(1)
  })

  it('DELETE removes a Hook', async () => {
    const res = await DeleteHook(makeRequest('/api/admin/hooks/investigate_before_transfer?agentConfigId=agent_default_v1'), routeCtx({ name: 'investigate_before_transfer' }))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.data.success).toBe(true)
  })
})

describe('F4 HookBinding API', () => {
  it('creates a CaseType binding with a canonical scopeKey', async () => {
    const res = await PostBinding(makeRequest('/api/admin/hooks/investigate_before_transfer/bindings', {
      agentConfigId: 'agent_default_v1',
      scopeType: 'caseType',
      caseTypeId: 'ct1',
    }), routeCtx({ name: 'investigate_before_transfer' }))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(res.status).toBe(201)
    expect(body.data.binding.scopeKey).toBe('caseType:ct1')
  })

  it('creates a ProcedureStep binding through the ProcedureStep picker shape', async () => {
    const res = await PostBinding(makeRequest('/api/admin/hooks/investigate_before_transfer/bindings', {
      agentConfigId: 'agent_default_v1',
      scopeType: 'procedureStep',
      caseTypeId: 'ct1',
      procedureStepId: 'lookup_deposit',
    }), routeCtx({ name: 'investigate_before_transfer' }))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.data.binding.scopeKey).toBe('procedureStep:ct1:lookup_deposit')
  })

  it('creates a Tool binding through the Tool picker shape', async () => {
    const res = await PostBinding(makeRequest('/api/admin/hooks/investigate_before_transfer/bindings', {
      agentConfigId: 'agent_default_v1',
      scopeType: 'tool',
      toolId: 't1',
    }), routeCtx({ name: 'investigate_before_transfer' }))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.data.binding.scopeKey).toBe('tool:t1')
  })

  it('rejects invalid CaseType, ProcedureStep, and Tool references', async () => {
    const missingCaseType = await PostBinding(makeRequest('/api/admin/hooks/investigate_before_transfer/bindings', {
      agentConfigId: 'agent_default_v1',
      scopeType: 'caseType',
      caseTypeId: 'ct-missing',
    }), routeCtx({ name: 'investigate_before_transfer' }))
    expect(missingCaseType.status).toBe(400)

    const missingStep = await PostBinding(makeRequest('/api/admin/hooks/investigate_before_transfer/bindings', {
      agentConfigId: 'agent_default_v1',
      scopeType: 'procedureStep',
      caseTypeId: 'ct1',
      procedureStepId: 'ghost_step',
    }), routeCtx({ name: 'investigate_before_transfer' }))
    expect(missingStep.status).toBe(400)

    const missingTool = await PostBinding(makeRequest('/api/admin/hooks/investigate_before_transfer/bindings', {
      agentConfigId: 'agent_default_v1',
      scopeType: 'tool',
      toolId: 't-missing',
    }), routeCtx({ name: 'investigate_before_transfer' }))
    expect(missingTool.status).toBe(400)
  })

  it('updates and deletes HookBinding rows inside the selected hook', async () => {
    const update = await PutBinding(makeRequest('/api/admin/hooks/investigate_before_transfer/bindings/b1', {
      agentConfigId: 'agent_default_v1',
      enabled: false,
    }), routeCtx({ name: 'investigate_before_transfer', id: 'b1' }))
    const updateBody = await update.json()
    expect(updateBody.ok).toBe(true)
    expect(updateBody.data.binding.enabled).toBe(false)

    const remove = await DeleteBinding(makeRequest('/api/admin/hooks/investigate_before_transfer/bindings/b1?agentConfigId=agent_default_v1'), routeCtx({ name: 'investigate_before_transfer', id: 'b1' }))
    const removeBody = await remove.json()
    expect(removeBody.ok).toBe(true)
    expect(removeBody.data.success).toBe(true)
  })
})
