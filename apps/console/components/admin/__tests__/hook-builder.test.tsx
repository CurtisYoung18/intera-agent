// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup, waitFor, within } from '@testing-library/react'
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
    { caseTypeId: 'ct1', caseTypeType: 'deposit_issue', caseTypeDisplayName: 'Deposit Issue', id: 'lookup_deposit', label: 'Deposit Issue / lookup_deposit' },
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
    if (url === '/api/admin/hooks/investigate_before_transfer?agentConfigId=agent_default_v1' && options?.method === 'DELETE') {
      return { data: { ok: true } }
    }
    return { data: {} }
  })
})

afterEach(() => {
  cleanup()
})

async function renderHookBuilder() {
  const { default: HookBuilder } = await import('@/components/admin/hook-builder')
  const { LocaleProvider } = await import('@/components/locale-provider')
  await act(async () => {
    render(
      <LocaleProvider>
        <React.Suspense>
          <HookBuilder />
        </React.Suspense>
      </LocaleProvider>,
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
    expect(screen.getAllByText('get_latest_deposit').length).toBeGreaterThan(0)
  })

  it('creates a Hook through the Hook API contract', async () => {
    await renderHookBuilder()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /New Hook/ }))
    })
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('investigate_before_transfer'), { target: { value: 'stop_unsafe_promise' } })
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
      checkpoint: 'PreToolUse',
      handlerKind: 'declarative',
      displayName: 'Stop Unsafe Promise',
    })
    expect(createCall[1].body.handler.kind).toBe('declarative')
    expect(createCall[1].body.handler.check.kind).toBe('rule')
    expect(createCall[1].body.handler.check.always).toBe(true)
    expect(createCall[1].body.handler.effect.decision).toBe('block')
  })

  it('builds Rule checks from structured fields instead of raw JSON input', async () => {
    await renderHookBuilder()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /New Hook/ }))
    })
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('investigate_before_transfer'), { target: { value: 'warn_provider_mismatch' } })
      fireEvent.click(screen.getByRole('button', { name: 'get_latest_deposit' }))
      fireEvent.click(screen.getByRole('button', { name: /Output contains/ }))
    })
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('One phrase per line'), { target: { value: 'provider_mismatch' } })
      fireEvent.change(screen.getByPlaceholderText('Explain why this rule matched.'), { target: { value: 'Provider proof needs review' } })
      fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))
    })

    const createCall = await waitFor(() => {
      const call = mockApiClient.mock.calls.find(([url, options]) => url === '/api/admin/hooks' && options?.method === 'POST')
      expect(call).toBeDefined()
      return call
    })
    expect(createCall![1].body.handler.check).toMatchObject({
      kind: 'rule',
      match: { tools: ['get_latest_deposit'] },
      outputContains: ['provider_mismatch'],
      reason: 'Provider proof needs review',
    })
  })

  it('inserts runtime placeholders into the LLM eval prompt with slash menu', async () => {
    await renderHookBuilder()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /New Hook/ }))
    })
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('investigate_before_transfer'), { target: { value: 'trace_customer_reply' } })
      fireEvent.click(screen.getByRole('button', { name: 'LLM eval' }))
    })

    const prompt = screen.getByLabelText('Evaluation prompt') as HTMLTextAreaElement
    await act(async () => {
      fireEvent.keyUp(prompt, { key: '/' })
    })
    expect(screen.getByText('Insert runtime placeholder')).toBeDefined()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Tool runtime/ }))
    })
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /\{\{tool_output\}\}/ })[0]!)
    })

    expect(prompt.value).toContain('{{tool_output}}')
  })

  it('shows the enabled toggle beside save controls', async () => {
    await renderHookBuilder()

    expect(screen.getByRole('button', { name: 'Enabled' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDefined()
  })

  it('requires confirmation before deleting a Hook', async () => {
    await renderHookBuilder()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete Hook' }))
    })

    expect(mockApiClient.mock.calls.some(([url, options]) => url.includes('/api/admin/hooks/investigate_before_transfer') && options?.method === 'DELETE')).toBe(false)

    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText('Delete Hooks')).toBeDefined()
    expect(within(dialog).getByText('Permanently delete "Investigate before transfer"? This action cannot be undone.')).toBeDefined()

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    })

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(mockApiClient.mock.calls.some(([url, options]) => url.includes('/api/admin/hooks/investigate_before_transfer') && options?.method === 'DELETE')).toBe(false)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete Hook' }))
    })

    const confirmDialog = screen.getByRole('alertdialog')
    await act(async () => {
      fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Delete' }))
    })

    await waitFor(() => {
      expect(mockApiClient.mock.calls.some(([url, options]) => url === '/api/admin/hooks/investigate_before_transfer?agentConfigId=agent_default_v1' && options?.method === 'DELETE')).toBe(true)
    })
  })
})
