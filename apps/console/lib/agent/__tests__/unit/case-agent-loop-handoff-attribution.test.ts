import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MEMORY_STRATEGY } from '@intera/shared/defaults'
import type { ToolExecutionResult } from '../../streaming-tool-executor'

const h = vi.hoisted(() => ({
  prisma: {
    organization: { upsert: vi.fn() },
    case: { upsert: vi.fn() },
    chatMemory: { upsert: vi.fn() },
    humanTask: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('@intera/shared/prisma', () => ({ prisma: h.prisma }))

import { ChatMemoryManager } from '../../memory'
import { CaseAgentLoop } from '../../case-agent-loop'
import {
  clearSessionsForTest,
  startProcedureRun,
} from '../../session-store'

function makeLoop(input: {
  caseId: string
  orgId: string
  agentConfigId: string
  userId: string
  chatId: string
}) {
  const chatMemory = new ChatMemoryManager(input.caseId, DEFAULT_MEMORY_STRATEGY)
  const messages: any[] = []
  const traceWriter = {
    write: vi.fn(async () => {}),
    writeHumanTaskCreated: vi.fn(async () => {}),
    writeEscalated: vi.fn(async () => {}),
  }

  const loop = new CaseAgentLoop(
    {
      type: 'deposit_not_credited',
      displayName: 'Deposit not credited',
      icon: 'D',
      requiredFacts: [],
      defaultGoal: 'Investigate missing deposit.',
      escalateOn: [],
    },
    {
      caseId: input.caseId,
      orgId: input.orgId,
      agentConfigId: input.agentConfigId,
      userId: input.userId,
      chatId: input.chatId,
      config: {} as any,
      chatMemory,
      getHookEngine: () => ({ getHookNames: () => [] }) as any,
      traceWriter: traceWriter as any,
      toolRouter: { getToolDefinitions: () => [] } as any,
      getMessages: () => messages,
      addMessage: (message) => {
        messages.push(message)
      },
    },
  )

  return { loop, chatMemory, traceWriter }
}

function humanTaskToolResult(question: string): ToolExecutionResult {
  return {
    name: 'create_human_task',
    latencyMs: 8,
    output: { ok: true, output: null, latencyMs: 8 },
    toolUse: {
      id: `toolu_${question.replace(/\W+/g, '_')}`,
      name: 'create_human_task',
      input: {
        queue: 'payments',
        question,
        fields: [{ key: 'transaction_id', label: 'Transaction ID', type: 'text' }],
      },
      status: 'completed',
    },
  } as ToolExecutionResult
}

describe('CaseAgentLoop create_human_task attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearSessionsForTest()
    h.prisma.organization.upsert.mockResolvedValue({})
    h.prisma.case.upsert.mockResolvedValue({})
    h.prisma.chatMemory.upsert.mockResolvedValue({})
    h.prisma.humanTask.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'task-created' })
    h.prisma.humanTask.create.mockResolvedValue({ id: 'task-created' })
    h.prisma.humanTask.update.mockResolvedValue({ id: 'task-created' })
  })

  afterEach(() => {
    clearSessionsForTest()
  })

  it('stamps created and reused HumanTask rows plus ChatMemory with orgId, chatId, and active runId', async () => {
    const caseId = 'case-attribution-non-default'
    const orgId = 'org-non-default'
    const agentConfigId = 'agent-config-a1'
    const chatId = 'chat-attribution-a1'
    const { loop } = makeLoop({
      caseId,
      orgId,
      agentConfigId,
      userId: 'user-a1',
      chatId,
    })
    const started = startProcedureRun(caseId, {
      agentConfigId,
      procedureId: 'deposit_not_credited',
      displayName: 'Deposit not credited',
    })
    const runId = started.run.runId
    const sendEvent = vi.fn()

    await loop.handleCaseTerminalTools([humanTaskToolResult('Please review this missing deposit.')], 1, { value: 0 }, sendEvent)
    await loop.handleCaseTerminalTools([humanTaskToolResult('Customer is still waiting for a human.')], 2, { value: 0 }, sendEvent)

    expect(h.prisma.humanTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        caseId,
        orgId,
        chatId,
        runId,
        queue: 'payments',
        question: 'Please review this missing deposit.',
        status: 'pending',
      }),
    })
    expect(h.prisma.humanTask.create.mock.calls[0]?.[0].data).not.toHaveProperty('agentConfigId')

    expect(h.prisma.humanTask.update).toHaveBeenCalledWith({
      where: { id: 'task-created' },
      data: expect.objectContaining({
        orgId,
        chatId,
        runId,
        queue: 'payments',
        question: 'Customer is still waiting for a human.',
      }),
    })
    expect(h.prisma.humanTask.update.mock.calls[0]?.[0].data).not.toHaveProperty('agentConfigId')

    expect(h.prisma.chatMemory.upsert).toHaveBeenCalledTimes(2)
    for (const [args] of h.prisma.chatMemory.upsert.mock.calls) {
      expect(args.where).toEqual({ caseId })
      expect(args.update).toEqual(expect.objectContaining({
        orgId,
        chatId,
        runId,
        humanTaskStatus: 'pending',
      }))
      expect(args.create).toEqual(expect.objectContaining({
        caseId,
        orgId,
        chatId,
        runId,
        humanTaskStatus: 'pending',
      }))
      expect(args.update).not.toHaveProperty('agentConfigId')
      expect(args.create).not.toHaveProperty('agentConfigId')
    }
  })

  it('omits runId when the active ProcedureRun belongs to another AgentConfig', async () => {
    const caseId = 'case-attribution-mismatch'
    const orgId = 'org-mismatch'
    const agentConfigId = 'agent-config-current'
    const chatId = 'chat-attribution-mismatch'
    const { loop } = makeLoop({
      caseId,
      orgId,
      agentConfigId,
      userId: 'user-mismatch',
      chatId,
    })
    startProcedureRun(caseId, {
      agentConfigId: 'agent-config-other',
      procedureId: 'deposit_not_credited',
      displayName: 'Deposit not credited',
    })
    const sendEvent = vi.fn()

    await loop.handleCaseTerminalTools([humanTaskToolResult('Please review this cross-agent run.')], 1, { value: 0 }, sendEvent)
    await loop.handleCaseTerminalTools([humanTaskToolResult('Please reuse without cross-agent run attribution.')], 2, { value: 0 }, sendEvent)

    expect(h.prisma.humanTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        caseId,
        orgId,
        chatId,
        queue: 'payments',
        question: 'Please review this cross-agent run.',
        status: 'pending',
      }),
    })
    expect(h.prisma.humanTask.create.mock.calls[0]?.[0].data).not.toHaveProperty('runId')
    expect(h.prisma.humanTask.create.mock.calls[0]?.[0].data).not.toHaveProperty('agentConfigId')

    expect(h.prisma.humanTask.update).toHaveBeenCalledWith({
      where: { id: 'task-created' },
      data: expect.objectContaining({
        orgId,
        chatId,
        queue: 'payments',
        question: 'Please reuse without cross-agent run attribution.',
      }),
    })
    expect(h.prisma.humanTask.update.mock.calls[0]?.[0].data).not.toHaveProperty('runId')
    expect(h.prisma.humanTask.update.mock.calls[0]?.[0].data).not.toHaveProperty('agentConfigId')

    expect(h.prisma.chatMemory.upsert).toHaveBeenCalledTimes(2)
    for (const [args] of h.prisma.chatMemory.upsert.mock.calls) {
      expect(args.where).toEqual({ caseId })
      expect(args.update).toEqual(expect.objectContaining({
        orgId,
        chatId,
        humanTaskStatus: 'pending',
      }))
      expect(args.create).toEqual(expect.objectContaining({
        caseId,
        orgId,
        chatId,
        humanTaskStatus: 'pending',
      }))
      expect(args.update).not.toHaveProperty('runId')
      expect(args.create).not.toHaveProperty('runId')
      expect(args.update).not.toHaveProperty('agentConfigId')
      expect(args.create).not.toHaveProperty('agentConfigId')
    }
  })
})
