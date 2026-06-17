import { describe, it, expect } from 'vitest'
import { aggregateTraces } from '../../trace-aggregator'

describe('aggregateTraces', () => {
  const t0 = Date.now()

  function aggregateToolResult(output: unknown, overrides: Partial<Record<string, unknown>> = {}) {
    return aggregateTraces([
      {
        caseId: 'c',
        actionType: 'tool_result',
        title: 'Tool result: kb_search_deposit',
        payload: JSON.stringify({
          toolName: 'kb_search_deposit',
          output,
          ...overrides,
        }),
        createdAt: new Date(t0 + 10).toISOString(),
      },
    ] as any, t0, false, ['Knowledge retrieval'])
  }

  it('never hides a stage that fired, even if not in applicableStages', () => {
    const recs = [
      { caseId: 'c', actionType: 'tool_result', title: 'Tool: kb_search', detail: 'ok', createdAt: new Date(t0 + 10).toISOString() },
    ]
    const out = aggregateTraces(recs as any, t0, false, ['Hooks', 'Model generation'])
    const tools = out.find(s => s.stage === 'Tools')
    expect(tools?.fired).toBe(true)
  })

  it('includes unfired applicable stages as skipped', () => {
    const out = aggregateTraces([], t0, false, ['Hooks', 'Model generation'])
    const hooks = out.find(s => s.stage === 'Hooks')
    expect(hooks?.fired).toBe(false)
    expect(hooks?.status).toBe('skipped')
  })

  it('computes ms as span between first and last record, not start-offset', () => {
    const recs = [
      { caseId: 'c', actionType: 'tool_result', title: 'Tool A', detail: 'ok', createdAt: new Date(t0 + 100).toISOString() },
      { caseId: 'c', actionType: 'tool_result', title: 'Tool B', detail: 'ok', createdAt: new Date(t0 + 600).toISOString() },
    ]
    const out = aggregateTraces(recs as any, t0, false, ['Tools'])
    const tools = out.find(s => s.stage === 'Tools')
    expect(tools?.ms).toBe(500)
  })

  it('ms is always >= 0 (single record stage)', () => {
    const recs = [
      { caseId: 'c', actionType: 'llm_response', title: 'LLM response', detail: '{}', createdAt: new Date(t0 + 50).toISOString() },
    ]
    const out = aggregateTraces(recs as any, t0, false, ['Model generation'])
    const model = out.find(s => s.stage === 'Model generation')
    expect(model?.ms).toBeGreaterThanOrEqual(0)
  })

  it('preserves existing behavior: includes all 5 stages when no applicableStages', () => {
    const out = aggregateTraces([], t0, false)
    expect(out).toHaveLength(5)
    expect(out.every(s => s.fired === false)).toBe(true)
  })

  it('excludes bookkeeping actionTypes from Tools stage (AC-C1)', () => {
    const t0 = Date.now()
    const traces = [
      { caseId: 'c', actionType: 'user_message', title: 'run start', detail: '', createdAt: new Date(t0).toISOString() },
      { caseId: 'c', actionType: 'stream_event', title: 'stream', detail: '', createdAt: new Date(t0 + 10).toISOString() },
      { caseId: 'c', actionType: 'loop_decision', title: 'Iteration Snapshot', payload: JSON.stringify({ llmWallMs: 1200, iterationWallMs: 1500 }), detail: '', createdAt: new Date(t0 + 20).toISOString() },
      { caseId: 'c', actionType: 'tool_result', title: 'Tool: kb_search', detail: 'ok', createdAt: new Date(t0 + 50).toISOString() },
    ]
    const result = aggregateTraces(traces as any, t0, false, ['Tools', 'Model generation'])
    const tools = result.find(s => s.stage === 'Tools')
    expect(tools?.fired).toBe(true)
    // Only kb_search should appear in the summary, not Iteration Snapshot or run start
    expect(tools?.summary).toContain('kb_search')
    expect(tools?.summary).not.toContain('Iteration Snapshot')
    expect(tools?.summary).not.toContain('run start')
  })

  it('renders current tool_result rows for display', () => {
    const traces = [
      {
        caseId: 'c',
        actionType: 'tool_result',
        title: 'Tool: kb_search',
        payload: JSON.stringify({
          toolName: 'kb_search',
          output: { hits: 1 },
          executionTruth: {
            effectiveMode: 'runtime_backed',
            label: 'Runtime-backed knowledge tool',
            dryRun: true,
            definitionMode: 'http',
            toolCategory: 'system_info',
          },
        }),
        createdAt: new Date(t0 + 50).toISOString(),
      },
    ]
    const result = aggregateTraces(traces as any, t0, false, ['Tools'])
    const tools = result.find(s => s.stage === 'Tools')
    expect(tools?.fired).toBe(true)
    expect(tools?.detail[0]?.[0]).toBe('tool_result')
    expect(tools?.events?.[0]?.executionTruth?.label).toBe('Runtime-backed knowledge tool')
  })

  it('maps structured knowledge-tool payloads to Knowledge retrieval even when the tool name has no kb_search_ prefix', () => {
    const traces = [
      {
        caseId: 'c',
        actionType: 'tool_result',
        title: 'Tool: faq_lookup_default',
        payload: JSON.stringify({
          toolName: 'faq_lookup_default',
          knowledgeSourceId: 'ks_faq',
          knowledgeSourceName: 'FAQ',
          output: { hits: [{ id: 'faq-1', title: 'Deposit FAQ' }] },
        }),
        createdAt: new Date(t0 + 55).toISOString(),
      },
    ]

    const result = aggregateTraces(traces as any, t0, false, ['Knowledge retrieval'])
    const knowledge = result.find((step) => step.stage === 'Knowledge retrieval')

    expect(knowledge?.fired).toBe(true)
    expect(knowledge?.events?.[0]?.toolName).toBe('faq_lookup_default')
    expect(knowledge?.summary).toContain('faq_lookup_default')
  })

  it('uses real llmWallMs from Iteration Snapshot for Model generation ms (AC-C2)', () => {
    const t0 = Date.now()
    const traces = [
      { caseId: 'c', actionType: 'loop_decision', title: 'Iteration Snapshot', payload: JSON.stringify({ llmWallMs: 1200, iterationWallMs: 1500 }), detail: '', createdAt: new Date(t0).toISOString() },
      { caseId: 'c', actionType: 'llm_request_start', title: 'LLM request', detail: null, createdAt: new Date(t0 + 10).toISOString() },
      { caseId: 'c', actionType: 'llm_response', title: 'LLM response', detail: JSON.stringify({ usage: { input_tokens: 100, output_tokens: 20 } }), createdAt: new Date(t0 + 200).toISOString() },
    ]
    const result = aggregateTraces(traces as any, t0, false, ['Model generation'])
    const model = result.find(s => s.stage === 'Model generation')
    expect(model?.fired).toBe(true)
    expect(model?.ms).toBe(1200) // from llmWallMs, NOT from createdAt span
  })

  it('includes Iteration Snapshot rows in debug export json for Model generation', () => {
    const traces = [
      {
        caseId: 'c',
        actionType: 'loop_decision',
        title: 'Iteration Snapshot',
        payload: JSON.stringify({ iteration: 1, llmWallMs: 1200, toolsWallMs: 80 }),
        detail: '',
        createdAt: new Date(t0 + 5).toISOString(),
      },
      {
        caseId: 'c',
        actionType: 'llm_request_start',
        title: 'LLM request',
        payload: JSON.stringify({ model: 'demo-model' }),
        createdAt: new Date(t0 + 10).toISOString(),
      },
      {
        caseId: 'c',
        actionType: 'llm_response',
        title: 'LLM response',
        payload: JSON.stringify({ usage: { input_tokens: 100, output_tokens: 20 }, iteration: 1 }),
        createdAt: new Date(t0 + 200).toISOString(),
      },
    ]

    const result = aggregateTraces(traces as any, t0, true, ['Model generation'])
    const model = result.find((step) => step.stage === 'Model generation')
    expect(model?.json).toBeDefined()
    expect(model?.json?.some((row) => row.title === 'Iteration Snapshot')).toBe(true)
    expect(model?.json?.every((row) => typeof row.createdAt === 'string')).toBe(true)
  })

  it('surfaces hook loop decisions and procedure runtime guards instead of hiding them as bookkeeping', () => {
    const traces = [
      {
        caseId: 'c',
        actionType: 'loop_decision',
        title: 'Hook blocked Tool: query_order_status',
        payload: JSON.stringify({
          results: [{ hookName: 'risk_gate', action: 'block', reason: 'Missing receipt evidence' }],
        }),
        createdAt: new Date(t0 + 10).toISOString(),
      },
      {
        caseId: 'c',
        actionType: 'loop_decision',
        title: 'Stale ProcedureRun finalize attempt blocked',
        payload: JSON.stringify({ inputEpoch: 4, basedOnInputEpoch: 3, evidenceState: 'stale' }),
        createdAt: new Date(t0 + 20).toISOString(),
      },
    ]

    const result = aggregateTraces(traces as any, t0, false, ['Hooks', 'Procedure'])
    const hooks = result.find((step) => step.stage === 'Hooks')
    const procedure = result.find((step) => step.stage === 'Procedure')

    expect(hooks?.fired).toBe(true)
    expect(hooks?.status).toBe('block')
    expect(hooks?.events?.[0]?.kind).toBe('hook_decision')
    expect(hooks?.events?.[0]?.detail).toContain('risk_gate')

    expect(procedure?.fired).toBe(true)
    expect(procedure?.status).toBe('block')
    expect(procedure?.events?.[0]?.kind).toBe('stale_evidence')
    expect(procedure?.events?.[0]?.detail).toContain('inputEpoch')
  })

  it('suppresses passive allow-only hook checkpoints when no hook actually matched', () => {
    const traces = [
      {
        caseId: 'c',
        actionType: 'loop_decision',
        title: 'Hook checkpoint Stop: allow',
        payload: JSON.stringify({
          checkpoint: 'Stop',
          summary: 'allow',
          results: [],
        }),
        createdAt: new Date(t0 + 10).toISOString(),
      },
    ]

    const result = aggregateTraces(traces as any, t0, false, ['Hooks'])
    const hooks = result.find((step) => step.stage === 'Hooks')

    expect(hooks?.fired).toBe(false)
    expect(hooks?.events).toEqual([])
  })

  it('attaches runner capability truth from llm_request_start payloads', () => {
    const traces = [
      {
        caseId: 'c',
        actionType: 'llm_request_start',
        title: 'LLM request',
        payload: JSON.stringify({
          model: 'custom-model',
          playgroundCapabilityTruth: {
            model: 'custom-model',
            imageSupport: {
              status: 'unknown',
              label: 'Unknown',
              source: 'missing_model_metadata',
            },
            executionSurface: {
              mode: 'dry_run_mixed',
              label: 'Dry-run mixed surface',
            },
            toolSummary: {
              mockedDryRun: 2,
              runtimeBacked: 1,
              runtimeManaged: 0,
              staticFixture: 0,
              unknown: 1,
            },
            warnings: ['Image support is unconfirmed.'],
          },
        }),
        createdAt: new Date(t0 + 10).toISOString(),
      },
      {
        caseId: 'c',
        actionType: 'llm_response',
        title: 'LLM response',
        detail: JSON.stringify({ usage: { input_tokens: 10, output_tokens: 4 } }),
        createdAt: new Date(t0 + 30).toISOString(),
      },
    ]

    const result = aggregateTraces(traces as any, t0, false, ['Model generation'])
    expect(result[0].runtimeTruth?.imageSupport.status).toBe('unknown')
    expect(result[0].runtimeTruth?.executionSurface.label).toBe('Dry-run mixed surface')
    expect(result[0].runtimeTruth?.toolSummary.mockedDryRun).toBe(2)
  })

  it('treats production-shaped kb_search hits as successful evidence', () => {
    const result = aggregateToolResult({
      success: true,
      list: [
        { document_name: 'Deposit FAQ', data_id: 'doc-1', content: 'Deposit evidence', score: 0.92 },
      ],
    })

    const knowledge = result.find((step) => step.stage === 'Knowledge retrieval')
    expect(knowledge?.status).toBe('ok')
    expect(knowledge?.events?.[0]?.status).toBe('ok')
  })

  it('treats success:false with errors as blocking tool evidence', () => {
    const result = aggregateToolResult({
      success: false,
      errors: { member_id: ['The selected member id is invalid.'] },
    })

    const knowledge = result.find((step) => step.stage === 'Knowledge retrieval')
    expect(knowledge?.status).toBe('block')
    expect(knowledge?.events?.[0]?.status).toBe('block')
  })

  it('treats ok:false and explicit error payloads as blocking tool evidence', () => {
    const result = aggregateToolResult({
      ok: false,
      error: 'HTTP 500',
    })

    const knowledge = result.find((step) => step.stage === 'Knowledge retrieval')
    expect(knowledge?.status).toBe('block')
    expect(knowledge?.events?.[0]?.status).toBe('block')
  })

  it('treats null or empty raw tool output as blocking', () => {
    const nullResult = aggregateToolResult(null)
    const emptyResult = aggregateToolResult('')

    expect(nullResult.find((step) => step.stage === 'Knowledge retrieval')?.events?.[0]?.status).toBe('block')
    expect(emptyResult.find((step) => step.stage === 'Knowledge retrieval')?.events?.[0]?.status).toBe('block')
  })

  it('treats success:true with empty list/data as usable negative evidence, not a runtime blocker', () => {
    const emptyList = aggregateToolResult({ success: true, list: [] })
    const emptyData = aggregateToolResult({ success: true, data: [] })

    expect(emptyList.find((step) => step.stage === 'Knowledge retrieval')?.status).toBe('info')
    expect(emptyList.find((step) => step.stage === 'Knowledge retrieval')?.events?.[0]?.status).toBe('info')
    expect(emptyData.find((step) => step.stage === 'Knowledge retrieval')?.status).toBe('info')
    expect(emptyData.find((step) => step.stage === 'Knowledge retrieval')?.events?.[0]?.status).toBe('info')
  })

  it('exposes the captured model request payload including tools and tool_choice', () => {
    const traces = [
      {
        caseId: 'c',
        actionType: 'llm_request_start',
        title: 'LLM request',
        payload: JSON.stringify({
          model: 'custom-model',
          requestPayloadCaptured: true,
          systemPrompt: 'CORE\n<procedure_run_runtime>active</procedure_run_runtime>',
          messages: [{ role: 'user', content: 'hello' }],
          tools: [
            { name: 'remember', description: 'Write a scoped memory item.' },
            { name: 'get_current_time', description: 'Return the current server time.' },
          ],
          toolChoice: { type: 'auto', disable_parallel_tool_use: false },
        }),
        createdAt: new Date(t0 + 10).toISOString(),
      },
      {
        caseId: 'c',
        actionType: 'llm_response',
        title: 'LLM response',
        detail: JSON.stringify({ usage: { input_tokens: 10, output_tokens: 4 } }),
        createdAt: new Date(t0 + 30).toISOString(),
      },
    ]

    const result = aggregateTraces(traces as any, t0, false, ['Model generation'])
    const model = result.find((step) => step.stage === 'Model generation')
    expect(model?.promptData?.systemPrompt).toContain('<procedure_run_runtime>')
    expect(model?.promptData?.messages).toEqual([{ role: 'user', content: 'hello' }])
    expect(model?.promptData?.tools?.map((tool: any) => tool.name)).toEqual(['remember', 'get_current_time'])
    expect(model?.promptData?.toolChoice).toEqual({ type: 'auto', disable_parallel_tool_use: false })
    expect(model?.promptData?.requestPayloadCaptured).toBe(true)
  })
})
