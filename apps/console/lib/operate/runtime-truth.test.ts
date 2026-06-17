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

  it('classifies stale ProcedureRun guards as stale evidence', () => {
    const trace = classifyOperateTrace({
      actionType: 'loop_decision',
      title: 'Stale ProcedureRun finalize attempt blocked',
      detail: null,
      payload: JSON.stringify({ inputEpoch: 4, basedOnInputEpoch: 3, evidenceState: 'stale' }),
    })

    expect(trace.kind).toBe('stale_evidence')
    expect(trace.status).toBe('block')
    expect(trace.semanticLabel).toBe('Stale evidence')
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

  it('classifies agent tree lifecycle rows as runtime debug events', () => {
    const trace = classifyOperateTrace({
      actionType: 'agent_tree_node',
      title: '[Main[7iisaj]] run start',
      detail: null,
      payload: JSON.stringify({ agentName: 'Main[7iisaj]', depth: 0, chainId: 'chain-1' }),
    })

    expect(trace.kind).toBe('runtime_debug')
    expect(trace.semanticLabel).toBe('Runtime debug')
    expect(trace.title).toBe('Run start')
  })

  it('summarizes tool results without dumping full JSON into the evidence line', () => {
    const trace = classifyOperateTrace({
      actionType: 'tool_result',
      title: 'Tool result: receipt_ocr',
      detail: null,
      payload: JSON.stringify({
        toolName: 'receipt_ocr',
        output: { status: 'matched', amount: '800 BDT', reference: 'ABC123' },
        latencyMs: 130,
      }),
    })

    expect(trace.detailText).toContain('status: matched')
    expect(trace.detailText).toContain('amount: 800 BDT')
    expect(trace.detailText).not.toContain('{"status"')
  })

  it('renders ask_user_questions tool calls as a readable form summary', () => {
    const trace = classifyOperateTrace({
      actionType: 'tool_call',
      title: 'Tool called: ask_user_questions',
      detail: null,
      payload: JSON.stringify({
        toolName: 'ask_user_questions',
        input: {
          title: 'Member ID Required',
          description: 'Please enter your Jayabaji Member ID.',
          fields: [
            { id: 'member_id', type: 'text', label: 'Member ID', required: true },
          ],
        },
      }),
    })

    expect(trace.detailText).toContain('title: Member ID Required')
    expect(trace.detailText).toContain('fields:')
    expect(trace.detailText).toContain('Member ID [text, required]')
  })

  it('renders form submission traces with labeled answers', () => {
    const trace = classifyOperateTrace({
      actionType: 'form_submit',
      title: 'Form submitted: Member ID Required',
      detail: null,
      payload: JSON.stringify({
        title: 'Member ID Required',
        fields: [
          { id: 'member_id', type: 'text', label: 'Member ID', required: true },
        ],
        answers: {
          member_id: 'JAYA117FFEB',
        },
      }),
    })

    expect(trace.kind).toBe('form_submission')
    expect(trace.status).toBe('ok')
    expect(trace.detailText).toContain('title: Member ID Required')
    expect(trace.detailText).toContain('Member ID: JAYA117FFEB')
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
