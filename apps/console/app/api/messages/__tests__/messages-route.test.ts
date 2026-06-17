import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => {
  process.env.ANTHROPIC_AUTH_TOKEN = process.env.ANTHROPIC_AUTH_TOKEN || 'test-auth-token'
  process.env.ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL || 'https://test-anthropic.local'

  const prisma = {
    $transaction: vi.fn(async (ops) => ops),
    humanTask: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    case: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    caseType: { findUnique: vi.fn() },
    procedureRun: { findFirst: vi.fn() },
    tool: { findMany: vi.fn() },
    knowledgeSource: { findMany: vi.fn() },
    message: { findMany: vi.fn(), upsert: vi.fn() },
    actionTrace: { create: vi.fn() },
    chatMemory: { upsert: vi.fn() },
  }
  return {
    prisma,
    repoForOrg: vi.fn(() => ({ orgId: 'org-a' })),
    resolveOrgFromApiKey: vi.fn(),
    isTrustedInternalCall: vi.fn(),
    createAgentClient: vi.fn(),
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
vi.mock('@/lib/agent/api/provider-config', () => ({
  createAgentClient: h.createAgentClient,
}))
vi.mock('@/lib/agent/buildModePrompt', () => ({
  buildModePrompt: h.buildModePrompt,
}))
vi.mock('@/lib/agent/loop', () => ({
  AgentLoop: { create: h.agentLoopCreate },
}))

import { POST } from '@/app/api/messages/route'
import { closeSession, enqueueMessageOrCreate, getOrCreateSession, getRuntimeEvents, hasSession } from '@/lib/agent/session-store'

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

function mockExistingCase(row: Record<string, unknown>) {
  const existingCase = {
    orgId: 'org-a',
    chatId: 'chat-1',
    type: 'general',
    status: 'created',
    memory: null,
    ...row,
  }
  h.prisma.case.findUnique.mockResolvedValue(existingCase)
  h.prisma.case.findFirst.mockResolvedValue(existingCase)
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
      contextMap: {},
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
  closeSession('case-v2-form')
  closeSession('case-provider-reload')

  h.resolveOrgFromApiKey.mockResolvedValue({ orgId: 'org-a', agentConfigId: 'agent-a' })
  h.isTrustedInternalCall.mockReturnValue(false)
  h.createAgentClient.mockReturnValue({
    messages: {
      create: vi.fn(async () => ({
        content: [{ text: 'case-1' }],
      })),
    },
  })
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
  h.prisma.humanTask.update.mockResolvedValue({})
  h.prisma.case.findUnique.mockResolvedValue(null)
  h.prisma.case.findFirst.mockResolvedValue(null)
  h.prisma.case.findMany.mockResolvedValue([])
  h.prisma.case.create.mockResolvedValue({ id: 'case-created' })
  h.prisma.case.upsert.mockResolvedValue({})
  h.prisma.case.update.mockResolvedValue({})
  h.prisma.caseType.findUnique.mockResolvedValue(null)
  h.prisma.procedureRun.findFirst.mockResolvedValue(null)
  h.prisma.tool.findMany.mockResolvedValue([])
  h.prisma.knowledgeSource.findMany.mockResolvedValue([])
  h.prisma.message.findMany.mockResolvedValue([])
  h.prisma.message.upsert.mockResolvedValue({})
  h.prisma.actionTrace.create.mockResolvedValue({})
  h.prisma.$transaction.mockImplementation(async (ops) => ops)
  h.prisma.chatMemory.upsert.mockResolvedValue({})
  h.agentLoopCreate.mockResolvedValue(mockLoop())
})

afterEach(() => {
  closeSession('case-error-release')
  closeSession('case-cross-org')
  closeSession('case-queued')
  closeSession('case-drain')
  closeSession('case-v2-form')
  closeSession('case-provider-reload')
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

  it('keeps a bridge-pinned caseId instead of rerouting to another active case in the same chat', async () => {
    h.prisma.case.findUnique.mockResolvedValue({
      id: 'case-bridge',
      orgId: 'org-a',
      chatId: 'chat-1',
      status: 'created',
      memory: null,
    })
    const loop = mockLoop()
    h.agentLoopCreate.mockResolvedValue(loop)

    const res = await POST(makeRequest({
      message: '怎么注册',
      caseId: 'case-bridge',
      orgId: 'org-a',
      userId: 'user-1',
      chatId: 'chat-1',
      sessionCasePinned: true,
    }))
    await readSse(res)

    expect(h.prisma.case.findMany).not.toHaveBeenCalled()
    expect(h.agentLoopCreate).toHaveBeenCalledWith(expect.objectContaining({
      caseId: 'case-bridge',
      chatId: 'chat-1',
      userId: 'user-1',
    }))
  })

  it('keeps a livechat bridge caseId when case routing is explicitly disabled', async () => {
    h.prisma.case.findUnique.mockResolvedValue({
      id: 'case-livechat',
      orgId: 'org-a',
      chatId: 'chat-1',
      status: 'created',
      memory: null,
    })
    const loop = mockLoop()
    h.agentLoopCreate.mockResolvedValue(loop)

    const res = await POST(makeRequest({
      message: '怎么注册',
      caseId: 'case-livechat',
      orgId: 'org-a',
      userId: 'user-1',
      chatId: 'chat-1',
      disableCaseRouting: true,
    }))
    await readSse(res)

    expect(h.prisma.case.findMany).not.toHaveBeenCalled()
    expect(h.agentLoopCreate).toHaveBeenCalledWith(expect.objectContaining({
      caseId: 'case-livechat',
      chatId: 'chat-1',
      userId: 'user-1',
    }))
  })

  it('creates a fresh case when the router says a single active case does not match the new topic', async () => {
    h.prisma.case.findUnique.mockResolvedValue({
      id: 'case-stale',
      orgId: 'org-a',
      chatId: 'chat-1',
      status: 'investigating',
      memory: null,
    })
    h.prisma.case.findMany.mockResolvedValue([
      { id: 'case-stale', type: 'deposit_not_credited', status: 'investigating' },
    ])
    h.createAgentClient.mockReturnValue({
      messages: {
        create: vi.fn(async () => ({
          content: [{ text: 'new' }],
        })),
      },
    })

    const loop = mockLoop()
    h.agentLoopCreate.mockResolvedValue(loop)

    const res = await POST(makeRequest({
      message: '你还能干啥',
      caseId: 'case-stale',
      orgId: 'org-a',
      userId: 'user-1',
      chatId: 'chat-1',
    }))
    await readSse(res)

    expect(h.prisma.case.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: 'org-a',
        userId: 'user-1',
        chatId: 'chat-1',
        type: 'general',
        status: 'created',
      }),
    })
    expect(h.agentLoopCreate).toHaveBeenCalledWith(expect.objectContaining({
      caseId: 'case-created',
      chatId: 'chat-1',
      userId: 'user-1',
    }))
  })

  it('does not let a pending human task hijack a new topic when multiple active cases share the chat', async () => {
    h.prisma.case.findUnique.mockResolvedValue({
      id: 'case-stale',
      orgId: 'org-a',
      chatId: 'chat-1',
      status: 'investigating',
      memory: null,
    })
    h.prisma.case.findMany.mockResolvedValue([
      { id: 'case-deposit', type: 'deposit_not_credited', status: 'investigating' },
      { id: 'case-old-general', type: 'general', status: 'waiting_human' },
    ])
    h.prisma.humanTask.findFirst.mockResolvedValue({
      id: 'task-pending',
      caseId: 'case-deposit',
      status: 'pending',
    })
    h.createAgentClient.mockReturnValue({
      messages: {
        create: vi.fn(async () => ({
          content: [{ text: 'new' }],
        })),
      },
    })

    const loop = mockLoop()
    h.agentLoopCreate.mockResolvedValue(loop)

    const res = await POST(makeRequest({
      message: '怎么注册',
      caseId: 'case-stale',
      orgId: 'org-a',
      userId: 'user-1',
      chatId: 'chat-1',
    }))
    await readSse(res)

    expect(h.prisma.humanTask.findFirst).not.toHaveBeenCalled()
    expect(h.prisma.case.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: 'org-a',
        userId: 'user-1',
        chatId: 'chat-1',
        type: 'general',
        status: 'created',
      }),
    })
    expect(h.agentLoopCreate).toHaveBeenCalledWith(expect.objectContaining({
      caseId: 'case-created',
      chatId: 'chat-1',
      userId: 'user-1',
    }))
  })

  it('routes explicit withdrawal follow-up text to the withdrawal case before LLM routing', async () => {
    mockExistingCase({ id: 'case-deposit', status: 'investigating' })
    h.prisma.case.findMany.mockResolvedValue([
      { id: 'case-deposit', type: 'deposit_not_credited', status: 'investigating' },
      { id: 'case-withdrawal', type: 'withdrawal_not_credited', status: 'investigating' },
    ])
    const loop = mockLoop()
    h.agentLoopCreate.mockResolvedValue(loop)
    h.createAgentClient.mockClear()

    const res = await POST(makeRequest({
      message: '我提了800元一直没到账，帮我查一下',
      caseId: 'case-deposit',
      orgId: 'org-a',
      userId: 'user-1',
      chatId: 'chat-1',
    }))
    await readSse(res)

    expect(h.createAgentClient).not.toHaveBeenCalled()
    expect(h.agentLoopCreate).toHaveBeenCalledWith(expect.objectContaining({
      caseId: 'case-withdrawal',
      chatId: 'chat-1',
      userId: 'user-1',
    }))
  })

  it('starts a fresh case when explicit withdrawal text is not covered by active cases', async () => {
    mockExistingCase({ id: 'case-deposit', status: 'investigating' })
    h.prisma.case.findMany.mockResolvedValue([
      { id: 'case-deposit', type: 'deposit_not_credited', status: 'investigating' },
    ])
    const loop = mockLoop()
    h.agentLoopCreate.mockResolvedValue(loop)
    h.createAgentClient.mockClear()

    const res = await POST(makeRequest({
      message: '提现500还没到账',
      caseId: 'case-deposit',
      orgId: 'org-a',
      userId: 'user-1',
      chatId: 'chat-1',
    }))
    await readSse(res)

    expect(h.createAgentClient).not.toHaveBeenCalled()
    expect(h.prisma.case.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: 'org-a',
        userId: 'user-1',
        chatId: 'chat-1',
        type: 'general',
        status: 'created',
      }),
    })
    expect(h.agentLoopCreate).toHaveBeenCalledWith(expect.objectContaining({
      caseId: 'case-created',
      chatId: 'chat-1',
      userId: 'user-1',
    }))
  })

  it('hydrates persisted provider transcript before a follow-up HTTP turn runs', async () => {
    const priorCreatedAt = new Date('2026-06-12T00:00:00Z')
    mockExistingCase({ id: 'case-provider-reload', status: 'open' })
    h.prisma.message.findMany.mockResolvedValueOnce([
      {
        id: 'assistant-tool-use',
        role: 'assistant',
        content: 'Checking that now.',
        contentBlocks: null,
        providerContent: [
          { type: 'text', text: 'Checking that now.' },
          { type: 'tool_use', id: 'toolu_1', name: 'lookup_deposit', input: { member_id: 'M123' } },
        ],
        providerMeta: { protocolVersion: 1, visibility: 'customer', transcriptKind: 'assistant_response', toolUseIds: ['toolu_1'] },
        createdAt: priorCreatedAt,
      },
      {
        id: 'tool-result',
        role: 'user',
        content: '',
        contentBlocks: null,
        providerContent: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: '{"ok":true}' },
        ],
        providerMeta: { protocolVersion: 1, visibility: 'internal', transcriptKind: 'tool_result', toolUseIds: ['toolu_1'] },
        createdAt: priorCreatedAt,
      },
    ])
    const loop = mockLoop()
    h.agentLoopCreate.mockResolvedValue(loop)

    const res = await POST(makeRequest({
      message: 'what happened next?',
      caseId: 'case-provider-reload',
      orgId: 'org-a',
      userId: 'user-1',
      chatId: 'chat-1',
    }))
    await readSse(res)

    expect(loop.loadMessages).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'assistant-tool-use',
        providerContent: expect.arrayContaining([
          expect.objectContaining({ type: 'tool_use', id: 'toolu_1', name: 'lookup_deposit' }),
        ]),
        toolUses: [{ id: 'toolu_1', name: 'lookup_deposit', input: { member_id: 'M123' } }],
      }),
      expect.objectContaining({
        id: 'tool-result',
        providerContent: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: '{"ok":true}', is_error: undefined },
        ],
        providerMeta: expect.objectContaining({ visibility: 'internal', transcriptKind: 'tool_result' }),
      }),
    ])
  })

  it('drains queued follow-up turns and persists the follow-up result before returning', async () => {
    h.prisma.case.findFirst.mockResolvedValue({
      id: 'case-drain',
      orgId: 'org-a',
      userId: 'user-1',
      type: 'general',
      status: 'created',
      chatId: 'chat-1',
      memory: null,
    })
    const primaryMemory = {
      contextMap: {},
      missingFacts: [],
      toolsCalled: [],
      toolResults: {},
      keyEvents: [],
      summary: '',
      todos: null,
      caseStatus: 'created',
    }
    const followupMemory = {
      contextMap: { memberId: 'M123' },
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
        messages: [{
          id: 'msg-followup',
          role: 'assistant',
          content: 'follow-up reply',
          providerContent: [{ type: 'text', text: 'follow-up reply' }],
          providerMeta: { protocolVersion: 1, visibility: 'customer', transcriptKind: 'assistant_response' },
        }],
        caseStatus: 'open',
        transition: 'next_turn',
        reason: 'drained',
      })),
      getMemorySummary: vi.fn(() => followupMemory),
      getCaseType: vi.fn(() => 'deposit_issue'),
    })
    const persistedToolPair = [
      {
        id: 'assistant-tool-use',
        role: 'assistant',
        content: '',
        contentBlocks: null,
        providerContent: [
          { type: 'tool_use', id: 'toolu_follow', name: 'lookup_balance', input: { member_id: 'M123' } },
        ],
        providerMeta: { protocolVersion: 1, visibility: 'customer', transcriptKind: 'assistant_response', toolUseIds: ['toolu_follow'] },
        createdAt: new Date('2026-06-12T00:00:00Z'),
      },
      {
        id: 'tool-result-follow',
        role: 'user',
        content: '',
        contentBlocks: null,
        providerContent: [
          { type: 'tool_result', tool_use_id: 'toolu_follow', content: '{"balance":10}' },
        ],
        providerMeta: { protocolVersion: 1, visibility: 'internal', transcriptKind: 'tool_result', toolUseIds: ['toolu_follow'] },
        createdAt: new Date('2026-06-12T00:00:01Z'),
      },
    ]
    h.prisma.message.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(persistedToolPair)
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
    expect(followupLoop.loadMessages).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'assistant-tool-use',
        toolUses: [{ id: 'toolu_follow', name: 'lookup_balance', input: { member_id: 'M123' } }],
      }),
      expect.objectContaining({
        id: 'tool-result-follow',
        providerMeta: expect.objectContaining({ visibility: 'internal' }),
      }),
    ])
    expect(followupLoop.loadMemory).toHaveBeenCalledWith(primaryMemory)
    expect(followupLoop.run).toHaveBeenCalledWith('queued follow-up', expect.any(Function), undefined)
    expect(h.prisma.case.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'case-drain' },
      update: expect.objectContaining({ status: 'open' }),
    }))
    expect(h.prisma.chatMemory.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { caseId: 'case-drain' },
        update: expect.objectContaining({
        contextMap: JSON.stringify(followupMemory.contextMap),
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
    expect(h.prisma.actionTrace.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        caseId: 'case-drain',
        chatId: 'chat-1',
        actionType: 'provider_transcript_persisted',
        payload: expect.stringContaining('"providerTranscriptPersisted":true'),
      }),
    }))
    expect(events.some((event) => event.type === 'message_stop' && event.data?.reason === 'drained')).toBe(true)
    expect(hasSession('case-drain')).toBe(false)
  })

  it('does not merge form answers into contextMap or persist new chatMemory facts for active Procedure v2 cases', async () => {
    const v2FormCase = {
      id: 'case-v2-form',
      orgId: 'org-a',
      userId: 'user-1',
      type: 'deposit_issue',
      status: 'open',
      chatId: 'chat-1',
      memory: {
        contextMap: JSON.stringify({ legacyMemberId: 'LEG-1' }),
        missingFacts: JSON.stringify(['memberId']),
        toolsCalled: JSON.stringify([]),
        toolResults: JSON.stringify({}),
        keyEvents: JSON.stringify([]),
        summary: '',
      },
    }
    h.prisma.case.findUnique.mockResolvedValue(v2FormCase)
    h.prisma.case.findFirst.mockResolvedValue(v2FormCase)
    h.prisma.caseType.findUnique.mockResolvedValue({
      type: 'deposit_issue',
      displayName: 'Deposit issue',
      description: null,
      icon: 'D',
      requiredFacts: '[]',
      defaultGoal: 'Help the customer with deposit issues.',
      escalateOn: '[]',
      autoCloseConditions: null,
      maxAutoTurns: 3,
      procedure: JSON.stringify({
        version: 'v2',
        whenToUse: 'Use for deposit issues',
        steps: [
          {
            id: 'collect_member_id',
            title: 'Collect the member id',
            guidance: 'Use structured runtime inputs.',
            actions: [
              {
                id: 'ask_member_id',
                kind: 'ask',
                label: 'Ask for member id',
                fields: ['memberId'],
              },
            ],
            branches: [],
          },
        ],
      }),
    })

    const loop = mockLoop({
      getMemorySummary: vi.fn(() => ({
        contextMap: { memberId: 'M123', legacyMemberId: 'LEG-1' },
        missingFacts: [],
        toolsCalled: [],
        toolResults: {},
        keyEvents: [],
        summary: '',
        todos: null,
        caseStatus: 'open',
      })),
      getCaseType: vi.fn(() => 'deposit_issue'),
    })
    h.agentLoopCreate.mockResolvedValue(loop)

    const res = await POST(makeRequest({
      formResult: {
        caseId: 'case-v2-form',
        answers: { memberId: 'M123' },
      },
      orgId: 'org-a',
      userId: 'user-1',
      chatId: 'chat-1',
    }))
    await readSse(res)

    expect(h.buildModePrompt).toHaveBeenCalledWith(expect.objectContaining({
      caseState: expect.objectContaining({
        missingFacts: [],
        toolsCalled: [],
        summary: '',
      }),
    }))
    expect(h.prisma.chatMemory.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { caseId: 'case-v2-form' },
      update: expect.objectContaining({
        contextMap: JSON.stringify({ legacyMemberId: 'LEG-1' }),
      }),
    }))

    const runtimeEvents = getRuntimeEvents('case-v2-form')
    expect(runtimeEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'customer_form_result',
          formAnswers: { memberId: 'M123' },
        }),
      ]),
    )
    closeSession('case-v2-form')
  })

  it('persists livechat form turns as envelope text plus an internal provider tool_result when toolCallId is present', async () => {
    mockExistingCase({
      id: 'case-form-persist',
      status: 'open',
      memory: null,
    })

    const userCreatedAt = new Date('2026-06-17T12:00:00.000Z')
    const assistantCreatedAt = new Date('2026-06-17T12:00:01.000Z')
    const loop = mockLoop({
      run: vi.fn(async () => ({
        messages: [
          {
            id: 'msg-form-user',
            role: 'user',
            content: 'Tool ask_user_questions result: {"member_id":"JAYA117FFEB"}',
            createdAt: userCreatedAt,
          },
          {
            id: 'msg-form-assistant',
            role: 'assistant',
            content: 'Thanks, I will continue.',
            providerContent: [{ type: 'text', text: 'Thanks, I will continue.' }],
            providerMeta: { protocolVersion: 1, visibility: 'customer', transcriptKind: 'assistant_response' },
            createdAt: assistantCreatedAt,
          },
        ],
        caseStatus: 'investigating',
        transition: 'next_turn',
        reason: 'form handled',
      })),
      getMemorySummary: vi.fn(() => ({
        contextMap: { member_id: 'JAYA117FFEB' },
        missingFacts: [],
        toolsCalled: ['ask_user_questions'],
        toolResults: {},
        keyEvents: [],
        summary: '',
        todos: null,
        caseStatus: 'investigating',
      })),
      getCaseType: vi.fn(() => 'deposit_issue'),
    })
    h.agentLoopCreate.mockResolvedValue(loop)

    const res = await POST(makeRequest({
      formResult: {
        caseId: 'case-form-persist',
        toolCallId: 'toolu_form_1',
        title: 'Member ID Required',
        description: 'Please enter your Jayabaji Member ID.',
        fields: [
          { id: 'member_id', type: 'text', label: 'Member ID', required: true },
        ],
        answers: { member_id: 'JAYA117FFEB' },
      },
      orgId: 'org-a',
      userId: 'user-1',
      chatId: 'chat-1',
    }))
    await readSse(res)

    expect(h.prisma.message.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'msg-form-user__tool_result' },
      create: expect.objectContaining({
        role: 'user',
        content: '',
        providerContent: [
          { type: 'tool_result', tool_use_id: 'toolu_form_1', content: '{"member_id":"JAYA117FFEB"}', is_error: undefined },
        ],
        providerMeta: expect.objectContaining({
          visibility: 'internal',
          transcriptKind: 'tool_result',
          toolUseIds: ['toolu_form_1'],
        }),
      }),
    }))
    expect(h.prisma.message.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'msg-form-user' },
      create: expect.objectContaining({
        role: 'user',
        content: '[FORM_SUBMISSION]\nmember_id: JAYA117FFEB\n[/FORM_SUBMISSION]',
      }),
    }))
    expect(h.prisma.actionTrace.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        caseId: 'case-form-persist',
        chatId: 'chat-1',
        actionType: 'form_submit',
        title: 'Form submitted: Member ID Required',
      }),
    }))
    closeSession('case-form-persist')
  })

  it('aligns case truth when a resolved human task explicitly resumes a case', async () => {
    h.prisma.humanTask.findUnique.mockResolvedValue({
      id: 'task-resume',
      caseId: 'case-resume',
      status: 'resolved',
      verdict: 'need_more_evidence',
      expectedEta: '2h',
      notes: 'Ask for TXID and screenshot',
      case: {
        id: 'case-resume',
        orgId: 'org-a',
        userId: 'user-1',
      },
    })
    const resumeCase = {
      id: 'case-resume',
      orgId: 'org-a',
      userId: 'user-1',
      type: 'general',
      status: 'created',
      chatId: 'chat-1',
      memory: {
        contextMap: JSON.stringify({ member_id: 'JAYA113C88F' }),
        missingFacts: JSON.stringify([]),
        toolsCalled: JSON.stringify(['create_human_task']),
        toolResults: JSON.stringify({}),
        keyEvents: JSON.stringify([]),
        summary: 'Paused for payment ops review.',
      },
    }
    h.prisma.case.findUnique.mockResolvedValue(resumeCase)
    h.prisma.case.findFirst.mockResolvedValue(resumeCase)
    h.prisma.procedureRun.findFirst.mockResolvedValue({
      procedureId: 'deposit_not_credited',
      status: 'paused',
    })
    h.prisma.caseType.findUnique.mockResolvedValue({
      type: 'deposit_not_credited',
      displayName: 'Deposit not credited',
      description: 'Investigate a missing deposit.',
      icon: 'D',
      requiredFacts: '["member_id"]',
      defaultGoal: 'Resolve the deposit issue.',
      escalateOn: '[]',
      autoCloseConditions: null,
      maxAutoTurns: 3,
      procedure: JSON.stringify({
        version: 'v2',
        whenToUse: 'Use for deposit-not-credited cases',
        steps: [],
      }),
    })

    const loop = mockLoop({
      loadMemory: vi.fn(),
      run: vi.fn(async () => ({
        messages: [],
        caseStatus: 'investigating',
        transition: 'next_turn',
        reason: 'resumed',
      })),
      getMemorySummary: vi.fn(() => ({
        contextMap: {},
        missingFacts: [],
        toolsCalled: ['resume_case'],
        toolResults: {},
        keyEvents: [],
        summary: 'resumed',
        todos: null,
        caseStatus: 'investigating',
      })),
      getCaseType: vi.fn(() => 'general'),
    })
    h.agentLoopCreate.mockResolvedValue(loop)

    const res = await POST(makeRequest({
      resumeTrigger: 'task-resume',
      orgId: 'org-a',
      chatId: 'chat-1',
    }))
    await readSse(res)

    expect(h.prisma.case.update).toHaveBeenCalledWith({
      where: { id: 'case-resume' },
      data: { status: 'investigating', blocker: null },
    })
    expect(loop.loadMemory).toHaveBeenCalledWith(expect.objectContaining({
      caseStatus: 'investigating',
    }))
    expect(h.prisma.case.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'case-resume' },
      update: expect.objectContaining({
        type: 'deposit_not_credited',
        status: 'investigating',
      }),
    }))
    expect(h.agentLoopCreate).toHaveBeenCalledWith(expect.objectContaining({
      caseId: 'case-resume',
      userId: 'user-1',
    }))
  })

  it('prefers active ProcedureRun truth over stale general case rows when hydrating an existing case', async () => {
    const runtimeTruthCase = {
      id: 'case-runtime-truth',
      orgId: 'org-a',
      userId: 'user-1',
      type: 'general',
      status: 'created',
      chatId: 'chat-1',
      memory: {
        contextMap: JSON.stringify({ memberId: 'M123' }),
        missingFacts: JSON.stringify(['txid']),
        toolsCalled: JSON.stringify([]),
        toolResults: JSON.stringify({}),
        keyEvents: JSON.stringify([]),
        summary: 'Need transaction proof.',
      },
    }
    h.prisma.case.findUnique.mockResolvedValue(runtimeTruthCase)
    h.prisma.case.findFirst.mockResolvedValue(runtimeTruthCase)
    h.prisma.procedureRun.findFirst.mockResolvedValue({
      procedureId: 'deposit_not_credited',
      status: 'active',
    })
    h.prisma.caseType.findUnique.mockResolvedValue({
      type: 'deposit_not_credited',
      displayName: 'Deposit not credited',
      description: 'Investigate a missing deposit.',
      icon: 'D',
      requiredFacts: '["memberId","txid"]',
      defaultGoal: 'Resolve the deposit issue.',
      escalateOn: '[]',
      autoCloseConditions: null,
      maxAutoTurns: 3,
      procedure: JSON.stringify({
        version: 'v2',
        whenToUse: 'Use for deposit-not-credited cases',
        steps: [{
          id: 'collect_txid',
          title: 'Collect TXID',
          guidance: 'Ask for transaction proof.',
          actions: [{ id: 'ask_txid', kind: 'ask', label: 'Ask for TXID', fields: ['txid'] }],
          branches: [],
        }],
      }),
    })

    const loop = mockLoop({
      run: vi.fn(async () => ({
        messages: [],
        caseStatus: 'investigating',
        transition: 'next_turn',
        reason: 'hydrated',
      })),
      getMemorySummary: vi.fn(() => ({
        contextMap: { memberId: 'M123' },
        missingFacts: ['txid'],
        toolsCalled: ['resume_case'],
        toolResults: {},
        keyEvents: [],
        summary: 'Need transaction proof.',
        todos: null,
        caseStatus: 'investigating',
      })),
      getCaseType: vi.fn(() => 'deposit_not_credited'),
    })
    h.agentLoopCreate.mockResolvedValue(loop)

    const res = await POST(makeRequest({
      message: '我补充一下，刚刚已经转给人工了',
      caseId: 'case-runtime-truth',
      orgId: 'org-a',
      userId: 'user-1',
      chatId: 'chat-1',
    }))
    await readSse(res)

    expect(h.buildModePrompt).toHaveBeenCalledWith(expect.objectContaining({
      hasActiveCase: true,
      caseSchema: expect.objectContaining({ type: 'deposit_not_credited' }),
    }))
    expect(loop.loadMemory).toHaveBeenCalledWith(expect.objectContaining({
      caseStatus: 'investigating',
      contextMap: JSON.stringify({ memberId: 'M123' }),
    }))

    const truthWrites = h.prisma.case.upsert.mock.calls
      .map(([arg]) => arg)
      .filter((arg) => arg.where?.id === 'case-runtime-truth')
    expect(truthWrites.some((arg) =>
      arg.update?.type === 'deposit_not_credited' &&
      arg.update?.status === 'investigating'
    )).toBe(true)
  })
})
