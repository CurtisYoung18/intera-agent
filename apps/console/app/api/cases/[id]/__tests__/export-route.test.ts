import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => {
  const repo = {
    case: { findUnique: vi.fn() },
    agentConfig: { findFirst: vi.fn() },
	    raw: {
	      procedureRun: { findFirst: vi.fn() },
	      message: { findMany: vi.fn() },
	      actionTrace: { findMany: vi.fn() },
	      humanTask: { findMany: vi.fn() },
	      chatMemory: { findFirst: vi.fn() },
	    },
  }
  return {
    repo,
    getSession: vi.fn(),
    repoForOrg: vi.fn(() => repo),
  }
})

vi.mock('@/lib/auth', () => ({ getSession: h.getSession }))
vi.mock('@/lib/db/repo-for-org', () => ({ repoForOrg: h.repoForOrg }))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { GET } from '@/app/api/cases/[id]/export/route'

function makeRequest() {
  return new NextRequest('http://localhost/api/cases/case-export/export', {
    method: 'GET',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getSession.mockResolvedValue({ userId: 'staff-1', orgId: 'org-a', role: 'admin' })
  h.repo.case.findUnique.mockResolvedValue({
    id: 'case-export',
    type: 'deposit_issue',
    status: 'created',
    source: 'live',
    userId: 'user-1',
    goal: null,
    blocker: null,
    createdAt: new Date('2026-06-10T00:00:00.000Z'),
    updatedAt: new Date('2026-06-10T00:01:00.000Z'),
    resolvedAt: null,
  })
  h.repo.agentConfig.findFirst.mockResolvedValue({
    model: 'test-model',
    temperature: 0,
    thinkingBudget: 0,
    maxIterations: 1,
    extendedThinking: false,
  })
	  h.repo.raw.message.findMany.mockResolvedValue([])
	  h.repo.raw.actionTrace.findMany.mockResolvedValue([])
	  h.repo.raw.humanTask.findMany.mockResolvedValue([])
	  h.repo.raw.procedureRun.findFirst.mockResolvedValue({ id: 'run-export' })
	  h.repo.raw.chatMemory.findFirst.mockResolvedValue({
    confirmedFacts: JSON.stringify({
      memberId: 'M123',
      __intera_procedure_runtime: { runId: 'runtime-secret' },
    }),
    missingFacts: '[]',
    toolsCalled: '[]',
    toolResults: JSON.stringify({
      lookup_balance: { ok: true },
      __intera_private_tool_state: { currentStepId: 'internal' },
    }),
    summary: null,
  })
})

describe('GET /api/cases/[id]/export', () => {
  it('strips internal runtime memory keys from exported markdown', async () => {
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'case-export' }) })
    const markdown = await res.text()

    expect(res.status).toBe(200)
    expect(markdown).toContain('memberId')
    expect(markdown).toContain('lookup_balance')
    expect(markdown).not.toContain('__intera_')
    expect(markdown).not.toContain('runtime-secret')
    expect(markdown).not.toContain('currentStepId')
  })

  it('adds a synthetic runtime truth note for playground exports', async () => {
    h.repo.case.findUnique.mockResolvedValueOnce({
      id: 'case-export',
      type: 'playground',
      status: 'resolved',
      source: 'playground',
      userId: 'playground-test-1',
      goal: 'Playground test',
      blocker: null,
      createdAt: new Date('2026-06-10T00:00:00.000Z'),
      updatedAt: new Date('2026-06-10T00:01:00.000Z'),
      resolvedAt: null,
    })

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'case-export' }) })
    const markdown = await res.text()

    expect(markdown).toContain('## Runtime Truth Note')
    expect(markdown).toContain('synthetic review export from Playground')
    expect(markdown).toContain('## Timeline & Evidence')
  })
})
