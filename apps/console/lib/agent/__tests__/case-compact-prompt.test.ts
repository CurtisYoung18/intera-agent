import { describe, it, expect } from 'vitest'
import { CASE_COMPACT_PROMPT } from '../case-compact-prompt'

describe('CASE_COMPACT_PROMPT', () => {
  it('contains confirmed facts as a required output section', () => {
    expect(CASE_COMPACT_PROMPT.toLowerCase()).toMatch(/confirmed facts/)
  })

  it('contains tool as a required output section', () => {
    expect(CASE_COMPACT_PROMPT.toLowerCase()).toMatch(/tools? run/)
  })

  it('contains open items as a required output section', () => {
    expect(CASE_COMPACT_PROMPT.toLowerCase()).toMatch(/open items?/)
  })

  it('contains verbatim as a signal for preserving recent messages', () => {
    expect(CASE_COMPACT_PROMPT.toLowerCase()).toMatch(/verbatim/)
  })

  it('does NOT contain portrait framing as an instruction', () => {
    // The prompt may mention "portrait" in negated context (e.g. "NOT a user portrait"),
    // but it must not instruct the model to produce a portrait.
    expect(CASE_COMPACT_PROMPT).not.toMatch(/summarize.*as a user portrait/i)
  })

  it('instructs the model NOT to describe who the user is', () => {
    // The prompt must explicitly forbid describing the user's identity traits.
    expect(CASE_COMPACT_PROMPT).toMatch(/do NOT describe/i)
    expect(CASE_COMPACT_PROMPT).toMatch(/user.*as a person/i)
  })

  it('explicitly forbids user identity description', () => {
    expect(CASE_COMPACT_PROMPT).toMatch(/do NOT describe.*user.*as a person/i)
  })

  it('is a non-empty string', () => {
    expect(CASE_COMPACT_PROMPT).toBeTruthy()
    expect(typeof CASE_COMPACT_PROMPT).toBe('string')
  })
})
