// Playground guardrail-trace e2e (AC-F).
// Proves a guardrail block produces a policy_hit (blocked) record
// in the port traces[] → Guardrails stage fired:true, status:'block'.
//
// Unlike AC2 (trace-contract) which tests the aggregator with synthetic records,
// AC-F drives the REAL pipeline: LLM emits tool_use → PolicyEngine.evaluate
// → TraceWriter.write('policy_hit') → aggregateTraces → Guardrails stage.

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

  // Turn 1: model tries to use the guardrail-denied tool (kb_search_org)
  const toolUseEvents = [
    { type: 'message_start', message: { id: 'm1', role: 'assistant', model: 'claude-sonnet-4-6', usage: { input_tokens: 150, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu1', name: 'kb_search_org', input: { query: 'test' } } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 12 } },
    { type: 'message_stop' },
  ]

  // Turn 2: after guardrail blocks, model produces final text
  const endTurnEvents = [
    { type: 'message_start', message: { id: 'm2', role: 'assistant', model: 'claude-sonnet-4-6', usage: { input_tokens: 200, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'I cannot search that knowledge base due to policy restrictions.' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 15 } },
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

// ── Mock prisma: policy.findMany returns a guardrail that denies kb_search_org ──
vi.mock('@intera/shared/prisma', () => {
  const writes: string[] = []

  const handler = (model: string) =>
    new Proxy({}, {
      get: (_t, op: string) =>
        vi.fn(async () => {
          if (typeof op === 'string' && op.startsWith('find')) {
            // Return a guardrail policy that denies kb_search_org
            if (model === 'policy' && op === 'findMany') {
              return [{
                id: 'pol_guard_1',
                name: 'deny_kb_search',
                orgId: 'org1',
                enabled: true,
                hook: 'preTool',
                guardrailConfig: JSON.stringify({
                  when: 'preTool',
                  match: { tools: ['kb_search_org'] },
                  check: { kind: 'rule', denyTools: ['kb_search_org'] },
                  onViolation: { action: 'block', guidance: 'Knowledge base search is not allowed.' },
                  onUnavailable: { action: 'closed' },
                }),
                rule: null,
              }]
            }
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

// Override provider mock
vi.mock('@/lib/agent/api/provider-config', () => ({
  getProviderConfig: () => ({}),
  createAgentClient: () => h.fakeClient,
  createClient: () => h.fakeClient,
}))

// Mock loadAgentConfig to return config with guardrails capabilityBindings
vi.mock('@/lib/agent/config-loader', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/agent/config-loader')>()
  return {
    ...orig,
    loadAgentConfig: vi.fn(async () => ({
      model: 'claude-sonnet-4-6',
      temperature: 0.5,
      thinkingBudget: 10000,
      maxIterations: 5,
      coreSystemPrompt: 'You are a helpful assistant.',
      coreSystemPrompt: 'You are a helpful assistant.',
      extendedThinking: false,
      memoryStrategy: { l1MaxMessages: 20, autocompactThresholdTokens: 50000 },
      policyHooks: {},
      capabilityBindings: JSON.stringify({
        guardrails: { preTool: ['deny_kb_search'], postTool: [], preFinalize: [] },
        tools: [],
        caseTypes: [],
        knowledge: [],
      }),
      name: 'Test Agent',
    })),
  }
})

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

describe('Playground guardrail-trace e2e (AC-F)', () => {
  it('AC-F — guardrail block produces fired Guardrails stage with status:block', async () => {
    vi.spyOn(OrchestratorAgent.prototype, 'planInvestigation').mockResolvedValue([{ id: 't1' } as never])
    vi.spyOn(OrchestratorAgent.prototype, 'dispatchInBackground').mockImplementation((() => undefined) as never)

    const events = await drainPlayground('Search the knowledge base')

    // Collect the trace event
    const traceEvent = events.find((e: any) => e.type === 'trace') as any
    expect(traceEvent).toBeDefined()

    const trace = traceEvent.data.trace || []

    // AC-F: Guardrails stage is fired:true with status:block
    const guardsStage = trace.find((s: any) => s.stage === 'Guardrails')
    expect(guardsStage).toBeDefined()
    expect(guardsStage.fired).toBe(true)
    expect(guardsStage.status).toBe('block')
  })
})
