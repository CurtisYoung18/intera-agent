import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { interaAgentTemplateV1Schema } from '@intera/shared/contracts/agent-template'
import { exportAgentTemplate, importAgentTemplate } from '../service'

const now = new Date('2026-06-08T00:00:00.000Z')

describe('Agent Template Package service', () => {
  it('exports current Agent config into v1 package with stable names, legacy fencing, and secret placeholders', async () => {
    const repo = makeExportRepo()
    const template = await exportAgentTemplate(repo, 'agent_1')

    expect(template.schemaVersion).toBe('intera.agentTemplate.v1')
    expect(template.caseTypes[0].type).toBe('deposit_issue')
    expect(template.tools[0].mode).toBe('http')
    expect(template.hookBindings).toContainEqual(expect.objectContaining({
      hookName: 'risk_http_hook',
      scopeType: 'caseType',
      scopeKey: 'caseType:deposit_issue',
      caseTypeName: 'deposit_issue',
    }))
    expect(template.hookBindings).toContainEqual(expect.objectContaining({
      hookName: 'risk_http_hook',
      scopeType: 'tool',
      scopeKey: 'tool:get_latest_deposit',
      toolName: 'get_latest_deposit',
    }))
    expect(template.legacy?.caseTypes).toHaveLength(1)
    expect(template.legacy?.skills).toHaveLength(1)
    expect((template as Record<string, unknown>).policies).toBeUndefined()
    expect((template as Record<string, unknown>).guardrails).toBeUndefined()
    expect((template as Record<string, unknown>).skills).toBeUndefined()

    const serialized = JSON.stringify(template)
    expect(serialized).not.toContain('redact-me-tool')
    expect(serialized).not.toContain('redact-me-gptbots')
    expect(template.secrets?.map((secret) => secret.name)).toEqual(expect.arrayContaining([
      'gptbots_api_key',
      'hook_risk_http_hook_x-risk-token',
      'risk_service_token',
      'tool_get_latest_deposit_authorization',
    ]))

    expect(() => interaAgentTemplateV1Schema.parse(template)).not.toThrow()
  })

  it('imports a package into a new draft Agent and remaps stable manifest names to fresh DB ids', async () => {
    const repo = makeImportRepo()
    const template = {
      schemaVersion: 'intera.agentTemplate.v1',
      metadata: { name: 'Gaming Support Starter' },
      agent: { name: 'Gaming Support Starter', model: 'deepseek-v4-flash' },
      caseTypes: [{
        type: 'deposit_issue',
        displayName: 'Deposit not credited',
        requiredFacts: ['member_id'],
        defaultGoal: 'Investigate deposit status.',
        escalateOn: ['conflict'],
        procedure: { steps: [{ id: 'lookup_latest_deposit', action: 'use', target: 'get_latest_deposit' }] },
      }],
      tools: [{
        name: 'get_latest_deposit',
        description: 'Look up deposit',
        mode: 'http',
        endpoint: 'https://api.example.test/deposits/latest',
        headers: {
          Authorization: 'redact-me-import-tool',
          'Content-Type': 'application/json',
        },
      }],
      hooks: [{
        name: 'risk_http_hook',
        checkpoint: 'PreToolUse',
        handlerKind: 'http',
        handler: {
          kind: 'http',
          endpoint: 'https://risk.example.test/hook',
          method: 'POST',
          headers: { 'X-Risk-Token': 'redact-me-risk' },
          timeoutMs: 5000,
        },
      }],
      hookBindings: [
        {
          hookName: 'risk_http_hook',
          scopeType: 'caseType',
          scopeKey: 'caseType:deposit_issue',
          caseTypeName: 'deposit_issue',
        },
        {
          hookName: 'risk_http_hook',
          scopeType: 'procedureStep',
          scopeKey: 'procedureStep:deposit_issue:lookup_latest_deposit',
          caseTypeName: 'deposit_issue',
          procedureStepId: 'lookup_latest_deposit',
        },
        {
          hookName: 'risk_http_hook',
          scopeType: 'tool',
          scopeKey: 'tool:get_latest_deposit',
          toolName: 'get_latest_deposit',
        },
      ],
      scenarios: [{
        name: 'deposit_pending_handoff',
        turns: [{ role: 'user', content: 'My deposit is missing' }],
        expected: { caseType: 'deposit_issue' },
      }],
      legacy: {
        policies: [{ name: 'old_policy' }],
      },
    }

    const result = await importAgentTemplate(repo, template, { parentAgentConfigId: 'agent_parent' })

    expect(result.config.parentId).toBe('agent_parent')
    expect(result.config.version).toBe(2)
    expect(result.config.isActive).toBe(false)
    expect(result.imported).toEqual({
      caseTypes: 1,
      tools: 1,
      hooks: 1,
      hookBindings: 3,
      scenarios: 0,
      secretPlaceholders: 2,
    })
    expect(result.warnings[0]).toContain('Scenario definitions')

    expect(repo.created.tools[0].id).not.toBe('get_latest_deposit')
    expect(repo.created.caseTypes[0].id).not.toBe('deposit_issue')
    expect(repo.created.hookBindings.map((binding: { scopeKey: string }) => binding.scopeKey)).toEqual([
      `caseType:${repo.created.caseTypes[0].id}`,
      `procedureStep:${repo.created.caseTypes[0].id}:lookup_latest_deposit`,
      `tool:${repo.created.tools[0].id}`,
    ])
    expect(repo.created.tools[0].headers).not.toContain('redact-me-import-tool')
    expect(repo.created.hooks[0].handler).not.toContain('redact-me-risk')
    expect(repo.created.policies).toHaveLength(0)
  })

  it('validates the Gaming Support Starter package fixture', () => {
    const raw = JSON.parse(readFileSync(
      join(process.cwd(), 'templates/gaming-support-starter.intera-agent.json'),
      'utf8',
    ))

    const parsed = interaAgentTemplateV1Schema.parse(raw)
    expect(parsed.metadata.templateId).toBe('gaming_support_starter')
    expect(parsed.caseTypes.length).toBeGreaterThanOrEqual(2)
    expect(parsed.hookBindings.every((binding) => !('caseTypeId' in binding) && !('toolId' in binding))).toBe(true)
    expect(JSON.stringify(parsed)).not.toMatch(/api[_-]?key|Bearer\s+[A-Za-z0-9]/i)
  })
})

function makeExportRepo() {
  const agent = {
    id: 'agent_1',
    orgId: 'default',
    name: 'Gaming Support',
    version: 1,
    parentId: null,
    isActive: true,
    model: 'deepseek-v4-flash',
    temperature: 0.5,
    thinkingBudget: 4096,
    maxIterations: 20,
    coreSystemPrompt: 'Support prompt',
    extendedThinking: true,
    maxOutputTokens: 4096,
    memoryStrategy: '{"enableChatMemory":true}',
    gptbotsApiKey: 'redact-me-gptbots',
    resumePrompt: null,
  }
  const caseTypes = [{
    id: 'ct_db_1',
    agentConfigId: 'agent_1',
    type: 'deposit_issue',
    displayName: 'Deposit not credited',
    description: 'Deposit issue',
    icon: 'money',
    requiredFacts: '["member_id"]',
    defaultGoal: 'Investigate deposit.',
    escalateOn: '["conflict"]',
    autoCloseConditions: null,
    enabled: true,
    procedure: '{"steps":[{"id":"lookup_latest_deposit","action":"use","target":"get_latest_deposit"}]}',
    maxAutoTurns: 8,
    createdAt: now,
    updatedAt: now,
  }]
  const tools = [{
    id: 'tool_db_1',
    agentConfigId: 'agent_1',
    name: 'get_latest_deposit',
    description: 'Read latest deposit',
    inputSchema: '{"type":"object"}',
    outputSchema: '{"type":"object"}',
    mode: 'http',
    endpoint: 'https://api.example.test/latest',
    httpMethod: 'POST',
    headers: '{"Authorization":"redact-me-tool","Content-Type":"application/json"}',
    timeoutMs: 8000,
    mockFixture: null,
    displayVerb: null,
    renderHints: null,
    guardPhase: 'post',
    toolCategory: null,
    isConcurrencySafe: true,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  }]
  const hooks = [{
    id: 'hook_db_1',
    agentConfigId: 'agent_1',
    name: 'risk_http_hook',
    displayName: null,
    description: 'Risk hook',
    checkpoint: 'PreToolUse',
    handlerKind: 'http',
    handler: '{"kind":"http","endpoint":"https://risk.example.test/hook","method":"POST","headers":{"X-Risk-Token":"redact-me-risk"},"secretRefs":[{"name":"risk_service_token","ref":"secret://risk/token"}],"timeoutMs":5000}',
    enabled: true,
    severity: 'high',
    createdAt: now,
    updatedAt: now,
  }]
  const hookBindings = [
    {
      id: 'hb_db_1',
      agentConfigId: 'agent_1',
      hookId: 'hook_db_1',
      scopeType: 'caseType',
      scopeKey: 'caseType:ct_db_1',
      caseTypeId: 'ct_db_1',
      procedureStepId: null,
      toolId: null,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'hb_db_2',
      agentConfigId: 'agent_1',
      hookId: 'hook_db_1',
      scopeType: 'tool',
      scopeKey: 'tool:tool_db_1',
      caseTypeId: null,
      procedureStepId: null,
      toolId: 'tool_db_1',
      enabled: true,
      createdAt: now,
      updatedAt: now,
    },
  ]
  return {
    orgId: 'default',
    agentConfig: {
      findUnique: async () => agent,
    },
    raw: {
      caseType: { findMany: async () => caseTypes },
      tool: { findMany: async () => tools },
      hook: { findMany: async () => hooks },
      hookBinding: { findMany: async () => hookBindings },
    },
  } as any
}

function makeImportRepo() {
  const configs = [{
    id: 'agent_parent',
    orgId: 'default',
    name: 'Gaming Support Starter',
    version: 1,
    parentId: null,
    isActive: true,
    model: 'deepseek-v4-flash',
    temperature: 0.5,
    thinkingBudget: 4096,
    maxIterations: 20,
    maxOutputTokens: 4096,
    coreSystemPrompt: 'Parent prompt',
    extendedThinking: true,
    memoryStrategy: '{}',
    gptbotsApiKey: null,
    resumePrompt: null,
  }]
  const created = {
    configs: [] as any[],
    tools: [] as any[],
    caseTypes: [] as any[],
    hooks: [] as any[],
    hookBindings: [] as any[],
    policies: [] as any[],
  }

  const tx = {
    tool: {
      create: async ({ data }: any) => {
        const row = { id: `tool_new_${created.tools.length + 1}`, ...data, createdAt: now, updatedAt: now }
        created.tools.push(row)
        return row
      },
    },
    caseType: {
      create: async ({ data }: any) => {
        const row = { id: `ct_new_${created.caseTypes.length + 1}`, ...data, createdAt: now, updatedAt: now }
        created.caseTypes.push(row)
        return row
      },
    },
    hook: {
      create: async ({ data }: any) => {
        const row = { id: `hook_new_${created.hooks.length + 1}`, ...data, createdAt: now, updatedAt: now }
        created.hooks.push(row)
        return row
      },
    },
    hookBinding: {
      create: async ({ data }: any) => {
        const row = { id: `hb_new_${created.hookBindings.length + 1}`, ...data, createdAt: now, updatedAt: now }
        created.hookBindings.push(row)
        return row
      },
    },
  }

  const repo = {
    orgId: 'default',
    created,
    agentConfig: {
      findUnique: async ({ where }: any) => configs.find((config) => config.id === where.id) ?? null,
      findFirst: async ({ where }: any) => {
        const matches = configs.filter((config) => config.name === where.name)
        return matches.sort((a, b) => b.version - a.version)[0] ?? null
      },
      create: async ({ data }: any) => {
        const row = { id: `agent_new_${created.configs.length + 1}`, orgId: 'default', ...data, createdAt: now, updatedAt: now }
        configs.push(row)
        created.configs.push(row)
        return {
          id: row.id,
          name: row.name,
          version: row.version,
          parentId: row.parentId,
          isActive: row.isActive,
          model: row.model,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        }
      },
    },
    raw: {
      organization: {
        upsert: async () => ({ id: 'default', name: 'Demo Org' }),
      },
      $transaction: async (callback: any) => callback(tx),
    },
  }

  return repo as any
}
