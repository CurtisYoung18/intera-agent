'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Ban, Bot, ClipboardList, FileDiff, Loader2, LockKeyhole, Save, Sparkles, X } from 'lucide-react'
import { OrganicLoader, OrganicLoaderStrip, TokenStreamPreview, type OrganicLoaderVariant } from '@/components/config-pilot/ai-motion'
import ConfigDiffViewer from '@/components/config-diff/config-diff-viewer'
import { apiClient, ApiClientError } from '@/lib/api/client'
import type { SavedScenario } from '@intera/shared/contracts/scenarios'
import type {
  ConfigPilotApplyResponse,
  ConfigPilotContextResponse,
  ConfigPilotPatch,
  ConfigPilotProposal,
  ConfigPilotProposeResponse,
} from '@/lib/config-pilot/contracts'

type ProposalPhase = 'empty' | 'generating' | 'proposal' | 'diff' | 'saved'

interface ConfigPilotWorkbenchProps {
  agentConfigId: string | null
  onScenarioSaved?: (scenario: SavedScenario) => void | Promise<void>
  drawer?: boolean
  onClose?: () => void
}

const DEFAULT_PROMPT = 'Create a repeatable deposit handoff Scenario with tool evidence, Hook escalation, human transfer, and forbidden compensation wording.'

export function ConfigPilotWorkbench({ agentConfigId, onScenarioSaved, drawer = false, onClose }: ConfigPilotWorkbenchProps) {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [phase, setPhase] = useState<ProposalPhase>('empty')
  const [context, setContext] = useState<ConfigPilotContextResponse | null>(null)
  const [proposal, setProposal] = useState<ConfigPilotProposal | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [loadingContext, setLoadingContext] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [modelUsed, setModelUsed] = useState<string | null>(null)
  const [promptVersion, setPromptVersion] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const diffGroups = useMemo(() => proposal?.diffGroups ?? [], [proposal])
  const canApply = Boolean(agentConfigId && context?.permissions.canApply && proposal && phase === 'diff' && confirmed && !saving)

  const loadContext = useCallback(async () => {
    if (!agentConfigId) {
      setContext(null)
      return
    }
    setLoadingContext(true)
    setError(null)
    try {
      const result = await apiClient<ConfigPilotContextResponse>(`/api/admin/config-pilot/context?agentConfigId=${encodeURIComponent(agentConfigId)}`)
      setContext(result.data)
    } catch (err) {
      setError(err instanceof ApiClientError ? err.envelope.error.message : 'Failed to load ConfigPilot context')
    } finally {
      setLoadingContext(false)
    }
  }, [agentConfigId])

  useEffect(() => { loadContext() }, [loadContext])

  const generateProposal = async () => {
    if (!agentConfigId || !prompt.trim()) return
    setGenerating(true)
    setPhase('generating')
    setProposal(null)
    setConfirmed(false)
    setNotice(null)
    setError(null)
    try {
      const result = await apiClient<ConfigPilotProposeResponse>('/api/admin/config-pilot/propose', {
        method: 'POST',
        body: { agentConfigId, request: prompt },
      })
      setProposal(result.data.proposal)
      setModelUsed(result.data.modelUsed)
      setPromptVersion(result.data.promptVersion)
      setPhase('proposal')
    } catch (err) {
      setPhase('empty')
      setError(err instanceof ApiClientError ? err.envelope.error.message : 'Failed to generate ConfigPilot proposal')
    } finally {
      setGenerating(false)
    }
  }

  const reviewDiff = () => {
    if (!proposal) return
    setPhase('diff')
    setConfirmed(false)
    setNotice(null)
    setError(null)
  }

  const rejectProposal = () => {
    setProposal(null)
    setPhase('empty')
    setConfirmed(false)
    setModelUsed(null)
    setPromptVersion(null)
    setNotice('Proposal rejected. No draft changes were written.')
    setError(null)
  }

  const applyDraft = async () => {
    if (!agentConfigId || !proposal || phase !== 'diff' || !confirmed) return
    setSaving(true)
    setNotice(null)
    setError(null)
    try {
      const result = await apiClient<ConfigPilotApplyResponse>('/api/admin/config-pilot/apply', {
        method: 'POST',
        body: { agentConfigId, accepted: confirmed, proposal },
      })
      setPhase('saved')
      setNotice(`Applied ${result.data.appliedPatches.length} draft ${result.data.appliedPatches.length === 1 ? 'change' : 'changes'}${result.data.createdDraft ? ` to new draft ${result.data.draftAgentConfigId}` : ''}. Validation is now ${result.data.validation.state}.`)
      const scenario = result.data.artifacts.scenarios[0] as SavedScenario | undefined
      if (scenario) await onScenarioSaved?.(scenario)
      await loadContext()
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
                <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Typed draft workspace</h2>
              </div>
            </div>
            <p className="mt-3 max-w-2xl text-sm text-[var(--color-text-secondary)]">Generate server-side typed proposals, inspect the diff, then save accepted changes as draft configuration. Publishing is unavailable here.</p>
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
              <p className="text-xs text-[var(--color-text-tertiary)]">{context?.permissions.canApply ? 'ConfigPilot can propose and apply accepted draft changes for this Agent.' : 'Current role can inspect context, but applying draft changes requires admin or owner.'}</p>
              <button type="button" onClick={generateProposal} disabled={!agentConfigId || !prompt.trim() || generating || loadingContext || !context?.permissions.canPropose} className="intera-q2-button inline-flex h-9 items-center gap-2 bg-[var(--color-accent-primary)] px-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60">
                {generating ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} {generating ? 'Generating' : 'Generate proposal'}
              </button>
            </div>
          </div>
          <ConfigPilotActivity phase={phase} drawer={drawer} />
        </div>

        <ConfigPilotContextPanel context={context} loading={loadingContext} modelUsed={modelUsed} promptVersion={promptVersion} />

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
                  {proposal.rationale ? <p className="mt-2 text-xs leading-5 text-[var(--color-text-tertiary)]">{proposal.rationale}</p> : null}
                </div>
                <div className="grid gap-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface-muted)] p-3 text-xs text-[var(--color-text-secondary)]">
                  <span>Target surface: {proposal.targetSurface}</span>
                  <span>Patches: {proposal.patches.length}</span>
                  <span>Model used: {modelUsed ?? 'not recorded'}</span>
                  <span>Prompt version: {promptVersion ?? 'not recorded'}</span>
                </div>
                <ConfigPilotPatchList patches={proposal.patches} />
                <div className="rounded-md border border-[rgba(53,127,124,0.18)] bg-[rgba(53,127,124,0.06)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
                  <TokenStreamPreview text="Generated draft tokens are ready for diff review." />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={reviewDiff} className="intera-q2-button inline-flex h-9 items-center justify-center gap-2 border border-[var(--color-border-subtle)] bg-white px-3 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface-muted)]">
                    <FileDiff size={15} /> Review diff
                  </button>
                  <button type="button" onClick={rejectProposal} className="intera-q2-button inline-flex h-9 items-center justify-center gap-2 border border-red-200 bg-white px-3 text-sm font-medium text-red-700 hover:bg-red-50">
                    <Ban size={15} /> Reject
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-4 text-sm text-[var(--color-text-tertiary)]">{phase === 'generating' ? 'ConfigPilot is asking the server-side model for a typed proposal.' : 'Generate a proposal to review draft configuration.'}</div>
            )}
          </div>

          <div className="overflow-hidden rounded-lg border border-[var(--color-border-subtle)] bg-white">
            <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] px-4 py-3">
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Diff and confirm</h3>
              <span className="text-xs text-[var(--color-text-tertiary)]">{phase === 'diff' || phase === 'saved' ? 'Diff required' : 'Waiting for review'}</span>
            </div>
            <div className="grid gap-4 p-4">
              {phase === 'diff' || phase === 'saved' ? (
                <ConfigDiffViewer title="ConfigPilot proposal diff" subtitle="Review exact typed patch changes before accepting. This action cannot publish." groups={diffGroups} emptyLabel="No proposal diff rows were returned." />
              ) : (
                <div className="rounded-md border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-bg-surface-muted)] px-3 py-8 text-center text-sm text-[var(--color-text-tertiary)]">Diff appears after proposal review.</div>
              )}

              <label className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${phase === 'diff' || phase === 'saved' ? 'border-[var(--color-border-subtle)] bg-[var(--color-bg-surface-muted)] text-[var(--color-text-secondary)]' : 'border-[var(--color-border-subtle)] bg-white text-[var(--color-text-tertiary)]'}`}>
                <input type="checkbox" checked={confirmed} disabled={phase !== 'diff'} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1" />
                <span>I reviewed the diff and explicitly accept these draft configuration changes.</span>
              </label>

              <button type="button" onClick={applyDraft} disabled={!canApply} className="intera-q2-button inline-flex h-10 items-center justify-center gap-2 bg-[var(--color-accent-primary)] px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50" data-testid="config-pilot-apply-draft">
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save draft through API
              </button>
              <p className="text-xs text-[var(--color-text-tertiary)]">Apply writes draft config through typed backend APIs, marks validation stale, and never activates or publishes.</p>
              {proposal?.receiptSuggestions.length ? (
                <SuggestionList title="Receipt suggestions" suggestions={proposal.receiptSuggestions} />
              ) : null}
              {proposal?.runSuggestions.length ? (
                <SuggestionList title="Run suggestions" suggestions={proposal.runSuggestions} />
              ) : null}
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
    : phase === 'generating'
      ? { title: 'Generating proposal', detail: 'The server-side model is returning one typed proposal tool call.', variant: '05' as OrganicLoaderVariant, text: 'ConfigPilot model is drafting typed patches.' }
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

function ConfigPilotContextPanel({ context, loading, modelUsed, promptVersion }: { context: ConfigPilotContextResponse | null; loading: boolean; modelUsed: string | null; promptVersion: string | null }) {
  if (loading) {
    return <div className="rounded-md border border-[var(--color-border-subtle)] bg-white px-4 py-3 text-sm text-[var(--color-text-tertiary)]">Loading current Agent context</div>
  }
  if (!context) {
    return <div className="rounded-md border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-bg-surface-muted)] px-4 py-3 text-sm text-[var(--color-text-tertiary)]">Select an Agent version to load ConfigPilot context.</div>
  }
  return (
    <section className="grid gap-3 rounded-md border border-[var(--color-border-subtle)] bg-white px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(220px,0.55fr)]">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <ClipboardList size={15} className="text-[var(--color-accent-primary)]" />
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">Current context</p>
        </div>
        <p className="mt-2 text-xs leading-5 text-[var(--color-text-secondary)]">
          Selected {context.selected.name} v{context.selected.version} · {context.selected.isActive ? 'active version' : 'draft version'} · validation {context.validation.state}
        </p>
        <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">
          Model for proposals: {modelUsed ?? context.selected.model}. Active: {context.active ? `v${context.active.version}` : 'none'} · Draft: {context.draft ? `v${context.draft.version}` : 'none'}
        </p>
        {promptVersion ? (
          <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">Prompt version: {promptVersion}</p>
        ) : null}
      </div>
      <div className="grid gap-2 text-xs text-[var(--color-text-secondary)]">
        <span>Role: {context.permissions.role ?? 'unknown'}</span>
        <span>Can apply draft changes: {context.permissions.canApply ? 'yes' : 'no'}</span>
        <span>Locked capabilities: {context.lockedCapabilities.length}</span>
      </div>
    </section>
  )
}

function ConfigPilotPatchList({ patches }: { patches: ConfigPilotPatch[] }) {
  return (
    <div className="grid gap-2">
      {patches.map((patch, index) => (
        <div key={`${patch.surface}-${patch.operation}-${index}`} className="rounded-md border border-[var(--color-border-subtle)] bg-white px-3 py-2 text-xs text-[var(--color-text-secondary)]">
          <span className="font-semibold text-[var(--color-text-primary)]">{patch.surface}</span>
          <span> / {patch.operation}</span>
          <span className="ml-2 text-[var(--color-text-tertiary)]">{patchLabel(patch)}</span>
        </div>
      ))}
    </div>
  )
}

function patchLabel(patch: ConfigPilotPatch): string {
  if (patch.surface === 'brain') return 'Agent Brain'
  if (patch.surface === 'hookBindings') return `${patch.value.hookName} -> ${patch.value.scopeType}`
  if ('target' in patch && patch.target) {
    if ('name' in patch.target) return String(patch.target.name)
    if ('type' in patch.target) return String(patch.target.type)
    if ('channel' in patch.target) return String(patch.target.channel)
  }
  if ('value' in patch && patch.value && typeof patch.value === 'object') {
    const value = patch.value as Record<string, unknown>
    return String(value.name ?? value.type ?? 'new draft object')
  }
  return 'draft object'
}

function SuggestionList({ title, suggestions }: { title: string; suggestions: string[] }) {
  return (
    <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface-muted)] px-3 py-2">
      <p className="text-xs font-semibold text-[var(--color-text-primary)]">{title}</p>
      <ul className="mt-2 grid gap-1 text-xs leading-5 text-[var(--color-text-secondary)]">
        {suggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}
      </ul>
    </div>
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
