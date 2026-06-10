import { describe, expect, it } from 'vitest'
import {
  classifyOperateTrace,
  getRuntimeSourceTruth,
  summarizeConversationSourceTruth,
  summarizeToolPairing,
} from './runtime-truth'

describe('runtime-truth helpers', () => {
  it('marks playground exports as synthetic review conversations', () => {
    const truth = summarizeConversationSourceTruth([
      { source: 'playground', userId: 'playground-test-123' },
    ])

    expect(truth.kind).toBe('synthetic_review')
    expect(truth.isSynthetic).toBe(true)
    expect(truth.shortLabel).toBe('Synthetic export')
  })

  it('marks mixed conversations when synthetic and live runs coexist', () => {
    const truth = summarizeConversationSourceTruth([
      { source: 'live', userId: 'customer-1' },
      { source: 'playground', userId: 'playground-test-456' },
    ])

    expect(truth.kind).toBe('mixed')
    expect(truth.isSynthetic).toBe(true)
  })

  it('keeps live runtime chats distinct from synthetic exports', () => {
    const truth = getRuntimeSourceTruth({ source: 'live', userId: 'customer-2' })

    expect(truth.kind).toBe('live')
    expect(truth.isSynthetic).toBe(false)
    expect(truth.shortLabel).toBe('Live runtime')
  })

  it('classifies reconcile blocks as reconcile gates', () => {
    const trace = classifyOperateTrace({
      actionType: 'loop_decision',
      title: 'ProcedureRun reconcile gate blocked Tool: finalize_procedure',
      detail: null,
      payload: JSON.stringify({ inputEpoch: 4, lastReconciledInputEpoch: 3 }),
    })

    expect(trace.kind).toBe('reconcile_gate')
    expect(trace.status).toBe('block')
    expect(trace.semanticLabel).toBe('Reconcile gate')
  })

  it('classifies exported playground stage rows without pretending they are raw live traces', () => {
    const trace = classifyOperateTrace({
      actionType: 'Tools',
      title: 'Tool called: lookup_balance -> Tool result: lookup_balance',
      detail: '120ms',
      payload: JSON.stringify({ ms: 120, usage: { inputTokens: 10, outputTokens: 4 } }),
    })

    expect(trace.kind).toBe('exported_review')
    expect(trace.isExportedReviewStage).toBe(true)
    expect(trace.semanticLabel).toBe('Exported review stage')
  })

  it('summarizes unmatched tool call/result counts', () => {
    const summary = summarizeToolPairing([
      { actionType: 'tool_call', title: 'Tool called: search', detail: null, payload: null },
      { actionType: 'tool_call', title: 'Tool called: search', detail: null, payload: null },
      { actionType: 'tool_result', title: 'Tool result: search', detail: null, payload: null },
    ])

    expect(summary.toolCalls).toBe(2)
    expect(summary.toolResults).toBe(1)
    expect(summary.tone).toBe('warning')
  })
})
