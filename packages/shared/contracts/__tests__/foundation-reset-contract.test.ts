import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  hookBindingContractSchema,
  hookContractSchema,
  hookContextSchema,
  hookDecisionSchema,
  hookHandlerSchema,
  mapLegacyHookCheckpoint,
} from '../hooks'
import { interaAgentTemplateV1Schema } from '../agent-template'
import {
  scenarioObservedEvidenceSchema,
  scenarioReceiptSchema,
  templateScenarioSchema,
} from '../scenarios'
import { normalizeToolMode, templateToolSchema } from '../tools'

describe('Hook contract', () => {
  it('maps legacy checkpoints into the reset lifecycle', () => {
    expect(mapLegacyHookCheckpoint('preTool')).toBe('PreToolUse')
    expect(mapLegacyHookCheckpoint('postTool')).toBe('PostToolUse')
    expect(mapLegacyHookCheckpoint('preFinalize')).toBe('Stop')
    expect(mapLegacyHookCheckpoint('unknown')).toBe('Stop')
  })

  it('validates declarative, code, and http handlers', () => {
    expect(hookHandlerSchema.parse({
      kind: 'declarative',
      check: { kind: 'rule', requireTools: ['get_latest_deposit'] },
      effect: { decision: 'block' },
    }).kind).toBe('declarative')

    expect(hookHandlerSchema.parse({
      kind: 'code',
      runtime: 'javascript',
      source: 'async function hook(ctx) { return { action: "allow" } }',
    }).kind).toBe('code')

    expect(hookHandlerSchema.parse({
      kind: 'http',
      endpoint: 'https://rules.example.com/hook',
      method: 'POST',
      timeoutMs: 3000,
      secretRefs: [{ name: 'risk_service_token', ref: 'secret://risk/token' }],
    }).kind).toBe('http')
  })

  it('validates Hook decisions, context, and bindings', () => {
    expect(hookDecisionSchema.parse({ action: 'block', reason: 'missing evidence' }).action).toBe('block')
    expect(hookContextSchema.parse({
      checkpoint: 'PreToolUse',
      tool: { name: 'get_latest_deposit', input: { txnId: 'T1' } },
    }).procedureStepIds).toEqual([])

    expect(hookBindingContractSchema.parse({
      hookName: 'investigate_before_resolve',
      scopeType: 'caseType',
      scopeKey: 'caseType:ct_123',
      caseTypeName: 'deposit_issue',
    }).scopeType).toBe('caseType')

    expect(hookBindingContractSchema.parse({
      hookName: 'require_receipt_before_lookup',
      scopeType: 'procedureStep',
      scopeKey: 'procedureStep:ct_123:ask_receipt',
      procedureStepId: 'ask_receipt',
    }).scopeType).toBe('procedureStep')
  })
})

describe('Tool and package contracts', () => {
  it('normalizes legacy tool modes for package boundaries', () => {
    expect(normalizeToolMode('mock')).toBe('static_fixture')
    expect(normalizeToolMode('static')).toBe('static_fixture')
    expect(normalizeToolMode('engine_managed')).toBe('system_managed')
    expect(templateToolSchema.parse({
      name: 'get_latest_deposit',
      description: 'Read the latest deposit',
      mode: 'static_fixture',
    }).mode).toBe('static_fixture')
  })

  it('parses a complete .intera-agent.json v1 package with current top-level names', () => {
    const parsed = interaAgentTemplateV1Schema.parse({
      schemaVersion: 'intera.agentTemplate.v1',
      metadata: {
        name: 'Gaming Support Starter',
        industry: 'gaming',
        marketplace: { category: 'customer-support' },
      },
      agent: { name: 'Gaming Support' },
      caseTypes: [{
        type: 'deposit_issue',
        displayName: 'Deposit not credited',
        procedure: {
          steps: [
            { id: 'ask_member_id', action: 'ask', target: 'member_id', required: true },
            { id: 'lookup_deposit', action: 'use', target: 'get_latest_deposit' },
          ],
        },
      }],
      tools: [{
        name: 'get_latest_deposit',
        description: 'Read latest deposit state',
        mode: 'static_fixture',
        staticFixture: { status: 'pending' },
      }],
      hooks: [{
        name: 'investigate_before_resolve',
        checkpoint: 'Stop',
        handlerKind: 'declarative',
        handler: {
          kind: 'declarative',
          check: { kind: 'rule', requireToolsAny: ['get_latest_deposit'] },
          effect: { decision: 'block' },
        },
      }],
      procedures: [{
        procedureId: 'deposit_issue',
        displayName: 'Deposit not credited',
        caseTypeType: 'deposit_issue',
        procedure: {
          steps: [
            { id: 'ask_member_id', action: 'ask', target: 'member_id', required: true },
            { id: 'lookup_deposit', action: 'use', target: 'get_latest_deposit' },
          ],
        },
      }],
      hookBindings: [{
        hookName: 'investigate_before_resolve',
        scopeType: 'caseType',
        scopeKey: 'caseType:ct_123',
        caseTypeName: 'deposit_issue',
      }],
      scenarios: [{
        name: 'deposit_pending_handoff',
        turns: [{ role: 'user', content: 'My deposit is missing' }],
        expected: {
          caseType: 'deposit_issue',
          toolsCalled: ['get_latest_deposit'],
          hooks: [{ hookName: 'investigate_before_resolve', decision: 'allow' }],
        },
      }],
      scenarioDefinitions: [{
        name: 'deposit_runtime_reference',
        turns: [{ role: 'user', content: 'Check my latest deposit' }],
        expected: {
          caseType: 'deposit_issue',
          toolsCalled: ['get_latest_deposit'],
        },
      }],
      knowledgeRefs: [{
        sourceId: 'ks_123',
        name: 'Deposit FAQ',
        provider: 'gptbots',
        groupRefs: ['group_deposit'],
        retrieval: { topK: 5 },
      }],
      integrationRefs: [{
        channel: 'livechat',
        provider: 'livechat',
        name: 'LiveChat production',
        requiredCapabilities: ['transfer:transfer_chat'],
        requiredSecrets: ['livechat_bot_access_token'],
      }],
      requiredSecrets: [{
        name: 'livechat_bot_access_token',
        required: true,
        exampleRef: 'integrationRefs.livechat',
      }],
      systemToolPolicy: {
        runtimeManaged: true,
        importMode: 'ignore',
        runtimeManagedTools: [{ name: 'start_procedure', runtimeManaged: true }],
      },
      validationEvidence: {
        source: 'historical_reference',
        runtimeValidated: true,
        scenarioCount: 1,
        receiptCount: 1,
        latestReceipts: [{
          scenarioName: 'deposit_pending_handoff',
          runId: 'scn_1',
          status: 'pass',
          executionMode: 'agentRuntime',
        }],
      },
      legacy: {
        policies: [{ name: 'old_policy' }],
        guardrails: [{ name: 'old_guardrail' }],
        skills: [{ name: 'old_skill' }],
      },
    })

    expect(parsed.schemaVersion).toBe('intera.agentTemplate.v1')
    expect(parsed.hooks[0].checkpoint).toBe('Stop')
    expect(parsed.hookBindings[0].scopeType).toBe('caseType')
    expect(parsed.scenarioDefinitions[0].name).toBe('deposit_runtime_reference')
    expect(parsed.knowledgeRefs[0].provider).toBe('gptbots')
    expect(parsed.integrationRefs[0].requiredSecrets).toEqual(['livechat_bot_access_token'])
    expect(parsed.systemToolPolicy.importMode).toBe('ignore')
  })

  it('rejects old vocabulary as top-level package fields', () => {
    expect(() => interaAgentTemplateV1Schema.parse({
      schemaVersion: 'intera.agentTemplate.v1',
      metadata: { name: 'Bad package' },
      agent: {},
      skills: [],
    })).toThrow()
  })

  it('rejects unsupported package versions', () => {
    expect(() => interaAgentTemplateV1Schema.parse({
      schemaVersion: 'intera.agentTemplate.v0',
      metadata: { name: 'Old package' },
      agent: {},
    })).toThrow()
  })
})

describe('Scenario contract', () => {
  it('validates multi-turn expectations and receipt evidence', () => {
    const scenario = templateScenarioSchema.parse({
      name: 'deposit_pending_handoff',
      turns: [
        { role: 'user', content: 'My deposit is missing' },
        { role: 'assistant', content: 'I will transfer this case.' },
      ],
      expected: {
        caseType: 'deposit_issue',
        toolCalls: [{ name: 'get_latest_deposit', minCalls: 1, maxCalls: 1 }],
        hooks: [{ hookName: 'investigate_before_resolve', checkpoint: 'Stop', decision: 'allow' }],
        humanTransfer: true,
        forbiddenPhrases: ['guaranteed compensation'],
        finalStatus: 'waiting_human',
      },
    })
    expect(scenario.turns).toHaveLength(2)
    expect(scenario.expected.toolCalls?.[0].name).toBe('get_latest_deposit')

    const evidence = scenarioObservedEvidenceSchema.parse({
      toolsCalled: ['get_latest_deposit'],
      hookDecisions: [{ hookName: 'investigate_before_resolve', checkpoint: 'Stop', decision: 'allow' }],
      knowledgeHits: [{ source: 'gptbots', title: 'Deposit FAQ' }],
      humanTransfer: true,
      handoff: [{ required: true, reason: 'unclear provider evidence' }],
      finalResponse: 'I will transfer this case.',
      finalStatus: 'waiting_human',
    })
    expect(evidence.handoff[0].required).toBe(true)

    const receipt = scenarioReceiptSchema.parse({
      scenarioName: 'deposit_pending_handoff',
      runId: 'scn_1',
      status: 'pass',
      executionMode: 'agentRuntime',
      toolExecutionMode: 'mocked',
      startedAt: '2026-06-08T00:00:00.000Z',
      completedAt: '2026-06-08T00:00:01.000Z',
      finishedAt: '2026-06-08T00:00:01.000Z',
      evidence,
      checks: [{ name: 'tool:get_latest_deposit', passed: true }],
    })
    const legacyReceipt = scenarioReceiptSchema.parse({
      scenarioName: 'deposit_pending_handoff',
      runId: 'scn_legacy',
      status: 'passed',
      startedAt: '2026-06-08T00:00:00.000Z',
      evidence,
    })
    expect(receipt.evidence.knowledgeHits[0]).toMatchObject({ source: 'gptbots' })
    expect(receipt.checks[0].passed).toBe(true)
    expect(legacyReceipt.status).toBe('pass')
    expect(legacyReceipt.executionMode).toBe('fixture')
  })
})

describe('Hook backfill migration shape', () => {
  it('creates hooks and hook bindings from legacy policy and case-type activation data', () => {
    const migration = readFileSync(
      join(process.cwd(), 'packages/shared/prisma/migrations/20260608000002_add_hooks_and_hook_bindings/migration.sql'),
      'utf8',
    )

    expect(migration).toContain('CREATE TABLE "hooks"')
    expect(migration).toContain('CREATE TABLE "hook_bindings"')
    expect(migration).toContain('INSERT INTO "hooks"')
    expect(migration).toContain("'legacy', jsonb_build_object")
    expect(migration).toContain('intera_legacy_jsonb_array_text(ct."guardrails")')
    expect(migration).toContain("'caseType:' || ct.\"id\"")
  })
})
