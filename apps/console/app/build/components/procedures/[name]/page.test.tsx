// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockApiClient = vi.fn()
const mockBustConfigCache = vi.fn(async () => {})
const mockReplace = vi.fn()
const detailT = (key: string, params?: Record<string, unknown>) => {
  const labels: Record<string, string> = {
    'procedureEditor.error.selectAgent': 'Select an agent version first.',
    'procedureEditor.error.load': 'Failed to load Procedure type',
    'procedureEditor.error.save': 'Failed to save Procedure type',
    'procedureEditor.error.displayNameRequired': 'Enter a display name before saving.',
    'procedureEditor.back': 'Back to Procedures',
    'procedureEditor.form.displayName': 'Display name',
    'procedureEditor.defaults.newProcedure': 'New Procedure',
    'procedureEditor.status.draft': 'Draft',
    'procedureEditor.actions.settings': 'Settings',
    'common.save': 'Save',
    'common.delete': 'Delete',
    'procedureEditor.actions.close': 'Close',
    'procedureEditor.section.orderedSteps': 'Ordered procedure steps',
    'procedureEditor.form.whenToUse': 'When to use this procedure',
    'procedureEditor.badge.v2': 'Procedure v2',
    'procedureEditor.form.procedureKey': 'Procedure key',
    'common.enabled': 'Enabled',
    'common.disabled': 'Disabled',
    'procedureEditor.section.advanced': 'Advanced',
    'procedureEditor.form.icon': 'Icon',
    'procedureEditor.form.maxAutoTurns': 'Max auto turns',
    'common.description': 'Description',
    'procedureEditor.form.overview': 'Overview',
    'caseTypes.defaultGoal': 'Default goal',
    'procedureEditor.form.requiredFacts': 'Required facts',
    'procedureEditor.form.escalateOn': 'Escalate on',
    'procedureEditor.form.knowledgeGuidance': 'Knowledge guidance',
    'procedureEditor.form.handoffGuidance': 'Handoff guidance',
    'procedureEditor.form.autoCloseConditions': 'Auto close conditions',
    'procedureEditor.placeholder.whenToUse': 'When to use placeholder',
    'procedureEditor.status.branches': 'Branches',
    'procedureEditor.section.stepHooks': 'Step Hooks',
    'procedureEditor.section.stepHooksHint': 'Hook hint',
    'procedureEditor.actions.openHooks': 'Open Hooks',
    'procedureEditor.section.noHookBindings': 'No Hook bindings',
    'procedureEditor.section.bindExistingHook': 'Bind existing Hook',
    'procedureEditor.placeholder.selectHook': 'Select a Hook',
    'procedureEditor.actions.bind': 'Bind',
    'procedureEditor.section.createAndBindHook': 'Create and bind Hook',
    'procedureEditor.placeholder.newHookName': 'new_hook',
    'procedureEditor.actions.create': 'Create',
    'caseTypes.enabledForRouting': 'Enabled for routing',
    'caseTypes.defaults.whenToUse': 'Use this procedure when the route is selected for a new customer issue.',
    'caseTypes.defaults.stepTitle': 'Open the investigation',
    'caseTypes.defaults.stepGuidance': 'Ask for the minimum context you need, then gather the first hard evidence.',
    'caseTypes.defaults.actionLabel': 'Ask for the key details',
    'procedureEditor.actions.addStep': 'Add step',
    'procedureEditor.actions.addAction': 'Add action',
    'procedureEditor.actions.addIf': 'Add IF',
    'procedureEditor.actions.addElseIf': 'Add ELSE IF',
    'procedureEditor.actions.addElse': 'Add ELSE',
    'procedureEditor.section.branches': 'IF / ELSE branches',
    'procedureEditor.section.branchesHint': 'Branches hint',
    'procedureEditor.section.branchesEmpty': 'No branches yet.',
    'procedureEditor.form.stepTitle': 'Step title',
    'procedureEditor.form.operatorGuidance': 'Operator guidance',
    'procedureEditor.section.defaultActions': 'Default actions',
    'procedureEditor.defaults.stepTitle': `Step ${String(params?.n ?? 1)}`,
    'procedureEditor.actions.remove': 'Remove',
    'procedureEditor.section.stepControls': 'Step controls',
    'procedureEditor.form.stepKey': 'Step key',
    'procedureEditor.form.completionGuidance': 'Completion guidance',
    'procedureEditor.form.skipGuidance': 'Skip guidance',
    'procedureEditor.placeholder.completionGuidance': 'completion',
    'procedureEditor.placeholder.skipGuidance': 'skip',
    'procedureEditor.confirm.deleteTitle': 'Delete Procedure type?',
    'procedureEditor.confirm.deleteMessage': 'Delete it?',
    'procedureEditor.confirm.deleteMessageNamed': `Delete ${String(params?.name ?? '')}`,
    'procedureEditor.actionKind.ask': 'Ask the customer',
  }
  return labels[key] ?? key
}

vi.mock('next/navigation', () => ({
  useParams: () => ({ name: '__new__' }),
  useRouter: () => ({ replace: mockReplace }),
}))

vi.mock('@/lib/api/client', () => ({
  apiClient: (...args: unknown[]) => mockApiClient(...args),
  bustConfigCache: mockBustConfigCache,
}))

vi.mock('@/components/locale-provider', () => ({
  useConsoleLocale: () => ({
    locale: 'en',
    t: detailT,
  }),
}))

vi.mock('@/components/admin/version-context-bar', () => ({
  __esModule: true,
  default: () => null,
  useSelectedAgentId: () => 'agent_v3',
}))

vi.mock('@/lib/hooks/use-session', () => ({
  useSession: () => ({ orgId: 'org_default' }),
}))

vi.mock('../../_components/components-route-shell', () => ({
  BuildComponentsRouteShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/components/ui/page-loader', () => ({
  PageLoader: ({ loading, error, children }: { loading: boolean; error: string | null; children: React.ReactNode }) => (
    loading ? <div>loading</div> : error ? <div>{error}</div> : <>{children}</>
  ),
}))

vi.mock('@/components/ui/confirm-dialog', () => ({
  __esModule: true,
  default: () => null,
}))

vi.mock('@/components/ui/chip-input', () => ({
  __esModule: true,
  default: () => <div data-testid="chip-input" />,
}))

describe('BuildProcedureDetailPage new draft mode', () => {
  beforeEach(() => {
    mockApiClient.mockReset()
    mockBustConfigCache.mockClear()
    mockReplace.mockReset()
    mockApiClient.mockImplementation(async (url: string, options?: { method?: string; body?: Record<string, unknown> }) => {
      if (url.startsWith('/api/admin/hooks?')) {
        return { data: { hooks: [] } }
      }
      if (url === '/api/admin/case-types' && options?.method === 'POST') {
        return {
          data: {
            caseType: {
              id: 'ct_1',
              type: String(options.body?.type),
              displayName: String(options.body?.displayName),
              description: '',
              icon: '📋',
              requiredFacts: '[]',
              defaultGoal: '',
              escalateOn: '[]',
              autoCloseConditions: null,
              enabled: true,
              procedure: '{}',
              maxAutoTurns: 10,
            },
          },
        }
      }
      throw new Error(`Unexpected apiClient call: ${url}`)
    })
  })

  it('loads as a local draft and only creates the Procedure on explicit save', async () => {
    const { default: BuildProcedureDetailPage } = await import('./page')

    render(<BuildProcedureDetailPage />)

    const displayNameInput = await screen.findByRole('textbox', { name: 'Display name' })
    expect(screen.queryByLabelText('Delete')).toBeNull()
    expect(mockApiClient.mock.calls.some(([url]) => String(url).includes('/api/admin/case-types/__new__'))).toBe(false)

    fireEvent.change(displayNameInput, { target: { value: 'Deposit Retry' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(mockApiClient).toHaveBeenCalledWith(
        '/api/admin/case-types',
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({
            agentConfigId: 'agent_v3',
            type: 'deposit_retry',
            displayName: 'Deposit Retry',
          }),
        }),
      )
    })
    expect(mockReplace).toHaveBeenCalledWith('/build/components/procedures/deposit_retry')
  })
})
