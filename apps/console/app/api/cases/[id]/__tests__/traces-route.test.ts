import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => {
  const repo = {
    orgId: 'org-a',
    agentConfig: { findUnique: vi.fn() },
    case: { findFirst: vi.fn() },
    raw: {
      procedureRun: { findFirst: vi.fn() },
      actionTrace: {
        findMany: vi.fn(),
        count: vi.fn(),
      },
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
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { GET } from '@/app/api/cases/[id]/traces/route'

function makeRequest(query = 'limit=2&offset=1&agentId=agent-a') {
  return new NextRequest(`http://localhost/api/cases/case-1/traces?${query}`, {
    method: 'GET',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getSession.mockResolvedValue({ userId: 'staff-1', orgId: 'org-a', role: 'admin' })
  h.repo.agentConfig.findUnique.mockResolvedValue({ id: 'agent-a' })
  h.repo.raw.procedureRun.findFirst.mockResolvedValue({ id: 'run-1' })
  h.repo.case.findFirst.mockResolvedValue({ id: 'case-1' })
  h.repo.raw.actionTrace.findMany.mockResolvedValue([])
  h.repo.raw.actionTrace.count.mockResolvedValue(0)
})

describe('GET /api/cases/[id]/traces', () => {
  it('scopes raw trace queries to the current org and case', async () => {
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'case-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(h.repo.raw.actionTrace.findMany).toHaveBeenCalledWith({
      where: { orgId: 'org-a', caseId: 'case-1' },
      orderBy: { createdAt: 'asc' },
      take: 2,
      skip: 1,
    })
    expect(h.repo.raw.actionTrace.count).toHaveBeenCalledWith({
      where: { orgId: 'org-a', caseId: 'case-1' },
    })
  })

  it('returns not found when the selected agent does not own the case', async () => {
    h.repo.raw.procedureRun.findFirst.mockResolvedValue(null)

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'case-1' }) })
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('not_found')
    expect(h.repo.case.findFirst).not.toHaveBeenCalled()
    expect(h.repo.raw.actionTrace.findMany).not.toHaveBeenCalled()
  })
})
