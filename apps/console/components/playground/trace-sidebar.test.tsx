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
      expandedTools={new Set(['0-1-0', '0-1-1', '0-3-0', '0-3-1'])}
      onToggleTurn={() => {}}
      onToggleTool={() => {}}
      responding={false}
      tb={(key) => key.split('.').pop() ?? key}
    />,
  )
}

describe('TraceSidebar', () => {
  it('uses approved motion primitives for the active turn and running tool rows', () => {
    render(
      <TraceSidebar
        collapsed={false}
        onCollapse={() => {}}
        onExpand={() => {}}
        liveTools={[{
          name: 'kb_search_deposit',
          status: 'running',
          startedAt: Date.now(),
        }]}
        turnTraces={[[]]}
        turnTotalMs={[0]}
        sessionMetrics={{ totalInput: 0, totalOutput: 0, totalTools: 0, llmCalls: 0, totalMs: 0 }}
        expandedTurns={new Set([0])}
        expandedTools={new Set()}
        onToggleTurn={() => {}}
        onToggleTool={() => {}}
        responding
        tb={(key) => key.split('.').pop() ?? key}
      />,
    )

    expect(screen.getByTitle('Trace turn is running')).toBeTruthy()
    expect(screen.getByTitle('Tool is running')).toBeTruthy()
    expect(screen.getByText('Tool: kb_search_deposit')).toBeTruthy()
  })

  it('renders runtime truth, hook decisions, procedure guards, and tool execution labels', () => {
    renderSidebar([
      {
        stage: 'Model generation',
        source: 'agent',
        status: 'skipped',
        fired: false,
        ms: 0,
        summary: '(no events)',
        detail: [],
        runtimeTruth: {
          model: 'deepseek-v4-pro',
          imageSupport: {
            status: 'unsupported',
            label: 'Unsupported',
            source: 'configured_model_registry',
            note: 'Resolved from configured model metadata for DeepSeek V4 Pro.',
          },
          executionSurface: {
            mode: 'dry_run_mixed',
            label: 'Dry-run mixed surface',
            note: 'Prompting, hooks, and runtime-managed tools are real, while operational tools are mocked.',
          },
          toolSummary: {
            mockedDryRun: 1,
            runtimeBacked: 1,
            runtimeManaged: 0,
            staticFixture: 0,
            unknown: 0,
          },
          warnings: [
            'Playground is in dry-run mode: operational tools are mocked and cannot perform live side effects.',
          ],
        },
      },
      {
        stage: 'Hooks',
        source: 'hooks',
        status: 'block',
        fired: true,
        ms: 0,
        summary: 'Hook blocked Tool: query_order_status',
        detail: [['loop_decision', 'risk_gate -> block: Missing receipt evidence']],
        events: [{
          kind: 'hook_decision',
          actionType: 'loop_decision',
          label: 'Hook blocked Tool: query_order_status',
          status: 'block',
          detail: 'risk_gate -> block: Missing receipt evidence',
        }],
      },
      {
        stage: 'Procedure',
        source: 'agent',
        status: 'block',
        fired: true,
        ms: 0,
        summary: 'ProcedureRun reconcile gate blocked Tool: finalize_procedure',
        detail: [['loop_decision', 'inputEpoch: 4\nlastReconciledInputEpoch: 3']],
        events: [{
          kind: 'runtime_guard',
          actionType: 'loop_decision',
          label: 'ProcedureRun reconcile gate blocked Tool: finalize_procedure',
          status: 'block',
          detail: 'inputEpoch: 4\nlastReconciledInputEpoch: 3',
        }],
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
        events: [
          {
            kind: 'tool_call',
            actionType: 'tool_call',
            label: 'get_latest_deposit',
            toolName: 'get_latest_deposit',
            status: 'info',
            detail: 'input: {"memberId":"u1"}',
            executionTruth: {
              effectiveMode: 'mocked_dry_run',
              label: 'Mocked in Playground dry-run',
              dryRun: true,
              definitionMode: 'http',
              toolCategory: 'operational',
            },
          },
          {
            kind: 'tool_result',
            actionType: 'tool_result',
            label: 'get_latest_deposit',
            toolName: 'get_latest_deposit',
            status: 'ok',
            detail: 'output: {"status":"pending"}',
            executionTruth: {
              effectiveMode: 'mocked_dry_run',
              label: 'Mocked in Playground dry-run',
              dryRun: true,
              definitionMode: 'http',
              toolCategory: 'operational',
            },
          },
        ],
      },
    ])

    expect(screen.getByText('Trace timeline')).toBeTruthy()
    expect(screen.getByText('Runtime truth')).toBeTruthy()
    expect(screen.getByText('Dry-run mixed surface')).toBeTruthy()
    expect(screen.getByText('Resolved model')).toBeTruthy()
    expect(screen.queryByText((_, node) => node?.textContent?.includes('Call requests a tool.') ?? false)).toBeNull()
    expect(screen.getAllByText('Mocked in Playground dry-run').length).toBeGreaterThan(0)
    expect(screen.getByText('Hook blocked Tool: query_order_status')).toBeTruthy()
    expect(screen.getByText('ProcedureRun reconcile gate blocked Tool: finalize_procedure')).toBeTruthy()
    expect(screen.getAllByText(/get_latest_deposit/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/result/i).length).toBeGreaterThan(0)
  })
})
