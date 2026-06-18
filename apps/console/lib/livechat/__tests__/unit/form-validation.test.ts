import { describe, expect, it } from 'vitest'

import { validateFormAnswers } from '../../form-validation'

describe('validateFormAnswers', () => {
  it('rejects reversed from/to date fields', () => {
    expect(validateFormAnswers(
      [
        { id: 'from_date', type: 'date', label: 'From Date' },
        { id: 'to_date', type: 'date', label: 'To Date' },
      ],
      { from_date: '2026-06-18', to_date: '2026-06-01' },
    )).toEqual({
      ok: false,
      error: 'From Date must be earlier than To Date.',
    })
  })

  it('accepts same-day date-only ranges as a full-day interval', () => {
    expect(validateFormAnswers(
      [
        { id: 'from_date', type: 'date', label: 'From Date' },
        { id: 'to_date', type: 'date', label: 'To Date' },
      ],
      { from_date: '2026-06-18', to_date: '2026-06-18' },
    )).toEqual({ ok: true })
  })

  it('rejects reversed start/end timestamps', () => {
    expect(validateFormAnswers(
      [
        { id: 'start_time', type: 'date', label: 'Start Time' },
        { id: 'end_time', type: 'date', label: 'End Time' },
      ],
      {
        start_time: '2026-06-18 12:00:00',
        end_time: '2026-06-18 11:59:59',
      },
    )).toEqual({
      ok: false,
      error: 'Start Time must be earlier than End Time.',
    })
  })

  it('ignores non-date fields with matching names', () => {
    expect(validateFormAnswers(
      [
        { id: 'from_date', type: 'text', label: 'From Date' },
        { id: 'to_date', type: 'text', label: 'To Date' },
      ],
      { from_date: 'later', to_date: 'earlier' },
    )).toEqual({ ok: true })
  })
})
