'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  FileDown,
  GitCompare,
  Loader2,
  MoreHorizontal,
  PackageOpen,
  RotateCcw,
  SendHorizontal,
  Upload,
  Wand2,
  X,
} from 'lucide-react'
import ConfigDiffViewer, { type ConfigDiffGroup, type ConfigDiffItem } from '@/components/config-diff/config-diff-viewer'
import { OrganicLoader, TokenStreamPreview } from '@/components/config-pilot/ai-motion'
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
  if (status === 'pass') return 'success'
  if (status === 'fail') return 'danger'
  if (status === 'blocked') return 'warning'
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
  const importInputRef = useRef<HTMLInputElement>(null)

  const reload = useCallback(() => setReloadKey((key) => key + 1), [])
  const openPilotLab = useCallback(() => {
    window.location.href = '/build/pilot-lab'
  }, [])

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
    <main className="intera-q2-page mx-auto max-w-[1536px] px-5 py-6 text-[var(--color-text-primary)] sm:px-8">
      <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] font-medium text-[var(--color-text-tertiary)]">
            <span>Build</span>
            <span className="text-[var(--color-border-strong)]">/</span>
            <span className="text-[var(--color-text-primary)]">Release</span>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <h1 className="text-[30px] font-semibold leading-[1.08] text-[var(--color-text-primary)] sm:text-[34px]">{data.current?.name ?? data.live?.name ?? 'Agent'}</h1>
            <span className={`rounded-[var(--radius-control)] border px-2.5 py-1 text-[12px] font-semibold ${toneClass(data.current?.isActive ? 'success' : 'warning')}`}>
              {data.current?.isActive ? 'Active' : 'Draft'}
            </span>
          </div>
          <p className="mt-2 max-w-3xl text-[15px] leading-6 text-[var(--color-text-secondary)]">Manage versions, validate quality, and publish with confidence.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="intera-q2-button flex min-h-11 items-center gap-3 border border-[var(--color-border-subtle)] bg-white px-4 text-[13px] shadow-[0_1px_2px_rgba(21,23,25,0.04)]">
            <span className="text-[var(--color-text-tertiary)]">Agent</span>
            <select
              aria-label="Release agent version"
              value={data.current?.id ?? ''}
              onChange={(event) => selectAgent(event.target.value)}
              className="min-w-[190px] bg-transparent text-[13px] font-semibold text-[var(--color-text-primary)] outline-none"
            >
              {data.configs.map((config) => (
                <option key={config.id} value={config.id}>{config.name} v{config.version}</option>
              ))}
            </select>
          </label>
          <button type="button" aria-label="Release actions" className="intera-q2-button flex h-11 w-11 items-center justify-center border border-[var(--color-border-subtle)] bg-white text-[var(--color-text-secondary)]">
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
      </div>

      {(notice || error) ? (
        <div className={`mb-4 rounded-[var(--radius-control)] border px-4 py-3 text-[13px] ${error ? toneClass('danger') : toneClass('success')}`}>{error || notice}</div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <ReleaseSummaryStrip
            live={data.live}
            draft={data.draft}
            validationState={validationState}
            validation={validation}
            latestReceipt={latestReceipt}
            onOpenPilot={openPilotLab}
          />

          <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
            <ConfigDiffViewer groups={diffGroups} subtitle={`${data.live ? `${data.live.name} v${data.live.version}` : 'No live version'} compared with ${data.draft ? `v${data.draft.version}` : 'no draft'}.`} />
            <LatestReceiptCard latestReceipt={latestReceipt} />
          </div>

          <PackageActionsPanel
            busyAction={busyAction}
            canPublish={canPublish}
            importInputRef={importInputRef}
            publishDisabledReason={publishDisabledReason}
            rollbackCandidate={data.rollbackCandidate}
            onDuplicate={handleDuplicate}
            onExport={handleExport}
            onImport={(file) => handleImport(file)}
            onImportClick={() => importInputRef.current?.click()}
            onPublish={() => setPublishOpen(true)}
            onRollback={() => setRollbackOpen(true)}
          />
        </div>

        <ReleaseConfigPilotRail validation={validation} validationState={validationState} latestReceipt={latestReceipt} onOpen={openPilotLab} />
      </div>

      {Object.keys(data.templateErrors).length > 0 ? (
        <section className="mt-4 rounded-[var(--radius-control)] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-bg-surface-muted)] px-4 py-3 text-[12px] text-[var(--color-text-secondary)]">
          Template diff placeholders are isolated because export failed for: {Object.entries(data.templateErrors).map(([id, message]) => `${id} (${message})`).join(', ')}
        </section>
      ) : null}

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

    </main>
  )
}

function ReleaseSummaryStrip({
  live,
  draft,
  validationState,
  validation,
  latestReceipt,
  onOpenPilot,
}: {
  live: AgentVersion | null
  draft: AgentVersion | null
  validationState: string
  validation: ScenarioValidationSummary | undefined
  latestReceipt: ScenarioReceipt | null
  onOpenPilot: () => void
}) {
  const runtimeValidated = Boolean(validation?.runtimeValidated)
  const validationTitle = runtimeValidated ? 'Runtime validated' : validationState === 'Validated' ? 'Fixture only' : validationState
  const validationDetail = runtimeValidated
    ? `Runtime validated ${formatDate(validation?.runtimeValidatedAt ?? validation?.lastValidatedAt)}`
    : latestReceipt?.executionMode === 'fixture'
      ? 'Latest receipt is fixture-only'
      : 'No runtime-backed validation'
  const validationMeta = latestReceipt
    ? `${executionModeLabel(latestReceipt.executionMode)} receipt ${latestReceipt.status}`
    : 'Run Pilot Lab before publish'
  return (
    <section className="intera-q2-panel overflow-hidden">
      <div className="grid divide-y divide-[var(--color-border-subtle)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(320px,1.15fr)] lg:divide-x lg:divide-y-0">
        <SummaryMetric
          label="Live Version"
          title={live ? `v${live.version}` : 'No live'}
          detail={formatDate(live?.publishedAt, 'Not published')}
          meta={live?.publishedBy ? `by ${live.publishedBy}` : 'Publisher unknown'}
          tone="success"
        />
        <SummaryMetric
          label="Validation State"
          title={validationTitle}
          detail={validationDetail}
          meta={validationMeta}
          tone={runtimeValidated ? 'success' : validationTone(validationState)}
          icon={runtimeValidated ? <CheckCircle2 className="h-5 w-5 text-[var(--color-signal-success)]" /> : <AlertTriangle className="h-5 w-5 text-[var(--color-signal-warning)]" />}
        />
        <SummaryMetric
          label="Draft"
          title={draft ? `v${draft.version}${draft.isActive ? '' : ' draft'}` : 'No draft'}
          detail={formatDate(draft?.updatedAt, 'Not updated')}
          meta={draft?.parentId ? 'Has parent version' : 'No parent version'}
          tone={draft?.isActive ? 'neutral' : 'warning'}
        />
        <div className="p-5">
          <p className="text-[13px] font-semibold text-[var(--color-text-secondary)]">Command</p>
          <button type="button" onClick={onOpenPilot} className="intera-q2-button mt-4 flex min-h-12 w-full items-center gap-3 border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-4 text-left text-[13px] text-[var(--color-text-tertiary)] transition hover:border-[var(--color-accent-primary)]/35">
            <span className="min-w-0 flex-1">
              <TokenStreamPreview text="Ask ConfigPilot or enter a command." />
            </span>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-accent-primary)] text-[var(--color-text-inverse)]">
              <SendHorizontal className="h-4 w-4" />
            </span>
          </button>
        </div>
      </div>
    </section>
  )
}

function SummaryMetric({
  label,
  title,
  detail,
  meta,
  tone,
  icon,
}: {
  label: string
  title: string
  detail: string
  meta: string
  tone: 'success' | 'warning' | 'danger' | 'neutral'
  icon?: ReactNode
}) {
  return (
    <div className="min-w-0 p-5">
      <p className="text-[13px] font-semibold text-[var(--color-text-secondary)]">{label}</p>
      <div className="mt-4 flex min-w-0 items-center gap-3">
        {icon}
        <h2 className="min-w-0 text-[22px] font-semibold leading-tight text-[var(--color-text-primary)]">{title}</h2>
      </div>
      <div className="mt-4 space-y-2 text-[13px] leading-5 text-[var(--color-text-secondary)]">
        <p className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${tone === 'success' ? 'bg-[var(--color-signal-success)]' : tone === 'warning' ? 'bg-[var(--color-signal-warning)]' : tone === 'danger' ? 'bg-[var(--color-signal-danger)]' : 'bg-[var(--color-text-tertiary)]'}`} />
          <span>{detail}</span>
        </p>
        <p>{meta}</p>
      </div>
    </div>
  )
}

function LatestReceiptCard({ latestReceipt }: { latestReceipt: ScenarioReceipt | null }) {
  return (
    <section className="intera-q2-panel overflow-hidden">
      <div className="border-b border-[var(--color-border-subtle)] px-5 py-4">
        <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)]">Latest Scenario Receipt</h2>
      </div>
      {latestReceipt ? (
        <div className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <span className={`inline-flex rounded-[var(--radius-control)] border px-2.5 py-1 text-[12px] font-semibold capitalize ${toneClass(receiptTone(latestReceipt.status))}`}>{latestReceipt.status}</span>
              <h3 className="mt-4 text-[14px] font-semibold text-[var(--color-text-primary)]">{latestReceipt.scenarioName}</h3>
              <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">{executionModeLabel(latestReceipt.executionMode)} · Run {formatDate(latestReceipt.completedAt ?? latestReceipt.finishedAt ?? latestReceipt.startedAt)}</p>
            </div>
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-0 overflow-hidden rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] text-[12px]">
            <ReceiptStat label="Total" value={String(latestReceipt.checks.length)} />
            <ReceiptStat label="Passed" value={String(latestReceipt.checks.filter((check) => check.passed).length)} tone="success" />
            <ReceiptStat label="Failed" value={String(latestReceipt.checks.filter((check) => !check.passed).length)} tone={latestReceipt.checks.some((check) => !check.passed) ? 'danger' : 'neutral'} />
            <ReceiptStat label="Tool mode" value={latestReceipt.toolExecutionMode} />
          </dl>
          <div className="mt-5 space-y-3">
            {latestReceipt.checks.slice(0, 5).map((check) => (
              <div key={check.name} className="flex items-center justify-between gap-3 text-[13px]">
                <span className="flex min-w-0 items-center gap-2 font-medium text-[var(--color-text-primary)]">
                  {check.passed ? <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--color-signal-success)]" /> : <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--color-signal-danger)]" />}
                  <span className="truncate">{check.name.replace(/_/g, ' ')}</span>
                </span>
                <span className="shrink-0 rounded bg-[var(--color-bg-surface-muted)] px-2 py-1 text-[11px] text-[var(--color-text-tertiary)]">{check.passed ? 'Passed' : 'Failed'}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="p-5">
          <p className="rounded-[var(--radius-control)] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-bg-surface-muted)] px-4 py-3 text-[12px] leading-5 text-[var(--color-text-secondary)]">No Scenario receipt has been recorded for this draft yet. Run Pilot Lab validation before publishing or provide an override reason.</p>
        </div>
      )}
    </section>
  )
}

function ReceiptStat({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'success' | 'danger' | 'neutral' }) {
  const toneClassName = tone === 'success' ? 'text-[var(--color-signal-success)]' : tone === 'danger' ? 'text-[var(--color-signal-danger)]' : 'text-[var(--color-text-primary)]'
  return (
    <div className="border-b border-r border-[var(--color-border-subtle)] px-4 py-3 even:border-r-0">
      <dt className="text-[11px] text-[var(--color-text-tertiary)]">{label}</dt>
      <dd className={`mt-1 text-[20px] font-semibold ${toneClassName}`}>{value}</dd>
    </div>
  )
}

function PackageActionsPanel({
  busyAction,
  canPublish,
  importInputRef,
  publishDisabledReason,
  rollbackCandidate,
  onDuplicate,
  onExport,
  onImport,
  onImportClick,
  onPublish,
  onRollback,
}: {
  busyAction: string | null
  canPublish: boolean
  importInputRef: RefObject<HTMLInputElement | null>
  publishDisabledReason: string | null
  rollbackCandidate: AgentVersion | null
  onDuplicate: () => void
  onExport: () => void
  onImport: (file: File | undefined) => void
  onImportClick: () => void
  onPublish: () => void
  onRollback: () => void
}) {
  return (
    <section className="intera-q2-panel p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)]">Package Actions</h2>
          <p className="mt-1 text-[13px] leading-5 text-[var(--color-text-secondary)]">Import, export, duplicate, publish, and rollback from the existing package endpoints.</p>
        </div>
        <input ref={importInputRef} aria-label="Import .intera-agent.json file" type="file" accept="application/json,.json,.intera-agent.json" className="hidden" onChange={(event) => onImport(event.target.files?.[0])} />
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <ActionButton icon={<FileDown className="h-4 w-4" />} label="Export package" busy={busyAction === 'export'} onClick={onExport} />
        <ActionButton icon={<Upload className="h-4 w-4" />} label="Import package" busy={busyAction === 'import'} onClick={onImportClick} />
        <ActionButton icon={<Copy className="h-4 w-4" />} label="Duplicate Version" busy={busyAction === 'duplicate'} onClick={onDuplicate} />
        <ActionButton icon={<PackageOpen className="h-4 w-4" />} label="Publish draft" busy={busyAction === 'publish'} disabled={!canPublish} onClick={onPublish} />
        <ActionButton icon={<RotateCcw className="h-4 w-4" />} label="Rollback preview" disabled={!rollbackCandidate} onClick={onRollback} />
      </div>
      {publishDisabledReason ? <p className="mt-3 text-[12px] text-[var(--color-text-tertiary)]">{publishDisabledReason}</p> : null}
    </section>
  )
}

function ReleaseConfigPilotRail({
  validation,
  validationState,
  latestReceipt,
  onOpen,
}: {
  validation: ScenarioValidationSummary | undefined
  validationState: string
  latestReceipt: ScenarioReceipt | null
  onOpen: () => void
}) {
  const validated = Boolean(validation?.runtimeValidated)
  return (
    <aside className="intera-q2-rail p-5 xl:sticky xl:top-6 xl:self-start">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-accent-primary)]">
            <OrganicLoader variant={validated ? '20' : '12'} size={24} title="ConfigPilot release rail loader" />
          </span>
          <div className="min-w-0">
            <p className="text-[16px] font-semibold text-[var(--color-text-primary)]">ConfigPilot <span className="ml-1 rounded bg-[var(--color-bg-surface-muted)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-text-tertiary)]">BETA</span></p>
          </div>
        </div>
        <button type="button" aria-label="Collapse ConfigPilot rail" className="text-[var(--color-text-tertiary)]">⌃</button>
      </div>

      <p className="mt-8 text-[13px] leading-6 text-[var(--color-text-secondary)]">
        Based on your draft changes and latest receipt.
      </p>

      <RailInsight
        tone="warning"
        title={validated ? 'Recommendation' : 'High impact'}
        body={validated ? 'Validation is fresh. Ask for a small draft improvement before the next publish.' : 'Validation needs attention. Run Pilot Lab or ask ConfigPilot for the smallest reviewable fix.'}
        action={validated ? 'Review suggestion' : 'Open suggestion'}
        onClick={onOpen}
      />
      <RailInsight
        tone="info"
        title="Recommendation"
        body={latestReceipt ? `Latest ${executionModeLabel(latestReceipt.executionMode)} receipt ${latestReceipt.status}: ${latestReceipt.scenarioName}` : 'No receipt yet. Run validation before publishing.'}
        action="Ask ConfigPilot"
        onClick={onOpen}
      />
      <RailInsight
        tone="success"
        title="Insight"
        body="Package changes stay draft-only until Release publishes explicitly."
        action="View context"
        onClick={onOpen}
      />
    </aside>
  )
}

function executionModeLabel(mode: ScenarioReceipt['executionMode']): string {
  return mode === 'agentRuntime' ? 'Runtime-backed' : 'Fixture-only'
}

function RailInsight({ tone, title, body, action, onClick }: { tone: 'warning' | 'info' | 'success'; title: string; body: string; action: string; onClick: () => void }) {
  const toneStyles = tone === 'warning'
    ? 'text-[var(--color-signal-warning)]'
    : tone === 'success'
      ? 'text-[var(--color-signal-success)]'
      : 'text-[var(--color-accent-primary)]'
  return (
    <section className="mt-5 rounded-[var(--radius-panel)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4">
      <p className={`flex items-center gap-2 text-[13px] font-semibold ${toneStyles}`}>
        <span className="flex h-5 w-5 items-center justify-center rounded-full border border-current text-[11px]">i</span>
        {title}
      </p>
      <p className="mt-4 text-[13px] font-medium leading-6 text-[var(--color-text-primary)]">{body}</p>
      <button type="button" onClick={onClick} className="intera-q2-button mt-5 inline-flex h-9 items-center gap-2 border border-[var(--color-border-subtle)] bg-white px-3 text-[12px] font-semibold text-[var(--color-text-primary)]">
        {action}
        <span aria-hidden>›</span>
      </button>
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
    <button type="button" disabled={busy || disabled} onClick={onClick} className="intera-q2-button inline-flex min-h-[42px] items-center justify-center gap-2 border border-[var(--color-border-subtle)] bg-white/80 px-3 py-2 text-[12px] font-medium text-[var(--color-text-primary)] shadow-sm transition hover:border-[var(--color-accent-primary)]/40 disabled:cursor-not-allowed disabled:opacity-45">
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
