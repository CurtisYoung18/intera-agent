import { describe, expect, it, vi } from 'vitest'
import type { SSEEvent } from '@intera/shared/types'
import type { TraceRecord } from '@/lib/agent/persistence-port'
import type { SavedScenario } from '@intera/shared/contracts/scenarios'

vi.mock('@/lib/agent/playground-runner', () => ({
  runPlaygroundTurn: vi.fn(),
}))

import { runPlaygroundTurn } from '@/lib/agent/playground-runner'
import { buildRuntimeEvidence, parseScenarioFormSubmission, runScenarioAgentRuntime } from '../runtime-runner'

const scenario: SavedScenario = {
  id: 'scenario-runtime',
  agentConfigId: 'agent-1',
  name: 'deposit_runtime_validation',
  displayName: 'Deposit runtime validation',
  tags: [],
  enabled: true,
  turns: [{ role: 'user', content: 'My deposit is missing.' }],
  expected: {
    toolsCalled: ['get_latest_deposit'],
    hooks: [{ hookName: 'review_lookup_result', checkpoint: 'PostToolUse', decision: 'escalate' }],
    humanTransfer: true,
    finalStatus: 'waiting_human',
    procedureStatus: 'completed',
    procedureOutcome: 'handed_off',
    requiredPhrases: ['human specialist'],
    forbiddenPhrases: ['guaranteed compensation'],
  },
  createdAt: '2026-06-10T00:00:00.000Z',
  updatedAt: '2026-06-10T00:00:00.000Z',
}

describe('runtime-backed Scenario evidence', () => {
  it('extracts Tool, Hook, human transfer, and R3 stale evidence from runtime trace', () => {
    const events: SSEEvent[] = [
      { type: 'session_init', data: { chatId: 'chat-1', caseId: 'case-1' }, timestamp: '2026-06-10T00:00:00.000Z' },
      { type: 'tool_executing', data: { name: 'kb_search_deposit', status: 'executing' }, timestamp: '2026-06-10T00:00:00.500Z' },
      { type: 'tool_executing', data: { name: 'get_latest_deposit', status: 'executing' }, timestamp: '2026-06-10T00:00:01.000Z' },
      { type: 'tool_result', data: { name: 'get_latest_deposit', status: 'completed', result: { ok: true, output: { _dryRun: true, status: 'needs_review' } } }, timestamp: '2026-06-10T00:00:02.000Z' },
      { type: 'escalated', data: { reason: 'human_task_created', queue: 'risk' }, timestamp: '2026-06-10T00:00:03.000Z' },
      { type: 'message_stop', data: { reason: 'waiting_human' }, timestamp: '2026-06-10T00:00:04.000Z' },
    ]
    const rawTrace: TraceRecord[] = [
      {
        caseId: 'case-1',
        actionType: 'tool_result',
        title: 'Tool: kb_search_deposit',
        payload: JSON.stringify({
          toolName: 'kb_search_deposit',
          input: { query: 'how to deposit' },
          output: {
            list: [
              { document_name: 'Deposit FAQ', data_id: 'doc-1', content: 'Use bank transfer.', score: 0.97 },
            ],
          },
        }),
        createdAt: '2026-06-10T00:00:01.500Z',
      },
      {
        caseId: 'case-1',
        actionType: 'loop_decision',
        title: 'Hook escalate: review_lookup_result',
        payload: JSON.stringify({
          checkpoint: 'PostToolUse',
          result: 'escalate',
          reason: 'Result needs review.',
          toolName: 'get_latest_deposit',
          results: [{ hookName: 'review_lookup_result', action: 'escalate', reason: 'Result needs review.' }],
        }),
        createdAt: '2026-06-10T00:00:02.500Z',
      },
      {
        caseId: 'case-1',
        actionType: 'tool_result',
        title: 'Tool result stored as stale evidence: get_latest_deposit',
        payload: JSON.stringify({
          toolName: 'get_latest_deposit',
          output: { ok: true },
          evidenceState: 'stale',
          basedOnInputEpoch: 1,
        }),
        createdAt: '2026-06-10T00:00:03.000Z',
      },
      {
        caseId: 'case-1',
        actionType: 'loop_decision',
        title: 'ProcedureRun reconcile gate blocked Tool: finalize_procedure',
        payload: JSON.stringify({ runId: 'run-1', inputEpoch: 2 }),
        createdAt: '2026-06-10T00:00:03.500Z',
      },
      {
        caseId: 'case-1',
        actionType: 'provider_transcript_health',
        title: 'Provider transcript health',
        payload: JSON.stringify({
          providerTranscriptPersisted: false,
          providerTranscriptPresent: true,
          toolPairsChecked: 2,
          toolPairsRepaired: 1,
          orphanToolResultsDropped: 0,
          legacyRowsSkipped: 1,
          compactPairsSummarized: 0,
        }),
        createdAt: '2026-06-10T00:00:03.750Z',
      },
      {
        caseId: 'case-1',
        actionType: 'provider_transcript_persisted',
        title: 'Provider transcript persisted',
        payload: JSON.stringify({
          providerTranscriptPersisted: true,
          providerTranscriptMessageCount: 2,
          providerTranscriptBlockCount: 3,
        }),
        createdAt: '2026-06-10T00:00:03.900Z',
      },
    ]

    const evidence = buildRuntimeEvidence({
      events,
      rawTrace,
      finalResponse: 'I will ask a human specialist to review this safely.',
      chatId: 'chat-1',
      caseId: 'case-1',
      caseType: 'deposit_not_credited',
      traceId: 'trace-1',
    })

    expect(evidence.caseType).toBe('deposit_not_credited')
    expect(evidence.toolsCalled).toEqual(['kb_search_deposit', 'get_latest_deposit'])
    expect(evidence.toolResults?.some((result) => result.name === 'get_latest_deposit' && result.executionMode === 'mocked')).toBe(true)
    expect(evidence.knowledgeHits?.[0]).toMatchObject({
      source: 'deposit',
      toolName: 'kb_search_deposit',
      query: 'how to deposit',
      title: 'Deposit FAQ',
      documentId: 'doc-1',
    })
    expect(evidence.hookDecisions?.[0]).toMatchObject({ hookName: 'review_lookup_result', checkpoint: 'PostToolUse', decision: 'escalate' })
    expect(evidence.humanTransfer).toBe(true)
    expect(evidence.procedureStatus).toBeUndefined()
    expect(evidence.procedureOutcome).toBeUndefined()
    expect(evidence.runtime?.staleEvidence).toHaveLength(1)
    expect(evidence.runtime?.reconcileEvidence).toHaveLength(1)
    expect(evidence.runtime?.transition).toBe('waiting_human')
    expect(evidence.runtime?.transcriptHealth).toMatchObject({
      providerTranscriptPersisted: true,
      toolPairsChecked: 2,
      toolPairsRepaired: 1,
      orphanToolResultsDropped: 0,
      legacyRowsSkipped: 1,
      compactPairsSummarized: 0,
    })
  })

  it('captures knowledge-search hits for scenario receipts', () => {
    const events: SSEEvent[] = [
      { type: 'tool_result', data: { name: 'kb_search_deposit_faq', status: 'completed', result: { ok: true, output: { hits: [{ id: 'faq-1', title: 'Deposit FAQ' }] } } }, timestamp: '2026-06-10T00:00:02.000Z' },
      { type: 'message_stop', data: { reason: 'next_turn' }, timestamp: '2026-06-10T00:00:03.000Z' },
    ]

    const evidence = buildRuntimeEvidence({
      events,
      finalResponse: '',
      chatId: 'chat-knowledge',
      caseId: 'case-knowledge',
      caseType: 'deposit_not_credited',
      traceId: 'trace-knowledge',
    })

    expect(evidence.toolsCalled).toEqual(['kb_search_deposit_faq'])
    expect(evidence.knowledgeHits).toEqual([
      expect.objectContaining({
        source: 'deposit_faq',
        toolName: 'kb_search_deposit_faq',
        documentId: 'faq-1',
        title: 'Deposit FAQ',
      }),
    ])
    expect(evidence.runtime?.transition).toBe('next_turn')
  })

  it('keeps ProcedureRun runtime snapshots in the runtime receipt block', () => {
    const evidence = buildRuntimeEvidence({
      events: [{ type: 'message_stop', data: { reason: 'waiting_human' }, timestamp: '2026-06-10T00:00:03.000Z' }],
      finalResponse: 'I will hand this to a person.',
      chatId: 'chat-procedure',
      caseId: 'case-procedure',
      traceId: 'trace-procedure',
      procedureRuns: [
        {
          runId: 'run-1',
          procedureId: 'deposit_issue',
          displayName: 'Deposit',
          status: 'completed',
          outcome: 'handed_off',
          reason: 'Finalized after human handoff task task-1.',
          version: 'v2',
          updatedAt: '2026-06-10T00:00:02.000Z',
          currentStepId: null,
          blockers: [],
          inputs: [{ eventId: 'evt-1', inputEpoch: 1, source: 'customer_message', origin: 'customer', createdAt: '2026-06-10T00:00:00.000Z', content: 'Where is the deposit page?' }],
          branches: [{ stepId: 'triage', branchId: 'docs_only', kind: 'if', status: 'matched', reason: 'Observed create_human_task.' }],
          evaluations: [{ id: 'eval-1', branchId: 'docs_only', conditionId: 'docs_only_eval', label: 'documentation only', decision: 'matched', reason: 'The customer explicitly asked for a human.', basedOnInputEpoch: 1, createdAt: '2026-06-10T00:00:01.000Z' }],
          evidence: [{ id: 'handoff-1', kind: 'handoff', label: 'Human handoff requested', state: 'canonical', metadata: { outcome: 'succeeded' } }],
        },
      ],
    })

    expect(evidence.runtime?.procedureRuns?.[0]).toMatchObject({
      procedureId: 'deposit_issue',
      version: 'v2',
      status: 'completed',
      outcome: 'handed_off',
      reason: 'Finalized after human handoff task task-1.',
      currentStepId: null,
    })
    expect(evidence.procedureStatus).toBe('completed')
    expect(evidence.procedureOutcome).toBe('handed_off')
    expect(evidence.runtime?.procedureRuns?.[0]?.evaluations?.[0]).toMatchObject({
      decision: 'matched',
    })
  })

  it('returns a runtime-backed receipt through an injected executor', async () => {
    const receipt = await runScenarioAgentRuntime(scenario, {
      orgId: 'org-1',
      agentConfigId: 'agent-1',
      execute: async () => ({
        toolExecutionMode: 'mocked',
        evidence: {
          caseType: 'deposit_not_credited',
          toolsCalled: ['get_latest_deposit'],
          toolCalls: [{ name: 'get_latest_deposit', executionMode: 'mocked' }],
          toolResults: [{ name: 'get_latest_deposit', output: { _dryRun: true }, executionMode: 'mocked' }],
          hookDecisions: [{ hookName: 'review_lookup_result', checkpoint: 'PostToolUse', decision: 'escalate' }],
          humanTransfer: true,
          handoff: [{ required: true, target: 'human' }],
          finalResponse: 'A human specialist will review this safely.',
          finalStatus: 'waiting_human',
          procedureStatus: 'completed',
          procedureOutcome: 'handed_off',
          runtime: {
            procedureRuns: [{
              runId: 'run-1',
              procedureId: 'deposit_issue',
              displayName: 'Deposit',
              status: 'completed',
              outcome: 'handed_off',
              version: 'v2',
              currentStepId: 'handoff',
              blockers: [],
              inputs: [],
              branches: [],
              evaluations: [],
              evidence: [],
            }],
          },
        },
      }),
    })

    expect(receipt.executionMode).toBe('agentRuntime')
    expect(receipt.status).toBe('pass')
    expect(receipt.evidence.caseType).toBe('deposit_not_credited')
    expect(receipt.evidence.runtime?.procedureRuns?.[0]?.procedureId).toBe('deposit_issue')
    expect(receipt.failureReasons).toEqual([])
  })

  it('derives runtime receipt truth from structured Playground trace metadata instead of hardcoding mocked', async () => {
    vi.mocked(runPlaygroundTurn).mockImplementationOnce(async function* () {
      yield {
        type: 'session_init',
        data: { chatId: 'chat-runtime', caseId: 'case-runtime' },
        timestamp: '2026-06-10T00:00:00.000Z',
      }
      yield {
        type: 'tool_executing',
        data: { name: 'faq_lookup_default', input: { query: 'deposit help' } },
        timestamp: '2026-06-10T00:00:00.500Z',
      }
      yield {
        type: 'trace',
        data: {
          turnId: 'trace-runtime',
          caseType: 'deposit_not_credited',
          reply: 'Here is the deposit help article.',
          blocked: false,
          trace: [
            {
              stage: 'Knowledge retrieval',
              source: 'knowledge',
              status: 'info',
              fired: true,
              ms: 50,
              summary: 'Tool: faq_lookup_default',
              detail: [['tool_call', 'faq_lookup_default']],
              runtimeTruth: {
                model: 'deepseek-v4-flash',
                imageSupport: {
                  status: 'unsupported',
                  label: 'Unsupported',
                  source: 'configured_model_registry',
                },
                executionSurface: {
                  mode: 'runtime_only',
                  label: 'Runtime-backed surface',
                },
                toolSummary: {
                  mockedDryRun: 0,
                  runtimeBacked: 1,
                  runtimeManaged: 0,
                  staticFixture: 0,
                  unknown: 0,
                },
                warnings: [],
              },
            },
          ],
          rawTrace: [
            {
              caseId: 'case-runtime',
              actionType: 'tool_call',
              title: 'Tool called: faq_lookup_default',
              payload: JSON.stringify({
                toolName: 'faq_lookup_default',
                input: { query: 'deposit help' },
                knowledgeSourceId: 'ks_faq',
                knowledgeSourceName: 'FAQ',
                executionTruth: {
                  effectiveMode: 'runtime_backed',
                  label: 'Runtime-backed knowledge tool',
                  dryRun: false,
                  definitionMode: 'http',
                  toolCategory: 'system_info',
                },
              }),
              createdAt: '2026-06-10T00:00:00.600Z',
            },
            {
              caseId: 'case-runtime',
              actionType: 'tool_result',
              title: 'Tool: faq_lookup_default',
              payload: JSON.stringify({
                toolName: 'faq_lookup_default',
                input: { query: 'deposit help' },
                output: { hits: [{ id: 'faq-1', title: 'Deposit FAQ' }] },
                knowledgeSourceId: 'ks_faq',
                knowledgeSourceName: 'FAQ',
                executionTruth: {
                  effectiveMode: 'runtime_backed',
                  label: 'Runtime-backed knowledge tool',
                  dryRun: false,
                  definitionMode: 'http',
                  toolCategory: 'system_info',
                },
              }),
              createdAt: '2026-06-10T00:00:01.000Z',
            },
          ],
          resolvedModel: 'deepseek-v4-flash',
          applicableStages: ['Knowledge retrieval', 'Model generation'],
          totalMs: 100,
        },
        timestamp: '2026-06-10T00:00:01.100Z',
      }
      yield {
        type: 'message_stop',
        data: { reason: 'next_turn' },
        timestamp: '2026-06-10T00:00:01.200Z',
      }
    })

    const receipt = await runScenarioAgentRuntime(scenario, {
      orgId: 'org-1',
      agentConfigId: 'agent-1',
    })

    expect(receipt.toolExecutionMode).toBe('runtime')
    expect(receipt.evidence.toolCalls?.some((call) =>
      call.name === 'faq_lookup_default'
      && call.executionMode === 'runtime'
      && (call as Record<string, unknown>).knowledgeSourceId === 'ks_faq'
    )).toBe(true)
    expect(receipt.evidence.knowledgeHits?.[0]).toMatchObject({
      source: 'FAQ',
      toolName: 'faq_lookup_default',
      title: 'Deposit FAQ',
    })
  })
})

describe('Scenario form submissions', () => {
  it('parses Playground-style form submission turns into structured answers', () => {
    expect(parseScenarioFormSubmission([
      '[Form submission]',
      'member_id: JAYA113C88F',
      'amount：500',
      'payment_channel: bank transfer',
    ].join('\n'))).toEqual({
      answers: {
        member_id: 'JAYA113C88F',
        amount: '500',
        payment_channel: 'bank transfer',
      },
    })
  })

  it('ignores ordinary customer text', () => {
    expect(parseScenarioFormSubmission('member_id 是 JAYA113C88F')).toBeUndefined()
  })
})
