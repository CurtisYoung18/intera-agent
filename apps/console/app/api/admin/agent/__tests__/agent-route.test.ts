import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => {
  const mockGetSession = vi.fn()
  const config = {
    id: 'cfg-1',
    orgId: 'acme',
    model: 'deepseek-v4-flash',
    temperature: 0.5,
    thinkingBudget: 4096,
    maxIterations: 20,
    maxOutputTokens: 4096,
    coreSystemPrompt: 'core prompt',
    extendedThinking: false,
    memoryStrategy: '{}',
    resumePrompt: '',
  }
  const mockScopedFindUnique = vi.fn()
  const mockScopedFindFirst = vi.fn()
  const mockScopedCreate = vi.fn()
  const mockRawFindUnique = vi.fn()
  const mockRawUpdate = vi.fn()
  const mockOrgUpsert = vi.fn()

  return {
    mockGetSession,
    config,
    mockScopedFindUnique,
    mockScopedFindFirst,
    mockScopedCreate,
    mockRawFindUnique,
    mockRawUpdate,
    mockOrgUpsert,
  }
})

vi.mock('@/lib/db/repo-for-org', () => ({
  repoForOrg(orgId: string) {
    return {
      orgId,
      agentConfig: {
        findUnique: h.mockScopedFindUnique,
        findFirst: h.mockScopedFindFirst,
        create: h.mockScopedCreate,
      },
      raw: {
        organization: {
          upsert: h.mockOrgUpsert,
        },
        agentConfig: {
          findUnique: h.mockRawFindUnique,
          update: h.mockRawUpdate,
        },
      },
    } as any
  },
}))

vi.mock('@/lib/auth', () => ({ getSession: h.mockGetSession }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { GET, PUT } from '../route'

function req(url = 'http://localhost/api/admin/agent', body?: unknown) {
  return new NextRequest(url, {
    method: body ? 'PUT' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.mockGetSession.mockResolvedValue({ userId: 'u1', orgId: 'acme', role: 'admin' })
  h.mockScopedFindUnique.mockResolvedValue({ id: 'cfg-1' })
  h.mockScopedFindFirst.mockResolvedValue(h.config)
  h.mockScopedCreate.mockResolvedValue(h.config)
  h.mockRawFindUnique.mockResolvedValue(h.config)
  h.mockRawUpdate.mockImplementation(async (args: any) => ({ ...h.config, ...args.data }))
  h.mockOrgUpsert.mockResolvedValue({ id: 'acme', name: 'Demo Org' })
})

describe('GET /api/admin/agent', () => {
  it('returns 401 without session', async () => {
    h.mockGetSession.mockResolvedValue(null)
    const res = await GET(req())
    expect(res.status).toBe(401)
  })

  it('returns config when authenticated', async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data.config.model).toBe('deepseek-v4-flash')
  })

  it('parses agentId from query params', async () => {
    const res = await GET(req('http://localhost/api/admin/agent?agentId=cfg-1'))
    expect(res.status).toBe(200)
    expect(h.mockScopedFindUnique).toHaveBeenCalledWith({ where: { id: 'cfg-1' }, select: { id: true } })
    expect(h.mockRawFindUnique).toHaveBeenCalledWith({ where: { id: 'cfg-1' } })
  })
})

describe('PUT /api/admin/agent', () => {
  it('saves selected model, prompt, and generation parameters', async () => {
    const payload = {
      model: 'openai/gpt-4o',
      temperature: 0.2,
      thinkingBudget: 2048,
      maxIterations: 12,
      maxOutputTokens: 2048,
      coreSystemPrompt: 'Updated core prompt',
      extendedThinking: true,
      resumePrompt: 'Resume here',
    }

    const res = await PUT(req('http://localhost/api/admin/agent?agentId=cfg-1', payload))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(h.mockRawUpdate).toHaveBeenCalledWith({
      where: { id: 'cfg-1' },
      data: payload,
    })
    expect(body.data.config).toEqual(expect.objectContaining(payload))
  })
})
