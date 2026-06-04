// Profile write-path test — verifies compactUserProfile writes both
// `profile` (rendered Markdown) and `sections` (structured JSON) to UserProfile.
//
// GREEN: dual-write contract (C3) — upsert includes both columns.
// RED:   only profile written (pre-C3).
//
// This test drives compactUserProfile via mocked dependencies — it verifies
// the write-path logic, not the DB layer.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mock state ──
const h = vi.hoisted(() => {
  const persistedProfiles: Record<string, { profile: string; sections: string }> = {}
  const existingProfiles: Record<string, { profile: string } | null> = {}
  const mockCompactConversation = vi.fn()

  return { persistedProfiles, existingProfiles, mockCompactConversation }
})

// ── Mock prisma ──
vi.mock('@intera/shared/prisma', () => ({
  prisma: {
    userProfile: {
      findUnique: vi.fn(async ({ where }: { where: { userId: string } }) =>
        h.existingProfiles[where.userId] ?? null,
      ),
      upsert: vi.fn(async (args: {
        where: { userId: string }
        create: { userId: string; profile: string; sections?: string }
        update: { profile: string; sections?: string }
      }) => {
        const data = {
          profile: args.create.profile || args.update.profile,
          sections: args.create.sections || args.update.sections || '{}',
        }
        h.persistedProfiles[args.where.userId] = data
        return data
      }),
    },
  },
}))

// ── Mock identity ──
vi.mock('@/lib/agent/identity', () => ({
  profileKey: vi.fn((userId?: string) => (userId ? `user:${userId}` : null)),
}))

// ── Mock compact ──
vi.mock('@/lib/agent/compact', () => ({
  compactConversation: h.mockCompactConversation,
  reactiveCompact: vi.fn((msgs: unknown[]) => msgs),
}))

// ── Mock recomputeStats ──
vi.mock('@intera/shared/memory/recomputeStats', () => ({
  recomputeProfileStats: vi.fn(async () => ({
    totalChats: 5,
    totalCases: 3,
    resolvedCases: 2,
    escalatedCases: 1,
    lastCaseType: 'general',
    firstSeenAt: new Date('2026-01-01'),
    lastSeenAt: new Date('2026-06-01'),
  })),
}))

import { AgentLoop } from '@/lib/agent/loop'
import { prisma } from '@intera/shared/prisma'
import { DEFAULT_MEMORY_STRATEGY } from '@intera/shared/defaults'

// Helper: create a minimal AgentLoop with mocked deps
function createLoop(options?: { existingProfile?: string; enableChatMemory?: boolean }) {
  const config = {
    model: 'claude-sonnet-4-20250514',
    temperature: 0.7,
    thinkingBudget: 4096,
    maxIterations: 10,
    maxOutputTokens: 4096,
    systemPrompt: 'You are helpful.',
    showThinking: false,
    memoryStrategy: {
      ...DEFAULT_MEMORY_STRATEGY,
      enableChatMemory: options?.enableChatMemory ?? true,
    },
    policyHooks: { preTool: [], postTool: [], preFinalize: [] },
    debugMode: false,
  }

  const deps = {
    config,
    caseId: 'test-case-001',
    orgId: 'test-org',
    userId: 'test-user',
    systemPrompt: 'You are helpful.',
    coreSystemPrompt: 'You are helpful.',
    caseSchema: null,
    chatId: 'test-chat-001',
    dryRun: false,
    persistence: {
      ensureCase: vi.fn(async () => {}),
      saveMemory: vi.fn(async () => {}),
      createHumanTask: vi.fn(async () => {}),
    } as any,
  }

  return new AgentLoop(deps)
}

describe('compactUserProfile — dual-write (C3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.persistedProfiles = {}
    h.existingProfiles = {}
    h.mockCompactConversation.mockReset()
  })

  it('writes both profile (rendered Markdown) and sections (JSON) on upsert', async () => {
    // Arrange: existing profile in DB
    const existingMd = [
      '# User Profile',
      '',
      '## Identity',
      '- name: Alice',
      '',
      '## Activity',
      '- issue: login problem',
    ].join('\n')
    h.existingProfiles['user:test-user'] = { profile: existingMd }

    // Arrange: compactConversation returns a new profile summary
    const newSummary = [
      '# User Profile',
      '',
      '## Identity',
      '- name: Alice',
      '',
      '## Activity',
      '- issue: billing question',
    ].join('\n')
    h.mockCompactConversation.mockResolvedValueOnce({
      summary: newSummary,
      model: 'test-model',
      provider: 'test',
      tokensUsed: 100,
    })

    // Act
    const loop = createLoop()
    await (loop as any).compactUserProfile()

    // Assert: prisma.userProfile.upsert was called
    const upsertMock = prisma.userProfile.upsert as ReturnType<typeof vi.fn>
    expect(upsertMock).toHaveBeenCalledTimes(1)

    const upsertArgs = upsertMock.mock.calls[0][0]
    // Both profile and sections must be present
    expect(upsertArgs.create).toHaveProperty('profile')
    expect(upsertArgs.create).toHaveProperty('sections')
    expect(upsertArgs.update).toHaveProperty('profile')
    expect(upsertArgs.update).toHaveProperty('sections')
  })

  it('profile and sections are internally consistent', async () => {
    // Arrange
    h.existingProfiles['user:test-user'] = { profile: '# User Profile' }

    const newSummary = [
      '# User Profile',
      '',
      '## Identity',
      '- name: Bob',
      '- age: 25',
      '',
      '## Contact',
      '- email: bob@test.com',
    ].join('\n')
    h.mockCompactConversation.mockResolvedValueOnce({
      summary: newSummary,
      model: 'test-model',
      provider: 'test',
      tokensUsed: 100,
    })

    // Act
    const loop = createLoop()
    await (loop as any).compactUserProfile()

    // Assert: verify the persisted data
    const persisted = h.persistedProfiles['user:test-user']
    expect(persisted).toBeDefined()

    // The profile Markdown should contain the rendered sections
    expect(persisted.profile).toContain('## Identity')
    expect(persisted.profile).toContain('name: Bob')
    expect(persisted.profile).toContain('## Contact')
    expect(persisted.profile).toContain('email: bob@test.com')

    // The sections JSON should parse to the same data
    const parsed = JSON.parse(persisted.sections)
    expect(parsed.Identity).toBeDefined()
    expect(parsed.Identity).toContain('name: Bob')
    expect(parsed.Identity).toContain('age: 25')
    expect(parsed.Contact).toBeDefined()
    expect(parsed.Contact).toContain('email: bob@test.com')

    // Consistency: identity items in profile Markdown should match sections JSON
    for (const item of parsed.Identity) {
      expect(persisted.profile).toContain(item)
    }
    for (const item of parsed.Contact) {
      expect(persisted.profile).toContain(item)
    }
  })

  it('respects dryRun mode — does not write to DB', async () => {
    const config = {
      model: 'claude-sonnet-4-20250514',
      temperature: 0.7,
      thinkingBudget: 4096,
      maxIterations: 10,
      maxOutputTokens: 4096,
      systemPrompt: 'You are helpful.',
      showThinking: false,
      memoryStrategy: { ...DEFAULT_MEMORY_STRATEGY, enableChatMemory: true },
      policyHooks: { preTool: [], postTool: [], preFinalize: [] },
      debugMode: false,
    }

    const deps = {
      config,
      caseId: 'test-case-001',
      orgId: 'test-org',
      userId: 'test-user',
      systemPrompt: 'You are helpful.',
      coreSystemPrompt: 'You are helpful.',
      caseSchema: null,
      chatId: 'test-chat-001',
      dryRun: true,  // dryRun mode!
      persistence: {
        ensureCase: vi.fn(async () => {}),
        saveMemory: vi.fn(async () => {}),
        createHumanTask: vi.fn(async () => {}),
      } as any,
    }

    h.mockCompactConversation.mockResolvedValueOnce({
      summary: '## Identity\n- name: Test',
      model: 'test',
      provider: 'test',
      tokensUsed: 10,
    })

    const loop = new AgentLoop(deps)
    await (loop as any).compactUserProfile()

    // prisma.userProfile.upsert should NOT have been called in dryRun mode
    const upsertMock = prisma.userProfile.upsert as ReturnType<typeof vi.fn>
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('skips when enableChatMemory is false', async () => {
    const loop = createLoop({ enableChatMemory: false })
    await (loop as any).compactUserProfile()

    // compactConversation should not have been called
    expect(h.mockCompactConversation).not.toHaveBeenCalled()
  })

  it('skips when profileKey returns null', async () => {
    const config = {
      model: 'claude-sonnet-4-20250514',
      temperature: 0.7,
      thinkingBudget: 4096,
      maxIterations: 10,
      maxOutputTokens: 4096,
      systemPrompt: 'You are helpful.',
      showThinking: false,
      memoryStrategy: { ...DEFAULT_MEMORY_STRATEGY, enableChatMemory: true },
      policyHooks: { preTool: [], postTool: [], preFinalize: [] },
      debugMode: false,
    }

    // userId is undefined → profileKey returns null
    const deps = {
      config,
      caseId: 'test-case-001',
      orgId: 'test-org',
      userId: '',
      systemPrompt: 'You are helpful.',
      coreSystemPrompt: 'You are helpful.',
      caseSchema: null,
      chatId: null,
      dryRun: false,
      persistence: {
        ensureCase: vi.fn(async () => {}),
        saveMemory: vi.fn(async () => {}),
        createHumanTask: vi.fn(async () => {}),
      } as any,
    }

    const loop = new AgentLoop(deps)
    await (loop as any).compactUserProfile()

    // prisma.userProfile.upsert should NOT have been called
    const upsertMock = prisma.userProfile.upsert as ReturnType<typeof vi.fn>
    expect(upsertMock).not.toHaveBeenCalled()
  })
})
