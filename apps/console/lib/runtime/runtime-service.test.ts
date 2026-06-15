import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

import {
  RUNTIME_BYPASS_HEADER,
  buildRuntimeMessagesUrl,
  extractMessageAgentConfigId,
  extractMessageCaseId,
  maybeProxyMessagesToRuntime,
  normalizeRuntimeBaseUrl,
  resolveRuntimeInternalBaseUrl,
} from './runtime-service'
import { INTERNAL_SECRET_HEADER } from '@/lib/api-auth'

describe('runtime service console proxy helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('normalizes runtime base URLs and builds case-scoped message URLs', () => {
    expect(normalizeRuntimeBaseUrl('http://127.0.0.1:3101///')).toBe('http://127.0.0.1:3101')
    expect(resolveRuntimeInternalBaseUrl({ INTERA_RUNTIME_URL: 'http://runtime:3101/' } as unknown as NodeJS.ProcessEnv)).toBe('http://runtime:3101')
    expect(buildRuntimeMessagesUrl('http://runtime:3101', 'case-1')).toBe('http://runtime:3101/internal/cases/case-1/messages')
    expect(buildRuntimeMessagesUrl('http://runtime:3101', null)).toBe('http://runtime:3101/internal/cases/_unresolved/messages')
  })

  it('extracts routing hints from the message body without requiring them', () => {
    expect(extractMessageCaseId(JSON.stringify({ caseId: 'case-1' }))).toBe('case-1')
    expect(extractMessageCaseId('{bad json')).toBeNull()
    expect(extractMessageAgentConfigId(JSON.stringify({ configId: 'agent-a' }))).toBe('agent-a')
    expect(extractMessageAgentConfigId(JSON.stringify({ agentConfigId: 'agent-b' }))).toBe('agent-b')
  })

  it('forwards authenticated Console traffic to the runtime service when configured', async () => {
    vi.stubEnv('INTERA_RUNTIME_URL', 'http://127.0.0.1:3101')
    vi.stubEnv('INTERNAL_API_SECRET', 'secret-1')

    const fetchMock = vi.fn(async () => new Response('data: {"type":"message_stop"}\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest('http://console.test/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi', caseId: 'case-1', configId: 'agent-a' }),
    })

    const response = await maybeProxyMessagesToRuntime(request, { orgId: 'org-a' })

    expect(response).not.toBeNull()
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3101/internal/cases/case-1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          [INTERNAL_SECRET_HEADER]: 'secret-1',
          'x-intera-org': 'org-a',
          'x-intera-agent-config-id': 'agent-a',
        }),
      }),
    )
  })

  it('does not proxy runtime legacy-forward callbacks back into runtime', async () => {
    vi.stubEnv('INTERA_RUNTIME_URL', 'http://127.0.0.1:3101')
    vi.stubEnv('INTERNAL_API_SECRET', 'secret-1')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const request = new NextRequest('http://console.test/api/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [INTERNAL_SECRET_HEADER]: 'secret-1',
        [RUNTIME_BYPASS_HEADER]: '1',
      },
      body: JSON.stringify({ message: 'hi', caseId: 'case-1' }),
    })

    await expect(maybeProxyMessagesToRuntime(request, { orgId: 'org-a' })).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
