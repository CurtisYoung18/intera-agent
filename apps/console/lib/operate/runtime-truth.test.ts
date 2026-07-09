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

  it('renders form request traces as a readable rich form summary', () => {
    const trace = classifyOperateTrace({
      actionType: 'form_request',
      title: 'Form requested: Member ID Required',
      detail: null,
      payload: JSON.stringify({
        caseId: 'case-1',
        toolCallId: 'toolu_form_1',
        title: 'Member ID Required',
        description: 'Please enter your Jayabaji Member ID.',
        fields: [
          { id: 'member_id', type: 'text', label: 'Member ID', required: true, placeholder: 'JAYA123456' },
        ],
      }),
    })

    expect(trace.kind).toBe('form_request')
    expect(trace.status).toBe('info')
    expect(trace.semanticLabel).toBe('Form request')
    expect(trace.detailText).toContain('title: Member ID Required')
    expect(trace.detailText).toContain('toolCallId: toolu_form_1')
    expect(trace.detailText).toContain('Member ID [text, required] - JAYA123456')
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

  it('renders channel rich message traces with card details', () => {
    const trace = classifyOperateTrace({
      actionType: 'channel_rich_message',
      title: 'LiveChat rich message: card',
      detail: null,
      payload: JSON.stringify({
        channel: 'livechat',
        rendererAction: 'send_card',
        richType: 'card',
        sourceEventType: 'form_request',
        card: {
          title: 'Member ID Required',
          subtitle: 'Please enter your Jayabaji Member ID.',
          buttons: [{ id: 'open_form', label: 'Open form', type: 'webview' }],
        },
      }),
    })

    expect(trace.kind).toBe('channel_message')
    expect(trace.status).toBe('ok')
    expect(trace.semanticLabel).toBe('Channel rich message')
    expect(trace.detailText).toContain('channel: livechat')
    expect(trace.detailText).toContain('richType: card')
    expect(trace.detailText).toContain('source: form_request')
    expect(trace.detailText).toContain('title: Member ID Required')
    expect(trace.detailText).toContain('buttons: Open form')
  })

  it('renders human handoff note fields in the trace panel', () => {
    const trace = classifyOperateTrace({
      actionType: 'human_task_created',
      title: 'Human task created',
      detail: null,
      payload: JSON.stringify({
        taskId: 'task-1',
        queue: 'payment_ops',
        status: 'pending',
        chat_summary: 'Customer reported that an approved deposit is not reflected.',
        known_facts: {
          member_id: 'JAYA1126511',
          issue: 'deposit not reflected after approved status',
          tool_name: 'create_human_task',
        },
        handoff_reason: 'Customer explicitly requested a human after automated lookup.',
      }),
    })

    expect(trace.kind).toBe('human_handoff')
    expect(trace.status).toBe('warn')
    expect(trace.detailText).toContain('Issue summary:')
    expect(trace.detailText).toContain('Customer reported that an approved deposit is not reflected.')
    expect(trace.detailText).toContain('Known facts collected:')
    expect(trace.detailText).toContain('Member ID: JAYA1126511')
    expect(trace.detailText).toContain('Issue: deposit not reflected after approved status')
    expect(trace.detailText).toContain('Reason for handoff:')
    expect(trace.detailText).toContain('Customer explicitly requested a human after automated lookup.')
    expect(trace.detailText).not.toContain('create_human_task')
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

  it('describes result-only tool traces without leading with zero calls', () => {
    const summary = summarizeToolPairing([
      { actionType: 'tool_result', title: 'Tool result: search', detail: null, payload: null },
      { actionType: 'tool_result', title: 'Tool result: lookup', detail: null, payload: null },
    ])

    expect(summary.toolCalls).toBe(0)
    expect(summary.toolResults).toBe(2)
    expect(summary.label).toBe('2 tool result events (tool_call records unavailable)')
    expect(summary.labelZh).toBe('2 个工具结果事件（缺少对应 tool_call 记录）')
    expect(summary.label).not.toContain('0 tool calls')
  })

  it('summarizes llm_request_start tool schemas without exposing full provider schema payloads', () => {
    const trace = classifyOperateTrace({
      actionType: 'llm_request_start',
      title: 'LLM request: demo-model',
      detail: null,
      payload: JSON.stringify({
        model: 'demo-model',
        messageCount: 3,
        requestPayloadCaptured: true,
        systemPrompt: 'PRIVATE PROMPT',
        messages: [{ role: 'user', content: 'hello' }],
        tools: [
          { name: 'search_knowledge', description: 'full description', input_schema: { type: 'object', properties: { source: { type: 'string', enum: ['deposit', 'account'] } } } },
          { name: 'get_current_time', description: 'full description', input_schema: { type: 'object', properties: {} } },
        ],
      }),
    })

    expect(trace.kind).toBe('model_request')
    expect(trace.detailText).toContain('provider-visible tools: 2')
    expect(trace.detailText).toContain('knowledge schema: unified')
    expect(trace.detailText).toContain('schema tokens: ~')
    expect(trace.payload).not.toHaveProperty('tools')
    expect(trace.payload).not.toHaveProperty('messages')
    expect(trace.payload).not.toHaveProperty('systemPrompt')
    expect(trace.toolSchemaSummary?.providerVisibleToolCount).toBe(2)
    expect(trace.toolSchemaSummary?.knowledgeSourceCount).toBe(2)
  })

  it('summarizes search_knowledge source, topK, result count, and latency', () => {
    const trace = classifyOperateTrace({
      actionType: 'tool_result',
      title: 'Tool: search_knowledge',
      detail: null,
      payload: JSON.stringify({
        toolName: 'search_knowledge',
        input: { query: 'deposit bonus', source: 'deposit', topK: 8 },
        output: {
          ok: true,
          output: {
            list: [
              { document_name: 'Deposit FAQ', score: 0.91 },
              { document_name: 'Bonus Policy', score: 0.82 },
            ],
            knowledgeSourceName: 'Deposit',
            knowledgeSourceKey: 'deposit',
            topK: 8,
          },
          latencyMs: 237,
        },
        latencyMs: 237,
        isKnowledgeTool: true,
        knowledgeSourceName: 'Deposit',
        knowledgeProvider: 'gptbots',
      }),
    })

    expect(trace.semanticLabel).toBe('Knowledge result')
    expect(trace.title).toBe('search_knowledge · Deposit')
    expect(trace.detailText).toContain('source: Deposit')
    expect(trace.detailText).toContain('topK: 8')
    expect(trace.detailText).toContain('results: 2')
    expect(trace.detailText).toContain('latency: 237ms')
    expect(trace.knowledgeSummary?.resultCount).toBe(2)
  })
})
