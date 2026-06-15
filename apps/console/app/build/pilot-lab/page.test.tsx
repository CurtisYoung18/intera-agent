// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PilotSessionSnapshot, PilotTodoItemStatus } from '@intera/shared/contracts/pilot'
import type { ScenarioReceipt, ScenarioValidationSummary, SavedScenario } from '@intera/shared/contracts/scenarios'

const mockApiClient = vi.fn()
let searchParams = new URLSearchParams()

const labels: Record<string, string> = {
  'pilotLab.tabs.aria': 'Pilot Lab tabs',
  'pilotLab.tabs.pilot': 'Pilot',
  'pilotLab.tabs.pilotDesc': 'Draft changes and Scenario receipts',
  'pilotLab.tabs.playground': 'Playground',
  'pilotLab.tabs.playgroundDesc': 'Manual dry-run and trace debug',
}

vi.mock('@/lib/api/client', () => ({
  apiClient: (...args: unknown[]) => mockApiClient(...args),
  ApiClientError: class ApiClientError extends Error {
    constructor(public envelope: any) {
      super(envelope.error.message)
    }
  },
}))

vi.mock('@/components/admin/version-context-bar', () => ({
  default: () => null,
  useSelectedAgentId: vi.fn(() => 'agent-1'),
}))

vi.mock('@/components/locale-provider', () => ({
  useConsoleLocale: () => ({
    locale: 'en',
    toggleLocale: vi.fn(),
    t: (key: string) => labels[key] ?? key,
  }),
}))

vi.mock('@/components/playground/playground-workspace', () => ({
  default: ({ surface }: { surface?: string }) => <div data-testid="native-playground">{surface === 'pilot-lab' ? 'Native Playground' : 'Legacy Playground'}</div>,
}))

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(() => searchParams),
}))

const scenario: SavedScenario = {
  id: 'scenario-1',
  agentConfigId: 'agent-1',
  name: 'deposit_missing_evidence',
  displayName: 'Deposit missing evidence',
  description: 'Covers provider evidence and human transfer.',
  locale: 'en-US',
  tags: ['deposit'],
  enabled: true,
  createdAt: '2026-06-09T00:00:00.000Z',
  updatedAt: '2026-06-09T00:00:00.000Z',
  lastRunId: 'run-1',
  lastRunStatus: 'pass',
  turns: [
    { role: 'user', content: 'My deposit has not arrived yet.' },
    { role: 'assistant', content: 'I checked the available evidence and will transfer this case to a human specialist.' },
  ],
  expected: {
    caseType: 'deposit_issue',
    toolsCalled: ['get_latest_deposit'],
    hooks: [{ hookName: 'conflict_requires_human', checkpoint: 'PostToolUse', decision: 'escalate' }],
    humanTransfer: true,
    finalStatus: 'waiting_human',
    procedureStatus: 'completed',
    procedureOutcome: 'handed_off',
    forbiddenPhrases: ['guaranteed compensation'],
    requiredPhrases: ['human specialist'],
  },
}

const runtimeReceipt: ScenarioReceipt = {
  scenarioName: 'deposit_missing_evidence',
  runId: 'run-1',
  status: 'pass',
  executionMode: 'agentRuntime',
  toolExecutionMode: 'mocked',
  startedAt: '2026-06-09T00:01:00.000Z',
  completedAt: '2026-06-09T00:01:03.000Z',
  finishedAt: '2026-06-09T00:01:03.000Z',
  agentConfigId: 'agent-1',
  summary: '7 expectations passed.',
  expected: scenario.expected,
  evidence: {
    caseType: 'deposit_issue',
    toolsCalled: ['get_latest_deposit'],
    toolCalls: [{ name: 'get_latest_deposit', executionMode: 'mocked' }],
    toolResults: [{ name: 'get_latest_deposit', output: { _dryRun: true }, executionMode: 'mocked' }],
    hookDecisions: [{ hookName: 'conflict_requires_human', checkpoint: 'PostToolUse', decision: 'escalate', reason: 'Provider proof mismatch' }],
    knowledgeHits: [{ source: 'fixture', title: 'Deposit runbook' }],
    humanTransfer: true,
    handoff: [{ required: true, target: 'human', reason: 'Needs manual provider review' }],
    finalResponse: 'I checked the available evidence and will transfer this case to a human specialist.',
    finalStatus: 'waiting_human',
    procedureStatus: 'completed',
    procedureOutcome: 'handed_off',
  },
  checks: [
    { name: 'tool:get_latest_deposit', passed: true },
    { name: 'hook:conflict_requires_human', passed: true },
    { name: 'human_transfer', passed: true },
    { name: 'final_status', passed: true },
    { name: 'forbidden_phrase:guaranteed compensation', passed: true },
    { name: 'required_phrase:human specialist', passed: true },
  ],
  failureReasons: [],
}

const fixtureReceipt: ScenarioReceipt = {
  ...runtimeReceipt,
  runId: 'fixture-run-1',
  executionMode: 'fixture',
  summary: 'Fixture expectations passed.',
}

const failedReceipt: ScenarioReceipt = {
  ...runtimeReceipt,
  runId: 'failed-run-1',
  status: 'fail',
  executionMode: 'agentRuntime',
  summary: '1 of 6 expectations failed.',
  checks: [
    { name: 'tool:get_latest_deposit', passed: true },
    { name: 'hook:conflict_requires_human', passed: false, code: 'hook_decision_missing', detail: 'Expected Hook decision for conflict_requires_human' },
  ],
  failureReasons: [{
    code: 'hook_decision_missing',
    message: 'Expected Hook decision for conflict_requires_human',
    checkName: 'hook:conflict_requires_human',
  }],
}

const runtimeValidation: ScenarioValidationSummary = {
  state: 'Validated',
  lastValidatedAt: runtimeReceipt.finishedAt,
  lastReceiptId: runtimeReceipt.runId,
  lastReceiptStatus: runtimeReceipt.status,
  lastReceiptExecutionMode: runtimeReceipt.executionMode,
  runtimeValidated: true,
  runtimeValidatedAt: runtimeReceipt.completedAt,
  overrideRequired: false,
}

const fixtureValidation: ScenarioValidationSummary = {
  state: 'Validated',
  lastValidatedAt: fixtureReceipt.finishedAt,
  lastReceiptId: fixtureReceipt.runId,
  lastReceiptStatus: fixtureReceipt.status,
  lastReceiptExecutionMode: fixtureReceipt.executionMode,
  runtimeValidated: false,
  runtimeValidatedAt: undefined,
  overrideRequired: true,
}

const failedValidation: ScenarioValidationSummary = {
  state: 'Validation failed',
  lastReceiptId: failedReceipt.runId,
  lastReceiptStatus: failedReceipt.status,
  lastReceiptExecutionMode: failedReceipt.executionMode,
  runtimeValidated: false,
  runtimeValidatedAt: undefined,
  overrideRequired: true,
}

const configPilotProposal = {
  id: 'proposal-1',
  pilotProposalId: 'pilot-proposal-1',
  baseDraftFingerprint: 'fingerprint-1',
  targetSurface: 'scenarios',
  title: 'Deposit handoff Scenario',
  summary: 'Creates a draft Scenario for provider evidence and human transfer.',
  rationale: 'The current validation suite needs one repeatable handoff case.',
  patches: [{
    surface: 'scenarios',
    operation: 'create',
    value: {
      name: 'configpilot_deposit_handoff',
      displayName: 'ConfigPilot deposit handoff',
      description: 'Generated through backend ConfigPilot.',
      locale: 'en-US',
      tags: ['configpilot'],
      enabled: true,
      turns: scenario.turns,
      expected: scenario.expected,
    },
  }],
  diffGroups: [{
    id: 'scenarios',
    title: 'Scenarios',
    description: 'Pilot Lab validation cases and receipt expectations.',
    summary: '1 proposed change',
    items: [{
      key: 'configpilot_deposit_handoff.name',
      label: 'configpilot_deposit_handoff / name',
      status: 'added',
      after: 'configpilot_deposit_handoff',
    }],
  }],
  receiptSuggestions: ['Run the generated Scenario before publishing.'],
  runSuggestions: ['Use observed provider evidence for the first run.'],
  safetyNotes: ['Draft only; publish remains locked.'],
}

function contextResponse(validation: any = runtimeValidation) {
  return {
    agentConfigId: 'agent-1',
    selected: { id: 'agent-1', name: 'Gaming Support', version: 2, isActive: false, model: 'deepseek-v4-flash', updatedAt: '2026-06-09T00:00:00.000Z', publishedAt: null },
    active: { id: 'agent-live', name: 'Gaming Support', version: 1, isActive: true, model: 'deepseek-v4-flash', updatedAt: '2026-06-08T00:00:00.000Z', publishedAt: '2026-06-08T01:00:00.000Z' },
    draft: { id: 'agent-1', name: 'Gaming Support', version: 2, isActive: false, model: 'deepseek-v4-flash', updatedAt: '2026-06-09T00:00:00.000Z', publishedAt: null },
    permissions: { role: 'admin', canRead: true, canPropose: true, canApply: true, canPublish: false },
    lockedCapabilities: [{ id: 'hook_engine', name: 'Hook Engine', surface: 'runtime', reason: 'runtime-managed', editable: false }],
    configuration: { brain: { model: 'deepseek-v4-flash' }, procedures: [], tools: [], hooks: [], hookBindings: [], knowledge: [], integrations: [], scenarios: [scenario] },
    validation,
  }
}

function pilotSnapshotResponse(memoryDegraded = true, latestReceiptRunId = 'run-1', todoStatus: PilotTodoItemStatus = 'active'): PilotSessionSnapshot {
  return {
    session: {
      id: 'pilot-session-1',
      orgId: 'default',
      agentConfigId: 'agent-1',
      agentFamilyKey: 'Gaming Support',
      bindingScope: 'draft_agent',
      createdByUserId: 'user-1',
      activeEditorUserId: 'user-1',
      status: 'in_progress',
      title: 'Gaming Support v2 Pilot',
      currentMode: 'critique_existing_agent',
      summary: {
        confirmedGoals: ['Support deposit and withdrawal escalations.'],
        openQuestions: [],
        nextRecommendedStep: 'Continue the current visible TodoPlan item by item.',
      },
      pinnedState: null,
      currentBuildBriefId: 'brief-1',
      currentTodoPlanId: 'plan-1',
      currentActiveTodoItemId: 'todo-1',
      latestProposalId: 'pilot-proposal-1',
      latestReceiptRunId,
      latestHandoffId: 'handoff-1',
      memoryDegraded,
      compactedAt: memoryDegraded ? null : '2026-06-09T00:05:00.000Z',
      archivedAt: null,
      isCurrent: true,
      createdAt: '2026-06-09T00:00:00.000Z',
      updatedAt: '2026-06-09T00:04:00.000Z',
    },
    permissions: { role: 'admin', canRead: true, canPropose: true, canAccept: true, canApply: true, canTakeOver: true, canGenerateHandoff: true, canPublish: false },
    draftFingerprint: 'fingerprint-1',
    messages: [{
      id: 'msg-accept',
      sessionId: 'pilot-session-1',
      role: 'system',
      kind: 'accept',
      content: 'Proposal accepted.',
      structuredPayload: { proposalId: 'pilot-proposal-1' },
      createdByUserId: 'user-1',
      createdAt: '2026-06-09T00:02:00.000Z',
    }],
    proposals: [],
    todoPlans: [{
      id: 'plan-1',
      sessionId: 'pilot-session-1',
      title: 'Template tailoring build plan',
      isCurrent: true,
      createdByUserId: 'user-1',
      createdAt: '2026-06-09T00:01:00.000Z',
      updatedAt: '2026-06-09T00:01:00.000Z',
      items: [{
        id: 'todo-1',
        sessionId: 'pilot-session-1',
        planId: 'plan-1',
        type: 'config_change',
        status: todoStatus,
        title: 'Escalate provider conflicts',
        description: 'Create Hook and Scenario coverage.',
        isRequired: true,
        visibleReason: 'Conflicting evidence reaches human support.',
        latestProposalId: null,
        latestReceiptRunId: todoStatus === 'completed' || todoStatus === 'blocked' ? latestReceiptRunId : null,
        latestHandoffId: null,
        targetScenarioName: 'deposit_missing_evidence',
        metadata: null,
        createdAt: '2026-06-09T00:01:00.000Z',
        updatedAt: '2026-06-09T00:01:00.000Z',
      }],
    }],
    handoffs: [{
      id: 'handoff-1',
      sessionId: 'pilot-session-1',
      draftAgentConfigId: 'agent-1',
      draftFingerprint: 'fingerprint-1',
      handoffSummary: 'Runtime receipt still required.',
      readinessVerdict: 'not_ready',
      blockers: [{ code: 'runtime_receipt_missing', message: 'Run runtime validation before release review.' }],
      risks: [],
      referencedProposalIds: ['pilot-proposal-1'],
      referencedReceiptIds: [],
      coveredTodoItemIds: ['todo-1'],
      isCurrent: true,
      createdByUserId: 'user-1',
      createdAt: '2026-06-09T00:04:00.000Z',
      updatedAt: '2026-06-09T00:04:00.000Z',
    }],
    buildBriefs: [{
      id: 'brief-1',
      orgId: 'default',
      agentFamilyKey: 'Gaming Support',
      sessionId: 'pilot-session-1',
      revision: 1,
      status: 'confirmed',
      businessGoal: 'Support deposit and withdrawal escalations.',
      targetChannels: ['web-chat'],
      supportedUseCases: ['deposit_status'],
      outOfScopeUseCases: ['bonus_abuse'],
      escalationPolicy: 'Escalate provider conflicts.',
      requiredToolsAndIntegrations: ['order_status'],
      toneAndResponseConstraints: ['evidence-first'],
      validationExpectations: ['runtime receipt required'],
      openQuestions: [],
      isCurrent: true,
      confirmedAt: '2026-06-09T00:01:00.000Z',
      confirmedByUserId: 'user-1',
      supersededAt: null,
      supersededById: null,
      createdByUserId: 'user-1',
      createdAt: '2026-06-09T00:01:00.000Z',
      updatedAt: '2026-06-09T00:01:00.000Z',
    }],
    templateRecommendations: [],
    templateTailoringPlans: [],
    scratchBuildPlans: [],
    inspectionTraces: [{
      id: 'trace-1',
      orgId: 'default',
      sessionId: 'pilot-session-1',
      actionClass: 'proposal',
      targetObjectRef: { type: 'template_tailoring_plan', id: 'tailoring-1' },
      steps: [{
        toolFamily: 'inspect_config_surface',
        target: 'hooks',
        visibility: 'metadata_only',
        summary: 'Hook surface needs provider-conflict tailoring.',
        evidenceSufficientAfterStep: true,
      }],
      evidenceSufficient: true,
      stopReason: 'Target surface and validation need are known.',
      createdByUserId: 'user-1',
      createdAt: '2026-06-09T00:03:00.000Z',
    }],
  }
}

function setupApi(mode: 'runtime' | 'fixture' | 'failed' = 'runtime') {
  const receipt = mode === 'runtime' ? runtimeReceipt : mode === 'fixture' ? fixtureReceipt : failedReceipt
  const validation = mode === 'runtime' ? runtimeValidation : mode === 'fixture' ? fixtureValidation : failedValidation
  let snapshot = pilotSnapshotResponse(true)
  let scenarioState: SavedScenario[] = [{ ...scenario }]
  let receiptState: ScenarioReceipt[] = [receipt]
  let validationState: ScenarioValidationSummary = { ...validation }
  mockApiClient.mockImplementation(async (url: string, options?: any) => {
    if (url === '/api/admin/config-pilot/context?agentConfigId=agent-1') {
      return { data: contextResponse(validationState) }
    }
    if (url === '/api/admin/pilot/sessions/current?agentConfigId=agent-1') {
      return { data: snapshot }
    }
    if (url === '/api/admin/pilot/sessions/manual-compact' && options?.method === 'POST') {
      snapshot = pilotSnapshotResponse(false)
      return { data: { session: snapshot.session } }
    }
    if (url === '/api/admin/pilot/release-handoffs/generate' && options?.method === 'POST') {
      snapshot = {
        ...snapshot,
        session: { ...snapshot.session, latestHandoffId: 'handoff-ready', status: 'handoff_ready' },
        handoffs: [{
          ...snapshot.handoffs[0],
          id: 'handoff-ready',
          handoffSummary: 'Pilot release handoff for Gaming Support v2. Changed surfaces: hooks. Validation: Validated with runtime-backed receipt.',
          readinessVerdict: 'ready_for_release_review',
          blockers: [],
          referencedReceiptIds: ['run-1'],
        }],
      }
      return { data: { handoff: snapshot.handoffs[0] } }
    }
    if (url === '/api/admin/scenarios?agentConfigId=agent-1') {
      return { data: { scenarios: scenarioState, receipts: receiptState, validation: validationState } }
    }
    if (url === '/api/admin/scenarios' && options?.method === 'POST') {
      const created: SavedScenario = {
        id: `scenario-${scenarioState.length + 1}`,
        agentConfigId: 'agent-1',
        createdAt: '2026-06-09T00:06:00.000Z',
        updatedAt: '2026-06-09T00:06:00.000Z',
        ...options.body,
      }
      scenarioState = [...scenarioState, created]
      validationState = { ...validationState, state: 'Changed since last validation', overrideRequired: true }
      return { data: { scenario: created } }
    }
    if (url.startsWith('/api/admin/scenarios/') && options?.method === 'PUT') {
      const currentName = decodeURIComponent(url.split('/api/admin/scenarios/')[1] ?? '')
      const updated: SavedScenario = {
        ...(scenarioState.find((item) => item.name === currentName) ?? scenarioState[0]),
        ...options.body,
        agentConfigId: 'agent-1',
        updatedAt: '2026-06-09T00:07:00.000Z',
      }
      scenarioState = scenarioState
        .filter((item) => item.name !== currentName)
        .concat(updated)
      validationState = { ...validationState, state: 'Changed since last validation', overrideRequired: true }
      return { data: { scenario: updated } }
    }
    if (url.startsWith('/api/admin/scenarios/') && options?.method === 'DELETE') {
      const currentName = decodeURIComponent(url.split('/api/admin/scenarios/')[1]?.split('?')[0] ?? '')
      scenarioState = scenarioState.filter((item) => item.name !== currentName)
      validationState = { ...validationState, state: 'Changed since last validation', overrideRequired: true }
      return { data: { success: true } }
    }
    if (url === '/api/admin/config-pilot/propose' && options?.method === 'POST') {
      return {
        data: {
          proposal: configPilotProposal,
          modelUsed: 'config-pilot-test-model',
          promptVersion: 'config-pilot.p1.v1',
        },
      }
    }
    if (url === '/api/admin/pilot/proposals/pilot-proposal-1/accept' && options?.method === 'POST') {
      return {
        data: {
          proposal: {
            id: 'pilot-proposal-1',
            status: 'accepted',
          },
        },
      }
    }
    if (url === '/api/admin/config-pilot/apply' && options?.method === 'POST') {
      const createdScenario: SavedScenario = {
        ...scenario,
        ...configPilotProposal.patches[0].value,
        id: 'scenario-configpilot',
        createdAt: '2026-06-09T00:03:00.000Z',
        updatedAt: '2026-06-09T00:03:00.000Z',
      }
      scenarioState = scenarioState.concat(createdScenario)
      validationState = {
        state: 'Changed since last validation',
        changedAt: '2026-06-09T00:03:00.000Z',
        overrideRequired: true,
        runtimeValidated: false,
      }
      return {
        data: {
          appliedPatches: [{ surface: 'scenarios', operation: 'create', target: 'configpilot_deposit_handoff' }],
          draftAgentConfigId: 'agent-1',
          createdDraft: false,
          validation: validationState,
          artifacts: {
            scenarios: [createdScenario],
          },
        },
      }
    }
    if (url === '/api/admin/pilot/validation/run-scenario' && options?.method === 'POST') {
      const nextReceipt: ScenarioReceipt = options.body.executionMode === 'fixture'
        ? { ...fixtureReceipt, runId: 'fixture-run-2' }
        : { ...runtimeReceipt, runId: 'run-2' }
      const nextValidation: ScenarioValidationSummary = nextReceipt.executionMode === 'agentRuntime'
        ? { ...runtimeValidation, lastReceiptId: nextReceipt.runId, lastRuntimeReceiptId: nextReceipt.runId, runtimeValidatedAt: nextReceipt.completedAt }
        : { ...fixtureValidation, lastReceiptId: nextReceipt.runId }
      receiptState = [nextReceipt, ...receiptState]
      validationState = nextValidation
      snapshot = pilotSnapshotResponse(true, nextReceipt.runId, nextReceipt.executionMode === 'agentRuntime' ? 'completed' : 'active')
      return {
        data: {
          receipt: nextReceipt,
          validation: nextValidation,
          triage: {
            scenarioName: nextReceipt.scenarioName,
            receiptRunId: nextReceipt.runId,
            status: nextReceipt.status,
            executionMode: nextReceipt.executionMode,
            validationState: nextValidation.state,
            runtimeBacked: nextReceipt.executionMode === 'agentRuntime',
            releaseReadinessEffect: nextReceipt.executionMode === 'agentRuntime' ? 'restores_runtime_validation' : 'debug_only_fixture',
            summary: `${nextReceipt.executionMode} receipt ${nextReceipt.status}.`,
            nextRecommendedStep: nextReceipt.executionMode === 'agentRuntime'
              ? 'Use this runtime-backed receipt in the release handoff after closing any remaining required Pilot todos.'
              : 'Treat this as debugging evidence only; run the same named Scenario in runtime-backed mode before release review.',
            failureReasons: [],
          },
          todoItem: snapshot.todoPlans[0].items[0],
          inspectionTrace: snapshot.inspectionTraces[0],
        },
      }
    }
    if (url === '/api/admin/pilot/validation/propose-fix' && options?.method === 'POST') {
      snapshot = {
        ...snapshot,
        session: { ...snapshot.session, latestProposalId: 'pilot-proposal-fix', currentMode: 'validation_triage' },
      }
      return {
        data: {
          proposal: {
            ...configPilotProposal,
            id: 'proposal-fix',
            pilotProposalId: 'pilot-proposal-fix',
            title: 'Fix failed receipt',
            summary: 'Drafts a minimal fix from the failed receipt.',
          },
          modelUsed: 'config-pilot-test-model',
          promptVersion: 'config-pilot.p1.v1',
          sourceReceiptRunId: options.body.receiptRunId,
          inspectionTrace: snapshot.inspectionTraces[0],
        },
      }
    }
    return { data: {} }
  })
}

async function renderPage() {
  const { default: PilotLabPage } = await import('./page')
  await act(async () => {
    render(<PilotLabPage />)
  })
}

function textIncludes(text: string) {
  return (_content: string, element: Element | null) => Boolean(element?.textContent?.includes(text))
}

async function submitChatPrompt(text = 'Create a deposit handoff Scenario') {
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Message U-Pilot'), { target: { value: text } })
  })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
  })
}

beforeEach(() => {
  searchParams = new URLSearchParams()
  mockApiClient.mockReset()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  setupApi()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PilotLabPage U-Pilot cockpit', () => {
  it('renders the initial chat cockpit around current draft context', async () => {
    await renderPage()

    expect(screen.getByRole('link', { name: /Pilot/ }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: /Playground/ })).toBeTruthy()
    expect(screen.getByLabelText('Message U-Pilot')).toBeTruthy()
    expect(await screen.findAllByText('Current context')).toBeTruthy()
    expect(mockApiClient.mock.calls[0][0]).toBe('/api/admin/config-pilot/context?agentConfigId=agent-1')
  }, 10000)

  it('shows durable Pilot session artifacts and manual compact state', async () => {
    await renderPage()

    expect(await screen.findByText('Pilot state')).toBeTruthy()
    expect(await screen.findByText('Critique existing agent')).toBeTruthy()
    expect(await screen.findByText('Support deposit and withdrawal escalations.')).toBeTruthy()
    expect(await screen.findByText('Template tailoring build plan')).toBeTruthy()
    expect(await screen.findByText('Escalate provider conflicts')).toBeTruthy()
    expect(await screen.findByText('proposal')).toBeTruthy()
    expect((await screen.findAllByText(textIncludes('runtime_receipt_missing'))).length).toBeGreaterThan(0)

    await act(async () => {
      fireEvent.click(screen.getByTestId('pilot-manual-compact'))
    })
    await waitFor(() => {
      expect(mockApiClient.mock.calls.some(([url, options]) => url === '/api/admin/pilot/sessions/manual-compact' && options?.method === 'POST')).toBe(true)
    })
    expect(await screen.findByText('Pilot session memory compacted.')).toBeTruthy()
  }, 10000)

  it('generates a Release handoff from durable Pilot state', async () => {
    await renderPage()
    await screen.findByText('Pilot state')

    await act(async () => {
      fireEvent.click(screen.getByTestId('pilot-generate-handoff'))
    })

    await waitFor(() => {
      expect(mockApiClient.mock.calls.some(([url, options]) => url === '/api/admin/pilot/release-handoffs/generate' && options?.method === 'POST')).toBe(true)
    })
    expect((await screen.findAllByText('Release handoff generated.')).length).toBeGreaterThan(0)
    expect((await screen.findAllByText('ready_for_release_review')).length).toBeGreaterThan(0)
    expect(await screen.findByRole('link', { name: 'Open Release' })).toBeTruthy()
  }, 10000)

  it('renders playground as a compact workspace without compatibility chrome', async () => {
    searchParams = new URLSearchParams('tab=playground')
    await renderPage()

    expect(screen.getByTestId('native-playground')).toBeTruthy()
    expect(screen.getByText('Native Playground')).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Pilot Lab tabs' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Playground/ }).getAttribute('aria-current')).toBe('page')
    expect(screen.queryByText('Playground compatibility surface')).toBeNull()
    expect(screen.queryByText(/Compatibility route only/i)).toBeNull()
    expect(screen.queryByText('U-Pilot Chat Cockpit')).toBeNull()
  }, 10000)

  it('shows the initial streaming Pilot greeting after context loads', async () => {
    await renderPage()

    expect((await screen.findAllByText(textIncludes('I have read the current draft'))).length).toBeGreaterThan(0)
  }, 10000)

  it('shows a proposal diff after chat propose, while apply stays disabled before accept', async () => {
    await renderPage()
    await screen.findByLabelText('Message U-Pilot')

    await submitChatPrompt()
    expect(await screen.findByText('Deposit handoff Scenario')).toBeTruthy()

    const applyButton = screen.getByTestId('config-pilot-apply-draft')
    expect(applyButton).toHaveProperty('disabled', true)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Review diff/ }))
    })
    expect(await screen.findByText('Diff viewer')).toBeTruthy()
    expect(applyButton).toHaveProperty('disabled', true)
  }, 10000)

  it('enables apply only after explicit accept', async () => {
    await renderPage()
    await submitChatPrompt()
    await screen.findByText('Deposit handoff Scenario')
    const applyButton = screen.getByTestId('config-pilot-apply-draft')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Review diff/ }))
    })
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/I reviewed the diff/))
    })

    await waitFor(() => {
      expect(mockApiClient.mock.calls.some(([url, options]) => url === '/api/admin/pilot/proposals/pilot-proposal-1/accept' && options?.method === 'POST')).toBe(true)
    })
    await waitFor(() => expect(applyButton).toHaveProperty('disabled', false))
  }, 10000)

  it('applies accepted drafts without calling publish activate deploy or rollback endpoints', async () => {
    await renderPage()
    await submitChatPrompt()
    await screen.findByText('Deposit handoff Scenario')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Review diff/ }))
    })
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/I reviewed the diff/))
    })
    await waitFor(() => {
      expect(mockApiClient.mock.calls.some(([url, options]) => url === '/api/admin/pilot/proposals/pilot-proposal-1/accept' && options?.method === 'POST')).toBe(true)
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('config-pilot-apply-draft'))
    })

    await waitFor(() => {
      expect(mockApiClient.mock.calls.some(([url, options]) => url === '/api/admin/config-pilot/apply' && options?.method === 'POST')).toBe(true)
    })
    expect(mockApiClient.mock.calls.some(([url]) => typeof url === 'string' && /publish|activate|deploy|rollback/i.test(url))).toBe(false)
  }, 10000)

  it('does not label fixture-only receipts as runtime validated', async () => {
    setupApi('fixture')
    await renderPage()

    expect(await screen.findByText('Fixture-only validation')).toBeTruthy()
    expect(await screen.findByText('Not runtime validated')).toBeTruthy()
    expect(screen.queryByText('Runtime validated')).toBeNull()
  }, 10000)

  it('labels runtime-backed receipts explicitly', async () => {
    await renderPage()

    expect(await screen.findAllByText('Runtime validated')).toBeTruthy()
    expect(await screen.findByText('Agent runtime')).toBeTruthy()
  }, 10000)

  it('runs Scenario validation through the durable Pilot workflow route', async () => {
    await renderPage()
    await screen.findByText('Scenario controls')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Run runtime/ }))
    })

    await waitFor(() => {
      const call = mockApiClient.mock.calls.find(([url, options]) => url === '/api/admin/pilot/validation/run-scenario' && options?.method === 'POST')
      expect(call).toBeTruthy()
      expect(call?.[1].body).toMatchObject({
        sessionId: 'pilot-session-1',
        agentConfigId: 'agent-1',
        scenarioName: 'deposit_missing_evidence',
        executionMode: 'agentRuntime',
        todoItemId: 'todo-1',
      })
    })
    expect((await screen.findAllByText(textIncludes('Use this runtime-backed receipt'))).length).toBeGreaterThan(0)
    expect((await screen.findAllByText('run-2')).length).toBeGreaterThan(0)
  }, 10000)

  it('creates a new Scenario through manual authoring controls', async () => {
    await renderPage()
    await screen.findByText('Scenario controls')

    await act(async () => {
      fireEvent.click(screen.getByTestId('pilot-scenario-new'))
    })
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Scenario name'), { target: { value: 'duplicate_deposit_manual' } })
      fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Duplicate deposit manual' } })
      fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Manual production scenario created from the Pilot UI.' } })
      fireEvent.change(screen.getByLabelText('Expected Procedure'), { target: { value: 'duplicate_deposit' } })
      fireEvent.change(screen.getByLabelText('Expected tools'), { target: { value: 'ask_user_questions, get_latest_deposit' } })
      fireEvent.change(screen.getByLabelText('Turn 1 content'), { target: { value: '我重复存款了，请帮我查一下。' } })
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('pilot-scenario-save'))
    })

    await waitFor(() => {
      const call = mockApiClient.mock.calls.find(([url, options]) => url === '/api/admin/scenarios' && options?.method === 'POST')
      expect(call).toBeTruthy()
      expect(call?.[1].body).toMatchObject({
        agentConfigId: 'agent-1',
        name: 'duplicate_deposit_manual',
        displayName: 'Duplicate deposit manual',
        expected: {
          caseType: 'duplicate_deposit',
          toolsCalled: ['ask_user_questions', 'get_latest_deposit'],
        },
      })
    })
    expect(await screen.findByText('Scenario created.')).toBeTruthy()
  }, 10000)

  it('updates and deletes the selected Scenario through manual authoring controls', async () => {
    await renderPage()
    await screen.findByText('Scenario controls')

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Deposit missing evidence v2' } })
      fireEvent.change(screen.getByLabelText('Required phrases'), { target: { value: 'human specialist\nprovider evidence' } })
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('pilot-scenario-save'))
    })

    await waitFor(() => {
      const call = mockApiClient.mock.calls.find(([url, options]) => url === '/api/admin/scenarios/deposit_missing_evidence' && options?.method === 'PUT')
      expect(call).toBeTruthy()
      expect(call?.[1].body).toMatchObject({
        agentConfigId: 'agent-1',
        displayName: 'Deposit missing evidence v2',
        expected: {
          requiredPhrases: ['human specialist', 'provider evidence'],
        },
      })
    })
    expect(await screen.findByText('Scenario saved.')).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByTestId('pilot-scenario-delete'))
    })

    await waitFor(() => {
      expect(mockApiClient.mock.calls.some(([url, options]) => url === '/api/admin/scenarios/deposit_missing_evidence?agentConfigId=agent-1' && options?.method === 'DELETE')).toBe(true)
    })
    expect(await screen.findByText('Scenario deleted.')).toBeTruthy()
  }, 10000)

  it('drafts a follow-up proposal from a failed selected receipt', async () => {
    setupApi('failed')
    await renderPage()
    await screen.findByText('Scenario controls')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Draft fix from receipt/ }))
    })

    await waitFor(() => {
      const call = mockApiClient.mock.calls.find(([url, options]) => url === '/api/admin/pilot/validation/propose-fix' && options?.method === 'POST')
      expect(call).toBeTruthy()
      expect(call?.[1].body).toMatchObject({
        sessionId: 'pilot-session-1',
        agentConfigId: 'agent-1',
        receiptRunId: 'failed-run-1',
      })
    })
    expect(await screen.findByText('Fix failed receipt')).toBeTruthy()
    expect(await screen.findByText('Drafts a minimal fix from the failed receipt.')).toBeTruthy()
  }, 10000)
})
