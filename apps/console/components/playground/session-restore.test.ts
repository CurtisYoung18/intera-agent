import { describe, expect, it } from 'vitest'
import { groupRestoredTracesByTurn, type RestoredPlaygroundTrace } from './session-restore'

function trace(
  actionType: string,
  title: string,
  createdAt: string,
): RestoredPlaygroundTrace {
  return {
    id: `${actionType}-${title}-${createdAt}`,
    actionType,
    title,
    detail: '',
    payload: '{}',
    createdAt,
  }
}

describe('groupRestoredTracesByTurn', () => {
  it('keeps one restored group per runtime turn even when the start markers arrive in mixed order', () => {
    const traces = [
      trace('user_message', 'User sent message', '2026-06-11T06:20:00.000Z'),
      trace('agent_tree_node', '[Main[1]] run start', '2026-06-11T06:20:00.000Z'),
      trace('llm_request_start', 'LLM request: deepseek-v4-flash', '2026-06-11T06:20:00.010Z'),
      trace('llm_response', 'LLM response: end_turn', '2026-06-11T06:20:01.000Z'),
      trace('loop_decision', 'Exit: no tools called', '2026-06-11T06:20:01.001Z'),

      trace('agent_tree_node', '[Main[2]] run start', '2026-06-11T06:20:02.000Z'),
      trace('user_message', 'User sent message', '2026-06-11T06:20:02.000Z'),
      trace('llm_request_start', 'LLM request: deepseek-v4-flash', '2026-06-11T06:20:02.010Z'),
      trace('llm_response', 'LLM response: tool_use', '2026-06-11T06:20:03.000Z'),
      trace('tool_result', 'Tool: kb_search_promotion', '2026-06-11T06:20:03.100Z'),
      trace('loop_decision', 'Iteration Snapshot', '2026-06-11T06:20:03.101Z'),

      trace('user_message', 'User sent message', '2026-06-11T06:20:04.000Z'),
      trace('agent_tree_node', '[Main[3]] run start', '2026-06-11T06:20:04.000Z'),
      trace('llm_request_start', 'LLM request: deepseek-v4-flash', '2026-06-11T06:20:04.010Z'),
      trace('llm_response', 'LLM response: end_turn', '2026-06-11T06:20:05.000Z'),
      trace('loop_decision', 'Exit: no tools called', '2026-06-11T06:20:05.001Z'),
    ]

    const groups = groupRestoredTracesByTurn(traces)

    expect(groups).toHaveLength(3)
    expect(groups.map((group) => group.length)).toEqual([5, 6, 5])
    expect(groups[1][0]?.title).toBe('[Main[2]] run start')
    expect(groups[1][1]?.title).toBe('User sent message')
  })

  it('returns an empty list when there are no traces to restore', () => {
    expect(groupRestoredTracesByTurn([])).toEqual([])
  })
})
