import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const mockGetSession = vi.fn()
  const agentConfigs: Record<string, any> = {
    agent_1: {
      id: 'agent_1',
      orgId: 'default',
      name: 'Gaming Support',
      version: 2,
      isActive: false,
      parentId: 'agent_live',
      model: 'deepseek-v4-flash',
      temperature: 0.5,
      thinkingBudget: 4096,
      maxIterations: 20,
      maxOutputTokens: 4096,
      coreSystemPrompt: 'Current prompt',
      extendedThinking: false,
      memoryStrategy: '{"mode":"balanced"}',
      gptbotsApiKey: 'raw-gptbots-key',
      resumePrompt: null,
      updatedAt: new Date('2026-06-09T00:00:00.000Z'),
      publishedAt: null,
    },
    agent_live: {
      id: 'agent_live',
      orgId: 'default',
      name: 'Gaming Support',
      version: 1,
      isActive: true,
      parentId: null,
      model: 'deepseek-v4-flash',
      temperature: 0.5,
      thinkingBudget: 4096,
      maxIterations: 20,
      maxOutputTokens: 4096,
      coreSystemPrompt: 'Live prompt',
      extendedThinking: false,
      memoryStrategy: '{"mode":"short"}',
      gptbotsApiKey: null,
      resumePrompt: null,
      updatedAt: new Date('2026-06-08T00:00:00.000Z'),
      publishedAt: new Date('2026-06-08T01:00:00.000Z'),
    },
    foreign_agent: {
      id: 'foreign_agent',
      orgId: 'other',
      name: 'Other',
      version: 1,
      isActive: false,
      model: 'deepseek-v4-flash',
      updatedAt: new Date('2026-06-08T00:00:00.000Z'),
    },
  }
  const toolsByAgent: Record<string, any[]> = {
    agent_1: [
      { id: 'tool_1', agentConfigId: 'agent_1', name: 'dispatch_case_agent', description: 'System route', mode: 'system_managed', inputSchema: '{}', outputSchema: '{}', headers: null, enabled: true, timeoutMs: 8000 },
      { id: 'tool_2', agentConfigId: 'agent_1', name: 'get_latest_deposit', description: 'Deposit lookup', mode: 'http', inputSchema: '{}', outputSchema: '{}', headers: '{"Authorization":"Bearer raw"}', enabled: true, timeoutMs: 8000 },
    ],
  }
  const caseTypesByAgent: Record<string, any[]> = {
    agent_1: [
      { id: 'ct_1', agentConfigId: 'agent_1', type: 'deposit_issue', displayName: 'Deposit Issue', description: null, icon: 'x', requiredFacts: '[]', defaultGoal: '', escalateOn: '[]', autoCloseConditions: null, enabled: true, procedure: '{"steps":[{"id":"lookup","action":"use","target":"get_latest_deposit"}]}', maxAutoTurns: 10 },
    ],
  }
  const hooksByAgent: Record<string, any[]> = { agent_1: [] }
  const hookBindingsByAgent: Record<string, any[]> = { agent_1: [] }
  const knowledgeByAgent: Record<string, any[]> = { agent_1: [] }
  const channelBindingsByAgent: Record<string, any[]> = { agent_1: [] }
  const agentUpdates: any[] = []
  return {
    mockGetSession,
    agentConfigs,
    toolsByAgent,
    caseTypesByAgent,
    hooksByAgent,
    hookBindingsByAgent,
    knowledgeByAgent,
    channelBindingsByAgent,
    agentUpdates,
  }
})

vi.mock('@/lib/db/repo-for-org', () => ({
  repoForOrg(orgId: string) {
    const scopedConfigs = () => Object.values(h.agentConfigs).filter((config: any) => config.orgId === orgId)
    return {
      orgId,
      agentConfig: {
        findUnique: vi.fn(async (args: any) => {
          const config = h.agentConfigs[args?.where?.id]
          if (!config || config.orgId !== orgId) return null
          if (!args?.select) return config
          return Object.fromEntries(Object.keys(args.select).map((key) => [key, config[key]]))
        }),
        findFirst: vi.fn(async (args: any) => {
          let rows = scopedConfigs()
          if (args?.where?.name !== undefined) rows = rows.filter((config: any) => config.name === args.where.name)
          if (args?.where?.isActive !== undefined) rows = rows.filter((config: any) => config.isActive === args.where.isActive)
          if (args?.orderBy?.version === 'desc') rows = rows.sort((a: any, b: any) => b.version - a.version)
          const config = rows[0] ?? null
          if (!config || !args?.select) return config
          return Object.fromEntries(Object.keys(args.select).map((key) => [key, config[key]]))
        }),
        findMany: vi.fn(async () => scopedConfigs()),
        create: vi.fn(async (args: any) => {
          const id = `agent_${Object.keys(h.agentConfigs).length + 1}`
          const config = { id, orgId, updatedAt: new Date(), publishedAt: null, ...args.data }
          h.agentConfigs[id] = config
          return config
        }),
      },
      raw: {
        agentConfig: {
          findUnique: vi.fn(async (args: any) => h.agentConfigs[args?.where?.id] ?? null),
          update: vi.fn(async (args: any) => {
            const config = h.agentConfigs[args.where.id]
            Object.assign(config, args.data, { updatedAt: new Date() })
            h.agentUpdates.push(args.data)
            return config
          }),
        },
        caseType: {
          findMany: vi.fn(async (args: any) => h.caseTypesByAgent[args.where.agentConfigId] ?? []),
          findUnique: vi.fn(async (args: any) => {
            const { agentConfigId, type } = args.where.agentConfigId_type
            return (h.caseTypesByAgent[agentConfigId] ?? []).find((row: any) => row.type === type) ?? null
          }),
          create: vi.fn(async (args: any) => {
            const row = { id: `ct_${Date.now()}`, ...args.data }
            h.caseTypesByAgent[row.agentConfigId] ??= []
            h.caseTypesByAgent[row.agentConfigId].push(row)
            return row
          }),
          update: vi.fn(async (args: any) => {
            const { agentConfigId, type } = args.where.agentConfigId_type
            const row = (h.caseTypesByAgent[agentConfigId] ?? []).find((item: any) => item.type === type)
            Object.assign(row, args.data)
            return row
          }),
        },
        tool: {
          findMany: vi.fn(async (args: any) => h.toolsByAgent[args.where.agentConfigId] ?? []),
          findUnique: vi.fn(async (args: any) => {
            const { agentConfigId, name } = args.where.agentConfigId_name
            return (h.toolsByAgent[agentConfigId] ?? []).find((row: any) => row.name === name) ?? null
          }),
          create: vi.fn(async (args: any) => {
            const row = { id: `tool_${Date.now()}`, ...args.data }
            h.toolsByAgent[row.agentConfigId] ??= []
            h.toolsByAgent[row.agentConfigId].push(row)
            return row
          }),
          update: vi.fn(async (args: any) => {
            const { agentConfigId, name } = args.where.agentConfigId_name
            const row = (h.toolsByAgent[agentConfigId] ?? []).find((item: any) => item.name === name)
            Object.assign(row, args.data)
            return row
          }),
        },
        hook: {
          findMany: vi.fn(async (args: any) => h.hooksByAgent[args.where.agentConfigId] ?? []),
          findUnique: vi.fn(async (args: any) => {
            const { agentConfigId, name } = args.where.agentConfigId_name
            return (h.hooksByAgent[agentConfigId] ?? []).find((row: any) => row.name === name) ?? null
          }),
          create: vi.fn(async (args: any) => {
            const row = { id: `hook_${Date.now()}`, ...args.data }
            h.hooksByAgent[row.agentConfigId] ??= []
            h.hooksByAgent[row.agentConfigId].push(row)
            return row
          }),
          update: vi.fn(async (args: any) => {
            const { agentConfigId, name } = args.where.agentConfigId_name
            const row = (h.hooksByAgent[agentConfigId] ?? []).find((item: any) => item.name === name)
            Object.assign(row, args.data)
            return row
          }),
        },
        hookBinding: {
          findMany: vi.fn(async (args: any) => h.hookBindingsByAgent[args.where.agentConfigId] ?? []),
          findFirst: vi.fn(async () => null),
          create: vi.fn(async (args: any) => {
            const row = { id: `binding_${Date.now()}`, ...args.data }
            h.hookBindingsByAgent[row.agentConfigId] ??= []
            h.hookBindingsByAgent[row.agentConfigId].push(row)
            return row
          }),
        },
        knowledgeSource: {
          findMany: vi.fn(async (args: any) => h.knowledgeByAgent[args.where.agentConfigId] ?? []),
          findUnique: vi.fn(async (args: any) => {
            const { agentConfigId, name } = args.where.agentConfigId_name
            return (h.knowledgeByAgent[agentConfigId] ?? []).find((row: any) => row.name === name) ?? null
          }),
          create: vi.fn(async (args: any) => {
            const row = { id: `ks_${Date.now()}`, ...args.data }
            h.knowledgeByAgent[row.agentConfigId] ??= []
            h.knowledgeByAgent[row.agentConfigId].push(row)
            return row
          }),
          update: vi.fn(async (args: any) => {
            const { agentConfigId, name } = args.where.agentConfigId_name
            const row = (h.knowledgeByAgent[agentConfigId] ?? []).find((item: any) => item.name === name)
            Object.assign(row, args.data)
            return row
          }),
        },
        channelBinding: {
          findMany: vi.fn(async (args: any) => h.channelBindingsByAgent[args.where.agentConfigId] ?? []),
          upsert: vi.fn(async (args: any) => {
            const { agentConfigId, channel } = args.where.agentConfigId_channel
            h.channelBindingsByAgent[agentConfigId] ??= []
            let row = h.channelBindingsByAgent[agentConfigId].find((item: any) => item.channel === channel)
            if (row) Object.assign(row, args.update)
            else {
              row = { id: `cb_${Date.now()}`, ...args.create }
              h.channelBindingsByAgent[agentConfigId].push(row)
            }
            return row
          }),
        },
        organization: { upsert: vi.fn(async () => ({ id: orgId })) },
        $transaction: vi.fn(async (fn: any) => fn({})),
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

import { GET as GetContext } from '@/app/api/admin/config-pilot/context/route'
import { POST as Apply } from '@/app/api/admin/config-pilot/apply/route'
import { getScenarioValidationSummary } from '@/lib/scenarios/store'
import { selectConfigPilotModel } from '@/lib/config-pilot/model-selection'

let tempDir = ''

function getRequest(agentConfigId = 'agent_1') {
  return {
    method: 'GET',
    json: async () => ({}),
    nextUrl: new URL(`http://localhost/api/admin/config-pilot/context?agentConfigId=${agentConfigId}`),
  } as any
}

function postRequest(body: unknown) {
  return {
    method: 'POST',
    json: async () => body,
    nextUrl: new URL('http://localhost/api/admin/config-pilot/apply'),
  } as any
}

function proposal(patches: unknown[]) {
  return {
    targetSurface: 'brain',
    title: 'Draft change',
    summary: 'Draft change',
    patches,
    diffGroups: [],
    receiptSuggestions: [],
    runSuggestions: [],
    safetyNotes: [],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'admin', userId: 'user-1' })
  h.agentUpdates.length = 0
  h.agentConfigs.agent_1.isActive = false
  h.agentConfigs.agent_1.model = 'deepseek-v4-flash'
  h.agentConfigs.agent_1.temperature = 0.5
  tempDir = mkdtempSync(path.join(tmpdir(), 'intera-config-pilot-'))
  process.env.INTERA_SCENARIO_STORE_PATH = path.join(tempDir, 'scenarios.json')
})

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  delete process.env.INTERA_SCENARIO_STORE_PATH
  delete process.env.CONFIG_PILOT_MODEL
})

describe('ConfigPilot APIs', () => {
  it('returns current context with permissions, redacted secrets, and locked capabilities', async () => {
    const res = await GetContext(getRequest())
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.data.permissions).toMatchObject({ canRead: true, canApply: true, canPublish: false })
    expect(body.data.configuration.brain.gptbotsApiKey).toBe('{{secretRef:agent.gptbotsApiKey}}')
    expect(body.data.configuration.tools.find((tool: any) => tool.name === 'dispatch_case_agent')).toMatchObject({ locked: true })
    expect(body.data.lockedCapabilities.some((capability: any) => capability.id === 'hook_engine')).toBe(true)
  })

  it('rejects apply for non-admin roles', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'operator', userId: 'op-1' })
    const res = await Apply(postRequest({
      agentConfigId: 'agent_1',
      accepted: true,
      proposal: proposal([{ surface: 'brain', operation: 'update', fields: { temperature: 0.4 } }]),
    }))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error.code).toBe('forbidden')
  })

  it('requires explicit user acceptance before writing', async () => {
    const res = await Apply(postRequest({
      agentConfigId: 'agent_1',
      accepted: false,
      proposal: proposal([{ surface: 'brain', operation: 'update', fields: { temperature: 0.4 } }]),
    }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('validation')
    expect(h.agentUpdates).toHaveLength(0)
  })

  it('rejects untyped publish/activation fields instead of stripping them', async () => {
    const res = await Apply(postRequest({
      agentConfigId: 'agent_1',
      accepted: true,
      proposal: proposal([{ surface: 'brain', operation: 'update', fields: { isActive: true } }]),
    }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('validation')
    expect(h.agentUpdates).toHaveLength(0)
  })

  it('writes accepted typed patches as draft changes and marks validation stale', async () => {
    const res = await Apply(postRequest({
      agentConfigId: 'agent_1',
      accepted: true,
      proposal: proposal([{ surface: 'brain', operation: 'update', fields: { temperature: 0.25 } }]),
    }))
    const body = await res.json()
    const validation = await getScenarioValidationSummary('agent_1')

    expect(body.ok).toBe(true)
    expect(body.data.validation.state).toBe('Changed since last validation')
    expect(validation.state).toBe('Changed since last validation')
    expect(h.agentConfigs.agent_1.temperature).toBe(0.25)
    expect(h.agentUpdates.some((update) => Object.prototype.hasOwnProperty.call(update, 'isActive'))).toBe(false)
  })

  it('refuses ConfigPilot edits to protected system tools', async () => {
    const res = await Apply(postRequest({
      agentConfigId: 'agent_1',
      accepted: true,
      proposal: {
        ...proposal([{ surface: 'tools', operation: 'update', target: { name: 'dispatch_case_agent' }, fields: { description: 'change protected tool' } }]),
        targetSurface: 'tools',
      },
    }))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error.code).toBe('forbidden')
  })

  it('selects CONFIG_PILOT_MODEL before falling back to the AgentConfig model', () => {
    expect(selectConfigPilotModel('agent-model', { CONFIG_PILOT_MODEL: 'override-model' })).toBe('override-model')
    expect(selectConfigPilotModel('agent-model', { CONFIG_PILOT_MODEL: '' })).toBe('agent-model')
  })
})
