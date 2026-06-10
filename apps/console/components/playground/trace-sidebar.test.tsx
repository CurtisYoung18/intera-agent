// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import TraceSidebar from './trace-sidebar'
import type { PlaygroundTraceStep } from '@/lib/agent/trace-aggregator'

afterEach(() => cleanup())

function renderSidebar(steps: PlaygroundTraceStep[]) {
  render(
    <TraceSidebar
      collapsed={false}
      onCollapse={() => {}}
      onExpand={() => {}}
      liveTools={[]}
      turnTraces={[steps]}
      turnTotalMs={[120]}
      sessionMetrics={{ totalInput: 10, totalOutput: 5, totalTools: 2, llmCalls: 1, totalMs: 120 }}
      expandedTurns={new Set([0])}
      expandedTools={new Set(['0-1-0', '0-1-1'])}
      onToggleTurn={() => {}}
      onToggleTool={() => {}}
      responding={false}
      tb={(key) => key.split('.').pop() ?? key}
    />,
  )
}

describe('TraceSidebar', () => {
  it('renders tool and hook evidence in an expanded turn', () => {
    renderSidebar([
      {
        stage: 'Hooks',
        source: 'hooks',
        status: 'warn',
        fired: true,
        ms: 0,
        summary: 'Hook: provider_conflict',
        detail: [['hook_hit', 'escalated: provider evidence conflict']],
      },
      {
        stage: 'Tools',
        source: 'tools',
        status: 'ok',
        fired: true,
        ms: 10,
        summary: 'Tool called: get_latest_deposit → Tool result: get_latest_deposit',
        detail: [
          ['tool_call', 'input: {"memberId":"u1"}'],
          ['tool_result', 'output: {"status":"pending"}'],
        ],
      },
    ])

    expect(screen.getByText('Hook decision')).toBeTruthy()
    expect(screen.getByText(/provider evidence conflict/)).toBeTruthy()
    expect(screen.getAllByText(/get_latest_deposit/).length).toBeGreaterThan(0)
    expect(screen.getByText(/"status":"pending"/)).toBeTruthy()
  })
})
