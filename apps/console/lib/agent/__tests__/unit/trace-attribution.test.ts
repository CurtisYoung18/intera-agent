import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  prisma: {
    caseType: { findUnique: vi.fn(), findMany: vi.fn() },
    case: { upsert: vi.fn() },
  },
}))

vi.mock('@intera/shared/prisma', () => ({ prisma: h.prisma }))

import { createMemoryPersistence } from '@/lib/agent/persistence-port'
import { PostToolUsePhase } from '@/lib/agent/post-tool-use-phase'
import {
  closeSession,
  getActiveProcedureRun,
  recordInitialInputEvent,
  startProcedureRun,
} from '@/lib/agent/session-store'
import { TraceWriter } from '@/lib/agent/trace'
import { refreshActiveProcedureRunForStartToolResult } from '@/lib/agent/tool-interceptor'

function singleAskProcedure(stepId: string, actionId: string, field: string) {
  return {
    version: 'v2' as const,
    whenToUse: `Use when ${field} is needed.`,
    steps: [
      {
        id: stepId,
        title: `Collect ${field}`,
        guidance: `Ask for ${field}.`,
        actions: [
          {
            id: actionId,
            kind: 'ask' as const,
            label: `Ask for ${field}`,
            fields: [field],
          },
        ],
        branches: [],
      },
    ],
  }
}

function caseTypeRow(type: string, displayName: string, procedure = singleAskProcedure('collect_member', 'ask_member', 'member_id')) {
  return {
    type,
    displayName,
    description: `${displayName} procedure`,
    icon: null,
    requiredFacts: '["member_id"]',
    defaultGoal: `Resolve ${displayName}`,
    escalateOn: '[]',
    autoCloseConditions: null,
    maxAutoTurns: 3,
    procedure: JSON.stringify(procedure),
  }
}

function startToolResult(procedureId: string, id: string) {
  return {
    name: 'start_procedure',
    output: { ok: true, handled: 'system_managed' },
    latencyMs: 1,
    toolUse: {
      id,
      name: 'start_procedure',
      status: 'completed',
      input: {
        procedureId,
        reason: `Switch to ${procedureId}`,
      },
    },
  } as any
}

function askToolResult(id: string, title: string) {
  return {
    name: 'ask_user_questions',
    output: { ok: true, output: { status: 'form_requested' }, latencyMs: 1 },
    latencyMs: 1,
    toolUse: {
      id,
      name: 'ask_user_questions',
      status: 'completed',
      input: {
        title,
        description: 'Please provide the missing details.',
        fields: [
          {
            key: 'member_id',
            label: 'Member ID',
            type: 'text',
            required: true,
          },
        ],
      },
    },
  } as any
}

async function writePostToolTraces(args: {
  caseId: string
  traceWriter: TraceWriter
  toolResults: any[]
}) {
  const phase = new PostToolUsePhase({
    caseId: args.caseId,
    chatMemory: {
      applyToolResult: vi.fn(async () => {}),
      getHookHitCount: vi.fn(() => 0),
      recordHookHit: vi.fn(),
    } as any,
    getHookEngine: () => ({
      getHookNames: () => [],
      evaluate: vi.fn(async () => ({ summary: 'allow', results: [] })),
    } as any),
    hookContextBuilder: { build: vi.fn(() => ({})) } as any,
    traceWriter: args.traceWriter,
    getToolRouter: () => ({ getTool: vi.fn(() => undefined) } as any),
    addMessage: vi.fn(),
    buildToolInterceptorContext: vi.fn(() => ({} as any)),
  })

  await phase.run({
    toolResults: args.toolResults,
    toolBasedOnEpoch: new Map(args.toolResults.map((result) => [result.toolUse.id, 1])),
    iterationBasedOnInputEpoch: 1,
    iterationCount: 1,
    nudgeCount: 0,
    sendEvent: vi.fn(),
  })
}

describe('trace attribution after start_procedure switches active ProcedureRun', () => {
  const caseId = 'trace-attribution-switch'

  beforeEach(async () => {
    vi.clearAllMocks()
    await closeSession(caseId)
    h.prisma.caseType.findUnique.mockImplementation(async ({ where }: any) => {
      const type = where?.agentConfigId_type?.type
      if (type === 'deposit_not_credited') {
        return caseTypeRow('deposit_not_credited', 'Deposit not credited')
      }
      if (type === 'withdrawal_not_credited') {
        return caseTypeRow('withdrawal_not_credited', 'Withdrawal not credited')
      }
      return null
    })
    h.prisma.caseType.findMany.mockResolvedValue([])
    h.prisma.case.upsert.mockResolvedValue({})
  })

  afterEach(async () => {
    await closeSession(caseId)
  })

  it('attributes same-turn tool_result and form_request traces to withdrawal, then back to the resumed deposit run', async () => {
    const memory = createMemoryPersistence()
    const traceWriter = new TraceWriter(caseId, memory.port)
    traceWriter.setChatId('chat-trace')
    traceWriter.setRunIdProvider(() => getActiveProcedureRun(caseId)?.runId ?? null)

    recordInitialInputEvent(caseId, { content: 'My deposit is missing.' })
    const deposit = startProcedureRun(caseId, {
      agentConfigId: 'agent-a',
      procedureId: 'deposit_not_credited',
      displayName: 'Deposit not credited',
      procedure: singleAskProcedure('collect_deposit_member', 'ask_deposit_member', 'member_id'),
      requestId: 'start-deposit',
    })
    traceWriter.setRunId(deposit.run.runId)

    const makeCtx = () => ({
      caseId,
      orgId: 'org-a',
      agentConfigId: 'agent-a',
      userId: 'user-a',
      chatId: 'chat-trace',
      config: {} as any,
      caseSchema: null,
      chatMemory: {
        setCaseStatus: vi.fn(),
        setContextEntriesBulk: vi.fn(),
      } as any,
      persistence: memory.port,
      traceWriter,
      toolRouter: {} as any,
      getCaseLoop: () => null,
      dryRun: false,
      messages: [],
      getCurrentStage: () => 'investigating',
      setPendingEscalation: vi.fn(),
      activateProcedureContext: vi.fn(async () => {}),
    })

    const withdrawalTools = [
      startToolResult('withdrawal_not_credited', 'toolu_start_withdrawal'),
      askToolResult('toolu_ask_withdrawal', 'Withdrawal details required'),
    ]
    await refreshActiveProcedureRunForStartToolResult(makeCtx(), withdrawalTools, vi.fn())
    const withdrawal = getActiveProcedureRun(caseId)
    expect(withdrawal?.procedureId).toBe('withdrawal_not_credited')
    await writePostToolTraces({ caseId, traceWriter, toolResults: withdrawalTools })

    const withdrawalAskTrace = memory.traces.find((trace) =>
      trace.actionType === 'tool_result' &&
      trace.title === 'Tool: ask_user_questions' &&
      trace.payload?.includes('Withdrawal details required'),
    )
    expect(withdrawalAskTrace?.runId).toBe(withdrawal?.runId)

    await refreshActiveProcedureRunForStartToolResult(makeCtx(), [
      startToolResult('deposit_not_credited', 'toolu_start_deposit_again'),
    ], vi.fn())
    const resumedDeposit = getActiveProcedureRun(caseId)
    expect(resumedDeposit?.runId).toBe(deposit.run.runId)

    await traceWriter.write('form_request', 'Form requested: Deposit details required', {
      caseId,
      toolCallId: 'toolu_ask_deposit_again',
      title: 'Deposit details required',
    })
    const depositFormTrace = memory.traces.find((trace) =>
      trace.actionType === 'form_request' &&
      trace.title === 'Form requested: Deposit details required'
    )
    expect(depositFormTrace?.runId).toBe(deposit.run.runId)
  })
})
