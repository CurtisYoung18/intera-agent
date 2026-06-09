'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  FileDown,
  GitCompare,
  Loader2,
  PackageOpen,
  RotateCcw,
  Upload,
  Wand2,
  X,
} from 'lucide-react'
import ConfigDiffViewer, { type ConfigDiffGroup, type ConfigDiffItem } from '@/components/config-diff/config-diff-viewer'
import { useAgentContext } from '@/lib/agent/agent-context'
import type { InteraAgentTemplateV1 } from '@intera/shared/contracts/agent-template'
import type { ScenarioReceipt, ScenarioValidationSummary } from '@intera/shared/contracts/scenarios'

interface AgentVersion {
  id: string
  name: string
  version: number
  isActive: boolean
  parentId: string | null
  model: string | null
  createdAt: string
  updatedAt: string
  releaseNote?: string | null
  publishedAt?: string | null
  publishedBy?: string | null
}

interface ScenarioListResponse {
  scenarios: unknown[]
  receipts: ScenarioReceipt[]
  validation: ScenarioValidationSummary
}

interface ExportResponse {
  template: InteraAgentTemplateV1
  filename: string
}

interface ReleaseData {
  configs: AgentVersion[]
  current: AgentVersion | null
  live: AgentVersion | null
  draft: AgentVersion | null
  rollbackCandidate: AgentVersion | null
  scenarios: ScenarioListResponse | null
  templates: Record<string, InteraAgentTemplateV1 | null>
  templateErrors: Record<string, string>
  scenarioError: string | null
}

const EMPTY_RELEASE_DATA: ReleaseData = {
  configs: [],
  current: null,
  live: null,
  draft: null,
  rollbackCandidate: null,
  scenarios: null,
  templates: {},
  templateErrors: {},
  scenarioError: null,
}

const GROUP_COPY = {
  brain: {
    title: 'Brain',
    description: 'Model, prompt, generation limits, memory strategy, and resume behavior.',
  },
  procedures: {
    title: 'Procedures',
    description: 'Procedure types and step manifests that guide the ProcedureRun Agent.',
  },
  tools: {
    title: 'Tools',
    description: 'HTTP, fixture, and managed tools available to procedures.',
  },
  hooks: {
    title: 'Hooks',
    description: 'Hook definitions and binding scopes across Agent, Procedure type, Procedure step, and Tool.',
  },
  knowledge: {
    title: 'Knowledge',
    description: 'Knowledge source bindings and retrieval configuration.',
  },
  integrations: {
    title: 'Integrations',
    description: 'Channel bindings, API access, and customer environment connections.',
  },
} as const

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const body = await response.json().catch(() => null)
  if (!response.ok || body?.ok === false) {
    const message = body?.error?.message || `Request failed: ${response.status}`
    throw new Error(message)
  }
  return (body?.data ?? body) as T
}

function formatDate(value?: string | null, empty = 'Not set') {
  if (!value) return empty
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return empty
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

function validationTone(state?: string) {
  if (state === 'Validated') return 'success'
  if (state === 'Validation failed') return 'danger'
  if (state === 'Changed since last validation') return 'warning'
  return 'neutral'
}

function receiptTone(status?: string) {
  if (status === 'passed') return 'success'
  if (status === 'failed' || status === 'error') return 'danger'
  return 'neutral'
}

function toneClass(tone: 'success' | 'warning' | 'danger' | 'neutral') {
  if (tone === 'success') return 'border-[color:color-mix(in_srgb,var(--color-signal-success)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--color-signal-success)_12%,white)] text-[var(--color-text-primary)]'
  if (tone === 'warning') return 'border-[color:color-mix(in_srgb,var(--color-signal-warning)_48%,transparent)] bg-[color:color-mix(in_srgb,var(--color-signal-warning)_13%,white)] text-[var(--color-text-primary)]'
  if (tone === 'danger') return 'border-[color:color-mix(in_srgb,var(--color-signal-danger)_42%,transparent)] bg-[color:color-mix(in_srgb,var(--color-signal-danger)_10%,white)] text-[var(--color-text-primary)]'
  return 'border-[var(--color-border-subtle)] bg-white/65 text-[var(--color-text-secondary)]'
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, normalize(val)]))
  }
  return value ?? null
}

function stableString(value: unknown) {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value === 'string') return value
  return JSON.stringify(normalize(value), null, 2)
}

function sanitizeReleaseCopy(raw: string): string {
  return raw
    .replace(/\bdispatch_case_agent\b/g, 'start_procedure')
    .replace(/\bfinalize_case\b/g, 'finalize_procedure')
    .replace(/\bper-case\b/gi, 'ProcedureRun')
    .replace(/\bcase as resolved\b/gi, 'Procedure as resolved')
    .replace(/\bcases\b/gi, 'ProcedureRuns')
    .replace(/\bcase\b/gi, 'ProcedureRun')
    .replace(/\bplatform policy\b/gi, 'platform rule')
}

function shortValue(value: unknown) {
  const raw = sanitizeReleaseCopy(stableString(value))
  if (!raw) return 'Not present'
  return raw.length > 420 ? `${raw.slice(0, 420)}...` : raw
}

function itemStatus(before: unknown, after: unknown): ConfigDiffItem['status'] {
  const beforeText = stableString(before)
  const afterText = stableString(after)
  if (!beforeText && afterText) return 'added'
  if (beforeText && !afterText) return 'removed'
  if (beforeText !== afterText) return 'changed'
  return 'unchanged'
}

function diffCollection<T>(
  beforeItems: T[],
  afterItems: T[],
  keyFor: (item: T) => string,
  labelFor: (item: T) => string,
  detailFor?: (item: T) => string | undefined,
): ConfigDiffItem[] {
  const beforeMap = new Map(beforeItems.map((item) => [keyFor(item), item]))
  const afterMap = new Map(afterItems.map((item) => [keyFor(item), item]))
  const keys = Array.from(new Set([...beforeMap.keys(), ...afterMap.keys()])).sort((a, b) => a.localeCompare(b))
  return keys.map((key) => {
    const before = beforeMap.get(key)
    const after = afterMap.get(key)
    const present = after ?? before
    return {
      key,
      label: sanitizeReleaseCopy(present ? labelFor(present) : key),
      detail: present && detailFor ? sanitizeReleaseCopy(detailFor(present) ?? '') : undefined,
      status: itemStatus(before, after),
      before: before ? shortValue(before) : undefined,
      after: after ? shortValue(after) : undefined,
    }
  })
}

function changedCount(items: ConfigDiffItem[]) {
  return items.filter((item) => item.status !== 'unchanged').length
}

function makeGroup(id: keyof typeof GROUP_COPY, items: ConfigDiffItem[]): ConfigDiffGroup {
  const changed = changedCount(items)
  return {
    id,
    title: GROUP_COPY[id].title,
    description: GROUP_COPY[id].description,
    summary: changed > 0 ? `${changed} changed rows` : 'No material changes',
    items,
  }
}

function buildDiffGroups(liveTemplate: InteraAgentTemplateV1 | null, draftTemplate: InteraAgentTemplateV1 | null): ConfigDiffGroup[] {
  const brainBefore = liveTemplate?.agent ? [{ key: 'brain', ...liveTemplate.agent }] : []
  const brainAfter = draftTemplate?.agent ? [{ key: 'brain', ...draftTemplate.agent }] : []
  const hookRowsBefore = [
    ...(liveTemplate?.hooks ?? []).map((hook) => ({ kind: 'Hook', key: `hook:${hook.name}`, ...hook })),
    ...(liveTemplate?.hookBindings ?? []).map((binding) => ({ kind: 'Binding', key: `binding:${binding.hookName}:${binding.scopeKey}`, ...binding })),
  ]
  const hookRowsAfter = [
    ...(draftTemplate?.hooks ?? []).map((hook) => ({ kind: 'Hook', key: `hook:${hook.name}`, ...hook })),
    ...(draftTemplate?.hookBindings ?? []).map((binding) => ({ kind: 'Binding', key: `binding:${binding.hookName}:${binding.scopeKey}`, ...binding })),
  ]

  return [
    makeGroup('brain', diffCollection(brainBefore, brainAfter, (item) => item.key, () => 'Agent Brain settings', (item) => typeof item.model === 'string' ? `Model ${item.model}` : undefined)),
    makeGroup('procedures', diffCollection(liveTemplate?.caseTypes ?? [], draftTemplate?.caseTypes ?? [], (item) => item.type, (item) => item.displayName || item.type, (item) => `${item.type} · ${item.procedure?.steps?.length ?? 0} steps`)),
    makeGroup('tools', diffCollection(liveTemplate?.tools ?? [], draftTemplate?.tools ?? [], (item) => item.name, (item) => item.name, (item) => `${item.mode}${item.enabled === false ? ' · disabled' : ''}`)),
    makeGroup('hooks', diffCollection(hookRowsBefore, hookRowsAfter, (item) => item.key, (item) => `${item.kind}: ${'name' in item ? item.name : item.hookName}`, (item) => 'checkpoint' in item ? String(item.checkpoint) : String(item.scopeType))),
    {
      id: 'knowledge',
      title: GROUP_COPY.knowledge.title,
      description: GROUP_COPY.knowledge.description,
      status: 'placeholder',
      summary: 'Package v1 placeholder',
      items: [],
      placeholder: 'Knowledge sources are not part of the current .intera-agent.json package contract. This section is intentionally isolated until the package schema carries Knowledge metadata.',
    },
    {
      id: 'integrations',
      title: GROUP_COPY.integrations.title,
      description: GROUP_COPY.integrations.description,
      status: 'placeholder',
      summary: 'Package v1 placeholder',
      items: [],
      placeholder: 'Channel bindings and external integration credentials are intentionally not exported in package v1. Release shows this as a placeholder instead of synthesizing incomplete data.',
    },
  ]
}

function pickLatestReceipt(receipts: ScenarioReceipt[]) {
  return [...receipts].sort((a, b) => {
    const aTime = new Date(a.finishedAt ?? a.startedAt).getTime()
    const bTime = new Date(b.finishedAt ?? b.startedAt).getTime()
    return bTime - aTime
  })[0] ?? null
}

async function fetchTemplate(agentConfigId: string) {
  const response = await readJson<ExportResponse>(`/api/admin/agent-templates/export?agentConfigId=${encodeURIComponent(agentConfigId)}`)
  return response.template
}

export default function ReleaseCommandCenter() {
  const { selectedAgentId, loading: agentLoading, loadError, selectAgent, refreshConfigs } = useAgentContext()
  const [data, setData] = useState<ReleaseData>(EMPTY_RELEASE_DATA)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [publishOpen, setPublishOpen] = useState(false)
  const [releaseNote, setReleaseNote] = useState('')
  const [overrideReason, setOverrideReason] = useState('')
  const [rollbackOpen, setRollbackOpen] = useState(false)
  const [pilotOpen, setPilotOpen] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)

  const reload = useCallback(() => setReloadKey((key) => key + 1), [])

  useEffect(() => {
    if (agentLoading) return
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const configResponse = await readJson<{ configs: AgentVersion[] }>('/api/admin/agent-configs')
        const configs = [...(configResponse.configs ?? [])].sort((a, b) => a.name.localeCompare(b.name) || a.version - b.version)
        const current = configs.find((config) => config.id === selectedAgentId) ?? configs.find((config) => config.isActive) ?? configs[0] ?? null
        if (current && selectedAgentId !== current.id) selectAgent(current.id)
        const family = current ? configs.filter((config) => config.name === current.name).sort((a, b) => a.version - b.version) : []
        const live = family.find((config) => config.isActive) ?? configs.find((config) => config.isActive) ?? current
        const draft = current && !current.isActive ? current : [...family].reverse().find((config) => !config.isActive) ?? current
        const rollbackCandidate = live ? [...family].reverse().find((config) => config.id !== live.id) ?? null : null
        const templateIds = Array.from(new Set([live?.id, draft?.id, rollbackCandidate?.id].filter(Boolean))) as string[]
        const [scenarioResult, templateResults] = await Promise.all([
          draft
            ? readJson<ScenarioListResponse>(`/api/admin/scenarios?agentConfigId=${encodeURIComponent(draft.id)}`).then((scenarios) => ({ scenarios, error: null })).catch((err: Error) => ({ scenarios: null, error: err.message }))
            : Promise.resolve({ scenarios: null, error: null }),
          Promise.all(templateIds.map(async (id) => {
            try {
              return { id, template: await fetchTemplate(id), error: null }
            } catch (err) {
              return { id, template: null, error: err instanceof Error ? err.message : 'Template export failed' }
            }
          })),
        ])
        const templates: Record<string, InteraAgentTemplateV1 | null> = {}
        const templateErrors: Record<string, string> = {}
        for (const result of templateResults) {
          templates[result.id] = result.template
          if (result.error) templateErrors[result.id] = result.error
        }
        if (!cancelled) {
          setData({
            configs,
            current,
            live,
            draft,
            rollbackCandidate,
            scenarios: scenarioResult.scenarios,
            templates,
            templateErrors,
            scenarioError: scenarioResult.error,
          })
          setReleaseNote(draft?.releaseNote ?? live?.releaseNote ?? '')
          setOverrideReason('')
        }
      } catch (err) {
        if (!cancelled) {
          setData(EMPTY_RELEASE_DATA)
          setError(err instanceof Error ? err.message : 'Failed to load release data')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [agentLoading, reloadKey, selectedAgentId, selectAgent])

  const validation = data.scenarios?.validation
  const validationState = validation?.state ?? (data.scenarioError ? 'Not validated' : 'Not validated')
  const overrideRequired = validation?.overrideRequired ?? true
  const latestReceipt = useMemo(() => pickLatestReceipt(data.scenarios?.receipts ?? []), [data.scenarios?.receipts])
  const liveTemplate = data.live ? data.templates[data.live.id] ?? null : null
  const draftTemplate = data.draft ? data.templates[data.draft.id] ?? null : null
  const diffGroups = useMemo(() => buildDiffGroups(liveTemplate, draftTemplate), [liveTemplate, draftTemplate])
  const rollbackTemplate = data.rollbackCandidate ? data.templates[data.rollbackCandidate.id] ?? null : null
  const rollbackGroups = useMemo(() => buildDiffGroups(liveTemplate, rollbackTemplate), [liveTemplate, rollbackTemplate])
  const canPublish = Boolean(data.draft && !data.draft.isActive)
  const publishDisabledReason = data.draft?.isActive ? 'Duplicate the live version before publishing a new draft.' : null

  async function handleExport() {
    const target = data.draft ?? data.current
    if (!target) return
    setBusyAction('export')
    setNotice(null)
    setError(null)
    try {
      const response = await fetch(`/api/admin/agent-templates/export?agentConfigId=${encodeURIComponent(target.id)}&download=1`)
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.error?.message || 'Export failed')
      }
      const blob = await response.blob()
      const filename = `${target.name.replace(/\s+/g, '-').toLowerCase()}-v${target.version}.intera-agent.json`
      if (typeof URL.createObjectURL === 'function') {
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = filename
        anchor.click()
        URL.revokeObjectURL(url)
      }
      setNotice(`Exported ${filename}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setBusyAction(null)
    }
  }

  async function handleImport(file: File | undefined) {
    if (!file) return
    setBusyAction('import')
    setNotice(null)
    setError(null)
    try {
      const template = JSON.parse(await file.text())
      const result = await readJson<{ config: AgentVersion; imported?: Record<string, number>; warnings?: string[] }>('/api/admin/agent-templates/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template, parentAgentConfigId: data.current?.id }),
      })
      await refreshConfigs()
      if (result.config?.id) selectAgent(result.config.id)
      setNotice(`Imported ${result.config?.name ?? file.name} as a draft package`)
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setBusyAction(null)
      if (importInputRef.current) importInputRef.current.value = ''
    }
  }

  async function handleDuplicate() {
    const target = data.current ?? data.live
    if (!target) return
    setBusyAction('duplicate')
    setNotice(null)
    setError(null)
    try {
      const result = await readJson<{ config: AgentVersion }>(`/api/admin/agent-configs/${encodeURIComponent(target.id)}/fork`, { method: 'POST' })
      await refreshConfigs()
      if (result.config?.id) selectAgent(result.config.id)
      setNotice(`Duplicated ${target.name} v${target.version} into draft v${result.config.version}`)
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Duplicate failed')
    } finally {
      setBusyAction(null)
    }
  }

  async function handlePublish() {
    const target = data.draft
    if (!target || target.isActive) return
    if (overrideRequired && !overrideReason.trim()) {
      setError('Override reason is required when validation is stale, failing, or unvalidated.')
      return
    }
    setBusyAction('publish')
    setError(null)
    setNotice(null)
    try {
      await readJson<{ config: AgentVersion; validation: ScenarioValidationSummary & { overrideReason?: string } }>(`/api/admin/agent-configs/${encodeURIComponent(target.id)}/activate`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          releaseNote: releaseNote.trim() || undefined,
          overrideValidationReason: overrideRequired ? overrideReason.trim() : undefined,
        }),
      })
      await refreshConfigs()
      selectAgent(target.id)
      setPublishOpen(false)
      setNotice(`Published ${target.name} v${target.version}`)
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publish failed')
    } finally {
      setBusyAction(null)
    }
  }

  if (agentLoading || loading) {
    return (
      <main className="mx-auto flex min-h-[70vh] max-w-6xl items-center justify-center px-6 py-8 sm:px-8">
        <div className="rounded-[var(--radius-panel)] border border-[var(--color-border-subtle)] bg-white/75 px-6 py-5 text-[13px] text-[var(--color-text-secondary)] shadow-[var(--shadow-raised)]">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin text-[var(--color-accent-primary)]" />
          Loading Release command center...
        </div>
      </main>
    )
  }

  if (loadError || error && !data.current) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-8 sm:px-8">
        <section className="rounded-[var(--radius-panel)] border border-[color:color-mix(in_srgb,var(--color-signal-danger)_35%,transparent)] bg-white/80 p-6 shadow-[var(--shadow-raised)]">
          <p className="text-[13px] font-medium text-[var(--color-signal-danger)]">{loadError || error}</p>
          <button type="button" onClick={reload} className="mt-4 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white px-3 py-2 text-[12px] text-[var(--color-text-primary)]">Try again</button>
        </section>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-7xl px-5 py-7 sm:px-8">
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-tertiary)]">Build / Release</p>
          <h1 className="mt-2 text-[30px] font-semibold tracking-[-0.03em] text-[var(--color-text-primary)]">Release command center</h1>
          <p className="mt-2 max-w-3xl text-[13px] leading-5 text-[var(--color-text-secondary)]">Publish deliberately, inspect draft changes, validate with Scenario receipts, and move packages through import/export without leaving the Build workspace.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setPilotOpen(true)} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white/80 px-3 py-2 text-[12px] font-medium text-[var(--color-text-primary)] shadow-sm transition hover:border-[var(--color-accent-primary)]/40">
            <Wand2 className="h-4 w-4 text-[var(--color-accent-primary)]" />
            ConfigPilot
          </button>
          <Link href="/build/pilot-lab" className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white/70 px-3 py-2 text-[12px] text-[var(--color-text-secondary)] transition hover:text-[var(--color-text-primary)]">Open Pilot Lab</Link>
        </div>
      </div>

      {(notice || error) ? (
        <div className={`mb-4 rounded-[var(--radius-control)] border px-4 py-3 text-[13px] ${error ? toneClass('danger') : toneClass('success')}`}>{error || notice}</div>
      ) : null}

      <section className="mb-5 grid gap-4 lg:grid-cols-[1fr_1fr_360px]">
        <VersionCard title="Live Agent version" version={data.live} tone="success" meta={[
          ['Published', formatDate(data.live?.publishedAt, 'Not published')],
          ['Publisher', data.live?.publishedBy || 'Unknown'],
          ['Release note', data.live?.releaseNote || 'No release note'],
        ]} />
        <VersionCard title="Draft version" version={data.draft} tone={data.draft?.isActive ? 'neutral' : 'warning'} meta={[
          ['Updated', formatDate(data.draft?.updatedAt, 'Not updated')],
          ['Parent', data.draft?.parentId || 'No parent version'],
          ['State', data.draft?.isActive ? 'Currently live' : 'Draft can be published'],
        ]} />
        <section className="rounded-[var(--radius-panel)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 shadow-[var(--shadow-raised)]">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-tertiary)]">Validation status</p>
          <div className="mt-3 flex items-center gap-2">
            <span className={`rounded-full border px-2.5 py-1 text-[12px] font-medium ${toneClass(validationTone(validationState))}`}>{validationState}</span>
            {validationState === 'Validated' ? <CheckCircle2 className="h-4 w-4 text-[var(--color-signal-success)]" /> : <AlertTriangle className="h-4 w-4 text-[var(--color-signal-warning)]" />}
          </div>
          <dl className="mt-4 space-y-2 text-[12px]">
            <InfoRow label="Last validated" value={formatDate(validation?.lastValidatedAt, 'Never')} />
            <InfoRow label="Changed at" value={formatDate(validation?.changedAt, 'No tracked change')} />
            <InfoRow label="Receipt" value={validation?.lastReceiptId || 'No receipt'} />
          </dl>
          {overrideRequired ? <p className="mt-4 rounded-[var(--radius-control)] border border-[color:color-mix(in_srgb,var(--color-signal-warning)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--color-signal-warning)_11%,white)] px-3 py-2 text-[12px] leading-5 text-[var(--color-text-primary)]">Changed-since-validation warning: publishing requires a non-empty override reason.</p> : null}
        </section>
      </section>

      <section className="mb-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="rounded-[var(--radius-panel)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 shadow-[var(--shadow-raised)]">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-tertiary)]">Package actions</p>
              <h2 className="mt-1 text-[18px] font-semibold text-[var(--color-text-primary)]">Import, export, duplicate, publish</h2>
              <p className="mt-1 text-[13px] leading-5 text-[var(--color-text-secondary)]">These controls call the existing package and version endpoints. Live activation is explicit and never happens from import or draft save.</p>
            </div>
            <input ref={importInputRef} aria-label="Import .intera-agent.json file" type="file" accept="application/json,.json,.intera-agent.json" className="hidden" onChange={(event) => handleImport(event.target.files?.[0])} />
          </div>
          <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            <ActionButton icon={<FileDown className="h-4 w-4" />} label="Export package" busy={busyAction === 'export'} onClick={handleExport} />
            <ActionButton icon={<Upload className="h-4 w-4" />} label="Import package" busy={busyAction === 'import'} onClick={() => importInputRef.current?.click()} />
            <ActionButton icon={<Copy className="h-4 w-4" />} label="Duplicate Version" busy={busyAction === 'duplicate'} onClick={handleDuplicate} />
            <ActionButton icon={<PackageOpen className="h-4 w-4" />} label="Publish draft" busy={busyAction === 'publish'} disabled={!canPublish} onClick={() => setPublishOpen(true)} />
            <ActionButton icon={<RotateCcw className="h-4 w-4" />} label="Rollback preview" disabled={!data.rollbackCandidate} onClick={() => setRollbackOpen(true)} />
          </div>
          {publishDisabledReason ? <p className="mt-3 text-[12px] text-[var(--color-text-tertiary)]">{publishDisabledReason}</p> : null}
        </section>

        <section className="rounded-[var(--radius-panel)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 shadow-[var(--shadow-raised)]">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-tertiary)]">Latest Scenario receipt</p>
          {latestReceipt ? (
            <div className="mt-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)]">{latestReceipt.scenarioName}</h2>
                <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${toneClass(receiptTone(latestReceipt.status))}`}>{latestReceipt.status}</span>
              </div>
              <dl className="mt-4 space-y-2 text-[12px]">
                <InfoRow label="Run ID" value={latestReceipt.runId} />
                <InfoRow label="Finished" value={formatDate(latestReceipt.finishedAt ?? latestReceipt.startedAt)} />
                <InfoRow label="Trace" value={latestReceipt.traceId || 'No trace linked'} />
                <InfoRow label="Summary" value={latestReceipt.summary || `${latestReceipt.checks.length} checks recorded`} />
              </dl>
            </div>
          ) : (
            <p className="mt-3 rounded-[var(--radius-control)] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-bg-surface-muted)] px-4 py-3 text-[12px] leading-5 text-[var(--color-text-secondary)]">No Scenario receipt has been recorded for this draft yet. Run Pilot Lab validation before publishing or provide an override reason.</p>
          )}
        </section>
      </section>

      {Object.keys(data.templateErrors).length > 0 ? (
        <section className="mb-5 rounded-[var(--radius-control)] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-bg-surface-muted)] px-4 py-3 text-[12px] text-[var(--color-text-secondary)]">
          Template diff placeholders are isolated because export failed for: {Object.entries(data.templateErrors).map(([id, message]) => `${id} (${message})`).join(', ')}
        </section>
      ) : null}

      <ConfigDiffViewer groups={diffGroups} subtitle={`${data.live ? `${data.live.name} v${data.live.version}` : 'No live version'} compared with ${data.draft ? `v${data.draft.version}` : 'no draft'}.`} />

      {publishOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20 px-4 backdrop-blur-sm">
          <section role="dialog" aria-label="Publish version" className="w-full max-w-lg rounded-[var(--radius-panel)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-tertiary)]">Explicit publish</p>
                <h2 className="mt-1 text-[18px] font-semibold text-[var(--color-text-primary)]">Publish {data.draft?.name} v{data.draft?.version}</h2>
                <p className="mt-1 text-[13px] leading-5 text-[var(--color-text-secondary)]">This activates the selected draft for customer channels. Draft save/import actions remain isolated.</p>
              </div>
              <button type="button" aria-label="Close publish dialog" onClick={() => setPublishOpen(false)} className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white p-2 text-[var(--color-text-tertiary)]">
                <X className="h-4 w-4" />
              </button>
            </div>
            <label className="mt-5 block text-[12px] font-medium text-[var(--color-text-primary)]" htmlFor="release-note">Release note</label>
            <textarea id="release-note" aria-label="Release note" value={releaseNote} onChange={(event) => setReleaseNote(event.target.value)} rows={3} className="mt-2 w-full rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent-primary)]" placeholder="What changed in this publish?" />
            {overrideRequired ? (
              <>
                <label className="mt-4 block text-[12px] font-medium text-[var(--color-text-primary)]" htmlFor="override-reason">Override reason</label>
                <textarea id="override-reason" aria-label="Override reason" value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} rows={3} className="mt-2 w-full rounded-[var(--radius-control)] border border-[color:color-mix(in_srgb,var(--color-signal-warning)_40%,var(--color-border-subtle))] bg-white px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-signal-warning)]" placeholder="Required because validation is stale, failing, or missing." />
              </>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setPublishOpen(false)} className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white px-3 py-2 text-[12px] text-[var(--color-text-secondary)]">Cancel</button>
              <button type="button" disabled={busyAction === 'publish' || (overrideRequired && !overrideReason.trim())} onClick={handlePublish} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-[color:color-mix(in_srgb,var(--color-accent-primary)_45%,transparent)] bg-[var(--color-accent-primary)] px-3 py-2 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">
                {busyAction === 'publish' ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageOpen className="h-4 w-4" />}
                Publish version
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {rollbackOpen ? (
        <LightDrawer title="Rollback preview" eyebrow="Release safety" onClose={() => setRollbackOpen(false)}>
          <p className="text-[13px] leading-5 text-[var(--color-text-secondary)]">Preview how live v{data.live?.version ?? '?'} differs from {data.rollbackCandidate ? `v${data.rollbackCandidate.version}` : 'the selected historical version'}. This drawer does not activate rollback; select the historical version and publish explicitly when ready.</p>
          {data.rollbackCandidate ? (
            <div className="mt-4 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white/70 px-4 py-3 text-[12px] text-[var(--color-text-secondary)]">
              Candidate: <span className="font-semibold text-[var(--color-text-primary)]">{data.rollbackCandidate.name} v{data.rollbackCandidate.version}</span>
              <button type="button" onClick={() => { selectAgent(data.rollbackCandidate!.id); setRollbackOpen(false); reload() }} className="ml-3 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white px-2.5 py-1.5 text-[11px] text-[var(--color-text-primary)]">Select candidate</button>
            </div>
          ) : null}
          <div className="mt-4">
            <ConfigDiffViewer title="Rollback diff preview" subtitle="Live version compared with the rollback candidate." groups={rollbackGroups} />
          </div>
        </LightDrawer>
      ) : null}

      {pilotOpen ? (
        <LightDrawer title="ConfigPilot drawer" eyebrow="Placeholder entry" onClose={() => setPilotOpen(false)}>
          <p className="text-[13px] leading-5 text-[var(--color-text-secondary)]">U3 will land the full ConfigPilot workspace. For U2, this entry point is intentionally isolated: propose package-safe changes, review the diff, then apply through typed APIs before returning here to validate and publish.</p>
          <div className="mt-4 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[color:color-mix(in_srgb,var(--color-accent-primary)_7%,white)] px-4 py-3 text-[12px] leading-5 text-[var(--color-text-secondary)]">
            Suggested prompt: "Compare the draft against live and propose the smallest fix for the failing Scenario receipt."
          </div>
          <Link href="/build/pilot-lab" className="mt-4 inline-flex rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white px-3 py-2 text-[12px] font-medium text-[var(--color-text-primary)]">Open Pilot Lab placeholder</Link>
        </LightDrawer>
      ) : null}
    </main>
  )
}

function VersionCard({ title, version, tone, meta }: { title: string; version: AgentVersion | null; tone: 'success' | 'warning' | 'neutral'; meta: [string, string][] }) {
  return (
    <section className="rounded-[var(--radius-panel)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 shadow-[var(--shadow-raised)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-tertiary)]">{title}</p>
          <h2 className="mt-2 text-[22px] font-semibold text-[var(--color-text-primary)]">{version ? `${version.name} v${version.version}` : 'No version'}</h2>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${toneClass(tone)}`}>{version?.isActive ? 'Live' : 'Draft'}</span>
      </div>
      <dl className="mt-5 space-y-2 text-[12px]">
        {meta.map(([label, value]) => <InfoRow key={label} label={label} value={value} />)}
      </dl>
    </section>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 border-b border-[var(--color-border-subtle)] pb-2 last:border-b-0 last:pb-0">
      <dt className="w-28 shrink-0 text-[var(--color-text-tertiary)]">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-[var(--color-text-secondary)]">{value}</dd>
    </div>
  )
}

function ActionButton({ icon, label, busy, disabled, onClick }: { icon: ReactNode; label: string; busy?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={busy || disabled} onClick={onClick} className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white/80 px-3 py-2 text-[12px] font-medium text-[var(--color-text-primary)] shadow-sm transition hover:border-[var(--color-accent-primary)]/40 disabled:cursor-not-allowed disabled:opacity-45">
      {busy ? <Loader2 className="h-4 w-4 animate-spin text-[var(--color-accent-primary)]" /> : icon}
      {label}
    </button>
  )
}

function LightDrawer({ eyebrow, title, children, onClose }: { eyebrow: string; title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[55] bg-black/15 backdrop-blur-[2px]">
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col border-l border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--color-border-subtle)] px-5 py-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-tertiary)]">{eyebrow}</p>
            <h2 className="mt-1 text-[20px] font-semibold text-[var(--color-text-primary)]">{title}</h2>
          </div>
          <button type="button" aria-label={`Close ${title}`} onClick={onClose} className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white p-2 text-[var(--color-text-tertiary)]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
      </aside>
    </div>
  )
}
