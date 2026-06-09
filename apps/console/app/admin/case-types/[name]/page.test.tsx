// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, fireEvent, waitFor, within } from '@testing-library/react'

const mockApiClient = vi.fn()

vi.mock('@/lib/api/client', () => ({
  apiClient: (...args: unknown[]) => mockApiClient(...args),
  bustConfigCache: vi.fn(async () => {}),
}))

vi.mock('@/components/admin/version-context-bar', () => ({
  default: () => null,
  useSelectedAgentId: vi.fn(() => 'agent-1'),
}))

vi.mock('@/lib/hooks/use-session', () => ({
  useSession: vi.fn(() => ({ orgId: 'org-1' })),
}))

vi.mock('@/components/ui/confirm-dialog', () => ({
  default: () => null,
}))

const mockRouter = { replace: vi.fn(), push: vi.fn() }

vi.mock('next/navigation', async () => {
  const actual = await vi.importActual('next/navigation')
  return {
    ...actual,
    useParams: () => ({ name: 'refund_case' }),
    useRouter: () => mockRouter,
  }
})

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
}))

function setupApiMocks() {
  mockApiClient.mockImplementation(async (url: string, options: any = {}) => {
    if (url === '/api/admin/tools') {
      return { data: { tools: [{ name: 'tool_a' }] } }
    }
    if (url === '/api/admin/models') {
      return { data: { models: [{ id: 'model-x' }] } }
    }
    if (url === '/api/admin/case-types/refund_case?agentConfigId=agent-1') {
      return {
        data: {
          caseType: {
            id: 'ct-1',
            type: 'refund_case',
            displayName: 'Refund Case',
            description: 'Case type for refunds',
            icon: '💳',
            defaultGoal: '',
            stages: '["created"]',
            requiredFacts: '[]',
            escalateOn: '[]',
            autoCloseConditions: '[]',
            stageConfigs: '{}',
            orchestratorConfig: '{"enabled":false}',
            enabled: true,
            requireHumanReview: false,
            executionMode: 'cc',
            sop: null,
            sopMaxAutoTurns: 10,
            procedure: JSON.stringify({
            steps: [
              {
                id: 'step_1',
                action: 'use',
                target: 'customer',
                guidance: 'collect missing docs',
                when: 'always',
                required: true,
              },
              ],
            }),
            guardrails: '["human_review_before_finalize"]',
          },
        },
      }
    }
    if (url === '/api/admin/hooks?agentConfigId=agent-1') {
      return {
        data: {
          hooks: [
            {
              id: 'hook-agent',
              name: 'agent_scope_hook',
              displayName: 'Agent Scope Hook',
              enabled: true,
              bindings: [
                {
                  id: 'binding-agent',
                  hookName: 'agent_scope_hook',
                  scopeType: 'agent',
                  scopeKey: 'agent',
                  enabled: true,
                },
              ],
            },
            {
              id: 'hook-case',
              name: 'case_scope_hook',
              displayName: 'Case Scope Hook',
              enabled: true,
              bindings: [
                {
                  id: 'binding-case',
                  hookName: 'case_scope_hook',
                  scopeType: 'caseType',
                  scopeKey: 'caseType:ct-1',
                  caseTypeId: 'ct-1',
                  enabled: true,
                },
              ],
            },
          ],
        },
      }
    }
    if (url.startsWith('/api/admin/hooks/')) {
      const hasBindingsEndpoint = /\/bindings$/.test(url)
      if (hasBindingsEndpoint && options?.method === 'POST') {
        return {
          data: {
            binding: {
              id: 'binding-new',
              hookName: decodeURIComponent(url.split('/').slice(-2).slice(-1)[0] || ''),
              scopeType: 'procedureStep',
              scopeKey: `procedureStep:ct-1:${options?.body?.procedureStepId || 'unknown'}`,
              enabled: true,
            },
          },
        }
      }
      if (hasBindingsEndpoint && options?.method === 'DELETE') {
        return { data: { success: true } }
      }
      return { data: { hook: { name: 'new_hook_from_step' } } }
    }
    if (url === '/api/admin/hooks') {
      return {
        data: {
          hook: {
            name: options?.body?.name || 'created_hook',
          },
        },
      }
    }
    return { data: {} }
  })
}

describe('CaseType detail Procedure flow', () => {
  const waitForCaseTypeLoad = async (container: HTMLElement, view: ReturnType<typeof within>) => {
    await waitFor(() => {
      expect(mockApiClient.mock.calls.some(([calledUrl]) => calledUrl === '/api/admin/case-types/refund_case?agentConfigId=agent-1')).toBe(true)
      expect(mockApiClient.mock.calls.some(([calledUrl]) => calledUrl === '/api/admin/hooks?agentConfigId=agent-1')).toBe(true)
      expect(container.querySelector('.animate-spin')).toBeNull()
      expect(view.getByText('Procedure Steps')).toBeTruthy()
      expect(view.getByText('agent_scope_hook')).toBeTruthy()
      expect(view.getByText('case_scope_hook')).toBeTruthy()
      expect(view.getByText('No direct step hooks bound.')).toBeTruthy()
    })
  }

  beforeEach(() => {
    mockApiClient.mockReset()
    setupApiMocks()
  })

  it('shows inherited hook context for procedure steps', async () => {
    const { default: CaseTypeDetailPage } = await import('./page')
    const { container } = render(<CaseTypeDetailPage />)
    const view = within(container)

    await waitForCaseTypeLoad(container, view)
    expect(view.getByText('agent_scope_hook')).toBeTruthy()
    expect(view.getByText('case_scope_hook')).toBeTruthy()
    expect(view.getByText('No direct step hooks bound.')).toBeTruthy()
  })

  it('binds an existing Hook to a procedure step via /api/admin/hooks/:name/bindings', async () => {
    const { default: CaseTypeDetailPage } = await import('./page')
    const { container } = render(<CaseTypeDetailPage />)
    const view = within(container)

    await waitFor(() => {
      expect(view.getByText('Procedure Steps')).toBeTruthy()
      expect(view.getByText('No direct step hooks bound.')).toBeTruthy()
    })
    const select = await waitFor(() => view.getByTestId('procedure-step-step_1-existing-hook-select'))
    const addButton = await waitFor(() => view.getByTestId('procedure-step-step_1-existing-hook-add'))
    await act(async () => {
      fireEvent.change(select, {
        target: { value: 'case_scope_hook' },
      })
      fireEvent.click(addButton)
    })

    await waitFor(() => {
      const call = mockApiClient.mock.calls.find(
        ([calledUrl, calledOpts]) =>
          typeof calledUrl === 'string'
          && calledUrl.startsWith('/api/admin/hooks/case_scope_hook/bindings')
          && calledOpts?.method === 'POST',
      )
      expect(call).toBeDefined()
      expect(call![1]).toMatchObject({
        method: 'POST',
        body: {
          agentConfigId: 'agent-1',
          scopeType: 'procedureStep',
          caseTypeId: 'ct-1',
          procedureStepId: 'step_1',
        },
      })
    })
  })

  it('creates then binds a new Hook for a procedure step through /api/admin/hooks', async () => {
    const { default: CaseTypeDetailPage } = await import('./page')
    const { container } = render(<CaseTypeDetailPage />)
    const view = within(container)

    await waitFor(() => {
      expect(view.getByText('Procedure Steps')).toBeTruthy()
      expect(view.getByText('No direct step hooks bound.')).toBeTruthy()
    })
    const input = await waitFor(() => view.getByTestId('procedure-step-step_1-new-hook-input'))
    const createButton = await waitFor(() => view.getByTestId('procedure-step-step_1-new-hook-create'))
    await act(async () => {
      fireEvent.change(input, {
        target: { value: 'step_scope_hook' },
      })
      fireEvent.click(createButton)
    })

    await waitFor(() => {
      const createCall = mockApiClient.mock.calls.find(
        ([calledUrl, calledOpts]) => calledUrl === '/api/admin/hooks' && calledOpts?.method === 'POST',
      )
      const bindCall = mockApiClient.mock.calls.find(
        ([calledUrl, calledOpts]) =>
          typeof calledUrl === 'string'
          && calledUrl.includes('/api/admin/hooks/step_scope_hook/bindings')
          && calledOpts?.method === 'POST',
      )
      expect(createCall).toBeDefined()
      expect(bindCall).toBeDefined()
      expect(createCall![1]).toMatchObject({
        method: 'POST',
        body: {
          agentConfigId: 'agent-1',
          name: 'step_scope_hook',
          checkpoint: 'PreToolUse',
          handlerKind: 'declarative',
          enabled: true,
          severity: 'medium',
        },
      })
      expect(bindCall![1]).toMatchObject({
        method: 'POST',
        body: {
          agentConfigId: 'agent-1',
          scopeType: 'procedureStep',
          caseTypeId: 'ct-1',
          procedureStepId: 'step_1',
        },
      })
    })
  })
})
