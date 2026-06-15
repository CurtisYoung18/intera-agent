import { describe, expect, it } from 'vitest'
import {
  extractProcedureBlockers,
  summarizeProcedureMetrics,
  type ProcedureMetricsRunInput,
} from '../procedure-metrics'

const NOW = new Date('2026-06-12T12:00:00.000Z')

function run(overrides: Partial<ProcedureMetricsRunInput>): ProcedureMetricsRunInput {
  return {
    id: 'run-1',
    caseId: 'case-1',
    chatId: 'chat-1',
    procedureId: 'deposit_missing',
    status: 'completed',
    outcome: 'resolved_by_agent',
    inputEpoch: 2,
    state: {
      blockers: [],
      inputs: [
        { origin: 'customer', content: 'hello' },
        { origin: 'agent', content: 'hi' },
        { origin: 'customer', content: 'deposit missing' },
      ],
    },
    createdAt: '2026-06-12T10:00:00.000Z',
    updatedAt: '2026-06-12T10:05:00.000Z',
    ...overrides,
  }
}

describe('procedure metrics', () => {
  it('summarizes outcome buckets, rates, blockers, and terminal turn counts per procedure', () => {
    const summary = summarizeProcedureMetrics([
      run({
        id: 'deposit-resolved',
        outcome: 'resolved_by_agent',
        updatedAt: '2026-06-12T10:10:00.000Z',
      }),
      run({
        id: 'deposit-handoff',
        outcome: 'handed_off',
        inputEpoch: 3,
        updatedAt: '2026-06-12T10:20:00.000Z',
        state: {
          blockers: ['manual review needed'],
          inputs: [
            { role: 'user', content: 'need person' },
            { role: 'assistant', content: 'checking' },
            { role: 'user', content: 'still stuck' },
            { role: 'user', content: 'human please' },
          ],
        },
      }),
      run({
        id: 'deposit-active',
        status: 'paused',
        outcome: null,
        currentStepId: 'collect_receipt',
        updatedAt: '2026-06-12T10:30:00.000Z',
        state: {
          blockers: ['awaiting receipt'],
          inputs: [{ origin: 'customer', content: 'I will upload later' }],
        },
      }),
      run({
        id: 'deposit-legacy-terminal',
        status: 'completed',
        outcome: null,
        inputEpoch: 5,
        updatedAt: '2026-06-12T10:40:00.000Z',
        state: { blockers: ['legacy missing outcome'] },
      }),
      run({
        id: 'withdrawal-abandoned',
        procedureId: 'withdrawal_failed',
        status: 'cancelled',
        outcome: null,
        inputEpoch: 1,
        updatedAt: '2026-06-12T11:00:00.000Z',
        state: {
          blockers: ['missing txid'],
          timeline: [
            { metadata: { blockers: ['missing txid', 'kyc expired'] } },
          ],
        },
      }),
    ], NOW)

    expect(summary.totalRuns).toBe(5)
    expect(summary.resolvedByAgent).toBe(1)
    expect(summary.handedOff).toBe(1)
    expect(summary.abandoned).toBe(1)
    expect(summary.active).toBe(1)
    expect(summary.unknownTerminal).toBe(1)
    expect(summary.handoffRate).toBeCloseTo(0.2)
    expect(summary.latestActivityAt).toBe('2026-06-12T11:00:00.000Z')
    expect(summary.generatedAt).toBe(NOW.toISOString())

    const deposit = summary.rows.find((row) => row.procedureId === 'deposit_missing')
    expect(deposit).toMatchObject({
      runs: 4,
      resolvedByAgent: 1,
      handedOff: 1,
      abandoned: 0,
      active: 1,
      unknownTerminal: 1,
      resolutionRate: 0.25,
      handoffRate: 0.25,
      abandonmentRate: 0,
      medianTurnsToTerminal: 3,
      topBlockers: [
        { label: 'awaiting receipt', count: 1 },
        { label: 'legacy missing outcome', count: 1 },
        { label: 'manual review needed', count: 1 },
      ],
    })
    expect(deposit?.recentRuns[0]).toMatchObject({
      id: 'deposit-legacy-terminal',
      outcome: null,
      blockers: ['legacy missing outcome'],
      turnsToTerminal: 5,
    })

    const withdrawal = summary.rows.find((row) => row.procedureId === 'withdrawal_failed')
    expect(withdrawal).toMatchObject({
      runs: 1,
      abandoned: 1,
      abandonmentRate: 1,
      medianTurnsToTerminal: 1,
      topBlockers: [
        { label: 'kyc expired', count: 1 },
        { label: 'missing txid', count: 1 },
      ],
    })
  })

  it('extracts blockers from state and timeline metadata without duplicates inside one run', () => {
    expect(extractProcedureBlockers({
      blockers: ['a', 'b', 'a'],
      timeline: [
        { metadata: { blockers: ['b', 'c'] } },
        { blockers: ['d'] },
      ],
    })).toEqual(['a', 'b', 'c', 'd'])
  })

  it('counts every run even when the recent-run preview is capped', () => {
    const runs = Array.from({ length: 12 }, (_, index) => run({
      id: `run-${index}`,
      outcome: index % 2 === 0 ? 'resolved_by_agent' : 'handed_off',
      updatedAt: `2026-06-12T10:${String(index).padStart(2, '0')}:00.000Z`,
    }))

    const summary = summarizeProcedureMetrics(runs, NOW)
    const row = summary.rows[0]

    expect(row.runs).toBe(12)
    expect(row.resolvedByAgent).toBe(6)
    expect(row.handedOff).toBe(6)
    expect(row.recentRuns).toHaveLength(8)
  })

  it('counts legacy human_handoff outcomes as real handoffs', () => {
    const summary = summarizeProcedureMetrics([
      run({
        id: 'legacy-human-handoff',
        status: 'completed',
        outcome: 'human_handoff',
        updatedAt: '2026-06-12T10:10:00.000Z',
      }),
    ], NOW)

    expect(summary.handedOff).toBe(1)
    expect(summary.unknownTerminal).toBe(0)
    expect(summary.handoffRate).toBe(1)
    expect(summary.rows[0]).toMatchObject({
      handedOff: 1,
      unknownTerminal: 0,
      handoffRate: 1,
    })
  })
})
