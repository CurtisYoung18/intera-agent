'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Bot, CheckCircle2, ClipboardList, FileJson, FlaskConical, Loader2, Play, Plus, RefreshCw, Save, Trash2, XCircle } from 'lucide-react'
import VersionContextBar, { useSelectedAgentId } from '@/components/admin/version-context-bar'
import { OrganicLoader, TokenStreamPreview } from '@/components/config-pilot/ai-motion'
import { ConfigPilotDrawer, ConfigPilotWorkbench } from '@/components/config-pilot/config-pilot-workbench'
import { ReceiptStatusIcon, ScenarioReceiptPanel } from '@/components/scenario-receipts/scenario-receipt-panel'
import EmptyState from '@/components/ui/empty-state'
import { apiClient, ApiClientError } from '@/lib/api/client'
import type { SavedScenario, ScenarioObservedEvidenceInput, ScenarioReceipt, ScenarioValidationSummary } from '@intera/shared/contracts/scenarios'

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

type PilotArea = 'config-pilot' | 'free-test' | 'test-cases' | 'receipts'

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
  requiredPhrases: ['human specialist'],
}, null, 2)

const DEFAULT_OBSERVED = JSON.stringify({
  knowledgeHits: [{ source: 'fixture', title: 'Deposit runbook' }],
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

export default function PilotLabPage() {
  const agentConfigId = useSelectedAgentId()
  const [activeArea, setActiveArea] = useState<PilotArea>('test-cases')
  const [scenarios, setScenarios] = useState<SavedScenario[]>([])
  const [receipts, setReceipts] = useState<ScenarioReceipt[]>([])
  const [validation, setValidation] = useState<ScenarioValidationSummary | null>(null)
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [selectedReceiptRunId, setSelectedReceiptRunId] = useState<string | null>(null)
  const [editor, setEditor] = useState<ScenarioEditorState>(() => emptyEditor())
  const [observedJson, setObservedJson] = useState(DEFAULT_OBSERVED)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const selectedScenario = useMemo(() => scenarios.find((scenario) => scenario.name === selectedName) ?? null, [scenarios, selectedName])
  const selectedReceipt = useMemo(() => receipts.find((receipt) => receipt.runId === selectedReceiptRunId) ?? receipts[0] ?? null, [receipts, selectedReceiptRunId])
  const passingReceipts = receipts.filter((receipt) => receipt.status === 'passed').length
  const failingReceipts = receipts.filter((receipt) => receipt.status !== 'passed').length

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
      setSelectedName((prev) => {
        const nextName = prev && data.scenarios.some((scenario) => scenario.name === prev) ? prev : data.scenarios[0]?.name ?? null
        const nextScenario = data.scenarios.find((scenario) => scenario.name === nextName)
        if (nextScenario) setEditor(editorFromScenario(nextScenario))
        else setEditor(emptyEditor())
        return nextName
      })
      setSelectedReceiptRunId((prev) => {
        if (prev && data.receipts.some((receipt) => receipt.runId === prev)) return prev
        return data.receipts[0]?.runId ?? null
      })
    } catch (err) {
      setError(err instanceof ApiClientError ? err.envelope.error.message : 'Failed to load Pilot Lab')
    } finally {
      setLoading(false)
    }
  }, [agentConfigId])

  useEffect(() => { load() }, [load])

  const selectScenario = useCallback((scenario: SavedScenario) => {
    setSelectedName(scenario.name)
    setEditor(editorFromScenario(scenario))
    setActiveArea('test-cases')
    setError(null)
    setNotice(null)
  }, [])

  const newScenario = useCallback(() => {
    setSelectedName(null)
    setEditor(emptyEditor())
    setActiveArea('test-cases')
    setError(null)
    setNotice(null)
  }, [])

  const saveScenario = useCallback(async () => {
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
      setNotice('Test Scenario draft saved')
      await load()
    } catch (err) {
      if (err instanceof SyntaxError) setError(`Invalid JSON: ${err.message}`)
      else setError(err instanceof ApiClientError ? err.envelope.error.message : 'Failed to save Scenario')
    } finally {
      setSaving(false)
    }
  }, [agentConfigId, editor, load, selectedScenario])

  const deleteScenario = useCallback(async () => {
    if (!agentConfigId || !selectedScenario) return
    setError(null)
    setNotice(null)
    try {
      await apiClient(`/api/admin/scenarios/${encodeURIComponent(selectedScenario.name)}?agentConfigId=${encodeURIComponent(agentConfigId)}`, { method: 'DELETE' })
      setSelectedName(null)
      setEditor(emptyEditor())
      setNotice('Test Scenario deleted')
      await load()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.envelope.error.message : 'Failed to delete Scenario')
    }
  }, [agentConfigId, load, selectedScenario])

  const runScenario = useCallback(async (observed?: ScenarioObservedEvidenceInput) => {
    if (!agentConfigId || !selectedScenario) return
    setRunning(selectedScenario.name)
    setError(null)
    setNotice(null)
    try {
      const result = await apiClient<{ receipt: ScenarioReceipt; validation: ScenarioValidationSummary }>(
        `/api/admin/scenarios/${encodeURIComponent(selectedScenario.name)}/run`,
        { method: 'POST', body: { agentConfigId, observed } },
      )
      setReceipts((prev) => [result.data.receipt, ...prev.filter((receipt) => receipt.runId !== result.data.receipt.runId)])
      setSelectedReceiptRunId(result.data.receipt.runId)
      setValidation(result.data.validation)
      setActiveArea('receipts')
      setNotice(result.data.receipt.status === 'passed' ? 'Scenario passed' : 'Scenario failed')
      await load()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.envelope.error.message : 'Failed to run Scenario')
    } finally {
      setRunning(null)
    }
  }, [agentConfigId, load, selectedScenario])

  const runFreeTest = useCallback(async () => {
    try {
      const observed = observedJson.trim() ? JSON.parse(observedJson) as ScenarioObservedEvidenceInput : undefined
      await runScenario(observed)
    } catch (err) {
      setError(err instanceof SyntaxError ? `Invalid observed evidence JSON: ${err.message}` : 'Failed to parse observed evidence')
    }
  }, [observedJson, runScenario])

  const handleConfigPilotSaved = useCallback(async (scenario: SavedScenario) => {
    setSelectedName(scenario.name)
    setEditor(editorFromScenario(scenario))
    setActiveArea('test-cases')
    await load()
  }, [load])

  return (
    <div className="intera-q2-page min-h-screen px-5 py-6 text-[var(--color-text-primary)] sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-[1480px] flex-col gap-4">
        <VersionContextBar />

        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[13px] font-medium text-[var(--color-text-tertiary)]">
              <span>Build</span>
              <span className="text-[var(--color-border-strong)]">/</span>
              <span className="text-[var(--color-text-primary)]">Pilot Lab</span>
            </div>
            <h1 className="mt-4 text-[30px] font-semibold leading-[1.08] text-[var(--color-text-primary)] sm:text-[34px]">Pilot Lab</h1>
            <p className="mt-2 max-w-3xl text-[15px] leading-6 text-[var(--color-text-secondary)]">Run saved Scenarios, inspect receipts, and let ConfigPilot draft safe changes before validation.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ValidationBadge validation={validation} />
            <button type="button" onClick={load} className="intera-q2-button inline-flex h-9 items-center gap-2 border border-[var(--color-border-subtle)] bg-white px-3 text-[13px] font-medium hover:bg-[var(--color-bg-surface-muted)]">
              <RefreshCw size={15} /> Refresh
            </button>
            <button type="button" onClick={() => setDrawerOpen(true)} className="intera-q2-button inline-flex h-9 items-center gap-2 border border-[rgba(53,127,124,0.22)] bg-[rgba(53,127,124,0.08)] px-3 text-[13px] font-medium text-[var(--color-accent-primary)] hover:bg-[rgba(53,127,124,0.12)]">
              <Bot size={15} /> ConfigPilot
            </button>
            <button type="button" onClick={newScenario} className="intera-q2-button inline-flex h-9 items-center gap-2 bg-[var(--color-accent-primary)] px-3 text-[13px] font-medium text-white hover:opacity-90">
              <Plus size={15} /> New Test Scenario
            </button>
          </div>
        </header>

        <section className="intera-q2-panel overflow-hidden">
          <div className="grid divide-y divide-[var(--color-border-subtle)] md:grid-cols-4 md:divide-x md:divide-y-0">
            <MetricTile label="Test Scenarios" value={scenarios.length.toString()} />
            <MetricTile label="Receipts" value={receipts.length.toString()} />
            <MetricTile label="Passing" value={passingReceipts.toString()} tone="success" />
            <MetricTile label="Needs review" value={failingReceipts.toString()} tone={failingReceipts > 0 ? 'danger' : 'neutral'} />
          </div>
        </section>

        {(error || notice) && (
          <div className="grid gap-2">
            {error && <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
            {notice && <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-[256px_minmax(0,1fr)_380px] 2xl:grid-cols-[260px_minmax(0,1fr)_420px]">
          <aside className="grid gap-4">
            <section className="intera-q2-panel p-2">
              <PilotAreaButton active={activeArea === 'config-pilot'} icon={Bot} label="ConfigPilot Workspace" onClick={() => setActiveArea('config-pilot')} />
              <PilotAreaButton active={activeArea === 'free-test'} icon={FlaskConical} label="Free Test" onClick={() => setActiveArea('free-test')} />
              <PilotAreaButton active={activeArea === 'test-cases'} icon={ClipboardList} label="Test Scenarios" onClick={() => setActiveArea('test-cases')} />
              <PilotAreaButton active={activeArea === 'receipts'} icon={FileJson} label="Receipts" onClick={() => setActiveArea('receipts')} />
            </section>

            <section className="intera-q2-panel overflow-hidden">
              <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] px-4 py-3">
                <h2 className="text-sm font-semibold">Scenario index</h2>
                {loading && <OrganicLoader variant="02" size={16} className="text-[var(--color-text-tertiary)]" />}
              </div>
              <div className="max-h-[520px] overflow-y-auto">
                {loading ? (
                  <div className="p-3 text-sm text-[var(--color-text-tertiary)]">Loading Scenarios</div>
                ) : scenarios.length === 0 ? (
                  <EmptyState icon={ClipboardList} title="No Test Scenarios" description="Create a Scenario or ask ConfigPilot for a draft." />
                ) : (
                  scenarios.map((scenario) => (
                    <button key={scenario.id} type="button" onClick={() => selectScenario(scenario)} className={`intera-q2-row w-full px-3 py-3 text-left transition ${selectedName === scenario.name ? 'bg-[rgba(53,127,124,0.08)]' : 'hover:bg-[var(--color-bg-surface-muted)]'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{scenario.displayName || scenario.name}</p>
                          <p className="mt-1 truncate text-xs text-[var(--color-text-tertiary)]">{scenario.name}</p>
                        </div>
                        <ReceiptStatusIcon status={scenario.lastRunStatus} />
                      </div>
                      {scenario.description && <p className="mt-2 line-clamp-2 text-xs text-[var(--color-text-secondary)]">{scenario.description}</p>}
                    </button>
                  ))
                )}
              </div>
            </section>
          </aside>

          <main className="min-w-0">
            {activeArea === 'config-pilot' && <ConfigPilotWorkbench agentConfigId={agentConfigId} onScenarioSaved={handleConfigPilotSaved} />}
            {activeArea === 'free-test' && (
              <FreeTestPanel selectedScenario={selectedScenario} observedJson={observedJson} setObservedJson={setObservedJson} running={Boolean(running)} onRun={runFreeTest} />
            )}
            {activeArea === 'test-cases' && (
              <TestCaseEditorPanel editor={editor} setEditor={setEditor} selectedScenario={selectedScenario} saving={saving} running={running === selectedScenario?.name} onSave={saveScenario} onDelete={deleteScenario} onRun={() => runScenario()} />
            )}
            {activeArea === 'receipts' && (
              <ScenarioReceiptPanel receipt={selectedReceipt} receipts={receipts} selectedRunId={selectedReceipt?.runId ?? null} onSelectReceipt={(receipt) => setSelectedReceiptRunId(receipt.runId)} />
            )}
          </main>

          <aside className="min-w-0 space-y-4">
            <PilotLabRail running={Boolean(running)} activeArea={activeArea} onOpenDrawer={() => setDrawerOpen(true)} />
            <ScenarioReceiptPanel compact receipt={selectedReceipt} receipts={receipts} selectedRunId={selectedReceipt?.runId ?? null} onSelectReceipt={(receipt) => setSelectedReceiptRunId(receipt.runId)} />
          </aside>
        </div>
      </div>
      <ConfigPilotDrawer open={drawerOpen} agentConfigId={agentConfigId} onClose={() => setDrawerOpen(false)} onScenarioSaved={handleConfigPilotSaved} />
    </div>
  )
}

function PilotLabRail({ running, activeArea, onOpenDrawer }: { running: boolean; activeArea: PilotArea; onOpenDrawer: () => void }) {
  return (
    <aside className="intera-q2-rail p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-[rgba(53,127,124,0.18)] bg-white/75 text-[var(--color-accent-primary)]">
          <OrganicLoader variant={running ? '17' : '11'} size={24} title={running ? 'Scenario running loader' : 'ConfigPilot rail loader'} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">{running ? 'Scenario running' : 'ConfigPilot rail'}</p>
          <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
            {running ? 'Pilot Lab is collecting observed evidence and receipt checks.' : `Context: ${activeArea.replace('-', ' ')}.`}
          </p>
        </div>
      </div>
      <p className="mt-4 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white/70 px-3 py-2 text-xs leading-5 text-[var(--color-text-secondary)]">
        <TokenStreamPreview text={running ? 'Running Scenario token stream.' : 'Ask for a focused draft, then review the diff.'} />
      </p>
      <button type="button" onClick={onOpenDrawer} className="intera-q2-button mt-4 inline-flex h-9 w-full items-center justify-center gap-2 border border-[rgba(53,127,124,0.22)] bg-white/75 px-3 text-sm font-medium text-[var(--color-accent-primary)] hover:bg-white">
        <Bot size={15} /> Open ConfigPilot
      </button>
    </aside>
  )
}

function TestCaseEditorPanel({
  editor,
  setEditor,
  selectedScenario,
  saving,
  running,
  onSave,
  onDelete,
  onRun,
}: {
  editor: ScenarioEditorState
  setEditor: (updater: (prev: ScenarioEditorState) => ScenarioEditorState) => void
  selectedScenario: SavedScenario | null
  saving: boolean
  running: boolean
  onSave: () => void
  onDelete: () => void
  onRun: () => void
}) {
  return (
    <section className="intera-q2-panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] px-5 py-4">
        <div>
          <p className="text-xs font-medium text-[var(--color-text-tertiary)]">{selectedScenario ? 'Saved Test Scenario' : 'New Test Scenario'}</p>
          <h2 className="mt-1 text-lg font-semibold">{selectedScenario ? (selectedScenario.displayName || selectedScenario.name) : 'Draft Scenario'}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selectedScenario && (
            <button type="button" onClick={onRun} disabled={running} className="intera-q2-button inline-flex h-9 items-center gap-2 border border-[var(--color-border-subtle)] bg-white px-3 text-sm font-medium hover:bg-[var(--color-bg-surface-muted)] disabled:opacity-60">
              {running ? <OrganicLoader variant="06" size={15} /> : <Play size={15} />} {running ? 'Running' : 'Run'}
            </button>
          )}
          {selectedScenario && (
            <button type="button" onClick={onDelete} className="intera-q2-button inline-flex h-9 items-center gap-2 border border-red-200 bg-white px-3 text-sm font-medium text-red-700 hover:bg-red-50">
              <Trash2 size={15} /> Delete
            </button>
          )}
          <button type="button" onClick={onSave} disabled={saving || !editor.name.trim()} className="intera-q2-button inline-flex h-9 items-center gap-2 bg-[var(--color-accent-primary)] px-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} {saving ? 'Saving' : 'Save draft'}
          </button>
        </div>
      </div>
      <div className="grid gap-4 p-5">
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr))]">
          <Field label="Name" value={editor.name} onChange={(value) => setEditor((prev) => ({ ...prev, name: value }))} placeholder="deposit_missing_evidence" />
          <Field label="Display name" value={editor.displayName} onChange={(value) => setEditor((prev) => ({ ...prev, displayName: value }))} placeholder="Deposit missing evidence" />
        </div>
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(160px,100%),1fr))]">
          <Field label="Description" value={editor.description} onChange={(value) => setEditor((prev) => ({ ...prev, description: value }))} placeholder="Covers provider evidence and handoff" />
          <Field label="Locale" value={editor.locale} onChange={(value) => setEditor((prev) => ({ ...prev, locale: value }))} placeholder="en-US" />
          <Field label="Tags" value={editor.tags} onChange={(value) => setEditor((prev) => ({ ...prev, tags: value }))} placeholder="gaming, deposit" />
        </div>
        <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
          <input type="checkbox" checked={editor.enabled} onChange={(event) => setEditor((prev) => ({ ...prev, enabled: event.target.checked }))} />
          Enabled
        </label>
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr))]">
          <TextArea label="Turns JSON" value={editor.turnsJson} onChange={(value) => setEditor((prev) => ({ ...prev, turnsJson: value }))} rows={13} />
          <TextArea label="Expected outcome JSON" value={editor.expectedJson} onChange={(value) => setEditor((prev) => ({ ...prev, expectedJson: value }))} rows={13} />
        </div>
      </div>
    </section>
  )
}

function FreeTestPanel({
  selectedScenario,
  observedJson,
  setObservedJson,
  running,
  onRun,
}: {
  selectedScenario: SavedScenario | null
  observedJson: string
  setObservedJson: (value: string) => void
  running: boolean
  onRun: () => void
}) {
  return (
    <section className="intera-q2-panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] px-5 py-4">
        <div>
          <p className="text-xs font-medium text-[var(--color-text-tertiary)]">Free Test</p>
          <h2 className="mt-1 text-lg font-semibold">Run with observed evidence</h2>
        </div>
        <button type="button" onClick={onRun} disabled={!selectedScenario || running} className="intera-q2-button inline-flex h-9 items-center gap-2 bg-[var(--color-accent-primary)] px-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60">
          {running ? <OrganicLoader variant="05" size={15} /> : <Play size={15} />} Run Free Test
        </button>
      </div>
      <div className="grid gap-4 p-5">
        {running && (
          <div className="rounded-md border border-[rgba(53,127,124,0.18)] bg-[rgba(53,127,124,0.06)] px-4 py-3 text-sm text-[var(--color-text-secondary)]">
            <TokenStreamPreview text="Running observed evidence through Scenario validation." />
          </div>
        )}
        <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface-muted)] px-4 py-3">
          <p className="text-sm font-medium text-[var(--color-text-primary)]">{selectedScenario ? (selectedScenario.displayName || selectedScenario.name) : 'Select a Test Scenario first'}</p>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">Observed evidence is sent to the Scenario run API and compared against saved expectations.</p>
        </div>
        <TextArea label="Observed evidence JSON" value={observedJson} onChange={setObservedJson} rows={16} />
      </div>
    </section>
  )
}

function PilotAreaButton({ active, icon: Icon, label, onClick }: { active: boolean; icon: typeof Bot; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`mb-1 flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm font-medium transition last:mb-0 ${active ? 'bg-[rgba(53,127,124,0.10)] text-[var(--color-accent-primary)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface-muted)] hover:text-[var(--color-text-primary)]'}`}>
      <Icon size={15} />
      {label}
    </button>
  )
}

function MetricTile({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'success' | 'danger' }) {
  const toneClass = tone === 'success' ? 'text-emerald-700' : tone === 'danger' ? 'text-red-700' : 'text-[var(--color-text-primary)]'
  return (
    <div className="min-w-0 px-5 py-4">
      <p className="text-[12px] text-[var(--color-text-tertiary)]">{label}</p>
      <p className={`mt-2 text-[24px] font-semibold leading-none ${toneClass}`}>{value}</p>
    </div>
  )
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="grid min-w-0 gap-1 text-sm">
      <span className="font-medium text-[var(--color-text-secondary)]">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-10 min-w-0 rounded-md border border-[var(--color-border-subtle)] bg-white px-3 text-sm outline-none focus:border-[var(--color-accent-primary)]" />
    </label>
  )
}

function TextArea({ label, value, onChange, rows }: { label: string; value: string; onChange: (value: string) => void; rows: number }) {
  return (
    <label className="grid min-w-0 gap-1 text-sm">
      <span className="font-medium text-[var(--color-text-secondary)]">{label}</span>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={rows} className="w-full min-w-0 rounded-md border border-[var(--color-border-subtle)] bg-white px-3 py-2 font-mono text-xs leading-5 outline-none focus:border-[var(--color-accent-primary)]" />
    </label>
  )
}

function ValidationBadge({ validation }: { validation: ScenarioValidationSummary | null }) {
  const state = validation?.state ?? 'Not validated'
  const color = state === 'Validated' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : state === 'Validation failed' ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-700'
  const Icon = state === 'Validated' ? CheckCircle2 : state === 'Validation failed' ? XCircle : AlertTriangle
  return (
    <span className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium ${color}`}>
      <Icon size={15} /> {state}
    </span>
  )
}
