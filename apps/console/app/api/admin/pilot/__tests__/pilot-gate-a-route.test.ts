import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const h = vi.hoisted(() => {
  let idSeq = 0
  const id = (prefix: string) => `${prefix}_${++idSeq}`
  const mockGetSession = vi.fn()
  const agentConfigs: Record<string, any> = {
    agent_1: {
      id: 'agent_1',
      orgId: 'default',
      name: 'Gaming Support',
      version: 2,
      parentId: 'agent_live',
      isActive: false,
      model: 'deepseek-v4-flash',
      temperature: 0.5,
      thinkingBudget: 4096,
      maxIterations: 20,
      coreSystemPrompt: 'Current prompt',
      extendedThinking: false,
      maxOutputTokens: 4096,
      resumePrompt: null,
      memoryStrategy: '{}',
      updatedAt: new Date('2026-06-10T00:00:00.000Z'),
      createdAt: new Date('2026-06-09T00:00:00.000Z'),
    },
    agent_live: {
      id: 'agent_live',
      orgId: 'default',
      name: 'Gaming Support',
      version: 1,
      parentId: null,
      isActive: true,
      model: 'deepseek-v4-flash',
      temperature: 0.5,
      thinkingBudget: 4096,
      maxIterations: 20,
      coreSystemPrompt: 'Live prompt',
      extendedThinking: false,
      maxOutputTokens: 4096,
      resumePrompt: null,
      memoryStrategy: '{}',
      updatedAt: new Date('2026-06-08T00:00:00.000Z'),
      createdAt: new Date('2026-06-08T00:00:00.000Z'),
    },
  }
  const users = [{ id: 'user-1' }]
  const memberships = [{ userId: 'user-1', orgId: 'default', role: 'admin' }]
  const scenarioValidationSummary = {
    value: {
      state: 'Changed since last validation',
      runtimeValidated: false,
      overrideRequired: true,
    } as any,
  }
  const scenarioReceipts = [] as any[]
  const tables = {
    pilotSessions: [] as any[],
    pilotMessages: [] as any[],
    pilotProposals: [] as any[],
    pilotTodoPlans: [] as any[],
    pilotTodoItems: [] as any[],
    pilotHandoffs: [] as any[],
    agentBuildBriefs: [] as any[],
    templateRecommendations: [] as any[],
    templateTailoringPlans: [] as any[],
    scratchBuildPlans: [] as any[],
    pilotInspectionTraces: [] as any[],
    auditLogs: [] as any[],
    caseTypes: [] as any[],
    tools: [] as any[],
    hooks: [] as any[],
    hookBindings: [] as any[],
    knowledgeSources: [] as any[],
    channelBindings: [] as any[],
  }

  const matches = (row: any, where: any): boolean => {
    if (!where) return true
    return Object.entries(where).every(([key, value]) => {
      if (value && typeof value === 'object' && !Array.isArray(value) && 'in' in value) {
        return (value as any).in.includes(row[key])
      }
      return row[key] === value
    })
  }
  const selectRow = (row: any, select?: Record<string, boolean>) => {
    if (!row || !select) return row
    return Object.fromEntries(Object.keys(select).map((key) => [key, row[key]]))
  }
  const orderRows = (rows: any[], orderBy: any) => {
    if (!orderBy) return rows
    const spec = Array.isArray(orderBy) ? orderBy[0] : orderBy
    const [key, dir] = Object.entries(spec)[0] as [string, string]
    return rows.slice().sort((a, b) => {
      const left = String(a[key] ?? '')
      const right = String(b[key] ?? '')
      return dir === 'desc' ? right.localeCompare(left) : left.localeCompare(right)
    })
  }
  const delegate = (rows: any[], prefix: string) => ({
    findFirst: vi.fn(async (args: any = {}) => selectRow(orderRows(rows.filter((row) => matches(row, args.where)), args.orderBy)[0] ?? null, args.select)),
    findMany: vi.fn(async (args: any = {}) => {
      let result = orderRows(rows.filter((row) => matches(row, args.where)), args.orderBy)
      if (args.take) result = result.slice(0, args.take)
      if (args.include?.items) {
        result = result.map((row) => ({
          ...row,
          items: orderRows(tables.pilotTodoItems.filter((item) => item.planId === row.id), args.include.items.orderBy),
        }))
      }
      return result.map((row) => selectRow(row, args.select))
    }),
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
    agentConfigs,
    users,
    memberships,
    tables,
    scenarioValidationSummary,
    scenarioReceipts,
    delegate,
    matches,
    selectRow,
  }
})

vi.mock('@/lib/auth', () => ({ getSession: h.mockGetSession }))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('@/lib/scenarios/store', () => ({
  listScenarios: vi.fn(async () => ({
    scenarios: [],
    validationState: 'Not validated',
    receipts: h.scenarioReceipts,
    runtimeValidated: false,
    overrideRequired: true,
  })),
  markScenarioValidationChanged: vi.fn(async () => undefined),
  getScenarioValidationSummary: vi.fn(async () => h.scenarioValidationSummary.value),
  getScenario: vi.fn(async (agentConfigId: string, name: string) => ({
    id: 'scenario-1',
    agentConfigId,
    name,
    displayName: 'Provider conflict escalation',
    tags: ['pilot'],
    enabled: true,
    createdAt: '2026-06-10T00:00:00.000Z',
    updatedAt: '2026-06-10T00:00:00.000Z',
    turns: [{ role: 'user', content: 'My deposit status conflicts with provider proof.' }],
    expected: {
      toolsCalled: ['get_latest_deposit'],
      hooks: [{ hookName: 'provider_conflict_requires_human', checkpoint: 'PostToolUse', decision: 'escalate' }],
      humanTransfer: true,
      finalStatus: 'waiting_human',
    },
  })),
  appendScenarioReceipt: vi.fn(async (_agentConfigId: string, receipt: any) => {
    h.scenarioValidationSummary.value = receipt.status === 'pass' && receipt.executionMode === 'agentRuntime'
      ? {
          state: 'Validated',
          lastReceiptId: receipt.runId,
          lastReceiptStatus: receipt.status,
          lastReceiptExecutionMode: receipt.executionMode,
          runtimeValidated: true,
          lastRuntimeReceiptId: receipt.runId,
          overrideRequired: false,
        }
      : {
          state: receipt.status === 'pass' ? 'Changed since last validation' : 'Validation failed',
          lastReceiptId: receipt.runId,
          lastReceiptStatus: receipt.status,
          lastReceiptExecutionMode: receipt.executionMode,
          runtimeValidated: false,
          overrideRequired: true,
        }
    return receipt
  }),
  saveScenario: vi.fn(),
  updateScenario: vi.fn(),
}))
vi.mock('@/lib/scenarios/runtime-runner', async () => {
  const runner = await vi.importActual<typeof import('@/lib/scenarios/runner')>('@/lib/scenarios/runner')
  return {
    runScenarioAgentRuntime: vi.fn(async (scenario: any) => runner.buildScenarioReceipt(scenario, {
      toolsCalled: ['get_latest_deposit'],
      toolCalls: [{ name: 'get_latest_deposit', executionMode: 'mocked' }],
      toolResults: [{ name: 'get_latest_deposit', output: { _dryRun: true }, executionMode: 'mocked' }],
      hookDecisions: [{ hookName: 'provider_conflict_requires_human', checkpoint: 'PostToolUse', decision: 'escalate' }],
      humanTransfer: true,
      handoff: [{ required: true, target: 'human' }],
      finalStatus: 'waiting_human',
      finalResponse: 'I will transfer this case to a human specialist.',
    }, {
      executionMode: 'agentRuntime',
      toolExecutionMode: 'mocked',
      traceId: 'trace-runtime-1',
    })),
  }
})
vi.mock('@/lib/config-pilot/model', () => ({
  proposeConfigPilotChange: vi.fn(async (_input: any, context: any) => ({
    proposal: {
      id: 'model-proposal-id',
      baseDraftFingerprint: context.draftFingerprint,
      targetSurface: 'brain',
      title: 'Tighten prompt',
      summary: 'Updates the prompt.',
      patches: [{ surface: 'brain', operation: 'update', fields: { temperature: 0.25 } }],
      diffGroups: [],
      receiptSuggestions: [],
      runSuggestions: [],
      safetyNotes: [],
    },
    modelUsed: 'pilot-test-model',
    promptVersion: 'pilot-test-prompt',
  })),
}))
vi.mock('@/lib/db/repo-for-org', () => ({
  repoForOrg(orgId: string) {
    const scopedAgentConfig = {
      findUnique: vi.fn(async (args: any) => {
        const row = h.agentConfigs[args.where.id]
        if (!row || row.orgId !== orgId) return null
        return h.selectRow(row, args.select)
      }),
      findFirst: vi.fn(async (args: any) => {
        const rows = Object.values(h.agentConfigs).filter((row: any) => row.orgId === orgId && h.matches(row, args.where))
        return h.selectRow(rows[0] ?? null, args.select)
      }),
    }
    return {
      orgId,
      agentConfig: scopedAgentConfig,
      raw: {
        agentConfig: {
          findUnique: vi.fn(async (args: any) => h.selectRow(h.agentConfigs[args.where.id] ?? null, args.select)),
          update: vi.fn(async (args: any) => {
            const row = h.agentConfigs[args.where.id]
            Object.assign(row, args.data, { updatedAt: new Date() })
            return row
          }),
        },
        caseType: h.delegate(h.tables.caseTypes, 'case_type'),
        tool: h.delegate(h.tables.tools, 'tool'),
        hook: h.delegate(h.tables.hooks, 'hook'),
        hookBinding: h.delegate(h.tables.hookBindings, 'hook_binding'),
        knowledgeSource: h.delegate(h.tables.knowledgeSources, 'knowledge_source'),
        channelBinding: h.delegate(h.tables.channelBindings, 'channel_binding'),
        pilotSession: h.delegate(h.tables.pilotSessions, 'pilot_session'),
        pilotMessage: h.delegate(h.tables.pilotMessages, 'pilot_message'),
        pilotProposal: h.delegate(h.tables.pilotProposals, 'pilot_proposal'),
        pilotTodoPlan: h.delegate(h.tables.pilotTodoPlans, 'pilot_todo_plan'),
        pilotTodoItem: h.delegate(h.tables.pilotTodoItems, 'pilot_todo_item'),
        pilotHandoff: h.delegate(h.tables.pilotHandoffs, 'pilot_handoff'),
        agentBuildBrief: h.delegate(h.tables.agentBuildBriefs, 'agent_build_brief'),
        templateRecommendation: h.delegate(h.tables.templateRecommendations, 'template_recommendation'),
        templateTailoringPlan: h.delegate(h.tables.templateTailoringPlans, 'template_tailoring_plan'),
        scratchBuildPlan: h.delegate(h.tables.scratchBuildPlans, 'scratch_build_plan'),
        pilotInspectionTrace: h.delegate(h.tables.pilotInspectionTraces, 'pilot_inspection_trace'),
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
    }
  },
}))

import { POST as CurrentSession } from '@/app/api/admin/pilot/sessions/current/route'
import { POST as ConfigPilotPropose } from '@/app/api/admin/config-pilot/propose/route'
import { POST as AcceptProposal } from '@/app/api/admin/pilot/proposals/[proposalId]/accept/route'
import { POST as ApplyProposal } from '@/app/api/admin/pilot/proposals/[proposalId]/apply/route'
import { POST as GenerateHandoff } from '@/app/api/admin/pilot/handoffs/route'
import { POST as TakeoverSession } from '@/app/api/admin/pilot/sessions/takeover/route'
import { POST as ArchiveSession } from '@/app/api/admin/pilot/sessions/archive/route'
import { POST as ManualCompactSession } from '@/app/api/admin/pilot/sessions/manual-compact/route'
import { POST as UpsertBuildBrief } from '@/app/api/admin/pilot/build-briefs/route'
import { POST as ConfirmBuildBrief } from '@/app/api/admin/pilot/build-briefs/confirm/route'
import { POST as CreateTemplateRecommendation } from '@/app/api/admin/pilot/template-recommendations/route'
import { POST as CreateTemplateTailoringPlan } from '@/app/api/admin/pilot/template-tailoring-plans/route'
import { POST as CreateScratchBuildPlan } from '@/app/api/admin/pilot/scratch-build-plans/route'
import { POST as PromoteTodoPlan } from '@/app/api/admin/pilot/todo-plans/promote/route'
import { POST as RecordInspectionTrace } from '@/app/api/admin/pilot/inspection-traces/route'
import { POST as RunPilotScenario } from '@/app/api/admin/pilot/validation/run-scenario/route'
import { POST as ProposeReceiptFix } from '@/app/api/admin/pilot/validation/propose-fix/route'
import { POST as GenerateReleaseHandoff } from '@/app/api/admin/pilot/release-handoffs/generate/route'

function postRequest(body: unknown) {
  return {
    method: 'POST',
    json: async () => body,
    nextUrl: new URL('http://localhost/api/admin/pilot/test'),
  } as any
}

function params(proposalId: string) {
  return { params: Promise.resolve({ proposalId }) }
}

const proposalPayload = {
  id: 'proposal-model-id',
  targetSurface: 'brain',
  title: 'Tighten prompt',
  summary: 'Updates the prompt.',
  patches: [{ surface: 'brain', operation: 'update', fields: { temperature: 0.25 } }],
  diffGroups: [],
  receiptSuggestions: [],
  runSuggestions: [],
  safetyNotes: [],
}

async function createStoredProposal(baseDraftFingerprint: string) {
  const session = h.tables.pilotSessions[0]
  const proposal = {
    id: 'pilot_proposal_seed',
    orgId: 'default',
    sessionId: session.id,
    status: 'drafted',
    primarySurface: 'brain',
    title: proposalPayload.title,
    summary: proposalPayload.summary,
    validationPlan: {
      requiredScenarios: [],
      recommendedScenarios: [],
      manualPlaygroundChecks: [],
      releaseBlockingCondition: 'Runtime-backed receipt must pass.',
    },
    proposal: proposalPayload,
    diffGroups: [],
    patchCount: 1,
    baseAgentConfigId: 'agent_1',
    baseDraftFingerprint,
    createdByUserId: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  h.tables.pilotProposals.push(proposal)
  return proposal
}

beforeEach(() => {
  h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'admin', userId: 'user-1' })
  h.agentConfigs.agent_1.temperature = 0.5
  h.agentConfigs.agent_1.updatedAt = new Date('2026-06-10T00:00:00.000Z')
  h.scenarioValidationSummary.value = {
    state: 'Changed since last validation',
    runtimeValidated: false,
    overrideRequired: true,
  }
  h.scenarioReceipts.length = 0
  for (const table of Object.values(h.tables)) table.length = 0
})

describe('Pilot Gate A APIs', () => {
  it('declares explicit Gate A planning artifacts and current-row uniqueness in the migration', () => {
    const migration = readFileSync('packages/shared/prisma/migrations/20260610000000_add_pilot_persistence/migration.sql', 'utf8')

    expect(migration).toContain('CREATE TABLE "agent_build_briefs"')
    expect(migration).toContain('CREATE TABLE "template_recommendations"')
    expect(migration).toContain('CREATE TABLE "template_tailoring_plans"')
    expect(migration).toContain('CREATE TABLE "scratch_build_plans"')
    expect(migration).toContain('CREATE TABLE "pilot_inspection_traces"')
    expect(migration).toContain('CREATE UNIQUE INDEX "agent_build_briefs_current_family_unique"')
    expect(migration).toContain('CREATE UNIQUE INDEX "template_recommendations_current_brief_unique"')
    expect(migration).toContain('CREATE UNIQUE INDEX "template_tailoring_plans_current_template_path_unique"')
    expect(migration).toContain('CREATE UNIQUE INDEX "scratch_build_plans_current_scratch_path_unique"')
    expect(migration).toContain('CREATE UNIQUE INDEX "pilot_todo_plans_current_session_unique"')
    expect(migration).toContain('CREATE UNIQUE INDEX "pilot_handoffs_current_session_unique"')
  })

  it('creates and resumes one durable current session for a draft Agent', async () => {
    const first = await CurrentSession(postRequest({ agentConfigId: 'agent_1' }))
    const firstBody = await first.json()
    const second = await CurrentSession(postRequest({ agentConfigId: 'agent_1' }))
    const secondBody = await second.json()

    expect(firstBody.ok).toBe(true)
    expect(firstBody.data.session.id).toBe(secondBody.data.session.id)
    expect(firstBody.data.permissions).toMatchObject({ canRead: true, canApply: true, canPublish: false })
    expect(firstBody.data.draftFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(h.tables.pilotSessions).toHaveLength(1)
    expect(h.tables.pilotMessages.some((message) => message.kind === 'message')).toBe(true)
  })

  it('creates and resumes one durable pre-build family session', async () => {
    const first = await CurrentSession(postRequest({
      bindingScope: 'pre_build_family',
      agentFamilyKey: 'Gaming Support',
      currentMode: 'build_from_brief',
    }))
    const firstBody = await first.json()
    const second = await CurrentSession(postRequest({
      bindingScope: 'pre_build_family',
      agentFamilyKey: 'Gaming Support',
    }))
    const secondBody = await second.json()

    expect(firstBody.ok).toBe(true)
    expect(firstBody.data.session.bindingScope).toBe('pre_build_family')
    expect(firstBody.data.session.currentMode).toBe('build_from_brief')
    expect(firstBody.data.session.id).toBe(secondBody.data.session.id)
    expect(firstBody.data.draftFingerprint).toContain('pre_build_family:Gaming Support')
    expect(h.tables.pilotSessions).toHaveLength(1)
  })

  it('persists ConfigPilot proposals into the current Pilot session', async () => {
    const proposed = await ConfigPilotPropose(postRequest({
      agentConfigId: 'agent_1',
      request: 'Tighten the prompt.',
    }))
    const proposedBody = await proposed.json()

    expect(proposedBody.ok).toBe(true)
    expect(proposedBody.data.proposal.pilotProposalId).toBeTruthy()
    expect(proposedBody.data.proposal.baseDraftFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(h.tables.pilotSessions).toHaveLength(1)
    expect(h.tables.pilotProposals).toHaveLength(1)
    expect(h.tables.pilotProposals[0].proposal.title).toBe('Tighten prompt')
    expect(h.tables.pilotMessages.some((message) => message.kind === 'proposal')).toBe(true)
  })

  it('blocks operator mutation while preserving read access', async () => {
    const current = await CurrentSession(postRequest({ agentConfigId: 'agent_1' }))
    const body = await current.json()
    await createStoredProposal(body.data.draftFingerprint)
    h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'operator', userId: 'operator-1' })

    const denied = await AcceptProposal(postRequest({}), params('pilot_proposal_seed') as any)
    const deniedBody = await denied.json()

    expect(denied.status).toBe(403)
    expect(deniedBody.error.code).toBe('forbidden')
  })

  it('accepts then applies a stored proposal only when the draft fingerprint still matches', async () => {
    const current = await CurrentSession(postRequest({ agentConfigId: 'agent_1' }))
    const body = await current.json()
    await createStoredProposal(body.data.draftFingerprint)

    const accepted = await AcceptProposal(postRequest({ reason: 'Reviewed diff.' }), params('pilot_proposal_seed') as any)
    expect((await accepted.json()).data.proposal.status).toBe('accepted')

    const applied = await ApplyProposal(postRequest({}), params('pilot_proposal_seed') as any)
    const appliedBody = await applied.json()

    expect(appliedBody.ok).toBe(true)
    expect(appliedBody.data.proposal.status).toBe('applied')
    expect(appliedBody.data.apply.validation.state).toBe('Changed since last validation')
    expect(h.agentConfigs.agent_1.temperature).toBe(0.25)
    expect(h.tables.auditLogs.some((entry) => entry.action === 'pilot.proposal.apply')).toBe(true)
  })

  it('marks stale proposals when the draft changed after proposal creation', async () => {
    const current = await CurrentSession(postRequest({ agentConfigId: 'agent_1' }))
    const body = await current.json()
    await createStoredProposal(body.data.draftFingerprint)
    await AcceptProposal(postRequest({}), params('pilot_proposal_seed') as any)
    h.agentConfigs.agent_1.temperature = 0.7

    const stale = await ApplyProposal(postRequest({}), params('pilot_proposal_seed') as any)
    const staleBody = await stale.json()

    expect(stale.status).toBe(409)
    expect(staleBody.error.code).toBe('conflict')
    expect(h.tables.pilotProposals[0].status).toBe('stale')
  })

  it('creates a durable handoff snapshot and blocks ready verdicts with required active todo items', async () => {
    const current = await CurrentSession(postRequest({ agentConfigId: 'agent_1' }))
    const body = await current.json()
    h.tables.pilotTodoPlans.push({
      id: 'plan-1',
      orgId: 'default',
      sessionId: body.data.session.id,
      title: 'Gate plan',
      isCurrent: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    h.tables.pilotTodoItems.push({
      id: 'todo-1',
      orgId: 'default',
      sessionId: body.data.session.id,
      planId: 'plan-1',
      type: 'validation_run',
      status: 'active',
      title: 'Run runtime receipt',
      isRequired: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const handoff = await GenerateHandoff(postRequest({
      sessionId: body.data.session.id,
      draftAgentConfigId: 'agent_1',
      handoffSummary: 'Ready after validation.',
      readinessVerdict: 'ready_for_release_review',
      blockers: [],
      risks: [],
      referencedProposalIds: [],
      referencedReceiptIds: [],
      coveredTodoItemIds: [],
    }))
    const handoffBody = await handoff.json()

    expect(handoffBody.ok).toBe(true)
    expect(handoffBody.data.handoff.readinessVerdict).toBe('not_ready')
    expect(handoffBody.data.handoff.blockers[0].code).toBe('required_todo_incomplete')
  })

  it('runs the Gate B brief, recommendation, tailoring, scratch, promote, and trace lifecycle', async () => {
    const current = await CurrentSession(postRequest({
      bindingScope: 'pre_build_family',
      agentFamilyKey: 'Gaming Support',
      currentMode: 'build_from_brief',
    }))
    const currentBody = await current.json()

    const briefResponse = await UpsertBuildBrief(postRequest({
      sessionId: currentBody.data.session.id,
      agentFamilyKey: 'Gaming Support',
      businessGoal: 'Support deposit and withdrawal escalations.',
      targetChannels: ['web-chat'],
      supportedUseCases: ['deposit_status', 'withdrawal_delay'],
      outOfScopeUseCases: ['bonus_abuse'],
      escalationPolicy: 'Escalate provider conflicts to human support.',
      requiredToolsAndIntegrations: ['order_status'],
      toneAndResponseConstraints: ['brief', 'evidence-first'],
      validationExpectations: ['runtime scenario receipt required'],
      openQuestions: [],
    }))
    const briefBody = await briefResponse.json()
    expect(briefBody.data.brief.revision).toBe(1)
    expect(briefBody.data.brief.status).toBe('draft')
    expect(h.tables.pilotSessions[0].currentBuildBriefId).toBe(briefBody.data.brief.id)

    const confirmed = await ConfirmBuildBrief(postRequest({ briefId: briefBody.data.brief.id }))
    const confirmedBody = await confirmed.json()
    expect(confirmedBody.data.brief.status).toBe('confirmed')

    const recommendation = await CreateTemplateRecommendation(postRequest({
      briefId: briefBody.data.brief.id,
      candidateTemplates: [{ templateId: 'template-j1b', label: 'J1B Casino Support' }],
      recommendedTemplateId: 'template-j1b',
      fitSummary: 'Best fit for evidence-led gaming support.',
      mismatchSummary: 'Needs provider conflict tailoring.',
      whyNotScratch: 'Existing template covers most required flows.',
    }))
    const recommendationBody = await recommendation.json()
    expect(recommendationBody.data.recommendation.recommendedTemplateId).toBe('template-j1b')

    const tailoring = await CreateTemplateTailoringPlan(postRequest({
      briefId: briefBody.data.brief.id,
      recommendationId: recommendationBody.data.recommendation.id,
      selectedTemplateId: 'template-j1b',
      fitAreas: ['channel style'],
      mismatchAreas: ['provider conflict escalation'],
      requiredTailoringGroups: [{
        groupKey: 'provider-conflict',
        title: 'Escalate provider conflicts',
        description: 'Create Hook and Scenario coverage.',
        targetSurface: 'hooks',
        expectedEffect: 'Conflicting evidence reaches human support.',
        firstValidationTargets: ['provider_conflict_escalation'],
      }],
      recommendedTailoringGroups: [{
        groupKey: 'bonus-followup',
        title: 'Bonus follow-up guardrail',
        targetSurface: 'procedures',
        expectedEffect: 'Reduce unsupported bonus claims.',
        firstValidationTargets: ['bonus_guardrail'],
      }],
      firstValidationTargets: ['provider_conflict_escalation'],
    }))
    const tailoringBody = await tailoring.json()
    expect(tailoringBody.data.plan.requiredTailoringGroups).toHaveLength(1)

    const scratch = await CreateScratchBuildPlan(postRequest({
      briefId: briefBody.data.brief.id,
      scratchScope: 'fallback',
      proposedFoundationSurfaces: ['brain', 'procedures'],
      requiredBuildGroups: [{
        groupKey: 'scratch-core',
        title: 'Create core Procedure',
        targetSurface: 'procedures',
      }],
      recommendedBuildGroups: [{
        groupKey: 'scratch-hook',
        title: 'Add provider Hook',
        targetSurface: 'hooks',
      }],
      initialToolingPlan: ['order_status'],
      initialValidationTargets: ['scratch_core_validation'],
    }))
    const scratchBody = await scratch.json()
    expect(scratchBody.data.plan.scratchScope).toBe('fallback')

    const promoted = await PromoteTodoPlan(postRequest({
      sessionId: currentBody.data.session.id,
      sourceType: 'template_tailoring_plan',
      sourceId: tailoringBody.data.plan.id,
      groupKeys: ['bonus-followup'],
    }))
    const promotedBody = await promoted.json()
    expect(promotedBody.data.plan.items).toHaveLength(2)
    expect(promotedBody.data.plan.items[0]).toMatchObject({ status: 'active', isRequired: true })
    expect(promotedBody.data.plan.items[1]).toMatchObject({ status: 'pending', isRequired: false })
    expect(h.tables.pilotSessions[0].currentTodoPlanId).toBe(promotedBody.data.plan.id)

    const trace = await RecordInspectionTrace(postRequest({
      sessionId: currentBody.data.session.id,
      actionClass: 'proposal',
      targetObjectRef: { type: 'template_tailoring_plan', id: tailoringBody.data.plan.id, label: 'J1B tailoring' },
      steps: [{
        toolFamily: 'inspect_config_surface',
        target: 'hooks',
        visibility: 'metadata_only',
        summary: 'Hook surface needs provider-conflict tailoring.',
        evidenceSufficientAfterStep: true,
      }],
      evidenceSufficient: true,
      stopReason: 'Target surface and validation need are known.',
    }))
    const traceBody = await trace.json()
    expect(traceBody.data.trace.evidenceSufficient).toBe(true)
    expect(h.tables.pilotInspectionTraces).toHaveLength(1)
  })

  it('runs a named Scenario through the durable Pilot validation loop', async () => {
    const current = await CurrentSession(postRequest({ agentConfigId: 'agent_1' }))
    const body = await current.json()
    h.tables.pilotTodoPlans.push({
      id: 'plan-1',
      orgId: 'default',
      sessionId: body.data.session.id,
      title: 'Validation plan',
      isCurrent: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    h.tables.pilotTodoItems.push({
      id: 'todo-validation',
      orgId: 'default',
      sessionId: body.data.session.id,
      planId: 'plan-1',
      type: 'validation_run',
      status: 'active',
      title: 'Run provider conflict runtime receipt',
      isRequired: true,
      targetScenarioName: 'provider_conflict_escalation',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const run = await RunPilotScenario(postRequest({
      sessionId: body.data.session.id,
      agentConfigId: 'agent_1',
      scenarioName: 'provider_conflict_escalation',
      executionMode: 'agentRuntime',
      todoItemId: 'todo-validation',
    }))
    const runBody = await run.json()

    expect(runBody.ok).toBe(true)
    expect(runBody.data.receipt.executionMode).toBe('agentRuntime')
    expect(runBody.data.validation.runtimeValidated).toBe(true)
    expect(runBody.data.triage.releaseReadinessEffect).toBe('restores_runtime_validation')
    expect(runBody.data.todoItem.status).toBe('completed')
    expect(h.tables.pilotSessions[0]).toMatchObject({
      latestReceiptRunId: runBody.data.receipt.runId,
      currentMode: 'validation_triage',
    })
    expect(h.tables.pilotTodoItems[0].latestReceiptRunId).toBe(runBody.data.receipt.runId)
    expect(h.tables.pilotMessages.some((message) => message.kind === 'receipt' && message.structuredPayload.receiptRunId === runBody.data.receipt.runId)).toBe(true)
    expect(h.tables.pilotInspectionTraces.some((trace) => trace.actionClass === 'validation_summary' && trace.targetObjectRef.id === runBody.data.receipt.runId)).toBe(true)
    expect(h.tables.auditLogs.some((entry) => entry.action === 'pilot.validation.run_scenario')).toBe(true)
  })

  it('records fixture-only Scenario receipts without completing validation todos', async () => {
    const current = await CurrentSession(postRequest({ agentConfigId: 'agent_1' }))
    const body = await current.json()
    h.tables.pilotTodoItems.push({
      id: 'todo-fixture',
      orgId: 'default',
      sessionId: body.data.session.id,
      planId: 'plan-1',
      type: 'validation_run',
      status: 'active',
      title: 'Run fixture receipt',
      isRequired: true,
      targetScenarioName: 'provider_conflict_escalation',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const run = await RunPilotScenario(postRequest({
      sessionId: body.data.session.id,
      agentConfigId: 'agent_1',
      scenarioName: 'provider_conflict_escalation',
      executionMode: 'fixture',
    }))
    const runBody = await run.json()

    expect(runBody.ok).toBe(true)
    expect(runBody.data.receipt.executionMode).toBe('fixture')
    expect(runBody.data.validation.runtimeValidated).toBe(false)
    expect(runBody.data.triage.releaseReadinessEffect).toBe('debug_only_fixture')
    expect(runBody.data.todoItem.status).toBe('active')
    expect(h.tables.pilotSessions[0].latestReceiptRunId).toBe(runBody.data.receipt.runId)
    expect(h.tables.pilotTodoItems[0].latestReceiptRunId).toBe(runBody.data.receipt.runId)
  })

  it('drafts a receipt-linked follow-up proposal from a failed Scenario run', async () => {
    const current = await CurrentSession(postRequest({ agentConfigId: 'agent_1' }))
    const body = await current.json()
    h.scenarioReceipts.push({
      scenarioName: 'provider_conflict_escalation',
      runId: 'failed-run-1',
      status: 'fail',
      executionMode: 'agentRuntime',
      toolExecutionMode: 'mocked',
      startedAt: '2026-06-10T00:00:00.000Z',
      completedAt: '2026-06-10T00:00:03.000Z',
      summary: '1 of 4 expectations failed.',
      evidence: {
        toolsCalled: ['get_latest_deposit'],
        toolCalls: [{ name: 'get_latest_deposit', executionMode: 'mocked' }],
        toolResults: [{ name: 'get_latest_deposit', output: { _dryRun: true }, executionMode: 'mocked' }],
        hookDecisions: [],
        knowledgeHits: [],
        humanTransfer: false,
        handoff: [],
        finalStatus: 'completed',
      },
      checks: [{
        name: 'hook:provider_conflict_requires_human',
        passed: false,
        code: 'hook_decision_missing',
        detail: 'Expected Hook decision for provider_conflict_requires_human',
      }],
      failureReasons: [{
        code: 'hook_decision_missing',
        message: 'Expected Hook decision for provider_conflict_requires_human',
        checkName: 'hook:provider_conflict_requires_human',
      }],
    })
    h.tables.pilotTodoItems.push({
      id: 'todo-failed',
      orgId: 'default',
      sessionId: body.data.session.id,
      planId: 'plan-1',
      type: 'validation_run',
      status: 'blocked',
      title: 'Fix provider conflict receipt',
      isRequired: true,
      targetScenarioName: 'provider_conflict_escalation',
      latestReceiptRunId: 'failed-run-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const proposed = await ProposeReceiptFix(postRequest({
      sessionId: body.data.session.id,
      agentConfigId: 'agent_1',
      receiptRunId: 'failed-run-1',
    }))
    const proposedBody = await proposed.json()

    expect(proposedBody.ok).toBe(true)
    expect(proposedBody.data.sourceReceiptRunId).toBe('failed-run-1')
    expect(proposedBody.data.proposal.pilotProposalId).toBeTruthy()
    expect(h.tables.pilotProposals).toHaveLength(1)
    expect(h.tables.pilotProposals[0]).toMatchObject({
      todoItemId: 'todo-failed',
      intentSummary: 'Fix fail receipt failed-run-1 for provider_conflict_escalation.',
    })
    expect(h.tables.pilotProposals[0].validationPlan.requiredScenarios).toEqual(['provider_conflict_escalation'])
    expect(h.tables.pilotTodoItems[0]).toMatchObject({ latestProposalId: h.tables.pilotProposals[0].id, status: 'active' })
    expect(h.tables.pilotSessions[0]).toMatchObject({ latestProposalId: h.tables.pilotProposals[0].id, currentMode: 'validation_triage' })
    expect(h.tables.pilotInspectionTraces.some((trace) => trace.actionClass === 'revision' && trace.targetObjectRef.id === 'failed-run-1')).toBe(true)
  })

  it('generates a release handoff from current Pilot and validation state', async () => {
    const current = await CurrentSession(postRequest({ agentConfigId: 'agent_1' }))
    const body = await current.json()
    h.scenarioValidationSummary.value = {
      state: 'Validated',
      lastReceiptId: 'runtime-run-1',
      lastReceiptStatus: 'pass',
      lastReceiptExecutionMode: 'agentRuntime',
      runtimeValidated: true,
      lastRuntimeReceiptId: 'runtime-run-1',
      overrideRequired: false,
    }
    h.tables.pilotProposals.push({
      id: 'pilot-proposal-applied',
      orgId: 'default',
      sessionId: body.data.session.id,
      status: 'applied',
      primarySurface: 'hooks',
      title: 'Add provider conflict Hook',
      summary: 'Adds a provider conflict Hook.',
      validationPlan: {},
      proposal: proposalPayload,
      diffGroups: [],
      patchCount: 1,
      baseAgentConfigId: 'agent_1',
      baseDraftFingerprint: body.data.draftFingerprint,
      appliedDraftAgentConfigId: 'agent_1',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    h.tables.pilotTodoItems.push({
      id: 'todo-completed',
      orgId: 'default',
      sessionId: body.data.session.id,
      planId: 'plan-1',
      type: 'validation_run',
      status: 'completed',
      title: 'Run runtime receipt',
      isRequired: true,
      latestReceiptRunId: 'runtime-run-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    h.tables.channelBindings.push({
      id: 'channel-1',
      orgId: 'default',
      agentConfigId: 'agent_1',
      channel: 'web-chat',
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const generated = await GenerateReleaseHandoff(postRequest({
      sessionId: body.data.session.id,
      draftAgentConfigId: 'agent_1',
    }))
    const generatedBody = await generated.json()

    expect(generatedBody.ok).toBe(true)
    expect(generatedBody.data.handoff.readinessVerdict).toBe('ready_for_release_review')
    expect(generatedBody.data.handoff.handoffSummary).toContain('Changed surfaces: hooks')
    expect(generatedBody.data.handoff.referencedReceiptIds).toContain('runtime-run-1')
    expect(generatedBody.data.handoff.referencedProposalIds).toContain('pilot-proposal-applied')
    expect(h.tables.pilotSessions[0]).toMatchObject({ latestHandoffId: generatedBody.data.handoff.id, status: 'handoff_ready' })
    expect(h.tables.pilotMessages.some((message) => message.kind === 'handoff')).toBe(true)
  })

  it('durably records takeover, manual compact, and archive session actions', async () => {
    const current = await CurrentSession(postRequest({ agentConfigId: 'agent_1' }))
    const body = await current.json()
    h.tables.pilotSessions[0].memoryDegraded = true

    const takeover = await TakeoverSession(postRequest({
      sessionId: body.data.session.id,
      reason: 'Continuing owner review.',
    }))
    expect((await takeover.json()).data.session.activeEditorUserId).toBe('user-1')

    const compact = await ManualCompactSession(postRequest({ sessionId: body.data.session.id }))
    expect((await compact.json()).data.session.memoryDegraded).toBe(false)
    expect(h.tables.pilotMessages.some((message) => message.kind === 'compact')).toBe(true)

    const archived = await ArchiveSession(postRequest({
      sessionId: body.data.session.id,
      reason: 'Finished local test branch.',
    }))
    const archivedBody = await archived.json()
    expect(archivedBody.data.session.status).toBe('archived')
    expect(archivedBody.data.session.isCurrent).toBe(false)
    expect(archivedBody.data.session.archivedAt).toBeTruthy()
  })
})
