'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ClipboardList, Play, Plus, RefreshCw, Save, Trash2, XCircle } from 'lucide-react'
import VersionContextBar, { useSelectedAgentId } from '@/components/admin/version-context-bar'
import EmptyState from '@/components/ui/empty-state'
import { apiClient, ApiClientError } from '@/lib/api/client'
import type {
  SavedScenario,
  ScenarioObservedEvidence,
  ScenarioReceipt,
  ScenarioValidationSummary,
} from '@intera/shared/contracts/scenarios'

interface ScenarioListResponse {
  scenarios: SavedScenario[]
  receipts: ScenarioReceipt[]
  validation: ScenarioValidationSummary
}

interface ScenarioEditorState {
  name: string
  displayName: string
  description: string
  locale: string
  tags: string
  enabled: boolean
  turnsJson: string
  expectedJson: string
}

const DEFAULT_TURNS = JSON.stringify([
  { role: 'user', content: 'My deposit has not arrived yet.' },
  { role: 'assistant', content: 'I checked the available evidence and will transfer this case to a human specialist.' },
], null, 2)

const DEFAULT_EXPECTED = JSON.stringify({
  caseType: 'deposit_issue',
  toolsCalled: ['get_latest_deposit'],
  hooks: [{ hookName: 'conflict_requires_human', checkpoint: 'PostToolUse', decision: 'escalate' }],
  humanTransfer: true,
  finalStatus: 'waiting_human',
  forbiddenPhrases: ['guaranteed compensation'],
}, null, 2)

function emptyEditor(): ScenarioEditorState {
  return {
    name: '',
    displayName: '',
    description: '',
    locale: 'en-US',
    tags: '',
    enabled: true,
    turnsJson: DEFAULT_TURNS,
    expectedJson: DEFAULT_EXPECTED,
  }
}

function editorFromScenario(scenario: SavedScenario): ScenarioEditorState {
  return {
    name: scenario.name,
    displayName: scenario.displayName ?? '',
    description: scenario.description ?? '',
    locale: scenario.locale ?? 'en-US',
    tags: scenario.tags.join(', '),
    enabled: scenario.enabled,
    turnsJson: JSON.stringify(scenario.turns, null, 2),
    expectedJson: JSON.stringify(scenario.expected ?? {}, null, 2),
  }
}

export default function ScenariosPage() {
  const agentConfigId = useSelectedAgentId()
  const [scenarios, setScenarios] = useState<SavedScenario[]>([])
  const [receipts, setReceipts] = useState<ScenarioReceipt[]>([])
  const [validation, setValidation] = useState<ScenarioValidationSummary | null>(null)
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [editor, setEditor] = useState<ScenarioEditorState>(() => emptyEditor())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const selectedScenario = useMemo(
    () => scenarios.find((scenario) => scenario.name === selectedName) ?? null,
    [scenarios, selectedName],
  )
  const latestReceipt = receipts[0] ?? null

  const load = useCallback(async () => {
    if (!agentConfigId) return
    setLoading(true)
    setError(null)
    try {
      const result = await apiClient<ScenarioListResponse>(`/api/admin/scenarios?agentConfigId=${encodeURIComponent(agentConfigId)}`)
      const data = result.data
      setScenarios(data.scenarios)
      setReceipts(data.receipts)
      setValidation(data.validation)
      if (!selectedName && data.scenarios.length > 0) {
        setSelectedName(data.scenarios[0].name)
        setEditor(editorFromScenario(data.scenarios[0]))
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? err.envelope.error.message : 'Failed to load scenarios')
    } finally {
      setLoading(false)
    }
  }, [agentConfigId, selectedName])

  useEffect(() => { load() }, [load])

  const selectScenario = useCallback((scenario: SavedScenario) => {
    setSelectedName(scenario.name)
    setEditor(editorFromScenario(scenario))
    setError(null)
    setNotice(null)
  }, [])

  const newScenario = useCallback(() => {
    setSelectedName(null)
    setEditor(emptyEditor())
    setError(null)
    setNotice(null)
  }, [])

  const save = useCallback(async () => {
    if (!agentConfigId) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const turns = JSON.parse(editor.turnsJson)
      const expected = JSON.parse(editor.expectedJson)
      const body = {
        agentConfigId,
        name: editor.name.trim(),
        displayName: editor.displayName.trim() || undefined,
        description: editor.description.trim() || undefined,
        locale: editor.locale.trim() || undefined,
        tags: editor.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        enabled: editor.enabled,
        turns,
        expected,
      }
      const url = selectedScenario ? `/api/admin/scenarios/${encodeURIComponent(selectedScenario.name)}` : '/api/admin/scenarios'
      const result = await apiClient<{ scenario: SavedScenario }>(url, { method: selectedScenario ? 'PUT' : 'POST', body })
      setSelectedName(result.data.scenario.name)
      setEditor(editorFromScenario(result.data.scenario))
      setNotice('Saved')
      await load()
    } catch (err) {
      if (err instanceof SyntaxError) setError(`Invalid JSON: ${err.message}`)
      else setError(err instanceof ApiClientError ? err.envelope.error.message : 'Failed to save scenario')
    } finally {
      setSaving(false)
    }
  }, [agentConfigId, editor, load, selectedScenario])

  const remove = useCallback(async () => {
    if (!agentConfigId || !selectedScenario) return
    setError(null)
    setNotice(null)
    await apiClient(`/api/admin/scenarios/${encodeURIComponent(selectedScenario.name)}?agentConfigId=${encodeURIComponent(agentConfigId)}`, { method: 'DELETE' })
    setSelectedName(null)
    setEditor(emptyEditor())
    setNotice('Deleted')
    await load()
  }, [agentConfigId, load, selectedScenario])

  const run = useCallback(async () => {
    if (!agentConfigId || !selectedScenario) return
    setRunning(true)
    setError(null)
    setNotice(null)
    try {
      const result = await apiClient<{ receipt: ScenarioReceipt; validation: ScenarioValidationSummary }>(
        `/api/admin/scenarios/${encodeURIComponent(selectedScenario.name)}/run`,
        { method: 'POST', body: { agentConfigId } },
      )
      setReceipts((prev) => [result.data.receipt, ...prev.filter((receipt) => receipt.runId !== result.data.receipt.runId)])
      setValidation(result.data.validation)
      setNotice(result.data.receipt.status === 'passed' ? 'Scenario passed' : 'Scenario failed')
      await load()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.envelope.error.message : 'Failed to run scenario')
    } finally {
      setRunning(false)
    }
  }, [agentConfigId, load, selectedScenario])

  return (
    <div className="min-h-screen bg-[var(--color-bg-app)] px-8 py-8 text-[var(--color-text-primary)]">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <VersionContextBar />
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-[var(--color-accent-primary)]">Scenario Lab</p>
            <h1 className="mt-1 text-2xl font-semibold">Test Cases and Receipts</h1>
          </div>
          <div className="flex items-center gap-2">
            <ValidationBadge validation={validation} />
            <button type="button" onClick={load} className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--color-border-subtle)] bg-white px-3 text-sm font-medium hover:bg-[var(--color-bg-surface-muted)]">
              <RefreshCw size={15} /> Refresh
            </button>
            <button type="button" onClick={newScenario} className="inline-flex h-9 items-center gap-2 rounded-md bg-[var(--color-accent-primary)] px-3 text-sm font-medium text-white hover:opacity-90">
              <Plus size={15} /> New
            </button>
          </div>
        </header>

        {error && <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {notice && <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

        <main className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)_360px]">
          <section className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
            <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] px-4 py-3">
              <h2 className="text-sm font-semibold">Test Cases</h2>
              <span className="text-xs text-[var(--color-text-tertiary)]">{scenarios.length}</span>
            </div>
            <div className="max-h-[680px] overflow-y-auto p-2">
              {loading ? (
                <div className="p-4 text-sm text-[var(--color-text-tertiary)]">Loading</div>
              ) : scenarios.length === 0 ? (
                <EmptyState icon={ClipboardList} title="No test cases" description="Create a Scenario to produce validation receipts." />
              ) : (
                scenarios.map((scenario) => (
                  <button key={scenario.id} type="button" onClick={() => selectScenario(scenario)} className={`mb-2 w-full rounded-md border px-3 py-3 text-left transition ${selectedName === scenario.name ? 'border-[var(--color-accent-primary)] bg-[rgba(53,127,124,0.08)]' : 'border-transparent hover:border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-surface-muted)]'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">{scenario.displayName || scenario.name}</p>
                        <p className="mt-1 truncate text-xs text-[var(--color-text-tertiary)]">{scenario.name}</p>
                      </div>
                      <StatusIcon status={scenario.lastRunStatus} />
                    </div>
                    {scenario.description && <p className="mt-2 line-clamp-2 text-xs text-[var(--color-text-secondary)]">{scenario.description}</p>}
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] px-5 py-4">
              <h2 className="text-sm font-semibold">{selectedScenario ? 'Edit Test Case' : 'New Test Case'}</h2>
              <div className="flex items-center gap-2">
                {selectedScenario && (
                  <button type="button" onClick={run} disabled={running} className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--color-border-subtle)] bg-white px-3 text-sm font-medium hover:bg-[var(--color-bg-surface-muted)] disabled:opacity-60">
                    <Play size={15} /> {running ? 'Running' : 'Run'}
                  </button>
                )}
                {selectedScenario && (
                  <button type="button" onClick={remove} className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 bg-white px-3 text-sm font-medium text-red-700 hover:bg-red-50">
                    <Trash2 size={15} /> Delete
                  </button>
                )}
                <button type="button" onClick={save} disabled={saving || !editor.name.trim()} className="inline-flex h-9 items-center gap-2 rounded-md bg-[var(--color-accent-primary)] px-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60">
                  <Save size={15} /> {saving ? 'Saving' : 'Save'}
                </button>
              </div>
            </div>
            <div className="grid gap-4 p-5">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Name" value={editor.name} onChange={(value) => setEditor((prev) => ({ ...prev, name: value }))} placeholder="deposit_missing_evidence" />
                <Field label="Display name" value={editor.displayName} onChange={(value) => setEditor((prev) => ({ ...prev, displayName: value }))} placeholder="Deposit missing evidence" />
              </div>
              <div className="grid gap-4 md:grid-cols-[1fr_160px_160px]">
                <Field label="Description" value={editor.description} onChange={(value) => setEditor((prev) => ({ ...prev, description: value }))} placeholder="Covers unclear provider evidence and handoff" />
                <Field label="Locale" value={editor.locale} onChange={(value) => setEditor((prev) => ({ ...prev, locale: value }))} placeholder="en-US" />
                <Field label="Tags" value={editor.tags} onChange={(value) => setEditor((prev) => ({ ...prev, tags: value }))} placeholder="gaming, deposit" />
              </div>
              <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                <input type="checkbox" checked={editor.enabled} onChange={(event) => setEditor((prev) => ({ ...prev, enabled: event.target.checked }))} />
                Enabled
              </label>
              <TextArea label="Turns JSON" value={editor.turnsJson} onChange={(value) => setEditor((prev) => ({ ...prev, turnsJson: value }))} rows={10} />
              <TextArea label="Expected outcome JSON" value={editor.expectedJson} onChange={(value) => setEditor((prev) => ({ ...prev, expectedJson: value }))} rows={12} />
            </div>
          </section>

          <section className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-workspace-bg)] text-[var(--color-workspace-text)] shadow-[var(--shadow-workspace)]">
            <div className="border-b border-[var(--color-workspace-border)] px-5 py-4">
              <h2 className="text-sm font-semibold">Latest Receipt</h2>
            </div>
            {latestReceipt ? <ReceiptView receipt={latestReceipt} /> : <div className="p-5 text-sm text-[var(--color-workspace-muted)]">No receipts yet.</div>}
          </section>
        </main>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium text-[var(--color-text-secondary)]">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-10 rounded-md border border-[var(--color-border-subtle)] bg-white px-3 text-sm outline-none focus:border-[var(--color-accent-primary)]" />
    </label>
  )
}

function TextArea({ label, value, onChange, rows }: { label: string; value: string; onChange: (value: string) => void; rows: number }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium text-[var(--color-text-secondary)]">{label}</span>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={rows} className="w-full rounded-md border border-[var(--color-border-subtle)] bg-white px-3 py-2 font-mono text-xs leading-5 outline-none focus:border-[var(--color-accent-primary)]" />
    </label>
  )
}

function ValidationBadge({ validation }: { validation: ScenarioValidationSummary | null }) {
  const state = validation?.state ?? 'Not validated'
  const color = state === 'Validated' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : state === 'Validation failed' ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-700'
  return <span className={`inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium ${color}`}>{state}</span>
}

function StatusIcon({ status }: { status?: SavedScenario['lastRunStatus'] }) {
  if (status === 'passed') return <CheckCircle2 className="text-emerald-600" size={16} />
  if (status === 'failed' || status === 'error') return <XCircle className="text-red-600" size={16} />
  return <AlertTriangle className="text-amber-600" size={16} />
}

function ReceiptView({ receipt }: { receipt: ScenarioReceipt }) {
  const evidence: ScenarioObservedEvidence = receipt.evidence
  return (
    <div className="grid gap-5 p-5 text-sm">
      <div>
        <div className="flex items-center justify-between gap-3">
          <p className="font-semibold">{receipt.scenarioName}</p>
          <span className={`rounded-full px-2 py-1 text-xs font-semibold ${receipt.status === 'passed' ? 'bg-emerald-400/15 text-emerald-200' : 'bg-red-400/15 text-red-200'}`}>{receipt.status}</span>
        </div>
        <p className="mt-2 text-xs text-[var(--color-workspace-muted)]">{receipt.summary}</p>
      </div>
      <EvidenceGroup label="Tools" values={evidence.toolsCalled} />
      <EvidenceGroup label="Knowledge" values={evidence.knowledgeHits.map((hit) => JSON.stringify(hit))} />
      <EvidenceGroup label="Handoff" values={evidence.handoff.map((handoff) => handoff.reason ?? handoff.target ?? 'handoff')} fallback={evidence.humanTransfer ? 'human transfer required' : 'none'} />
      <div>
        <p className="mb-2 text-xs font-semibold uppercase text-[var(--color-workspace-muted)]">Hooks</p>
        <div className="grid gap-2">
          {evidence.hookDecisions.length === 0 ? <p className="text-xs text-[var(--color-workspace-muted)]">none</p> : evidence.hookDecisions.map((hook, index) => <div key={`${hook.hookName}-${index}`} className="rounded-md border border-[var(--color-workspace-border)] bg-[var(--color-workspace-surface)] px-3 py-2 text-xs">{hook.checkpoint} / {hook.hookName} / {hook.decision}</div>)}
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold uppercase text-[var(--color-workspace-muted)]">Checks</p>
        <div className="grid gap-2">
          {receipt.checks.map((check) => <div key={check.name} className="rounded-md border border-[var(--color-workspace-border)] bg-[var(--color-workspace-surface)] px-3 py-2 text-xs"><span className={check.passed ? 'text-emerald-200' : 'text-red-200'}>{check.passed ? 'pass' : 'fail'}</span> {check.name}{check.detail ? ` - ${check.detail}` : ''}</div>)}
        </div>
      </div>
      {evidence.finalResponse && <div><p className="mb-2 text-xs font-semibold uppercase text-[var(--color-workspace-muted)]">Final Response</p><p className="rounded-md border border-[var(--color-workspace-border)] bg-[var(--color-workspace-surface)] px-3 py-2 text-xs leading-5">{evidence.finalResponse}</p></div>}
    </div>
  )
}

function EvidenceGroup({ label, values, fallback = 'none' }: { label: string; values: string[]; fallback?: string }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase text-[var(--color-workspace-muted)]">{label}</p>
      <div className="flex flex-wrap gap-2">
        {values.length === 0 ? <span className="text-xs text-[var(--color-workspace-muted)]">{fallback}</span> : values.map((value) => <span key={value} className="rounded-full border border-[var(--color-workspace-border)] bg-[var(--color-workspace-surface)] px-2 py-1 text-xs">{value}</span>)}
      </div>
    </div>
  )
}
