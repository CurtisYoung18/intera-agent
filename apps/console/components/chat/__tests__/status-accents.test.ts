import { describe, it, expect } from 'vitest'
import { statusColor, ACCENTS } from '../status-accents'

describe('statusColor', () => {
  it('returns green for success types', () => {
    expect(statusColor('skill_result')).toBe('#2ea04a')
    expect(statusColor('ok')).toBe('#2ea04a')
    expect(statusColor('success')).toBe('#2ea04a')
    expect(statusColor('resolved')).toBe('#2ea04a')
  })

  it('returns red for failure types', () => {
    expect(statusColor('policy_hit')).toBe('#e64539')
    expect(statusColor('block')).toBe('#e64539')
    expect(statusColor('error')).toBe('#e64539')
    expect(statusColor('fail')).toBe('#e64539')
    expect(statusColor('escalated')).toBe('#e64539')
  })

  it('returns amber for warn/in-progress types', () => {
    expect(statusColor('skill_called')).toBe('#d4912e')
    expect(statusColor('human_task')).toBe('#d4912e')
    expect(statusColor('waiting_human')).toBe('#d4912e')
    expect(statusColor('warn')).toBe('#d4912e')
    expect(statusColor('in_progress')).toBe('#d4912e')
  })

  it('returns blue for info/llm types', () => {
    expect(statusColor('llm')).toBe('#5b8af7')
    expect(statusColor('info')).toBe('#5b8af7')
  })

  it('returns grey for unknown status', () => {
    expect(statusColor('unknown_thing')).toBe('#a09888')
  })
})

describe('ACCENTS', () => {
  it('has expected entries', () => {
    expect(ACCENTS.policy_hit.stroke).toBe('#e64539')
    expect(ACCENTS.skill_result.stroke).toBe('#2ea04a')
    expect(ACCENTS.skill_called.stroke).toBe('#d4912e')
    expect(ACCENTS.llm_request_start.stroke).toBe('#5b8af7')
  })

  it('has all 13 accent entries from case-trace-view', () => {
    expect(Object.keys(ACCENTS)).toHaveLength(13)
  })

  it('each accent has stroke, fill, and icon', () => {
    for (const [key, accent] of Object.entries(ACCENTS)) {
      expect(accent.stroke, `${key} missing stroke`).toBeDefined()
      expect(accent.fill, `${key} missing fill`).toBeDefined()
      expect(accent.icon, `${key} missing icon`).toBeDefined()
    }
  })

  it('matches expected stroke colors verbatim', () => {
    const expected: Record<string, string> = {
      user_message: '#5b8af7',
      case_created: '#a09888',
      fact_extracted: '#d4912e',
      policy_hit: '#e64539',
      skill_called: '#d4912e',
      skill_result: '#2ea04a',
      human_task_created: '#d4912e',
      human_task_resolved: '#2ea04a',
      final_resolution: '#2ea04a',
      loop_decision: '#6b6758',
      stream_event: '#8b6ff5',
      llm_request_start: '#5b8af7',
      llm_response: '#5b8af7',
    }
    for (const [key, expectedStroke] of Object.entries(expected)) {
      expect(ACCENTS[key].stroke, `${key} stroke mismatch`).toBe(expectedStroke)
    }
  })

  it('matches expected fill colors verbatim', () => {
    const expected: Record<string, string> = {
      user_message: 'rgba(91, 138, 247, 0.08)',
      case_created: 'rgba(160, 152, 136, 0.08)',
      fact_extracted: 'rgba(212, 145, 46, 0.10)',
      policy_hit: 'rgba(230, 69, 57, 0.08)',
      skill_called: 'rgba(212, 145, 46, 0.10)',
      skill_result: 'rgba(46, 160, 74, 0.08)',
      human_task_created: 'rgba(212, 145, 46, 0.12)',
      human_task_resolved: 'rgba(46, 160, 74, 0.10)',
      final_resolution: 'rgba(46, 160, 74, 0.10)',
      loop_decision: 'rgba(107, 103, 88, 0.06)',
      stream_event: 'rgba(139, 111, 245, 0.07)',
      llm_request_start: 'rgba(91, 138, 247, 0.09)',
      llm_response: 'rgba(91, 138, 247, 0.10)',
    }
    for (const [key, expectedFill] of Object.entries(expected)) {
      expect(ACCENTS[key].fill, `${key} fill mismatch`).toBe(expectedFill)
    }
  })
})
