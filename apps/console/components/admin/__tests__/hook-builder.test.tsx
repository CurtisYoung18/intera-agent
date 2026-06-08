// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react'
import React from 'react'

const mockApiClient = vi.fn()
const mockBustConfigCache = vi.fn(async (_orgId: string) => {})

vi.mock('@/lib/api/client', () => ({
  apiClient: (...args: any[]) => mockApiClient(...args),
  bustConfigCache: (orgId: string) => mockBustConfigCache(orgId),
  ApiClientError: class ApiClientError extends Error {
    constructor(public envelope: any) {
      super(envelope.error.message)
    }
  },
}))

vi.mock('@/components/admin/version-context-bar', () => ({
  default: () => null,
  useSelectedAgentId: vi.fn(() => 'agent_default_v1'),
}))

vi.mock('@/lib/hooks/use-session', () => ({
  useSession: vi.fn(() => ({ orgId: 'default' })),
}))

const bootstrap = {
  hooks: [
    {
      id: 'h1',
      agentConfigId: 'agent_default_v1',
      name: 'investigate_before_transfer',
      displayName: 'Investigate before transfer',
      description: 'Require investigation',
      checkpoint: 'PreToolUse',
      handlerKind: 'declarative',
      handler: { kind: 'declarative', check: {}, effect: { action: 'block' } },
      enabled: true,
      severity: 'high',
      bindings: [],
    },
  ],
  caseTypes: [
    { id: 'ct1', type: 'deposit_issue', displayName: 'Deposit Issue', enabled: true },
  ],
  procedureSteps: [
    { caseTypeId: 'ct1', caseTypeType: 'deposit_issue', caseTypeDisplayName: 'Deposit Issue', id: 'lookup_deposit', action: 'use', target: 'get_latest_deposit', label: 'Deposit Issue / lookup_deposit' },
  ],
  tools: [
    { id: 't1', name: 'get_latest_deposit', description: 'Deposit lookup', mode: 'http', enabled: true },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockApiClient.mockImplementation(async (url: string, options?: any) => {
    if (url.startsWith('/api/admin/hooks?')) {
      return { data: bootstrap }
    }
    if (url === '/api/admin/hooks' && options?.method === 'POST') {
      return {
        data: {
          hook: {
            id: 'h2',
            ...options.body,
            bindings: [],
          },
        },
      }
    }
    return { data: {} }
  })
})

afterEach(() => {
  cleanup()
})

async function renderHookBuilder() {
  const { default: HookBuilder } = await import('@/components/admin/hook-builder')
  await act(async () => {
    render(
      <React.Suspense>
        <HookBuilder />
      </React.Suspense>,
    )
  })
  return screen.findByText('Investigate before transfer')
}

describe('HookBuilder', () => {
  it('renders hook data and exposes ProcedureStep and Tool binding pickers', async () => {
    await renderHookBuilder()

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Scope'), { target: { value: 'procedureStep' } })
    })
    expect(screen.getByText('Deposit Issue / lookup_deposit')).toBeDefined()

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Scope'), { target: { value: 'tool' } })
    })
    expect(screen.getByText('get_latest_deposit')).toBeDefined()
  })

  it('creates a Hook through the Hook API contract', async () => {
    await renderHookBuilder()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /New Hook/ }))
    })
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('investigate_before_transfer'), { target: { value: 'stop_unsafe_promise' } })
      fireEvent.change(screen.getByLabelText('Checkpoint'), { target: { value: 'Stop' } })
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))
    })

    await waitFor(() => {
      expect(mockApiClient.mock.calls.some(([url, options]) => url === '/api/admin/hooks' && options?.method === 'POST')).toBe(true)
    })
    const createCall = mockApiClient.mock.calls.find(([url, options]) => url === '/api/admin/hooks' && options?.method === 'POST')
    expect(createCall).toBeDefined()
    if (!createCall) throw new Error('Expected Hook create API call')
    expect(createCall[1].body).toMatchObject({
      agentConfigId: 'agent_default_v1',
      name: 'stop_unsafe_promise',
      checkpoint: 'Stop',
      handlerKind: 'declarative',
    })
    expect(createCall[1].body.handler.kind).toBe('declarative')
  })
})
