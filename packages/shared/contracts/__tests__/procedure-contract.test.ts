import { describe, it, expect } from 'vitest'
import {
  PROCEDURE_ACTIONS,
  procedureActionSchema,
  procedureStepSchema,
  procedureSchema,
  parseProcedure,
} from '../case-types'

// Procedure contract guards: ordered steps with a closed action vocabulary.

describe('Procedure contract (Phase 1)', () => {
  it('exposes the closed action vocabulary', () => {
    expect([...PROCEDURE_ACTIONS].sort()).toEqual(
      ['ask', 'decide', 'escalate', 'finalize', 'read', 'tag', 'use'],
    )
    expect(procedureActionSchema.safeParse('use').success).toBe(true)
  })

  it('round-trips a valid procedure', () => {
    const proc = {
      steps: [
        { id: 'ask_member', action: 'ask', target: 'member_id', required: true },
        {
          id: 'check_deposit',
          action: 'use',
          target: 'get_latest_deposit',
          guidance: 'Look up the latest deposit',
          when: 'only if balance unchanged',
          required: true,
        },
        { id: 'close', action: 'finalize', target: 'resolved' },
      ],
    }
    const parsed = procedureSchema.parse(proc)
    expect(parsed.steps).toHaveLength(3)
    expect(parsed.steps[1]).toEqual({
      id: 'check_deposit',
      action: 'use',
      target: 'get_latest_deposit',
      guidance: 'Look up the latest deposit',
      when: 'only if balance unchanged',
      required: true,
    })
  })

  it('rejects an unknown action', () => {
    expect(procedureStepSchema.safeParse({ id: 's1', action: 'frobnicate' }).success).toBe(false)
  })

  it('rejects a step missing id', () => {
    expect(procedureStepSchema.safeParse({ action: 'use', target: 'get_latest_deposit' }).success).toBe(false)
  })

  it('rejects an empty-string id', () => {
    expect(procedureStepSchema.safeParse({ id: '', action: 'use' }).success).toBe(false)
  })
})

describe('parseProcedure (safe runtime parse)', () => {
  it('parses a JSON procedure string', () => {
    const p = parseProcedure('{"steps":[{"id":"a","action":"finalize"}]}')
    expect(p?.steps[0]).toEqual({ id: 'a', action: 'finalize' })
  })

  it('returns null for null / empty / malformed JSON', () => {
    expect(parseProcedure(null)).toBeNull()
    expect(parseProcedure(undefined)).toBeNull()
    expect(parseProcedure('')).toBeNull()
    expect(parseProcedure('{not json')).toBeNull()
  })

  it('returns null when the shape is invalid (unknown action)', () => {
    expect(parseProcedure('{"steps":[{"id":"a","action":"nope"}]}')).toBeNull()
  })
})
