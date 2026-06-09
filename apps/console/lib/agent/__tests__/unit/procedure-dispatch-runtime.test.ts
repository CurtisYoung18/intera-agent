import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Message } from '@intera/shared/types'
import { DEFAULT_MEMORY_STRATEGY } from '@intera/shared/defaults'
import { ChatMemoryManager } from '../../memory'
import { ToolRouter } from '../../tools'
import { interceptToolResults, type ToolInterceptorContext } from '../../tool-interceptor'
import { OrchestratorAgent } from '../../orchestrator'
import type { ToolExecutionResult } from '../../streaming-tool-executor'

const h = vi.hoisted(() => {
  const rows: Record<string, Record<string, unknown>> = {
    deposit_issue: {
      type: 'deposit_issue',
      displayName: 'Deposit Issue',
      icon: 'case',
      description: 'Deposit support procedure',
      requiredFacts: '["member_id","amount"]',
      stages: '["created","investigating"]',
      stageConfigs: '{}',
      defaultGoal: 'Resolve the deposit issue.',
      escalateOn: '["payments"]',
      executionMode: 'stage',
      sop: null,
      requireHumanReview: false,
      procedure: JSON.stringify({
        steps: [
          { id: 'collect_deposit', action: 'ask', guidance: 'Collect deposit details', required: true },
          { id: 'check_deposit', action: 'use', target: 'get_latest_deposit', required: true },
          { id: 'finalize_deposit', action: 'finalize', required: true },
        ],
      }),
    },
    withdrawal_status: {
      type: 'withdrawal_status',
      displayName: 'Withdrawal Status',
      icon: 'case',
      description: 'Withdrawal support procedure',
      requiredFacts: '["member_id"]',
      stages: '["created","investigating"]',
      stageConfigs: '{}',
      defaultGoal: 'Resolve the withdrawal question.',
      escalateOn: '["payments"]',
      executionMode: 'stage',
      sop: null,
      requireHumanReview: false,
      procedure: JSON.stringify({
        steps: [
          { id: 'check_withdrawal', action: 'use', target: 'get_latest_withdrawal', required: true },
          { id: 'finalize_withdrawal', action: 'finalize', required: true },
        ],
      }),
    },
  }

  return {
    caseTypeFindUnique: vi.fn(async (args: any) => {
      const type = args?.where?.agentConfigId_type?.type
      return rows[type] ?? null
    }),
  }
})

vi.mock('@intera/shared/prisma', () => ({
  prisma: {
    caseType: { findUnique: h.caseTypeFindUnique },
  },
}))

function toolResult(input: Record<string, unknown>, id = crypto.randomUUID()): ToolExecutionResult {
  return {
    name: 'dispatch_case_agent',
    latencyMs: 1,
    output: { ok: true, handled: 'engine_managed' },
    toolUse: {
      id,
      name: 'dispatch_case_agent',
      input,
      status: 'completed',
    },
  }
}

function toolResultMessage(toolUseId: string): Message {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ tool_use_id: toolUseId, type: 'tool_result', content: '{}' }] as unknown as string,
    createdAt: new Date(),
  } as Message
}

function makeContext(chatMemory = new ChatMemoryManager('chat_shell_1', DEFAULT_MEMORY_STRATEGY)) {
  const ensureCase = vi.fn(async () => {})
  const saveMemory = vi.fn(async () => {})
  const traceWrite = vi.fn(async () => {})
  const activationCalls: unknown[] = []
  const messages: Message[] = []

  const ctx: ToolInterceptorContext = {
    caseId: 'chat_shell_1',
    orgId: 'org_1',
    agentConfigId: 'agent_1',
    userId: 'user_1',
    chatId: 'chat_1',
    config: {
      model: 'test-model',
      temperature: 0,
      thinkingBudget: 0,
      maxIterations: 4,
      extendedThinking: false,
      memoryStrategy: DEFAULT_MEMORY_STRATEGY,
    },
    caseSchema: null,
    chatMemory,
    persistence: {
      ensureCase,
      saveMemory,
      saveMessages: vi.fn(async () => {}),
      saveTrace: vi.fn(async () => {}),
      createHumanTask: vi.fn(async () => {}),
      flush: vi.fn(async () => {}),
    },
    traceWriter: { write: traceWrite } as any,
    toolRouter: new ToolRouter('agent_1'),
    getCaseLoop: () => null,
    dryRun: false,
    messages,
    getCurrentStage: () => 'created',
    setPendingEscalation: vi.fn(),
    activateProcedureContext: vi.fn(async (schema) => {
      activationCalls.push(schema)
    }),
  }

  return { ctx, ensureCase, saveMemory, traceWrite, activationCalls, messages }
}

function procedureRuntime(chatMemory: ChatMemoryManager) {
  return chatMemory.getInternalState('__intera_procedure_runtime') as any
}

beforeEach(() => {
  vi.restoreAllMocks()
  h.caseTypeFindUnique.mockClear()
})

describe('dispatch_case_agent compatibility wrapper for inline Procedures', () => {
  it('starts a Procedure inline without dispatching a background agent or creating a durable Case', async () => {
    const dispatchSpy = vi
      .spyOn(OrchestratorAgent.prototype, 'dispatchInBackground')
      .mockImplementation((() => undefined) as never)
    const { ctx, ensureCase, saveMemory, activationCalls, messages } = makeContext()
    const tr = toolResult({
      procedureId: 'deposit_issue',
      reason: 'Customer says a deposit was not credited.',
      confidence: 0.91,
      collectedFacts: { amount: 100 },
    }, 'tu_proc_1')
    messages.push(toolResultMessage('tu_proc_1'))
    const events: unknown[] = []

    const result = await interceptToolResults(ctx, [tr], (event) => events.push(event))

    expect(result.action.kind).toBe('continue')
    expect(dispatchSpy).not.toHaveBeenCalled()
    expect(ensureCase).not.toHaveBeenCalled()
    expect(saveMemory).not.toHaveBeenCalled()
    expect(activationCalls).toHaveLength(1)
    expect((activationCalls[0] as any).type).toBe('deposit_issue')
    expect((activationCalls[0] as any).executionMode).toBe('cc')
    expect((activationCalls[0] as any).procedure.steps).toHaveLength(3)

    const runtime = procedureRuntime(ctx.chatMemory)
    expect(runtime.activeProcedureRun.procedureId).toBe('deposit_issue')
    expect(runtime.pendingProcedureRuns).toEqual([])
    expect(ctx.chatMemory.getConfirmedFacts().amount).toBe(100)
    expect(ctx.chatMemory.getConfirmedFacts()).not.toHaveProperty('__intera_procedure_runtime')
    expect(ctx.chatMemory.buildCompactionSummary()).not.toContain('__intera_procedure_runtime')

    const payload = JSON.parse(((messages[0].content as unknown as any[])[0]).content)
    expect(payload.mode).toBe('inline_procedure')
    expect(payload.durableCaseCreated).toBe(false)
    expect(payload.procedureSummary.stepCount).toBe(3)
    expect(payload.instruction).toContain('main customer-facing Agent')
    expect(events).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'sub_agent_start' }),
      expect.objectContaining({ type: 'skill_call' }),
      expect.objectContaining({ type: 'skill_result' }),
    ]))
  })

  it('pauses the active Procedure by default on topic switch and starts the new Procedure inline', async () => {
    const dispatchSpy = vi
      .spyOn(OrchestratorAgent.prototype, 'dispatchInBackground')
      .mockImplementation((() => undefined) as never)
    const sharedMemory = new ChatMemoryManager('chat_shell_1', DEFAULT_MEMORY_STRATEGY)
    const first = makeContext(sharedMemory)
    const firstTool = toolResult({ procedureId: 'deposit_issue', reason: 'Deposit issue.' }, 'tu_a')
    first.messages.push(toolResultMessage('tu_a'))

    await interceptToolResults(first.ctx, [firstTool], () => {})

    const second = makeContext(sharedMemory)
    const secondTool = toolResult({ procedureId: 'withdrawal_status', reason: 'Customer changed topic to withdrawal.' }, 'tu_b')
    second.messages.push(toolResultMessage('tu_b'))

    await interceptToolResults(second.ctx, [secondTool], () => {})

    const runtime = procedureRuntime(sharedMemory)
    expect(runtime.activeProcedureRun.procedureId).toBe('withdrawal_status')
    expect(runtime.pendingProcedureRuns).toHaveLength(1)
    expect(runtime.pendingProcedureRuns[0].procedureId).toBe('deposit_issue')
    expect(runtime.pendingProcedureRuns[0].status).toBe('paused')
    expect(first.ensureCase).not.toHaveBeenCalled()
    expect(second.ensureCase).not.toHaveBeenCalled()
    expect(dispatchSpy).not.toHaveBeenCalled()
  })
})
