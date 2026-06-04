import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — hoisted so vi.mock can reference them
// ---------------------------------------------------------------------------

const { mockPrisma, mockCompactConversation } = vi.hoisted(() => ({
  mockPrisma: {
    case: { findMany: vi.fn() },
    message: { findMany: vi.fn() },
    agentConfig: { findFirst: vi.fn() },
    chatMemory: { upsert: vi.fn() },
  },
  mockCompactConversation: vi.fn(),
}))

vi.mock('@intera/shared/prisma', () => ({
  prisma: mockPrisma,
}))

vi.mock('@/lib/agent/compact', () => ({
  compactConversation: mockCompactConversation,
}))

// Import after mocks are set up
import { POST } from '../compact/route'
import { NextRequest } from 'next/server'

function makeReq(chatId: string): NextRequest {
  const url = `http://localhost:3001/api/chats/${encodeURIComponent(chatId)}/compact`
  return new NextRequest(url, { method: 'POST' })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/chats/[chatId]/compact', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 404 when no cases are found for the chat', async () => {
    mockPrisma.case.findMany.mockResolvedValue([])

    const res = await POST(makeReq('chat-nonexistent'), {
      params: Promise.resolve({ chatId: 'chat-nonexistent' }),
    })
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error).toContain('No cases found')
  })

  it('returns 400 when the chat has cases but no messages', async () => {
    mockPrisma.case.findMany.mockResolvedValue([
      { id: 'case-1', userId: 'user-1', orgId: 'org-1' },
    ])
    mockPrisma.message.findMany.mockResolvedValue([])

    const res = await POST(makeReq('chat-empty'), {
      params: Promise.resolve({ chatId: 'chat-empty' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain('No messages to compact')
  })

  it('returns 200 with compaction result when messages exist', async () => {
    const messages = [
      { id: 'm1', role: 'user', content: 'Hello, help me with my deposit', createdAt: new Date() },
      { id: 'm2', role: 'assistant', content: 'Sure, what is your transaction ID?', createdAt: new Date() },
      { id: 'm3', role: 'user', content: 'TX-12345', createdAt: new Date() },
    ]

    mockPrisma.case.findMany.mockResolvedValue([
      { id: 'case-1', userId: 'user-1', orgId: 'org-1' },
    ])
    mockPrisma.message.findMany.mockResolvedValue(messages)
    mockPrisma.agentConfig.findFirst.mockResolvedValue(null)
    mockPrisma.chatMemory.upsert.mockResolvedValue({})

    mockCompactConversation.mockResolvedValue({
      summary: 'User reported a deposit issue with transaction ID TX-12345.',
      model: 'deepseek-v4-flash',
      provider: 'deepseek',
      tokensUsed: 150,
    })

    const res = await POST(makeReq('chat-1'), {
      params: Promise.resolve({ chatId: 'chat-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.summary).toContain('TX-12345')
    expect(body.compactModel).toBe('deepseek-v4-flash')
    expect(body.beforeTokens).toBeGreaterThan(0)
    expect(body.afterTokens).toBeGreaterThan(0)
    expect(body.compactedAt).toBeDefined()
  })

  it('returns 200 with error when compaction produces no summary', async () => {
    const messages = [
      { id: 'm1', role: 'user', content: 'Hi', createdAt: new Date() },
    ]

    mockPrisma.case.findMany.mockResolvedValue([
      { id: 'case-1', userId: 'user-1', orgId: 'org-1' },
    ])
    mockPrisma.message.findMany.mockResolvedValue(messages)
    mockPrisma.agentConfig.findFirst.mockResolvedValue(null)

    mockCompactConversation.mockResolvedValue({
      summary: null,
      model: 'deepseek-v4-flash',
      provider: 'deepseek',
      error: 'Summary too short',
    })

    const res = await POST(makeReq('chat-1'), {
      params: Promise.resolve({ chatId: 'chat-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.error).toBe('Summary too short')
    expect(body.compactModel).toBe('deepseek-v4-flash')
    expect(body.afterTokens).toBe(0)
  })

  it('persists the summary to ChatMemory for every case in the chat', async () => {
    const messages = [
      { id: 'm1', role: 'user', content: 'I need help', createdAt: new Date() },
    ]

    mockPrisma.case.findMany.mockResolvedValue([
      { id: 'case-a', userId: 'user-1', orgId: 'org-1' },
      { id: 'case-b', userId: 'user-1', orgId: 'org-1' },
    ])
    mockPrisma.message.findMany.mockResolvedValue(messages)
    mockPrisma.agentConfig.findFirst.mockResolvedValue(null)
    mockPrisma.chatMemory.upsert.mockResolvedValue({})

    mockCompactConversation.mockResolvedValue({
      summary: 'A brief summary.',
      model: 'deepseek-v4-flash',
      provider: 'deepseek',
    })

    const res = await POST(makeReq('chat-multi'), {
      params: Promise.resolve({ chatId: 'chat-multi' }),
    })
    expect(res.status).toBe(200)

    expect(mockPrisma.chatMemory.upsert).toHaveBeenCalledTimes(2)
    expect(mockPrisma.chatMemory.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { caseId: 'case-a' } }),
    )
    expect(mockPrisma.chatMemory.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { caseId: 'case-b' } }),
    )
  })

  it('returns 500 when an unexpected error occurs', async () => {
    mockPrisma.case.findMany.mockRejectedValue(new Error('DB connection lost'))

    const res = await POST(makeReq('chat-db-error'), {
      params: Promise.resolve({ chatId: 'chat-db-error' }),
    })
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error).toBeDefined()
  })
})
