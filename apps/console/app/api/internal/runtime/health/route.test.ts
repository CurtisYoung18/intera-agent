import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  isTrustedInternalCall: vi.fn(),
  getRuntimeSessionStats: vi.fn(),
}))

vi.mock('@/lib/api-auth', () => ({
  isTrustedInternalCall: h.isTrustedInternalCall,
}))

vi.mock('@/lib/agent/session-store', () => ({
  getRuntimeSessionStats: h.getRuntimeSessionStats,
}))

import { GET } from './route'

function makeRequest() {
  return new NextRequest('http://localhost/api/internal/runtime/health')
}

describe('internal runtime health route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.isTrustedInternalCall.mockReturnValue(true)
    h.getRuntimeSessionStats.mockReturnValue({
      sessions: 4,
      liveSessions: 3,
      activeRuns: 2,
      pausedRuns: 1,
      completedRuns: 5,
      queueDepth: 7,
      initializedSessions: 3,
      hydratedSessions: 2,
    })
  })

  it('rejects untrusted callers', async () => {
    h.isTrustedInternalCall.mockReturnValue(false)

    const response = await GET(makeRequest())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns Console-backed live session stats for the runtime seam', async () => {
    const response = await GET(makeRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      status: 'ok',
      sessions: 3,
      activeRuns: 2,
      queueDepth: 7,
      stats: {
        sessions: 4,
        liveSessions: 3,
        activeRuns: 2,
        queueDepth: 7,
      },
    })
  })
})
