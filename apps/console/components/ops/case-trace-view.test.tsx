// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CaseTraceTimeline, type TraceRow } from './case-trace-view'

afterEach(() => cleanup())

const copy: Record<string, string> = {
  'caseDetail.viewModeEvidence': 'Evidence',
  'caseDetail.viewModeRuntime': 'Runtime',
  'caseDetail.viewModeDebug': 'Debug',
  'caseDetail.viewModeEvidenceHint': 'Evidence hint',
  'caseDetail.viewModeRuntimeHint': 'Runtime hint',
  'caseDetail.viewModeDebugHint': 'Debug hint',
  'caseDetail.noVisibleTraces': 'No {mode} events recorded for this view.',
  'caseDetail.noTraces': 'No traces',
  'caseDetail.ms': '{n} ms',
  'caseDetail.rawDetails': 'Raw details',
  'caseDetail.hiddenInternalFields': '{n} internal fields hidden',
  'caseDetail.fieldCount': '{n} fields',
  'caseDetail.moreItems': '+{n} more',
}

function t(key: string, values?: Record<string, string | number>) {
  let template = copy[key] ?? key
  for (const [name, value] of Object.entries(values ?? {})) {
    template = template.replace(`{${name}}`, String(value))
  }
  return template
}

function renderTimeline(traces: TraceRow[]) {
  render(<CaseTraceTimeline traces={traces} t={t as any} groupByIteration={false} />)
}

describe('CaseTraceTimeline', () => {
  it('defaults to evidence mode and keeps runtime debug rows behind the debug switch', () => {
    renderTimeline([
      {
        id: 'trace-user',
        actionType: 'user_message',
        title: 'User sent message',
        detail: null,
        payload: JSON.stringify({ content: 'Uploaded receipt screenshot. What can you confirm?' }),
        createdAt: '2026-06-15T10:00:00.000Z',
      },
      {
        id: 'trace-debug',
        actionType: 'agent_tree_node',
        title: '[Main[7iisaj]] run start',
        detail: null,
        payload: JSON.stringify({ agentName: 'Main[7iisaj]', depth: 0, chainId: 'chain-1' }),
        createdAt: '2026-06-15T10:00:01.000Z',
      },
      {
        id: 'trace-tool',
        actionType: 'tool_result',
        title: 'Tool result: receipt_ocr',
        detail: null,
        payload: JSON.stringify({
          toolName: 'receipt_ocr',
          output: { status: 'matched', amount: '800 BDT', reference: 'ABC123' },
          latencyMs: 130,
        }),
        createdAt: '2026-06-15T10:00:02.000Z',
      },
    ])

    expect(screen.getByText('Evidence hint')).toBeTruthy()
    expect(screen.getByText(/Uploaded receipt screenshot/)).toBeTruthy()
    expect(screen.getByText(/status: matched/i)).toBeTruthy()
    expect(screen.queryByText('Run start')).toBeNull()
    expect(screen.queryByText('Raw details')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Runtime/i }))

    expect(screen.getByText('Runtime hint')).toBeTruthy()
    expect(screen.queryByText('Run start')).toBeNull()
    expect(screen.getByText('2 internal fields hidden')).toBeTruthy()
    fireEvent.click(screen.getByText('Raw details'))
    expect(screen.getByText('Output')).toBeTruthy()
    expect(screen.queryByText('Tool Name')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Debug/i }))

    expect(screen.getByText('Debug hint')).toBeTruthy()
    expect(screen.getAllByText('Run start').length).toBeGreaterThan(0)
    fireEvent.click(screen.getAllByText('Raw details')[0])
    expect(screen.getByText('Chain Id')).toBeTruthy()
  })
})
