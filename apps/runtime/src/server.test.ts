import { once } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

import {
  INTERNAL_SECRET_HEADER,
  RUNTIME_BYPASS_HEADER,
  authorizeInternalRequest,
  createRuntimeServer,
  resolveRuntimeExecutionMode,
  resolveConsoleRuntimeHealthUrl,
  resolveConsoleMessagesUrl,
} from './server.mjs'

function listen(server: ReturnType<typeof createRuntimeServer>): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address')
      resolve(`http://127.0.0.1:${address.port}`)
    })
  })
}

async function close(server: ReturnType<typeof createRuntimeServer>): Promise<void> {
  server.close()
  await once(server, 'close')
}

describe('runtime service', () => {
  it('defaults to direct execution and keeps legacy-forward as an explicit rollback mode', () => {
    expect(resolveRuntimeExecutionMode({})).toBe('direct')
    expect(resolveRuntimeExecutionMode({ INTERA_RUNTIME_EXECUTION_MODE: 'direct' })).toBe('direct')
    expect(resolveRuntimeExecutionMode({ INTERA_RUNTIME_EXECUTION_MODE: 'legacy-forward' })).toBe('legacy-forward')
    expect(resolveRuntimeExecutionMode({ INTERA_RUNTIME_EXECUTION_MODE: 'legacy' })).toBe('legacy-forward')
  })

  it('resolves the legacy Console messages backend explicitly', () => {
    expect(resolveConsoleMessagesUrl({
      CONSOLE_INTERNAL_MESSAGES_URL: 'http://console.local/api/messages',
    })).toBe('http://console.local/api/messages')
    expect(resolveConsoleMessagesUrl({
      CONSOLE_INTERNAL_URL: 'http://console.local/',
    })).toBe('http://console.local/api/messages')
  })

  it('resolves Console runtime health from the Console base URL', () => {
    expect(resolveConsoleRuntimeHealthUrl({
      CONSOLE_INTERNAL_URL: 'http://console.local/',
    })).toBe('http://console.local/api/internal/runtime/health')
  })

  it('uses timing-safe internal token auth', () => {
    expect(authorizeInternalRequest(
      { [INTERNAL_SECRET_HEADER]: 'secret-1' },
      { INTERNAL_API_SECRET: 'secret-1' },
    )).toBe(true)
    expect(authorizeInternalRequest(
      { [INTERNAL_SECRET_HEADER]: 'bad' },
      { INTERNAL_API_SECRET: 'secret-1' },
    )).toBe(false)
  })

  it('returns health with the required runtime counters', async () => {
    const fetchMock = vi.fn(async () => Response.json({
      status: 'ok',
      sessions: 5,
      activeRuns: 2,
      queueDepth: 3,
      stats: {
        sessions: 6,
        liveSessions: 5,
        activeRuns: 2,
        queueDepth: 3,
      },
    }))
    const server = createRuntimeServer({
      env: {
        INTERNAL_API_SECRET: 'secret-1',
        CONSOLE_INTERNAL_URL: 'http://console.local',
        INTERA_RUNTIME_EXECUTION_MODE: 'legacy-forward',
      },
      fetch: fetchMock as typeof fetch,
    })
    const baseUrl = await listen(server)
    try {
      const response = await fetch(`${baseUrl}/internal/health`)
      const body = await response.json()
      expect(response.status).toBe(200)
      expect(body).toMatchObject({
        status: 'ok',
        sessions: 5,
        activeRuns: 2,
        queueDepth: 3,
        mode: 'legacy-forward',
        upstream: {
          status: 'ok',
          stats: {
            liveSessions: 5,
          },
        },
      })
      expect(fetchMock).toHaveBeenCalledWith(
        'http://console.local/api/internal/runtime/health',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            [INTERNAL_SECRET_HEADER]: 'secret-1',
          }),
        }),
      )
    } finally {
      await close(server)
    }
  })

  it('marks runtime health degraded when Console stats are unavailable', async () => {
    const fetchMock = vi.fn(async () => Response.json({ error: 'not found' }, { status: 404 }))
    const server = createRuntimeServer({
      env: {
        INTERNAL_API_SECRET: 'secret-1',
        CONSOLE_INTERNAL_URL: 'http://console.local',
        INTERA_RUNTIME_EXECUTION_MODE: 'legacy-forward',
      },
      fetch: fetchMock as typeof fetch,
    })
    const baseUrl = await listen(server)
    try {
      const response = await fetch(`${baseUrl}/internal/health`)
      const body = await response.json()
      expect(response.status).toBe(503)
      expect(body).toMatchObject({
        status: 'degraded',
        mode: 'legacy-forward',
        upstreamError: 'Console runtime health returned 404',
      })
    } finally {
      await close(server)
    }
  })

  it('forwards message requests to Console with runtime bypass headers', async () => {
    const fetchMock = vi.fn(async () => new Response('data: {"type":"message_stop"}\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    const server = createRuntimeServer({
      env: {
        INTERNAL_API_SECRET: 'secret-1',
        CONSOLE_INTERNAL_MESSAGES_URL: 'http://console.local/api/messages',
        INTERA_RUNTIME_EXECUTION_MODE: 'legacy-forward',
      },
      fetch: fetchMock as typeof fetch,
    })
    const baseUrl = await listen(server)
    try {
      const response = await fetch(`${baseUrl}/internal/cases/case-1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [INTERNAL_SECRET_HEADER]: 'secret-1',
          'x-intera-org': 'org-a',
          'x-intera-agent-config-id': 'agent-a',
        },
        body: JSON.stringify({ message: 'hi' }),
      })

      expect(response.status).toBe(200)
      await expect(response.text()).resolves.toContain('message_stop')
      expect(fetchMock).toHaveBeenCalledWith(
        'http://console.local/api/messages',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            [INTERNAL_SECRET_HEADER]: 'secret-1',
            [RUNTIME_BYPASS_HEADER]: '1',
            'x-intera-org': 'org-a',
            'x-intera-agent-config-id': 'agent-a',
          }),
          body: JSON.stringify({ message: 'hi', caseId: 'case-1' }),
        }),
      )
    } finally {
      await close(server)
    }
  })

  it('rejects internal message calls without the shared secret', async () => {
    const server = createRuntimeServer({ env: { INTERNAL_API_SECRET: 'secret-1' } })
    const baseUrl = await listen(server)
    try {
      const response = await fetch(`${baseUrl}/internal/cases/case-1/messages`, {
        method: 'POST',
        headers: { 'x-intera-org': 'org-a' },
        body: '{}',
      })
      expect(response.status).toBe(401)
    } finally {
      await close(server)
    }
  })

  it('serves direct runtime health from the runtime process without calling Console', async () => {
    const fetchMock = vi.fn()
    const directRuntimeHealth = vi.fn(async () => ({
      status: 'ok',
      sessions: 4,
      activeRuns: 1,
      queueDepth: 2,
      stats: {
        liveSessions: 4,
        activeRuns: 1,
        queueDepth: 2,
      },
    }))
    const server = createRuntimeServer({
      env: { INTERNAL_API_SECRET: 'secret-1' },
      fetch: fetchMock as typeof fetch,
      directRuntimeHealth,
    })
    const baseUrl = await listen(server)
    try {
      const response = await fetch(`${baseUrl}/internal/health`)
      const body = await response.json()
      expect(response.status).toBe(200)
      expect(body).toMatchObject({
        status: 'ok',
        mode: 'direct',
        sessions: 4,
        activeRuns: 1,
        queueDepth: 2,
        stats: {
          liveSessions: 4,
        },
      })
      expect(fetchMock).not.toHaveBeenCalled()
      expect(directRuntimeHealth).toHaveBeenCalledTimes(1)
    } finally {
      await close(server)
    }
  })

  it('executes message requests through the direct handler by default', async () => {
    const fetchMock = vi.fn()
    const directMessagesHandler = vi.fn(async () => new Response('data: {"type":"message_stop"}\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    const server = createRuntimeServer({
      env: { INTERNAL_API_SECRET: 'secret-1' },
      fetch: fetchMock as typeof fetch,
      directMessagesHandler,
    })
    const baseUrl = await listen(server)
    try {
      const response = await fetch(`${baseUrl}/internal/cases/case-1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [INTERNAL_SECRET_HEADER]: 'secret-1',
          'x-intera-org': 'org-a',
          'x-intera-agent-config-id': 'agent-a',
        },
        body: JSON.stringify({ message: 'hi' }),
      })

      expect(response.status).toBe(200)
      await expect(response.text()).resolves.toContain('message_stop')
      expect(fetchMock).not.toHaveBeenCalled()
      expect(directMessagesHandler).toHaveBeenCalledWith(
        JSON.stringify({ message: 'hi', caseId: 'case-1' }),
        expect.objectContaining({
          [INTERNAL_SECRET_HEADER]: 'secret-1',
          [RUNTIME_BYPASS_HEADER]: '1',
          'x-intera-org': 'org-a',
          'x-intera-agent-config-id': 'agent-a',
        }),
      )
    } finally {
      await close(server)
    }
  })

  it('executes close requests through the direct handler by default', async () => {
    const fetchMock = vi.fn()
    const directCloseHandler = vi.fn(async () => Response.json({ ok: true }))
    const server = createRuntimeServer({
      env: { INTERNAL_API_SECRET: 'secret-1' },
      fetch: fetchMock as typeof fetch,
      directCloseHandler,
    })
    const baseUrl = await listen(server)
    try {
      const response = await fetch(`${baseUrl}/internal/cases/case-1/close`, {
        method: 'POST',
        headers: {
          [INTERNAL_SECRET_HEADER]: 'secret-1',
          'x-intera-org': 'org-a',
        },
      })

      expect(response.status).toBe(200)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(directCloseHandler).toHaveBeenCalledWith(
        'case-1',
        expect.objectContaining({
          [INTERNAL_SECRET_HEADER]: 'secret-1',
          [RUNTIME_BYPASS_HEADER]: '1',
          'x-intera-org': 'org-a',
        }),
      )
    } finally {
      await close(server)
    }
  })

  it('forwards close requests to Console internal close endpoint', async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }))
    const server = createRuntimeServer({
      env: {
        INTERNAL_API_SECRET: 'secret-1',
        CONSOLE_INTERNAL_URL: 'http://console.local',
        INTERA_RUNTIME_EXECUTION_MODE: 'legacy-forward',
      },
      fetch: fetchMock as typeof fetch,
    })
    const baseUrl = await listen(server)
    try {
      const response = await fetch(`${baseUrl}/internal/cases/case-1/close`, {
        method: 'POST',
        headers: {
          [INTERNAL_SECRET_HEADER]: 'secret-1',
          'x-intera-org': 'org-a',
        },
      })

      expect(response.status).toBe(200)
      expect(fetchMock).toHaveBeenCalledWith(
        'http://console.local/api/internal/cases/case-1/close',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            [INTERNAL_SECRET_HEADER]: 'secret-1',
            [RUNTIME_BYPASS_HEADER]: '1',
            'x-intera-org': 'org-a',
          }),
        }),
      )
    } finally {
      await close(server)
    }
  })
})
