import { describe, it, expect } from 'vitest'
import {
  ProcedureExecutor,
  renderProcedureSteps,
  seedProcedureTodos,
  requiredToolTargets,
  isProcedureComplete,
} from '../../procedure-executor'
import type { Procedure } from '@intera/shared/types'

// Procedure refactor — Phase 2. ProcedureExecutor is the structured-SOP runtime:
// it renders the ordered steps into the case-mode prompt, seeds todos, and gates
// completion on the required steps + finalize. Pure helpers are deterministically
// unit-tested here; the integrated agent behaviour is verified end-to-end on prod.

const proc: Procedure = {
  steps: [
    { id: 'ask_member', action: 'ask', target: 'member_id', guidance: 'Confirm the member ID', required: true },
    { id: 'check_deposit', action: 'use', target: 'get_latest_deposit', guidance: 'Look up the latest deposit', required: true },
    { id: 'maybe_kyc', action: 'use', target: 'get_kyc_status', when: 'only if the account is flagged', required: true },
    { id: 'close', action: 'finalize', target: 'resolved' },
  ],
}

describe('renderProcedureSteps', () => {
  it('renders steps in order with targets, guidance and when-conditions', () => {
    const out = renderProcedureSteps(proc)
    expect(out.indexOf('1.')).toBeGreaterThanOrEqual(0)
    expect(out.indexOf('1.')).toBeLessThan(out.indexOf('2.'))
    expect(out.indexOf('2.')).toBeLessThan(out.indexOf('3.'))
    expect(out).toContain('get_latest_deposit')
    expect(out).toContain('Look up the latest deposit')
    expect(out).toContain('only if the account is flagged')
  })

  it('handles an empty procedure', () => {
    expect(renderProcedureSteps({ steps: [] })).toContain('no steps')
  })
})

describe('seedProcedureTodos', () => {
  it('maps every step to a pending todo, preserving ids and order', () => {
    const todos = seedProcedureTodos(proc)
    expect(todos.map((t) => t.id)).toEqual(['ask_member', 'check_deposit', 'maybe_kyc', 'close'])
    expect(todos.every((t) => t.status === 'pending' && t.addedBy === 'sop_init')).toBe(true)
    expect(todos.every((t) => typeof t.addedAt === 'string' && t.addedAt.length > 0)).toBe(true)
  })
})

describe('requiredToolTargets', () => {
  it('returns required use/read targets that have no when-condition', () => {
    // check_deposit (required, use) → included; maybe_kyc (required but when-gated) → excluded;
    // ask + finalize → excluded (not use/read).
    expect(requiredToolTargets(proc)).toEqual(['get_latest_deposit'])
  })
})

describe('isProcedureComplete', () => {
  it('is blocked until every required tool ran AND finalize is reached', () => {
    expect(isProcedureComplete(proc, { calledTools: [], finalized: false })).toBe(false)
    expect(isProcedureComplete(proc, { calledTools: ['get_latest_deposit'], finalized: false })).toBe(false)
    expect(isProcedureComplete(proc, { calledTools: [], finalized: true })).toBe(false)
    expect(isProcedureComplete(proc, { calledTools: ['get_latest_deposit'], finalized: true })).toBe(true)
  })

  it('does not require a when-gated step to have run (skipped without a nudge)', () => {
    // get_kyc_status (when-gated) is NOT called, yet the case completes.
    expect(isProcedureComplete(proc, { calledTools: ['get_latest_deposit'], finalized: true })).toBe(true)
  })
})

describe('ProcedureExecutor', () => {
  it('buildPrompt embeds the ordered steps, the case type, and the base prompt', () => {
    const ex = new ProcedureExecutor(proc, 'deposit_issue')
    const prompt = ex.buildPrompt('BASE_PROMPT', 'investigating', [], {})
    expect(prompt).toContain('deposit_issue')
    expect(prompt).toContain('get_latest_deposit')
    expect(prompt).toContain('BASE_PROMPT')
  })

  it('requiredTools + isComplete delegate to the pure helpers', () => {
    const ex = new ProcedureExecutor(proc, 'deposit_issue')
    expect(ex.requiredTools()).toEqual(['get_latest_deposit'])
    expect(ex.isComplete({ calledTools: ['get_latest_deposit'], finalized: true })).toBe(true)
    expect(ex.isComplete({ calledTools: [], finalized: true })).toBe(false)
  })
})
