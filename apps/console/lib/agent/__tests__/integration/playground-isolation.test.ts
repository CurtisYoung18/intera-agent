// End-to-end isolation guard for the Playground (dry-run) pipeline.
//
// Unlike the unit-level invariants in playground-safety.test.ts (which check the
// helper functions in isolation), this test drives the REAL pipeline:
//   runPlaygroundTurn → AgentLoop.create({ dryRun:true, persistence: memory }) → run()
// with a mocked Anthropic stream that makes the model call `dispatch_case_agent`.
//
// It asserts the two dangerous, easy-to-regress invariants that the loop-only
// audit kept missing:
//   1. NO real background agent is spawned (OrchestratorAgent.dispatchInBackground).
//   2. ZERO real prisma writes happen (actionTrace/humanTask/chatSession/userProfile/...).
//
// These fail on the pre-fix code (orchestrator dispatched + TraceWriter writes
// actionTrace), which is the red-before-green proof.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Shared mock state (hoisted above the vi.mock factories) ──
const h = vi.hoisted(() => {
  const writes: string[] = []

  function makeStream(events: unknown[]) {
    return {
      async *[Symbol.asyncIterator]() {
        for (const e of events) yield e
      },
    }
  }

  // Iteration 1: model emits a dispatch_case_agent tool call.
  const dispatchEvents = [
    { type: 'message_start', message: { id: 'm1', role: 'assistant', model: 'x', usage: { input_tokens: 1, output_tokens: 0 } } },
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'tu1', name: 'dispatch_case_agent', input: { caseType: 'deposit_issue' } },
    },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } },
    { type: 'message_stop' },
  ]

  // Iteration 2+: model produces a final text answer → end_turn (terminates the loop).
  const endEvents = [
    { type: 'message_start', message: { id: 'm2', role: 'assistant', model: 'x', usage: { input_tokens: 1, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'All set.' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
    { type: 'message_stop' },
  ]

  let streamCall = 0
  const fakeClient = {
    messages: {
      stream: (..._args: unknown[]) => {
        streamCall++
        return makeStream(streamCall === 1 ? dispatchEvents : endEvents)
      },
      // Some auxiliary loop steps (summaries/compaction) may call create — keep it safe.
      create: async () => ({ id: 'aux', role: 'assistant', content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }),
    },
  }

  const resetStreams = () => { streamCall = 0 }

  return { writes, fakeClient, resetStreams }
})

// ── Mock prisma: reads return fixtures, any write is recorded (and must stay 0) ──
vi.mock('@intera/shared/prisma', () => {
  const caseTypeRow = {
    type: 'deposit_issue',
    displayName: 'Deposit Issue',
    icon: '💰',
    description: 'Deposit problems',
    requiredFacts: '[]',
    stages: '["created"]',
    stageConfigs: '{}',
    defaultGoal: 'Resolve the deposit issue.',
    escalateOn: '[]',
    executionMode: 'stage',
    enabled: true,
  }
  // A knowledge source that WOULD need auto-heal — proves heal writes are skipped in dry-run.
  const healableKs = { id: 'ks1', orgId: 'org1', name: 'docs', enabled: true, rerankVersion: null, topK: 5, docCorrelation: 0.5 }

  const handler = (model: string) =>
    new Proxy({}, {
      get: (_t, op: string) =>
        vi.fn(async () => {
          if (typeof op === 'string' && op.startsWith('find')) {
            if (model === 'caseType' && op === 'findUnique') return caseTypeRow
            if (model === 'knowledgeSource' && op === 'findMany') return [healableKs]
            if (op.endsWith('Many')) return []
            if (op === 'findFirst') return null
            return null
          }
          // create / update / upsert / delete / *Many writes → record as a real DB write
          h.writes.push(`${model}.${op}`)
          return { id: 'written' }
        }),
    })

  const prisma = new Proxy({}, { get: (_t, model: string) => handler(model) })
  return { prisma, default: prisma }
})

// ── Mock the Anthropic client factory ──
vi.mock('@/lib/agent/api/provider-config', () => ({
  getProviderConfig: () => ({}),
  createAgentClient: () => h.fakeClient,
  createClient: () => h.fakeClient,
}))

// Imports AFTER mocks so they pick up the mocked modules.
import { runPlaygroundTurn } from '@/lib/agent/playground-runner'
import { TraceWriter } from '@/lib/agent/trace'
import { SkillRouter } from '@/lib/agent/skills'
import { OrchestratorAgent } from '@/lib/agent/orchestrator'

async function drainPlayground(message: string) {
  const events: unknown[] = []
  for await (const ev of runPlaygroundTurn({
    orgId: 'org1',
    message,
    playgroundConfig: {
      debug: false,
    },
  })) {
    events.push(ev)
  }
  return events
}

beforeEach(() => {
  h.writes.length = 0
  h.resetStreams()
  vi.restoreAllMocks()
})

describe('Playground isolation (end-to-end, dry-run)', () => {
  it('dispatch_case_agent does NOT spawn a real background agent', async () => {
    const planSpy = vi
      .spyOn(OrchestratorAgent.prototype, 'planInvestigation')
      .mockResolvedValue([{ id: 't1' } as never])
    const dispatchSpy = vi
      .spyOn(OrchestratorAgent.prototype, 'dispatchInBackground')
      .mockImplementation((() => undefined) as never)

    await drainPlayground('I have a deposit problem')

    // The whole point: in dry-run, the real orchestrator must never run.
    expect(dispatchSpy).not.toHaveBeenCalled()
    expect(planSpy).not.toHaveBeenCalled()
  })

  it('a full dry-run turn performs ZERO real prisma writes', async () => {
    vi.spyOn(OrchestratorAgent.prototype, 'planInvestigation').mockResolvedValue([{ id: 't1' } as never])
    vi.spyOn(OrchestratorAgent.prototype, 'dispatchInBackground').mockImplementation((() => undefined) as never)

    await drainPlayground('I have a deposit problem')

    // Give fire-and-forget writes (e.g. TraceWriter) a tick to land if they were going to.
    await new Promise((r) => setTimeout(r, 10))

    expect(h.writes, `unexpected DB writes: ${h.writes.join(', ')}`).toHaveLength(0)
  })
})

describe('TraceWriter dry-run gate', () => {
  it('does NOT write actionTrace when dryRun=true', async () => {
    h.writes.length = 0
    const w = new TraceWriter('case1', true)
    await w.write('loop_decision', 'test')
    await new Promise((r) => setTimeout(r, 5))
    expect(h.writes).toHaveLength(0)
  })

  it('DOES write actionTrace when dryRun=false', async () => {
    h.writes.length = 0
    const w = new TraceWriter('case1', false)
    await w.write('loop_decision', 'test')
    await new Promise((r) => setTimeout(r, 5))
    expect(h.writes).toContain('actionTrace.create')
  })
})

describe('SkillRouter auto-heal dry-run gate', () => {
  it('does NOT issue knowledgeSource.update when dryRun=true', async () => {
    h.writes.length = 0
    await SkillRouter.create('org1', true)
    expect(h.writes).not.toContain('knowledgeSource.update')
  })

  it('DOES issue knowledgeSource.update when dryRun=false (heal active)', async () => {
    h.writes.length = 0
    await SkillRouter.create('org1', false)
    expect(h.writes).toContain('knowledgeSource.update')
  })
})

// ── Additional tool-specific isolation scenarios ──
// Each must fail (real write) when its dryRun guard is removed, and pass when present.

function makeToolStream(toolName: string, toolInput: Record<string, unknown> = {}) {
  const endEvents = [
    { type: 'message_start', message: { id: 'm2', role: 'assistant', model: 'x', usage: { input_tokens: 1, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Done.' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } },
    { type: 'message_stop' },
  ]
  const toolEvents = [
    { type: 'message_start', message: { id: 'm1', role: 'assistant', model: 'x', usage: { input_tokens: 1, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu1', name: toolName, input: toolInput } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } },
    { type: 'message_stop' },
  ]
  let streamCall = 0
  return {
    stream(..._args: unknown[]) {
      streamCall++
      const events = streamCall === 1 ? toolEvents : endEvents
      return {
        async *[Symbol.asyncIterator]() { for (const e of events) yield e },
      }
    },
  }
}

describe('Playground isolation — additional operational tools', () => {
  beforeEach(() => {
    h.writes.length = 0
    h.resetStreams()
  })

  it('dispatch_subagent produces ZERO real prisma writes (dryRun intercepts)', async () => {
    vi.spyOn(OrchestratorAgent.prototype, 'planInvestigation').mockResolvedValue([{ id: 't1' } as never])
    const dispatchSpy = vi.spyOn(OrchestratorAgent.prototype, 'dispatchInBackground').mockImplementation((() => undefined) as never)

    const sub = makeToolStream('dispatch_subagent', { agentType: 'verifier', task: 'check order' })
    const streamSpy = vi.spyOn(h.fakeClient.messages, 'stream').mockImplementation(sub.stream.bind(sub) as any)

    await drainPlayground('dispatch a sub-agent to check order ORDER123')
    await new Promise((r) => setTimeout(r, 10))

    expect(dispatchSpy).not.toHaveBeenCalled()
    expect(h.writes, `unexpected DB writes: ${h.writes.join(', ')}`).toHaveLength(0)
    streamSpy.mockRestore()
    dispatchSpy.mockRestore()
  })

  it('finalize_case produces ZERO real prisma writes (dryRun intercepts)', async () => {
    const fin = makeToolStream('finalize_case', { verdict: 'resolved' })
    const streamSpy = vi.spyOn(h.fakeClient.messages, 'stream').mockImplementation(fin.stream.bind(fin) as any)

    await drainPlayground('resolve the case now')
    await new Promise((r) => setTimeout(r, 10))

    expect(h.writes, `unexpected DB writes: ${h.writes.join(', ')}`).toHaveLength(0)
    streamSpy.mockRestore()
  })

  it('request_user_input produces ZERO real prisma writes (dryRun intercepts)', async () => {
    const req = makeToolStream('request_user_input', { question: 'What is your order ID?' })
    const streamSpy = vi.spyOn(h.fakeClient.messages, 'stream').mockImplementation(req.stream.bind(req) as any)

    await drainPlayground('I need to report an issue')

    expect(h.writes, `unexpected DB writes: ${h.writes.join(', ')}`).toHaveLength(0)
    streamSpy.mockRestore()
  })
})
