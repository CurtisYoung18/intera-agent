'use client'

import { useMemo, useState } from 'react'
import { Bot, CheckCircle2, FileDiff, Loader2, LockKeyhole, Plus, Save, Sparkles, X } from 'lucide-react'
import { OrganicLoader, OrganicLoaderStrip, TokenStreamPreview, type OrganicLoaderVariant } from '@/components/config-pilot/ai-motion'
import { apiClient, ApiClientError } from '@/lib/api/client'
import type { SavedScenario, TemplateScenario } from '@intera/shared/contracts/scenarios'

type ProposalPhase = 'empty' | 'proposal' | 'diff' | 'saved'

interface ConfigPilotWorkbenchProps {
  agentConfigId: string | null
  onScenarioSaved?: (scenario: SavedScenario) => void | Promise<void>
  drawer?: boolean
  onClose?: () => void
}

interface ScenarioProposal {
  id: string
  title: string
  summary: string
  scenario: TemplateScenario
}

const DEFAULT_PROMPT = 'Create a repeatable deposit handoff Scenario with tool evidence, Hook escalation, human transfer, and forbidden compensation wording.'

export function ConfigPilotWorkbench({ agentConfigId, onScenarioSaved, drawer = false, onClose }: ConfigPilotWorkbenchProps) {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [phase, setPhase] = useState<ProposalPhase>('empty')
  const [proposal, setProposal] = useState<ScenarioProposal | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const diffRows = useMemo(() => proposal ? buildScenarioDiff(proposal.scenario) : [], [proposal])
  const canApply = Boolean(agentConfigId && proposal && phase === 'diff' && confirmed && !saving)

  const generateProposal = () => {
    const next = buildScenarioProposal(prompt)
    setProposal(next)
    setPhase('proposal')
    setConfirmed(false)
    setNotice(null)
    setError(null)
  }

  const reviewDiff = () => {
    if (!proposal) return
    setPhase('diff')
    setConfirmed(false)
    setNotice(null)
    setError(null)
  }

  const applyDraft = async () => {
    if (!agentConfigId || !proposal || phase !== 'diff' || !confirmed) return
    setSaving(true)
    setNotice(null)
    setError(null)
    try {
      const result = await apiClient<{ scenario: SavedScenario }>('/api/admin/scenarios', {
        method: 'POST',
        body: { agentConfigId, ...proposal.scenario },
      })
      setPhase('saved')
      setNotice(`Saved draft Test Scenario: ${result.data.scenario.displayName ?? result.data.scenario.name}`)
      await onScenarioSaved?.(result.data.scenario)
    } catch (err) {
      setError(err instanceof ApiClientError ? err.envelope.error.message : 'Failed to save proposal')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={`${drawer ? 'flex h-full flex-col' : 'intera-q2-panel'}`}>
      <div className={`${drawer ? 'border-b border-[var(--color-border-subtle)] px-5 py-4' : 'border-b border-[var(--color-border-subtle)] px-5 py-4'}`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[rgba(53,127,124,0.10)] text-[var(--color-accent-primary)]">
                <Bot size={16} />
              </span>
              <div>
                <p className="text-xs font-medium text-[var(--color-text-tertiary)]">ConfigPilot</p>
                <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Draft workspace</h2>
              </div>
            </div>
            <p className="mt-3 max-w-2xl text-sm text-[var(--color-text-secondary)]">Generate configuration drafts, inspect the diff, then save through typed APIs. Publishing is unavailable here.</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2.5 text-xs font-medium text-amber-700">
              <LockKeyhole size={13} /> No publish
            </span>
            {drawer && onClose && (
              <button type="button" onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--color-border-subtle)] bg-white text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface-muted)]" aria-label="Close ConfigPilot">
                <X size={15} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className={`${drawer ? 'min-h-0 flex-1 overflow-y-auto p-5' : 'grid gap-5 p-5'}`}>
        <div className={`grid gap-4 ${drawer ? '' : 'xl:grid-cols-[minmax(0,1fr)_300px]'}`}>
          <div className="grid gap-2">
            <label htmlFor={drawer ? 'config-pilot-drawer-prompt' : 'config-pilot-prompt'} className="text-sm font-semibold text-[var(--color-text-primary)]">Prompt</label>
            <textarea id={drawer ? 'config-pilot-drawer-prompt' : 'config-pilot-prompt'} value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={drawer ? 5 : 4} className="w-full rounded-md border border-[var(--color-border-subtle)] bg-white px-3 py-2 text-sm leading-5 text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-accent-primary)]" />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-[var(--color-text-tertiary)]">P0 saves Test Scenario drafts only. Tool, Hook, and Procedure proposals can be previewed in later typed API slices.</p>
              <button type="button" onClick={generateProposal} disabled={!prompt.trim()} className="intera-q2-button inline-flex h-9 items-center gap-2 bg-[var(--color-accent-primary)] px-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60">
                <Sparkles size={15} /> Generate proposal
              </button>
            </div>
          </div>
          <ConfigPilotActivity phase={phase} drawer={drawer} />
        </div>

        {notice && <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</div>}
        {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className={`grid gap-4 ${drawer ? '' : 'lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]'}`}>
          <div className="overflow-hidden rounded-lg border border-[var(--color-border-subtle)] bg-white">
            <div className="border-b border-[var(--color-border-subtle)] px-4 py-3">
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Proposal</h3>
            </div>
            {proposal ? (
              <div className="grid gap-4 p-4">
                <div>
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">{proposal.title}</p>
                  <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{proposal.summary}</p>
                </div>
                <div className="grid gap-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface-muted)] p-3 text-xs text-[var(--color-text-secondary)]">
                  <span>Name: {proposal.scenario.name}</span>
                  <span>Tags: {proposal.scenario.tags.join(', ') || 'none'}</span>
                  <span>Expected final status: {proposal.scenario.expected.finalStatus ?? 'not set'}</span>
                </div>
                <div className="rounded-md border border-[rgba(53,127,124,0.18)] bg-[rgba(53,127,124,0.06)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
                  <TokenStreamPreview text="Generated draft tokens are ready for diff review." />
                </div>
                <button type="button" onClick={reviewDiff} className="intera-q2-button inline-flex h-9 items-center justify-center gap-2 border border-[var(--color-border-subtle)] bg-white px-3 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface-muted)]">
                  <FileDiff size={15} /> Review diff
                </button>
              </div>
            ) : (
              <div className="p-4 text-sm text-[var(--color-text-tertiary)]">Generate a proposal to review draft configuration.</div>
            )}
          </div>

          <div className="overflow-hidden rounded-lg border border-[var(--color-border-subtle)] bg-white">
            <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] px-4 py-3">
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Diff and confirm</h3>
              <span className="text-xs text-[var(--color-text-tertiary)]">{phase === 'diff' || phase === 'saved' ? 'Diff required' : 'Waiting for review'}</span>
            </div>
            <div className="grid gap-4 p-4">
              {phase === 'diff' || phase === 'saved' ? (
                <ConfigDiffPreview rows={diffRows} />
              ) : (
                <div className="rounded-md border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-bg-surface-muted)] px-3 py-8 text-center text-sm text-[var(--color-text-tertiary)]">Diff appears after proposal review.</div>
              )}

              <label className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${phase === 'diff' || phase === 'saved' ? 'border-[var(--color-border-subtle)] bg-[var(--color-bg-surface-muted)] text-[var(--color-text-secondary)]' : 'border-[var(--color-border-subtle)] bg-white text-[var(--color-text-tertiary)]'}`}>
                <input type="checkbox" checked={confirmed} disabled={phase !== 'diff'} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1" />
                <span>I reviewed the diff and want to save this as a draft Test Scenario.</span>
              </label>

              <button type="button" onClick={applyDraft} disabled={!canApply} className="intera-q2-button inline-flex h-10 items-center justify-center gap-2 bg-[var(--color-accent-primary)] px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50" data-testid="config-pilot-apply-draft">
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save draft through API
              </button>
              <p className="text-xs text-[var(--color-text-tertiary)]">The apply action only calls Scenario draft save. It does not activate, publish, or bypass validation receipts.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function ConfigPilotActivity({ phase, drawer }: { phase: ProposalPhase; drawer: boolean }) {
  const copy = phase === 'empty'
    ? { title: 'Ready to draft', detail: 'Use the approved organic loaders only when ConfigPilot is generating or thinking.', variant: '01' as OrganicLoaderVariant, text: 'Waiting for a prompt.' }
    : phase === 'proposal'
      ? { title: 'Proposal generated', detail: 'Review the generated object before opening the diff.', variant: '06' as OrganicLoaderVariant, text: 'Draft tokens resolved into a Test Scenario.' }
      : phase === 'diff'
        ? { title: 'Diff review', detail: 'The draft is held until a human confirms the grouped changes.', variant: '12' as OrganicLoaderVariant, text: 'Diff rows are streaming into review.' }
        : { title: 'Draft saved', detail: 'Scenario draft is saved, but publish remains locked outside ConfigPilot.', variant: '20' as OrganicLoaderVariant, text: 'Saved draft receipt is ready.' }

  return (
    <aside className={`intera-q2-rail ${drawer ? 'p-3' : 'p-4'}`}>
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-[rgba(53,127,124,0.18)] bg-white/75 text-[var(--color-accent-primary)]">
          <OrganicLoader variant={copy.variant} size={24} title={`${copy.title} loader`} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">{copy.title}</p>
          <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">{copy.detail}</p>
        </div>
      </div>
      {!drawer ? <OrganicLoaderStrip className="mt-4" /> : null}
      <p className="mt-4 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white/70 px-3 py-2 text-xs leading-5 text-[var(--color-text-secondary)]">
        <TokenStreamPreview text={copy.text} />
      </p>
    </aside>
  )
}

export function ConfigPilotDrawer({
  open,
  agentConfigId,
  onClose,
  onScenarioSaved,
}: {
  open: boolean
  agentConfigId: string | null
  onClose: () => void
  onScenarioSaved?: (scenario: SavedScenario) => void | Promise<void>
}) {
  if (!open) return null
  return (
    <>
      <div className="fixed inset-0 z-40 bg-[rgba(16,23,29,0.20)]" onClick={onClose} />
      <aside className="fixed right-0 top-0 z-50 h-dvh w-full max-w-[var(--pilot-drawer-width)] border-l border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-raised)]">
        <ConfigPilotWorkbench drawer agentConfigId={agentConfigId} onClose={onClose} onScenarioSaved={onScenarioSaved} />
      </aside>
    </>
  )
}

function ConfigDiffPreview({ rows }: { rows: Array<{ group: string; field: string; before: string; after: string; risk?: string }> }) {
  if (rows.length === 0) return <div className="rounded-md border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-bg-surface-muted)] px-3 py-8 text-center text-sm text-[var(--color-text-tertiary)]">No diff rows.</div>
  return (
    <div className="overflow-hidden rounded-md border border-[var(--color-border-subtle)]">
      <div className="grid grid-cols-[96px_minmax(0,1fr)_minmax(0,1fr)] bg-[var(--color-bg-surface-muted)] px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)]">
        <span>Field</span>
        <span>Before</span>
        <span>After</span>
      </div>
      {rows.map((row) => (
        <div key={`${row.group}-${row.field}`} className="grid grid-cols-[96px_minmax(0,1fr)_minmax(0,1fr)] border-t border-[var(--color-border-subtle)] px-3 py-2 text-xs">
          <span className="font-medium text-[var(--color-text-primary)]">{row.field}</span>
          <span className="truncate text-[var(--color-text-tertiary)]">{row.before}</span>
          <span className="min-w-0 text-[var(--color-text-secondary)]">
            <span className="block truncate">{row.after}</span>
            {row.risk && <span className="mt-1 inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">{row.risk}</span>}
          </span>
        </div>
      ))}
    </div>
  )
}

function buildScenarioProposal(prompt: string): ScenarioProposal {
  const nameSeed = slugify(prompt).slice(0, 42) || 'configpilot_test_case'
  const scenarioName = nameSeed.endsWith('_scenario') ? nameSeed : `${nameSeed}_scenario`
  const displayName = titleize(scenarioName)
  return {
    id: `proposal-${Date.now()}`,
    title: displayName,
    summary: 'A repeatable Scenario draft with tool, Hook, knowledge, handoff, final status, and phrase expectations.',
    scenario: {
      name: scenarioName,
      displayName,
      description: prompt.trim(),
      locale: 'en-US',
      tags: ['configpilot', 'pilot-lab'],
      enabled: true,
      turns: [
        { role: 'user', content: 'My deposit has not arrived yet and the provider proof is unclear.' },
        { role: 'assistant', content: 'I checked the available evidence and will transfer this case to a human specialist.' },
      ],
      expected: {
        caseType: 'deposit_issue',
        toolsCalled: ['get_latest_deposit'],
        hooks: [{ hookName: 'conflict_requires_human', checkpoint: 'PostToolUse', decision: 'escalate' }],
        humanTransfer: true,
        finalStatus: 'waiting_human',
        forbiddenPhrases: ['guaranteed compensation'],
        requiredPhrases: ['human specialist'],
      },
    },
  }
}

function buildScenarioDiff(scenario: TemplateScenario): Array<{ group: string; field: string; before: string; after: string; risk?: string }> {
  return [
    { group: 'Test Scenarios', field: 'Name', before: 'No draft', after: scenario.name },
    { group: 'Test Scenarios', field: 'Turns', before: 'No draft', after: `${scenario.turns.length} scripted turns` },
    { group: 'Test Scenarios', field: 'Tools', before: 'No expected tools', after: scenario.expected.toolsCalled?.join(', ') ?? 'none' },
    { group: 'Test Scenarios', field: 'Hooks', before: 'No expected Hooks', after: scenario.expected.hooks?.map((hook) => hook.hookName).join(', ') ?? 'none', risk: 'Escalation path' },
    { group: 'Test Scenarios', field: 'Handoff', before: 'Not required', after: scenario.expected.humanTransfer ? 'Required' : 'Not required', risk: scenario.expected.humanTransfer ? 'Human transfer' : undefined },
    { group: 'Test Scenarios', field: 'Phrase checks', before: 'No checks', after: [...(scenario.expected.forbiddenPhrases ?? []), ...(scenario.expected.requiredPhrases ?? [])].join(', ') || 'none' },
  ]
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_')
}

function titleize(value: string): string {
  return value.split('_').filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}
