import { mkdir, writeFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { runScenarioAgentRuntime } from '../runtime-runner'
import {
  closeSession,
  getPendingProcedureLlmEvaluations,
  getProcedureRuntime,
  getRuntimeEvents,
  recordInitialInputEvent,
  recordProcedureConditionEvaluation,
  recordProcedureToolCall,
  recordProcedureToolResult,
  startProcedureRun,
} from '@/lib/agent/session-store'
import type { SavedScenario, ScenarioObservedEvidenceInput } from '@intera/shared/contracts/scenarios'

const artifactDir = '.artifacts/delivery-audit/2026-06-12/procedure-v2-worktree'
const receiptPath = `${artifactDir}/procedure-v2-runtime-receipt.json`
const summaryPath = `${artifactDir}/procedure-v2-runtime-receipt.md`

function snapshotProcedureRuns(
  caseId: string,
): NonNullable<NonNullable<ScenarioObservedEvidenceInput['runtime']>['procedureRuns']> {
  const runtime = getProcedureRuntime(caseId)
  const runs = [
    ...(runtime.activeProcedureRun ? [runtime.activeProcedureRun] : []),
    ...runtime.pausedProcedureRuns,
    ...runtime.completedProcedureRuns,
  ]
  return runs.map((run) => ({
    runId: run.runId,
    procedureId: run.procedureId,
    displayName: run.displayName,
    status: run.status,
    outcome: run.outcome ?? undefined,
    reason: run.reason,
    version: 'v2',
    updatedAt: run.updatedAt,
    currentStepId: run.currentStepId,
    blockers: [...run.blockers],
    inputs: run.inputs.map((entry) => ({ ...entry })),
    branches: run.steps.flatMap((step) =>
      (step.branches ?? []).map((branch) => ({
        stepId: step.id,
        branchId: branch.id,
        kind: branch.kind,
        label: branch.label,
        conditionLabel: branch.conditionLabel,
        status: branch.status,
        reason: branch.reason,
      })),
    ),
    evaluations: run.evaluations.map((entry) => ({ ...entry })),
    evidence: run.evidence.map((entry) => ({ ...entry })),
  }))
}

describe('Procedure v2 runtime artifact receipt', () => {
  it('writes a scenario receipt with runtime proof details', async () => {
    const caseId = 'artifact-procedure-v2-runtime-proof'
    const scenario: SavedScenario = {
      id: 'scenario_procedure_v2_runtime_proof',
      agentConfigId: 'agent_procedure_v2',
      name: 'procedure_v2_runtime_proof',
      displayName: 'Procedure v2 runtime proof',
      tags: ['procedure-v2', 'runtime-proof'],
      enabled: true,
      turns: [
        { role: 'user', content: 'Where do I find the deposit receipt page?' },
        { role: 'user', content: 'That did not help. Please connect me to a human specialist.' },
      ],
      expected: {
        toolsCalled: ['kb_search_deposit_faq', 'create_human_task'],
        humanTransfer: true,
        finalStatus: 'waiting_human',
        procedureStatus: 'completed',
        procedureOutcome: 'handed_off',
        requiredPhrases: ['human specialist'],
      },
      createdAt: '2026-06-12T00:00:00.000Z',
      updatedAt: '2026-06-12T00:00:00.000Z',
    }

    closeSession(caseId)

    const receipt = await runScenarioAgentRuntime(scenario, {
      orgId: 'artifact-org',
      agentConfigId: 'artifact-agent',
      execute: async () => {
        recordInitialInputEvent(caseId, {
          content: scenario.turns[0].content,
          source: 'customer_message',
          origin: 'customer',
        })

        const started = startProcedureRun(caseId, {
          procedureId: 'deposit_issue',
          displayName: 'Deposit issue',
          procedure: {
            version: 'v2',
            whenToUse: 'Use when the customer needs deposit guidance or a human handoff.',
            overview: 'Try knowledge, then hand off safely if it still does not unblock the customer.',
            steps: [
              {
                id: 'guide_or_handoff',
                title: 'Guide the customer or hand off safely',
                guidance: 'Search knowledge first, then hand off if the customer still needs a person.',
                actions: [],
                branches: [
                  {
                    id: 'handoff_after_failed_docs_or_explicit_request',
                    kind: 'if',
                    condition: {
                      id: 'handoff_eval',
                      kind: 'llm_eval',
                      prompt: 'Given the latest customer message and recent runtime evidence, should the case now be handed to a human because the customer explicitly asks for a person or the documentation lookup failed to answer them?',
                    },
                    actions: [
                      {
                        id: 'search_docs',
                        kind: 'search_knowledge',
                        label: 'Search deposit FAQ',
                        suggestedSources: ['deposit_faq'],
                        required: false,
                      },
                      {
                        id: 'request_handoff',
                        kind: 'request_human_handoff',
                        label: 'Request human help',
                        queue: 'general',
                      },
                    ],
                  },
                  {
                    id: 'finish_without_handoff',
                    kind: 'else',
                    actions: [
                      {
                        id: 'end_step',
                        kind: 'end',
                        label: 'End with guidance',
                        status: 'completed',
                      },
                    ],
                  },
                ],
              },
            ],
          },
          requestId: 'artifact-start',
        })

        const firstEval = getPendingProcedureLlmEvaluations(caseId)[0]
        recordProcedureConditionEvaluation(caseId, {
          runId: started.run.runId,
          branchId: firstEval.branchId,
          conditionId: firstEval.conditionId,
          label: firstEval.branchLabel || firstEval.branchId,
          decision: 'pending',
          reason: 'Need to see whether the FAQ lookup answers the customer or whether the customer escalates to a human request.',
          basedOnInputEpoch: 1,
          model: 'artifact-injected-evaluator',
          metadata: { mode: 'injected-proof' },
        })

        recordProcedureToolCall(caseId, {
          toolName: 'kb_search_deposit_faq',
          toolUseId: 'kb-1',
          basedOnInputEpoch: 1,
          toolInput: { query: 'deposit receipt page' },
        })
        recordProcedureToolResult(caseId, {
          toolName: 'kb_search_deposit_faq',
          toolUseId: 'kb-1',
          basedOnInputEpoch: 1,
          toolOutput: { hits: [] },
        })

        recordInitialInputEvent(caseId, {
          content: scenario.turns[1].content,
          source: 'customer_message',
          origin: 'customer',
        })

        const secondEval = getPendingProcedureLlmEvaluations(caseId)[0]
        recordProcedureConditionEvaluation(caseId, {
          runId: started.run.runId,
          branchId: secondEval.branchId,
          conditionId: secondEval.conditionId,
          label: secondEval.branchLabel || secondEval.branchId,
          decision: 'matched',
          reason: 'The latest customer message explicitly asks for a human specialist, and the earlier FAQ lookup returned no usable answer.',
          basedOnInputEpoch: 2,
          model: 'artifact-injected-evaluator',
          metadata: { mode: 'injected-proof' },
        })

        recordProcedureToolCall(caseId, {
          toolName: 'create_human_task',
          toolUseId: 'handoff-1',
          basedOnInputEpoch: 2,
          toolInput: { queue: 'general', question: 'Please help this customer with the deposit receipt page.' },
        })
        recordProcedureToolResult(caseId, {
          toolName: 'create_human_task',
          toolUseId: 'handoff-1',
          basedOnInputEpoch: 2,
          toolOutput: { taskId: 'task-artifact-1', queue: 'general', status: 'pending', persisted: true },
        })

        return {
          evidence: {
            caseType: 'deposit_issue',
            toolsCalled: ['kb_search_deposit_faq', 'create_human_task'],
            toolCalls: [
              { name: 'kb_search_deposit_faq', input: { query: 'deposit receipt page' }, toolUseId: 'kb-1', executionMode: 'mocked', at: '2026-06-12T00:00:01.000Z' },
              { name: 'create_human_task', input: { queue: 'general' }, toolUseId: 'handoff-1', executionMode: 'mocked', at: '2026-06-12T00:00:04.000Z' },
            ],
            toolResults: [
              { name: 'kb_search_deposit_faq', output: { hits: [] }, toolUseId: 'kb-1', executionMode: 'mocked', at: '2026-06-12T00:00:02.000Z' },
              { name: 'create_human_task', output: { taskId: 'task-artifact-1', queue: 'general', status: 'pending', persisted: true }, toolUseId: 'handoff-1', executionMode: 'mocked', at: '2026-06-12T00:00:05.000Z' },
            ],
            knowledgeHits: [],
            humanTransfer: true,
            handoff: [
              {
                required: true,
                queue: 'general',
                reason: 'FAQ lookup produced no usable result and the customer explicitly requested a human specialist.',
                target: 'human',
                payload: { taskId: 'task-artifact-1', persisted: true },
              },
            ],
            finalResponse: 'I am handing this to a human specialist because the FAQ lookup did not answer your request.',
            finalStatus: 'waiting_human',
            procedureStatus: 'completed',
            procedureOutcome: 'handed_off',
            traceId: 'artifact-procedure-v2-runtime-proof',
            runtime: {
              sessionId: caseId,
              caseId,
              transition: 'waiting_human',
              staleEvidence: [],
              reconcileEvidence: [],
              procedureRuns: snapshotProcedureRuns(caseId),
              eventsObserved: getRuntimeEvents(caseId).length,
            },
          },
          toolExecutionMode: 'mocked',
          traceId: 'artifact-procedure-v2-runtime-proof',
        }
      },
    })

    const runtimeRun = receipt.evidence.runtime?.procedureRuns?.[0]
    await mkdir(artifactDir, { recursive: true })
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`)
    await writeFile(
      summaryPath,
      [
        '# Procedure v2 runtime receipt',
        '',
        '- Scenario runner: `runScenarioAgentRuntime` with injected runtime executor',
        '- Execution mode: `agentRuntime`',
        '- Tool execution mode: `mocked`',
        '- Provider proof: `injected only`',
        `- Outcome: \`${receipt.status}\``,
        `- Final status: \`${receipt.evidence.finalStatus || 'unknown'}\``,
        `- ProcedureRun status: \`${runtimeRun?.status || 'unknown'}\``,
        `- ProcedureRun outcome: \`${runtimeRun?.outcome || receipt.evidence.procedureOutcome || 'unknown'}\``,
        `- ProcedureRun reason: \`${runtimeRun?.reason || 'none'}\``,
        '',
        'This proof validates the runtime control plane for Procedure v2: structured inputs, llm_eval receipts, empty knowledge-result fallback, and persisted human handoff evidence.',
        'It does not claim that external tool connectors or a live llm_eval provider were run in this receipt.',
      ].join('\n'),
    )

    closeSession(caseId)

    expect(receipt.status).toBe('pass')
    expect(runtimeRun).toMatchObject({
      procedureId: 'deposit_issue',
      status: 'completed',
      outcome: 'handed_off',
      reason: 'Finalized after human handoff task task-artifact-1.',
      currentStepId: null,
      blockers: [],
    })
    expect(runtimeRun?.evaluations).toHaveLength(2)
    expect(runtimeRun?.branches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          branchId: 'handoff_after_failed_docs_or_explicit_request',
          status: 'matched',
        }),
        expect.objectContaining({
          branchId: 'finish_without_handoff',
          status: 'skipped',
          reason: 'Another branch already matched.',
        }),
      ]),
    )
    expect(runtimeRun?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'kb-1',
          metadata: expect.objectContaining({ outcome: 'empty_result' }),
        }),
        expect.objectContaining({
          id: 'handoff-1',
          metadata: expect.objectContaining({
            outcome: 'succeeded',
            output: expect.objectContaining({ persisted: true }),
          }),
        }),
      ]),
    )
    expect(receipt.evidence.handoff).toEqual([
      expect.objectContaining({
        target: 'human',
        payload: expect.objectContaining({ persisted: true }),
      }),
    ])
    expect(
      receipt.evidence.toolResults?.filter((result) =>
        result.name === 'create_human_task' &&
        !!(result.output as Record<string, unknown> | undefined)?.persisted,
      ),
    ).toEqual([
      expect.objectContaining({
        name: 'create_human_task',
        output: expect.objectContaining({ persisted: true }),
      }),
    ])
  })
})
