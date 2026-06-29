import { describe, expect, it, vi } from 'vitest'
import { AgentOpsMetricsQuerySchema } from '@intera/shared/contracts/agentops/metrics'
import { getAgentOpsMetrics } from './metrics'
import type { AgentCaseScope } from '@/app/api/_agent-scope'

const scope: AgentCaseScope = {
  agentConfigId: 'agent-a',
  runs: [
    { id: 'run-1', caseId: 'case-1' },
    { id: 'run-2', caseId: 'case-2' },
  ],
  caseIds: ['case-1', 'case-2'],
  runIds: ['run-1', 'run-2'],
}

const liveCases = [
  {
    id: 'case-1',
    chatId: 'chat-1',
    userId: 'customer-1',
    type: 'deposit_not_credited',
    status: 'waiting_human',
    source: 'live',
    createdAt: new Date('2026-06-26T00:00:00.000Z'),
    updatedAt: new Date('2026-06-26T00:03:00.000Z'),
    humanTasks: [{
      status: 'pending',
      createdAt: new Date('2026-06-26T00:02:00.000Z'),
      resolvedAt: null,
      chatId: 'chat-1',
      runId: 'run-1',
    }],
    messages: [
      {
        id: 'msg-1',
        caseId: 'case-1',
        runId: 'run-1',
        role: 'user',
        createdAt: new Date('2026-06-26T00:00:00.000Z'),
        providerContent: null,
        providerMeta: null,
      },
      {
        id: 'msg-2',
        caseId: 'case-1',
        runId: 'run-1',
        role: 'assistant',
        createdAt: new Date('2026-06-26T00:00:03.000Z'),
        providerContent: null,
        providerMeta: null,
      },
    ],
    _count: { messages: 2 },
  },
  {
    id: 'case-2',
    chatId: 'chat-1',
    userId: 'customer-1',
    type: 'deposit_not_credited',
    status: 'resolved',
    source: 'live',
    createdAt: new Date('2026-06-26T00:04:00.000Z'),
    updatedAt: new Date('2026-06-26T00:05:00.000Z'),
    humanTasks: [],
    messages: [
      {
        id: 'msg-3',
        caseId: 'case-2',
        runId: 'run-2',
        role: 'user',
        createdAt: new Date('2026-06-26T00:04:00.000Z'),
        providerContent: null,
        providerMeta: null,
      },
    ],
    _count: { messages: 1 },
  },
]

const traces = [
  {
    caseId: 'case-1',
    runId: 'run-1',
    actionType: 'llm_response',
    title: 'LLM response: end_turn',
    detail: null,
    payload: JSON.stringify({
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10 },
    }),
    createdAt: new Date('2026-06-26T00:00:02.000Z'),
  },
  {
    caseId: 'case-1',
    runId: 'run-1',
    actionType: 'tool_result',
    title: 'Tool: kb_search_deposit',
    detail: null,
    payload: JSON.stringify({
      toolName: 'kb_search_deposit',
      output: { list: [] },
      latencyMs: 120,
    }),
    createdAt: new Date('2026-06-26T00:00:04.000Z'),
  },
  {
    caseId: 'case-1',
    runId: 'run-1',
    actionType: 'loop_decision',
    title: 'Iteration Snapshot',
    detail: null,
    payload: JSON.stringify({
      wallMs: 1000,
      llmWallMs: 800,
      toolsWallMs: 200,
    }),
    createdAt: new Date('2026-06-26T00:00:05.000Z'),
  },
]

function createRepo(cases: any[] = liveCases, traceRows: any[] = traces) {
  return {
    orgId: 'default',
    case: {
      findMany: vi.fn(async () => cases),
    },
    raw: {
      actionTrace: {
        findMany: vi.fn(async () => traceRows),
      },
    },
  } as any
}

describe('getAgentOpsMetrics', () => {
  it('uses conversation-segment handoff denominator and returns explicit cost null', async () => {
    const repo = createRepo()
    const query = AgentOpsMetricsQuerySchema.parse({
      window: '1h',
      to: '2026-06-26T01:00:00.000Z',
    })

    const result = await getAgentOpsMetrics({
      repo,
      agentId: 'agent-a',
      scope,
      query,
      now: new Date('2026-06-26T01:00:00.000Z'),
    })

    expect(result.metrics.handoffRate.denominatorKind).toBe('conversation_segments')
    expect(result.metrics.handoffRate.denominator).toBe(1)
    expect(result.metrics.handoffRate.numerator).toBe(1)
    expect(result.metrics.handoffRate.value).toBe(1)
    expect(result.metrics.knowledgeMissRate.numerator).toBe(1)
    expect(result.metrics.knowledgeMissRate.denominator).toBe(1)
    expect(result.metrics.tokenSummary.totalTokens).toBe(160)
    expect(result.metrics.latency.firstResponseMs.average).toBe(3000)
    expect(result.metrics.cost.amount).toBeNull()
    expect(result.metrics.cost.currency).toBeNull()
    expect(result.metrics.cost.available).toBe(false)
    expect(result.coverage.incompleteLegacyHumanTaskRows.count).toBe(0)
  })

  it('excludes sibling run messages, tasks, traces, and token evidence in the same case', async () => {
    const sharedScope: AgentCaseScope = {
      agentConfigId: 'agent-a',
      runs: [{ id: 'run-a', caseId: 'case-shared' }],
      caseIds: ['case-shared'],
      runIds: ['run-a'],
    }
    const repo = createRepo([
      {
        id: 'case-shared',
        chatId: 'chat-shared',
        userId: 'customer-shared',
        type: 'deposit_not_credited',
        status: 'investigating',
        source: 'live',
        createdAt: new Date('2026-06-26T00:00:00.000Z'),
        updatedAt: new Date('2026-06-26T00:05:00.000Z'),
        humanTasks: [{
          status: 'pending',
          createdAt: new Date('2026-06-26T00:02:00.000Z'),
          resolvedAt: null,
          chatId: 'chat-shared',
          runId: 'run-b',
        }],
        messages: [
          {
            id: 'msg-a-1',
            caseId: 'case-shared',
            runId: 'run-a',
            role: 'user',
            createdAt: new Date('2026-06-26T00:01:00.000Z'),
            providerContent: null,
            providerMeta: null,
          },
          {
            id: 'msg-a-2',
            caseId: 'case-shared',
            runId: 'run-a',
            role: 'assistant',
            createdAt: new Date('2026-06-26T00:01:03.000Z'),
            providerContent: null,
            providerMeta: null,
          },
          {
            id: 'msg-b-1',
            caseId: 'case-shared',
            runId: 'run-b',
            role: 'user',
            createdAt: new Date('2026-06-26T00:00:00.000Z'),
            providerContent: null,
            providerMeta: null,
          },
          {
            id: 'msg-b-2',
            caseId: 'case-shared',
            runId: 'run-b',
            role: 'assistant',
            createdAt: new Date('2026-06-26T00:00:01.000Z'),
            providerContent: null,
            providerMeta: null,
          },
        ],
        _count: { messages: 4 },
      },
    ], [
      {
        caseId: 'case-shared',
        runId: 'run-a',
        actionType: 'llm_response',
        title: 'LLM response: end_turn',
        detail: null,
        payload: JSON.stringify({ usage: { input_tokens: 10, output_tokens: 5 } }),
        createdAt: new Date('2026-06-26T00:01:02.000Z'),
      },
      {
        caseId: 'case-shared',
        runId: 'run-b',
        actionType: 'llm_response',
        title: 'LLM response: end_turn',
        detail: null,
        payload: JSON.stringify({ usage: { input_tokens: 900, output_tokens: 90 } }),
        createdAt: new Date('2026-06-26T00:00:02.000Z'),
      },
      {
        caseId: 'case-shared',
        runId: 'run-b',
        actionType: 'tool_result',
        title: 'Tool: secret_b',
        detail: null,
        payload: JSON.stringify({ toolName: 'secret_b', output: { ok: false, error: 'boom' } }),
        createdAt: new Date('2026-06-26T00:00:03.000Z'),
      },
    ])
    const query = AgentOpsMetricsQuerySchema.parse({
      window: '1h',
      to: '2026-06-26T01:00:00.000Z',
    })

    const result = await getAgentOpsMetrics({
      repo,
      agentId: 'agent-a',
      scope: sharedScope,
      query,
      now: new Date('2026-06-26T01:00:00.000Z'),
    })

    expect(result.metrics.handoffRate.numerator).toBe(0)
    expect(result.metrics.handoffRate.activeHumanTasks).toBe(0)
    expect(result.metrics.toolErrorRate.observedToolResults).toBe(0)
    expect(result.metrics.toolErrorRate.errorCount).toBe(0)
    expect(result.metrics.tokenSummary.totalTokens).toBe(15)
    expect(result.metrics.latency.firstResponseMs.average).toBe(3000)
    expect(JSON.stringify(result)).not.toContain('secret_b')
    expect(JSON.stringify(result)).not.toContain('boom')
  })

  it('does not count a conversation when an in-window case only has sibling-run evidence', async () => {
    const staleScope: AgentCaseScope = {
      agentConfigId: 'agent-a',
      runs: [{ id: 'run-a', caseId: 'case-sibling-only' }],
      caseIds: ['case-sibling-only'],
      runIds: ['run-a'],
    }
    const repo = createRepo([
      {
        id: 'case-sibling-only',
        chatId: 'chat-sibling-only',
        userId: 'customer-sibling-only',
        type: 'deposit_not_credited',
        status: 'waiting_human',
        source: 'live',
        createdAt: new Date('2026-06-26T00:00:00.000Z'),
        updatedAt: new Date('2026-06-26T00:10:00.000Z'),
        humanTasks: [{
          status: 'pending',
          createdAt: new Date('2026-06-26T00:09:00.000Z'),
          resolvedAt: null,
          chatId: 'chat-sibling-only',
          runId: 'run-b',
        }],
        messages: [
          {
            id: 'msg-b-only-1',
            caseId: 'case-sibling-only',
            runId: 'run-b',
            role: 'user',
            createdAt: new Date('2026-06-26T00:08:00.000Z'),
            providerContent: null,
            providerMeta: null,
          },
          {
            id: 'msg-b-only-2',
            caseId: 'case-sibling-only',
            runId: 'run-b',
            role: 'assistant',
            createdAt: new Date('2026-06-26T00:08:02.000Z'),
            providerContent: null,
            providerMeta: null,
          },
        ],
        _count: { messages: 2 },
      },
    ], [
      {
        caseId: 'case-sibling-only',
        runId: 'run-b',
        actionType: 'llm_response',
        title: 'LLM response: end_turn',
        detail: null,
        payload: JSON.stringify({ usage: { input_tokens: 700, output_tokens: 70 } }),
        createdAt: new Date('2026-06-26T00:08:01.000Z'),
      },
      {
        caseId: 'case-sibling-only',
        runId: 'run-b',
        actionType: 'tool_result',
        title: 'Tool: secret_b',
        detail: null,
        payload: JSON.stringify({ toolName: 'secret_b', output: { ok: false, error: 'boom' } }),
        createdAt: new Date('2026-06-26T00:08:03.000Z'),
      },
    ])
    const query = AgentOpsMetricsQuerySchema.parse({
      window: '1h',
      to: '2026-06-26T01:00:00.000Z',
    })

    const result = await getAgentOpsMetrics({
      repo,
      agentId: 'agent-a',
      scope: staleScope,
      query,
      now: new Date('2026-06-26T01:00:00.000Z'),
    })

    expect(result.metrics.handoffRate.denominator).toBe(0)
    expect(result.metrics.handoffRate.numerator).toBeNull()
    expect(result.metrics.handoffRate.activeHumanTasks).toBe(0)
    expect(result.metrics.tokenSummary.totalTokens).toBeNull()
    expect(result.metrics.toolErrorRate.observedToolResults).toBe(0)
    expect(result.metrics.latency.firstResponseMs.average).toBeNull()
    expect(JSON.stringify(result)).not.toContain('secret_b')
    expect(JSON.stringify(result)).not.toContain('boom')
  })

  it('includes null-run rows only for scoped cases without selected run ids', async () => {
    const directAnswerScope: AgentCaseScope = {
      agentConfigId: 'agent-a',
      runs: [],
      caseIds: ['case-live-direct'],
      runIds: [],
    }
    const repo = createRepo([
      {
        id: 'case-live-direct',
        chatId: 'chat-live-direct',
        userId: 'customer-live-direct',
        type: 'direct_answer',
        status: 'waiting_human',
        source: 'live',
        createdAt: new Date('2026-06-26T00:00:00.000Z'),
        updatedAt: new Date('2026-06-26T00:03:00.000Z'),
        humanTasks: [{
          status: 'pending',
          createdAt: new Date('2026-06-26T00:02:00.000Z'),
          resolvedAt: null,
          chatId: 'chat-live-direct',
          runId: null,
        }],
        messages: [
          {
            id: 'msg-direct-1',
            caseId: 'case-live-direct',
            runId: null,
            role: 'user',
            createdAt: new Date('2026-06-26T00:00:00.000Z'),
            providerContent: null,
            providerMeta: null,
          },
          {
            id: 'msg-direct-2',
            caseId: 'case-live-direct',
            runId: null,
            role: 'assistant',
            createdAt: new Date('2026-06-26T00:00:02.000Z'),
            providerContent: null,
            providerMeta: null,
          },
        ],
        _count: { messages: 2 },
      },
    ], [
      {
        caseId: 'case-live-direct',
        runId: null,
        actionType: 'llm_response',
        title: 'LLM response: end_turn',
        detail: null,
        payload: JSON.stringify({ usage: { input_tokens: 4, output_tokens: 6 } }),
        createdAt: new Date('2026-06-26T00:00:01.000Z'),
      },
    ])
    const query = AgentOpsMetricsQuerySchema.parse({
      window: '1h',
      to: '2026-06-26T01:00:00.000Z',
    })

    const result = await getAgentOpsMetrics({
      repo,
      agentId: 'agent-a',
      scope: directAnswerScope,
      query,
      now: new Date('2026-06-26T01:00:00.000Z'),
    })

    expect(result.metrics.handoffRate.numerator).toBe(1)
    expect(result.metrics.tokenSummary.totalTokens).toBe(10)
    expect(result.metrics.latency.firstResponseMs.average).toBe(2000)
    expect(result.coverage.incompleteLegacyHumanTaskRows.count).toBe(1)
  })

  it('excludes synthetic evidence by default in the database predicate', async () => {
    const repo = createRepo()
    const query = AgentOpsMetricsQuerySchema.parse({
      window: '20m',
      to: '2026-06-26T01:00:00.000Z',
    })

    await getAgentOpsMetrics({
      repo,
      agentId: 'agent-a',
      scope,
      query,
      now: new Date('2026-06-26T01:00:00.000Z'),
    })

    expect(repo.case.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        NOT: [
          { source: 'playground' },
          { userId: { startsWith: 'playground-test-' } },
          { chatId: { startsWith: 'pg_' } },
        ],
      }),
    }))
  })

  it('returns unavailable/null fields instead of guessing when scoped evidence is empty', async () => {
    const repo = createRepo([], [])
    const query = AgentOpsMetricsQuerySchema.parse({
      window: '20m',
      to: '2026-06-26T01:00:00.000Z',
    })

    const result = await getAgentOpsMetrics({
      repo,
      agentId: 'agent-a',
      scope: { ...scope, caseIds: [], runIds: [], runs: [] },
      query,
      now: new Date('2026-06-26T01:00:00.000Z'),
    })

    expect(result.metrics.handoffRate.value).toBeNull()
    expect(result.metrics.toolErrorRate.value).toBeNull()
    expect(result.metrics.tokenSummary.totalTokens).toBeNull()
    expect(result.metrics.latency.firstResponseMs.average).toBeNull()
    expect(result.coverage.legacyOrUnattributedDirectAnswerRows.included).toBe(false)
  })
})
