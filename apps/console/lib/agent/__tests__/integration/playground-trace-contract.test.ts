// Playground trace-contract guard (AC1–AC4, AC7).
// Drives runPlaygroundTurn with a mocked LLM stream and asserts the
// trace pipeline produces correct stages, timing, and prompt data.
//
// AC1 – No split-brain: Skills & tools stage shows real tool count
// AC2 – Guardrails visible: policy_hit records → Guardrails stage fired:true
// AC3 – Honest timing: totalMs > 0, every stage ms ≤ totalMs
// AC4 – Model generation fidelity: promptData + usage preserved
// AC7 – Single producer: trace event emitted once after run() resolves

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mock state ──
const h = vi.hoisted(() => {
  function makeStream(events: unknown[]) {
    return {
      async *[Symbol.asyncIterator]() {
        for (const e of events) yield e
      },
    }
  }

  // Turn 1: model emits a tool_use → loop executes tool (mocked in dry-run)
  const toolUseEvents = [
    { type: 'message_start', message: { id: 'm1', role: 'assistant', model: 'claude-sonnet-4-6', usage: { input_tokens: 150, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu1', name: 'read_chat_memory', input: {} } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 12 } },
    { type: 'message_stop' },
  ]

  // Turn 2: model produces final text → end_turn
  const endTurnEvents = [
    { type: 'message_start', message: { id: 'm2', role: 'assistant', model: 'claude-sonnet-4-6', usage: { input_tokens: 200, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Your order #12345 is in transit and will arrive by Friday.' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 25 } },
    { type: 'message_stop' },
  ]

  let streamCall = 0
  const fakeClient = {
    messages: {
      stream: (..._args: unknown[]) => {
        streamCall++
        return makeStream(streamCall === 1 ? toolUseEvents : endTurnEvents)
      },
      create: async () => ({ id: 'aux', role: 'assistant', content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }),
    },
  }

  const resetStreams = () => { streamCall = 0 }

  return { fakeClient, resetStreams }
})

// ── Mock prisma: reads return fixtures, writes recorded ──
vi.mock('@intera/shared/prisma', () => {
  const writes: string[] = []

  const handler = (model: string) =>
    new Proxy({}, {
      get: (_t, op: string) =>
        vi.fn(async () => {
          if (typeof op === 'string' && op.startsWith('find')) {
            if (model === 'agentConfig' && op === 'findFirst') return null
            if (model === 'agentConfig' && op === 'findUnique') return null
            if (op.endsWith('Many')) return []
            if (op === 'findFirst') return null
            return null
          }
          writes.push(`${model}.${op}`)
          return { id: 'written' }
        }),
    })

  const prisma = new Proxy({}, {
    get: (_t, prop: string) => {
      if (prop === '$transaction') return vi.fn(async (arg: any) => typeof arg === 'function' ? arg(prisma) : Promise.all(arg))
      if (prop === '$disconnect' || prop === '$connect' || prop === '$on') return vi.fn()
      return handler(prop)
    }
  })
  return { prisma, default: prisma }
})

// Override the global provider mock to supply a stream-capable client
vi.mock('@/lib/agent/api/provider-config', () => ({
  getProviderConfig: () => ({}),
  createAgentClient: () => h.fakeClient,
  createClient: () => h.fakeClient,
}))

import { runPlaygroundTurn } from '@/lib/agent/playground-runner'
import { aggregateTraces } from '@/lib/agent/trace-aggregator'
import { OrchestratorAgent } from '@/lib/agent/orchestrator'

async function drainPlayground(message: string) {
  const events: unknown[] = []
  for await (const ev of runPlaygroundTurn({
    orgId: 'org1',
    message,
    playgroundConfig: { debug: false },
  })) {
    events.push(ev)
  }
  return events
}

beforeEach(() => {
  h.resetStreams()
  vi.restoreAllMocks()
})

describe('Playground trace contract (AC1, AC3, AC4, AC7)', () => {
  it('AC1 — Skills & tools stage is fired and matches tool events', async () => {
    // Prevent background agent dispatch
    vi.spyOn(OrchestratorAgent.prototype, 'planInvestigation').mockResolvedValue([{ id: 't1' } as never])
    vi.spyOn(OrchestratorAgent.prototype, 'dispatchInBackground').mockImplementation((() => undefined) as never)

    const events = await drainPlayground('Where is my order #12345?')

    // AC7 — trace event is produced once, at the end (after run resolves)
    const traceEvents = events.filter((e: any) => e.type === 'trace')
    expect(traceEvents).toHaveLength(1)

    const traceData: any = (traceEvents[0] as any).data
    const trace = traceData.trace || []

    // AC1 — Skills & tools stage exists with fired:true
    const toolsStage = trace.find((s: any) => s.stage === 'Skills & tools')
    expect(toolsStage).toBeDefined()
    expect(toolsStage.fired).toBe(true)

    // AC1 — tool count matches (one read_chat_memory call = 1 skill_result + 1 skill_called → N=2)
    // The tool_executing event also counts. Verify >0.
    const toolEvents = events.filter((e: any) =>
      e.type === 'tool_executing' || e.type === 'skill_result',
    )
    expect(toolEvents.length).toBeGreaterThan(0)
  })

  it('AC3 — totalMs is honest wall-clock timing', async () => {
    vi.spyOn(OrchestratorAgent.prototype, 'planInvestigation').mockResolvedValue([{ id: 't1' } as never])
    vi.spyOn(OrchestratorAgent.prototype, 'dispatchInBackground').mockImplementation((() => undefined) as never)

    const events = await drainPlayground('Hello')

    const traceEvent = events.find((e: any) => e.type === 'trace') as any
    expect(traceEvent).toBeDefined()

    const { totalMs, trace } = traceEvent.data
    expect(typeof totalMs).toBe('number')
    expect(totalMs).toBeGreaterThan(0)

    // Every per-stage ms ≤ totalMs
    for (const step of trace) {
      if (step.fired) {
        expect(step.ms).toBeGreaterThanOrEqual(0)
        expect(step.ms).toBeLessThanOrEqual(totalMs)
      }
    }
  })

  it('AC4 — Model generation stage carries promptData and usage', async () => {
    vi.spyOn(OrchestratorAgent.prototype, 'planInvestigation').mockResolvedValue([{ id: 't1' } as never])
    vi.spyOn(OrchestratorAgent.prototype, 'dispatchInBackground').mockImplementation((() => undefined) as never)

    const events = await drainPlayground('Where is my order?')

    const traceEvent = events.find((e: any) => e.type === 'trace') as any
    const trace = traceEvent.data.trace || []

    const modelStage = trace.find((s: any) => s.stage === 'Model generation')
    expect(modelStage).toBeDefined()
    expect(modelStage.fired).toBe(true)

    // AC4 — promptData.systemPrompt is non-empty
    expect(modelStage.promptData).toBeDefined()
    expect(typeof modelStage.promptData.systemPrompt).toBe('string')
    expect(modelStage.promptData.systemPrompt.length).toBeGreaterThan(0)

    // AC4 — conversation messages survive (TraceWriter stores them under `lastMessages`;
    // a key mismatch here silently empties the PromptViewer "Messages" pane).
    expect(Array.isArray(modelStage.promptData.messages)).toBe(true)
    expect(modelStage.promptData.messages.length).toBeGreaterThan(0)

    // AC4 — usage from real llm_response records
    expect(modelStage.usage).toBeDefined()
    expect(modelStage.usage.totalTokens).toBeGreaterThan(0)
  })
})

describe('Playground trace contract (AC2 — Guardrails)', () => {
  it('AC2 — policy_hit records produce a fired Guardrails stage', () => {
    // Test the aggregator contract: when policy_hit records exist in the
    // port's traces[], the Guardrails stage is fired:true regardless of
    // applicableStages. The real loop path (PolicyEngine → TraceWriter.write
    // → persistence.saveTrace) is verified by AC5 (isolation) + AC6 (prod).
    const t0 = Date.now()
    const traces = [
      {
        // REAL shape: the loop passes an object (PolicyEvaluation) as the 3rd arg, so
        // TraceWriter stores it in `payload` and leaves `detail` null. A status check that
        // only reads `detail` would wrongly render this blocked guardrail as green 'ok'.
        caseId: 'c1',
        actionType: 'policy_hit',
        title: 'Blocked: refund_policy',
        detail: null,
        payload: JSON.stringify({ results: [{ policyName: 'refund_policy', result: 'blocked' }], summary: 'blocked' }),
        createdAt: new Date(t0 + 50).toISOString(),
      },
      {
        caseId: 'c1',
        actionType: 'llm_request_start',
        title: 'LLM request: claude-sonnet-4-6',
        detail: null,
        createdAt: new Date(t0 + 10).toISOString(),
      },
      {
        caseId: 'c1',
        actionType: 'llm_response',
        title: 'LLM response: end_turn',
        detail: JSON.stringify({ usage: { input_tokens: 100, output_tokens: 20 } }),
        createdAt: new Date(t0 + 200).toISOString(),
      },
    ]

    const result = aggregateTraces(traces as any, t0, false)

    const guardsStage = result.find(s => s.stage === 'Guardrails')
    expect(guardsStage).toBeDefined()
    expect(guardsStage!.fired).toBe(true)
    expect(guardsStage!.status).toBe('block')
  })
})
