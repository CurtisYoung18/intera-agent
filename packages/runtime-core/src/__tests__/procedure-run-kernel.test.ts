import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  applyProcedureRunEvent,
  type ProcedureRunKernelState,
} from '../procedure-run-kernel'

const NOW = '2026-06-12T10:00:00.000Z'

function createRun(overrides: Partial<ProcedureRunKernelState> = {}): ProcedureRunKernelState {
  return {
    runId: 'run-1',
    status: 'active',
    inputEpoch: 7,
    currentStepId: 'step-handoff',
    updatedAt: '2026-06-12T09:00:00.000Z',
    blockers: [
      '[action:handoff] Waiting for human handoff persistence.',
      '[action:explain] Branch is still unresolved.',
    ],
    steps: [
      {
        id: 'step-handoff',
        status: 'active',
        evidenceToolCallIds: ['ev-handoff'],
        actions: [
          {
            id: 'collect',
            kind: 'ask',
            label: 'Collect issue',
            status: 'completed',
            evidenceIds: ['ev-form'],
          },
          {
            id: 'handoff',
            kind: 'request_human_handoff',
            label: 'Request human help',
            branchId: 'branch-human',
            status: 'active',
            evidenceIds: ['ev-handoff'],
          },
          {
            id: 'explain',
            kind: 'text_reply',
            label: 'Explain self-serve option',
            branchId: 'branch-self-serve',
            status: 'active',
            evidenceIds: [],
          },
        ],
        branches: [
          {
            id: 'branch-self-serve',
            kind: 'if',
            status: 'matched',
            actionIds: ['explain'],
          },
          {
            id: 'branch-human',
            kind: 'else_if',
            status: 'pending',
            actionIds: ['handoff'],
          },
        ],
      },
    ],
    ...overrides,
  }
}

describe('procedure-run-kernel', () => {
  it('finalizes persisted human handoff as a terminal completed run', () => {
    const original = createRun()
    const result = applyProcedureRunEvent(original, {
      type: 'human_handoff_finalized',
      taskId: 'task-123',
      queue: 'vip',
      match: { stepId: 'step-handoff', actionId: 'handoff' },
    }, {
      now: NOW,
    })

    expect(result.state).not.toBe(original)
    expect(original.status).toBe('active')
    expect(result.state.status).toBe('completed')
    expect(result.state.currentStepId).toBeNull()
    expect(result.state.outcome).toBe('handed_off')
    expect(result.state.reason).toBe('Finalized after human handoff task task-123.')
    expect(result.state.blockers).toEqual([])
    expect(result.state.updatedAt).toBe(NOW)

    const step = result.state.steps[0]
    expect(step.status).toBe('completed')
    expect(step.completedAt).toBe(NOW)
    expect(step.completionReason).toBe('Persisted human handoff task task-123 created.')
    expect(step.actions?.map((action) => [action.id, action.status])).toEqual([
      ['collect', 'completed'],
      ['handoff', 'completed'],
      ['explain', 'skipped'],
    ])
    expect(step.branches?.map((branch) => [branch.id, branch.status, branch.reason])).toEqual([
      ['branch-self-serve', 'skipped', 'Another branch already matched.'],
      ['branch-human', 'matched', 'Persisted human handoff evidence observed.'],
    ])

    expect(result.effects).toEqual([
      {
        type: 'timeline',
        origin: 'system',
        source: 'control',
        basedOnInputEpoch: 7,
        summary: 'ProcedureRun finalized after human handoff task task-123',
        metadata: {
          terminal: true,
          handoffFinalized: true,
          taskId: 'task-123',
          queue: 'vip',
          persisted: true,
          outcome: 'handed_off',
        },
      },
      {
        type: 'completed_run',
        runId: 'run-1',
        status: 'completed',
        outcome: 'handed_off',
      },
    ])
  })

  it('emits a terminal effect for normal finalize events', () => {
    const result = applyProcedureRunEvent(createRun(), {
      type: 'finalize',
      status: 'cancelled',
      basedOnInputEpoch: 8,
      summary: 'Procedure cancelled by operator',
    }, {
      now: NOW,
    })

    expect(result.state.status).toBe('cancelled')
    expect(result.state.updatedAt).toBe(NOW)
    expect(result.effects).toContainEqual({
      type: 'timeline',
      origin: 'system',
      source: 'tool_result',
      basedOnInputEpoch: 8,
      summary: 'Procedure cancelled by operator',
      metadata: { terminal: true, evidenceState: 'canonical' },
    })
    expect(result.effects).toContainEqual({
      type: 'completed_run',
      runId: 'run-1',
      status: 'cancelled',
    })
  })

  it('does not advance terminal state for stale finalize events', () => {
    for (const currentEpoch of [1, 2, 7, 42]) {
      for (const staleEpoch of Array.from({ length: currentEpoch }, (_, index) => index)) {
        const original = createRun({ inputEpoch: currentEpoch })
        const result = applyProcedureRunEvent(original, {
          type: 'finalize',
          status: 'completed',
          basedOnInputEpoch: staleEpoch,
          summary: 'Stale finalize attempt',
        }, {
          now: NOW,
        })

        expect(result.state).toEqual(original)
        expect(result.effects).toEqual([
          {
            type: 'timeline',
            origin: 'system',
            source: 'tool_result',
            basedOnInputEpoch: staleEpoch,
            summary: `Ignored stale finalize event based on inputEpoch ${staleEpoch}; current inputEpoch is ${currentEpoch}.`,
            metadata: {
              terminal: true,
              evidenceState: 'stale',
              blocked: true,
              currentInputEpoch: currentEpoch,
            },
          },
        ])
      }
    }
  })

  it('stays free of adapter-only runtime side effects', () => {
    const source = readFileSync(new URL('../procedure-run-kernel.ts', import.meta.url), 'utf8')

    expect(source).not.toMatch(/@intera\/shared\/prisma/)
    expect(source).not.toMatch(/\bfetch\(/)
    expect(source).not.toMatch(/\bDate\.now\b/)
    expect(source).not.toMatch(/\bnew Date\b/)
  })
})
