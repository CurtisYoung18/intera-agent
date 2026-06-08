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
      legacy: {
        policies: [{ name: 'old_policy' }],
        guardrails: [{ name: 'old_guardrail' }],
        skills: [{ name: 'old_skill' }],
      },
    })

    expect(parsed.schemaVersion).toBe('intera.agentTemplate.v1')
    expect(parsed.hooks[0].checkpoint).toBe('Stop')
    expect(parsed.hookBindings[0].scopeType).toBe('caseType')
  })

  it('rejects old vocabulary as top-level package fields', () => {
    expect(() => interaAgentTemplateV1Schema.parse({
      schemaVersion: 'intera.agentTemplate.v1',
      metadata: { name: 'Bad package' },
      agent: {},
      skills: [],
    })).toThrow()
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
