import { once } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

import {
  INTERNAL_SECRET_HEADER,
  RUNTIME_BYPASS_HEADER,
  authorizeInternalRequest,
  createRuntimeServer,
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
  it('resolves the legacy Console messages backend explicitly', () => {
    expect(resolveConsoleMessagesUrl({
      CONSOLE_INTERNAL_MESSAGES_URL: 'http://console.local/api/messages',
    })).toBe('http://console.local/api/messages')
    expect(resolveConsoleMessagesUrl({
      CONSOLE_INTERNAL_URL: 'http://console.local/',
    })).toBe('http://console.local/api/messages')
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
    const server = createRuntimeServer({ env: { INTERNAL_API_SECRET: 'secret-1' } })
    const baseUrl = await listen(server)
    try {
      const response = await fetch(`${baseUrl}/internal/health`)
      const body = await response.json()
      expect(response.status).toBe(200)
      expect(body).toMatchObject({
        status: 'ok',
        sessions: 0,
        activeRuns: 0,
        queueDepth: 0,
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

  it('forwards close requests to Console internal close endpoint', async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }))
    const server = createRuntimeServer({
      env: {
        INTERNAL_API_SECRET: 'secret-1',
        CONSOLE_INTERNAL_URL: 'http://console.local',
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
