import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => {
  const prisma = {
    $transaction: vi.fn(async (ops) => ops),
    humanTask: { findUnique: vi.fn(), findFirst: vi.fn() },
    case: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), upsert: vi.fn() },
    caseType: { findUnique: vi.fn() },
    tool: { findMany: vi.fn() },
    knowledgeSource: { findMany: vi.fn() },
    message: { findMany: vi.fn(), upsert: vi.fn() },
    chatMemory: { upsert: vi.fn() },
  }
  return {
    prisma,
    repoForOrg: vi.fn(() => ({ orgId: 'org-a' })),
    resolveOrgFromApiKey: vi.fn(),
    isTrustedInternalCall: vi.fn(),
    loadAgentConfig: vi.fn(),
    buildModePrompt: vi.fn(),
    agentLoopCreate: vi.fn(),
  }
})

vi.mock('@intera/shared/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/db/repo-for-org', () => ({ repoForOrg: h.repoForOrg }))
vi.mock('@/lib/api-auth', () => ({
  resolveOrgFromApiKey: h.resolveOrgFromApiKey,
  isTrustedInternalCall: h.isTrustedInternalCall,
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true })),
  clientIp: vi.fn(() => '127.0.0.1'),
}))
vi.mock('@/lib/agent/config-loader', () => ({
  loadAgentConfig: h.loadAgentConfig,
}))
vi.mock('@/lib/agent/buildModePrompt', () => ({
  buildModePrompt: h.buildModePrompt,
}))
vi.mock('@/lib/agent/loop', () => ({
  AgentLoop: { create: h.agentLoopCreate },
}))

import { POST } from '@/app/api/messages/route'
import { closeSession, enqueueMessageOrCreate, getOrCreateSession, hasSession } from '@/lib/agent/session-store'

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function readSse(res: Response) {
  const text = await res.text()
  return text
    .split('\n\n')
    .filter(Boolean)
    .map((chunk) => JSON.parse(chunk.replace(/^data: /, '')))
}

function mockLoop(overrides: Partial<{
  loadMemory: ReturnType<typeof vi.fn>
  loadMessages: ReturnType<typeof vi.fn>
  run: ReturnType<typeof vi.fn>
  getMemorySummary: ReturnType<typeof vi.fn>
  getCaseType: ReturnType<typeof vi.fn>
}> = {}) {
  return {
    loadMemory: overrides.loadMemory ?? vi.fn(),
    loadMessages: overrides.loadMessages ?? vi.fn(),
    run: overrides.run ?? vi.fn(async () => ({
      messages: [],
      caseStatus: 'created',
      transition: 'next_turn',
      reason: 'end_turn',
    })),
    getMemorySummary: overrides.getMemorySummary ?? vi.fn(() => ({
      confirmedFacts: {},
      missingFacts: [],
      toolsCalled: [],
      toolResults: {},
      keyEvents: [],
      summary: '',
      todos: null,
      caseStatus: 'created',
    })),
    getCaseType: overrides.getCaseType ?? vi.fn(() => 'general'),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  closeSession('case-error-release')
  closeSession('case-cross-org')
  closeSession('case-queued')
  closeSession('case-drain')

  h.resolveOrgFromApiKey.mockResolvedValue({ orgId: 'org-a', agentConfigId: 'agent-a' })
  h.isTrustedInternalCall.mockReturnValue(false)
  h.loadAgentConfig.mockResolvedValue({
    model: 'test-model',
    temperature: 0,
    thinkingBudget: 0,
    maxIterations: 1,
    memoryStrategy: {},
    coreSystemPrompt: '',
  })
  h.buildModePrompt.mockResolvedValue({ prompt: 'system prompt', basePrompt: 'core prompt' })

  h.prisma.humanTask.findUnique.mockResolvedValue(null)
  h.prisma.humanTask.findFirst.mockResolvedValue(null)
  h.prisma.case.findUnique.mockResolvedValue(null)
  h.prisma.case.findMany.mockResolvedValue([])
  h.prisma.case.create.mockResolvedValue({ id: 'case-created' })
  h.prisma.case.upsert.mockResolvedValue({})
  h.prisma.caseType.findUnique.mockResolvedValue(null)
  h.prisma.tool.findMany.mockResolvedValue([])
  h.prisma.knowledgeSource.findMany.mockResolvedValue([])
  h.prisma.message.findMany.mockResolvedValue([])
  h.prisma.message.upsert.mockResolvedValue({})
  h.prisma.$transaction.mockImplementation(async (ops) => ops)
  h.prisma.chatMemory.upsert.mockResolvedValue({})
  h.agentLoopCreate.mockResolvedValue(mockLoop())
})

afterEach(() => {
  closeSession('case-error-release')
  closeSession('case-cross-org')
  closeSession('case-queued')
  closeSession('case-drain')
})

describe('POST /api/messages runtime session guards', () => {
  it('releases a registered runtime session when AgentLoop.run throws', async () => {
    h.agentLoopCreate.mockResolvedValue(mockLoop({
      run: vi.fn(async () => {
        throw new Error('forced runtime failure')
      }),
    }))

    const res = await POST(makeRequest({
      message: 'hello',
      caseId: 'case-error-release',
      orgId: 'org-a',
      userId: 'user-1',
      chatId: 'chat-1',
    }))
    const events = await readSse(res)

    expect(events.some((event) => event.type === 'error' && String(event.data).includes('forced runtime failure'))).toBe(true)
    expect(hasSession('case-error-release')).toBe(false)
  })

  it('does not resume a human task from another authenticated org', async () => {
    h.prisma.humanTask.findUnique.mockResolvedValue({
      id: 'task-victim',
      caseId: 'case-cross-org',
      status: 'resolved',
      verdict: 'approved',
      expectedEta: 'soon',
      notes: 'private operator notes',
      case: {
        id: 'case-cross-org',
        orgId: 'org-b',
        userId: 'victim-user',
      },
    })

    const res = await POST(makeRequest({
      resumeTrigger: 'task-victim',
      orgId: 'org-a',
      userId: 'attacker-user',
      chatId: 'chat-1',
    }))
    const events = await readSse(res)

    expect(events.some((event) => event.type === 'error')).toBe(true)
    expect(JSON.stringify(events)).not.toContain('private operator notes')
    expect(h.agentLoopCreate).not.toHaveBeenCalled()
    expect(hasSession('case-cross-org')).toBe(false)
  })

  it('queues a message without creating a second loop when a runtime session is active', async () => {
    const active = getOrCreateSession('case-queued')
    active.resolved = false
    active.aborted = false

    const res = await POST(makeRequest({
      message: 'second turn',
      caseId: 'case-queued',
      orgId: 'org-a',
      userId: 'user-1',
      chatId: 'chat-1',
    }))
    const events = await readSse(res)

    expect(events.some((event) => event.type === 'withheld')).toBe(true)
    expect(events.some((event) => event.type === 'message_stop' && event.data?.reason === 'queued')).toBe(true)
    expect(h.agentLoopCreate).not.toHaveBeenCalled()
    expect(active.queue.pendingCount).toBe(1)
    expect(hasSession('case-queued')).toBe(true)
  })

  it('drains queued follow-up turns and persists the follow-up result before returning', async () => {
    const primaryMemory = {
      confirmedFacts: {},
      missingFacts: [],
      toolsCalled: [],
      toolResults: {},
      keyEvents: [],
      summary: '',
      todos: null,
      caseStatus: 'created',
    }
    const followupMemory = {
      confirmedFacts: { memberId: 'M123' },
      missingFacts: [],
      toolsCalled: ['lookup_balance'],
      toolResults: { lookup_balance: { ok: true } },
      keyEvents: [],
      summary: 'follow-up handled',
      todos: null,
      caseStatus: 'open',
    }
    const primaryLoop = mockLoop({
      run: vi.fn(async () => {
        enqueueMessageOrCreate('case-drain', {
          content: 'queued follow-up',
          source: 'customer_message',
          origin: 'customer',
        })
        return {
          messages: [],
          caseStatus: 'created',
          transition: 'next_turn',
          reason: 'end_turn',
        }
      }),
      getMemorySummary: vi.fn(() => primaryMemory),
    })
    const followupLoop = mockLoop({
      run: vi.fn(async () => ({
        messages: [{ id: 'msg-followup', role: 'assistant', content: 'follow-up reply' }],
        caseStatus: 'open',
        transition: 'next_turn',
        reason: 'drained',
      })),
      getMemorySummary: vi.fn(() => followupMemory),
      getCaseType: vi.fn(() => 'deposit_issue'),
    })
    h.agentLoopCreate
      .mockResolvedValueOnce(primaryLoop)
      .mockResolvedValueOnce(followupLoop)

    const res = await POST(makeRequest({
      message: 'first turn',
      caseId: 'case-drain',
      orgId: 'org-a',
      userId: 'user-1',
      chatId: 'chat-1',
    }))
    const events = await readSse(res)

    expect(h.agentLoopCreate).toHaveBeenCalledTimes(2)
    expect(followupLoop.loadMemory).toHaveBeenCalledWith(primaryMemory)
    expect(followupLoop.run).toHaveBeenCalledWith('queued follow-up', expect.any(Function), undefined)
    expect(h.prisma.case.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'case-drain' },
      update: { status: 'open' },
    }))
    expect(h.prisma.chatMemory.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { caseId: 'case-drain' },
      update: expect.objectContaining({
        confirmedFacts: JSON.stringify(followupMemory.confirmedFacts),
        toolResults: JSON.stringify(followupMemory.toolResults),
      }),
    }))
    expect(h.prisma.message.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'msg-followup' },
      create: expect.objectContaining({
        caseId: 'case-drain',
        role: 'assistant',
        content: 'follow-up reply',
      }),
    }))
    expect(h.prisma.$transaction).toHaveBeenCalled()
    expect(events.some((event) => event.type === 'message_stop' && event.data?.reason === 'drained')).toBe(true)
    expect(hasSession('case-drain')).toBe(false)
  })
})
