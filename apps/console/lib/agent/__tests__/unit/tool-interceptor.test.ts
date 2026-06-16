import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  prisma: {
    caseType: { findUnique: vi.fn() },
    case: { upsert: vi.fn() },
  },
  startProcedureRun: vi.fn(),
}))

vi.mock('@intera/shared/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/agent/session-store', async () => {
  const actual = await vi.importActual<typeof import('@/lib/agent/session-store')>('@/lib/agent/session-store')
  return {
    ...actual,
    startProcedureRun: h.startProcedureRun,
  }
})

import { interceptToolResults } from '@/lib/agent/tool-interceptor'

describe('tool-interceptor start_procedure truth alignment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.prisma.caseType.findUnique.mockResolvedValue({
      type: 'deposit_not_credited',
      displayName: 'Deposit not credited',
      description: 'Investigate a deposit that did not reach the account.',
      icon: 'D',
      requiredFacts: '["memberId","txid"]',
      defaultGoal: 'Resolve the deposit-not-credited issue.',
      escalateOn: '[]',
      autoCloseConditions: null,
      maxAutoTurns: 3,
      procedure: JSON.stringify({
        version: 'v2',
        whenToUse: 'Use for deposit issues',
        steps: [{
          id: 'collect_txid',
          title: 'Collect TXID',
          guidance: 'Ask for proof.',
          actions: [{ id: 'ask_txid', kind: 'ask', label: 'Ask for TXID', fields: ['txid'] }],
          branches: [],
        }],
      }),
    })
    h.prisma.case.upsert.mockResolvedValue({})
    h.startProcedureRun.mockReturnValue({
      run: {
        runId: 'run-1',
        procedureId: 'deposit_not_credited',
        currentStepId: 'collect_txid',
        inputEpoch: 2,
        needsReconcile: false,
      },
      pausedRun: null,
      idempotent: false,
    })
  })

  it('sets investigating truth, aligns the Case row, and continues inline', async () => {
    const activateProcedureContext = vi.fn(async () => {})
    const setCaseStatus = vi.fn()
    const sendEvent = vi.fn()

    const result = await interceptToolResults(
      {
        caseId: 'case-123',
        orgId: 'org-a',
        agentConfigId: 'agent-a',
        userId: 'user-1',
        chatId: 'chat-1',
        config: {} as any,
        caseSchema: null,
        chatMemory: {
          setCaseStatus,
          setContextEntriesBulk: vi.fn(),
        } as any,
        persistence: {} as any,
        traceWriter: {
          write: vi.fn(async () => {}),
        } as any,
        toolRouter: {} as any,
        getCaseLoop: () => null,
        dryRun: false,
        messages: [],
        getCurrentStage: () => 'created',
        setPendingEscalation: vi.fn(),
        activateProcedureContext,
      },
      [{
        name: 'start_procedure',
        output: { ok: true },
        toolUse: {
          id: 'toolu_start_1',
          input: {
            procedureId: 'deposit_not_credited',
            reason: 'Customer said the deposit is missing.',
          },
        },
      } as any],
      sendEvent,
    )

    expect(setCaseStatus).toHaveBeenCalledWith('investigating')
    expect(h.prisma.case.upsert).toHaveBeenCalledWith({
      where: { id: 'case-123' },
      update: {
        type: 'deposit_not_credited',
        status: 'investigating',
        blocker: null,
      },
      create: {
        id: 'case-123',
        orgId: 'org-a',
        userId: 'user-1',
        type: 'deposit_not_credited',
        status: 'investigating',
        chatId: 'chat-1',
        blocker: null,
      },
    })
    expect(activateProcedureContext).toHaveBeenCalledWith(expect.objectContaining({
      type: 'deposit_not_credited',
      displayName: 'Deposit not credited',
    }))
    expect(h.startProcedureRun).toHaveBeenCalledWith('case-123', expect.objectContaining({
      agentConfigId: 'agent-a',
      procedureId: 'deposit_not_credited',
    }))
    expect(h.startProcedureRun.mock.calls[0]?.[1]).not.toHaveProperty('procedureInputs')
    expect(sendEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'case_status',
      data: expect.objectContaining({
        caseId: 'case-123',
        caseType: 'deposit_not_credited',
        runId: 'run-1',
        currentStepId: 'collect_txid',
      }),
    }))
    expect(result.action).toEqual({ kind: 'continue' })
    expect(result.toolResults[0]?.output).toMatchObject({
      ok: true,
      mode: 'inline_procedure',
      caseType: 'deposit_not_credited',
      runId: 'run-1',
      procedureSummary: {
        stepCount: 1,
        steps: [
          expect.objectContaining({
            id: 'collect_txid',
            title: 'Collect TXID',
            actionKinds: ['ask'],
            branchCount: 0,
            requiredActionCount: 1,
          }),
        ],
      },
    })
  })

  it('ignores nested structured payloads on start_procedure so runtime only trusts customer form events', async () => {
    const sendEvent = vi.fn()
    const legacyKey = `collected${'Facts'}`

    await interceptToolResults(
      {
        caseId: 'case-compat',
        orgId: 'org-a',
        agentConfigId: 'agent-a',
        userId: 'user-1',
        chatId: 'chat-1',
        config: {} as any,
        caseSchema: null,
        chatMemory: {
          setCaseStatus: vi.fn(),
          setContextEntriesBulk: vi.fn(),
        } as any,
        persistence: {} as any,
        traceWriter: {
          write: vi.fn(async () => {}),
        } as any,
        toolRouter: {} as any,
        getCaseLoop: () => null,
        dryRun: false,
        messages: [],
        getCurrentStage: () => 'created',
        setPendingEscalation: vi.fn(),
        activateProcedureContext: vi.fn(async () => {}),
      },
      [{
        name: 'start_procedure',
        output: { ok: true },
        toolUse: {
          id: 'toolu_start_compat',
          input: {
            procedureId: 'deposit_not_credited',
            [legacyKey]: {
              member_id: 'JAYA113C88F',
              request_human_support: true,
            },
          },
        },
      } as any],
      sendEvent,
    )

    expect(h.startProcedureRun).toHaveBeenCalledWith('case-compat', expect.objectContaining({
      agentConfigId: 'agent-a',
      procedureId: 'deposit_not_credited',
    }))
    expect(h.startProcedureRun.mock.calls[0]?.[1]).not.toHaveProperty('procedureInputs')
  })

  it('does not override the procedure selected by the model', async () => {
    h.prisma.caseType.findUnique.mockImplementation(async ({ where }: any) => {
      const type = where.agentConfigId_type.type
      if (type === 'deposit_not_credited') {
        return {
          type: 'deposit_not_credited',
          displayName: 'Deposit not credited',
          description: 'Investigate a deposit that did not reach the customer.',
          icon: 'D',
          requiredFacts: '["memberId","amount"]',
          defaultGoal: 'Resolve the deposit-not-credited issue.',
          escalateOn: '[]',
          autoCloseConditions: null,
          maxAutoTurns: 3,
          procedure: JSON.stringify({
            version: 'v2',
            whenToUse: 'Use for deposit issues',
            steps: [{
              id: 'collect_deposit',
              title: 'Collect deposit details',
              guidance: 'Ask for deposit proof.',
              actions: [{ id: 'ask_deposit', kind: 'ask', label: 'Ask for deposit details', fields: ['amount'] }],
              branches: [],
            }],
          }),
        }
      }
      return null
    })
    h.startProcedureRun.mockReturnValue({
      run: {
        runId: 'run-deposit',
        procedureId: 'deposit_not_credited',
        currentStepId: 'collect_deposit',
        inputEpoch: 1,
        needsReconcile: false,
      },
      pausedRun: null,
      idempotent: false,
    })
    const activateProcedureContext = vi.fn(async () => {})
    const setCaseStatus = vi.fn()
    const sendEvent = vi.fn()

    const result = await interceptToolResults(
      {
        caseId: 'case-withdrawal',
        orgId: 'org-a',
        agentConfigId: 'agent-a',
        userId: 'user-1',
        chatId: 'chat-1',
        config: {} as any,
        caseSchema: null,
        chatMemory: {
          setCaseStatus,
          setContextEntriesBulk: vi.fn(),
        } as any,
        persistence: {} as any,
        traceWriter: {
          write: vi.fn(async () => {}),
        } as any,
        toolRouter: {} as any,
        getCaseLoop: () => null,
        dryRun: false,
        messages: [{ role: 'user', content: '我提了800元一直没到账，帮我查一下' }] as any,
        getCurrentStage: () => 'created',
        setPendingEscalation: vi.fn(),
        activateProcedureContext,
      },
      [{
        name: 'start_procedure',
        output: { ok: true },
        toolUse: {
          id: 'toolu_start_wrong_money_direction',
          input: {
            procedureId: 'deposit_not_credited',
            reason: 'Customer reports funds not credited.',
          },
        },
      } as any],
      sendEvent,
    )

    expect(h.prisma.caseType.findUnique).toHaveBeenCalledWith({
      where: { agentConfigId_type: { agentConfigId: 'agent-a', type: 'deposit_not_credited' } },
    })
    expect(h.startProcedureRun).toHaveBeenCalledWith('case-withdrawal', expect.objectContaining({
      procedureId: 'deposit_not_credited',
      reason: 'Customer reports funds not credited.',
    }))
    expect(activateProcedureContext).toHaveBeenCalledWith(expect.objectContaining({
      type: 'deposit_not_credited',
      displayName: 'Deposit not credited',
    }))
    expect(result.toolResults[0]?.output).toMatchObject({
      ok: true,
      mode: 'inline_procedure',
      requestedProcedureId: 'deposit_not_credited',
      procedureId: 'deposit_not_credited',
      caseType: 'deposit_not_credited',
      runId: 'run-deposit',
    })
    expect(result.toolResults[0]?.output).not.toHaveProperty('routingCorrection')
  })
})
