'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  FileDown,
  GitCompare,
  Loader2,
  PackageOpen,
  RotateCcw,
  SendHorizontal,
  Upload,
  X,
} from 'lucide-react'
import ConfigDiffViewer, { type ConfigDiffGroup, type ConfigDiffItem } from '@/components/config-diff/config-diff-viewer'
import { OrganicLoader, TokenStreamPreview } from '@/components/config-pilot/ai-motion'
import { useAgentContext } from '@/lib/agent/agent-context'
import { MAX_AGENT_CONFIG_VERSIONS } from '@/lib/agent-config/versioning'
import type { AgentTemplateImportReport, InteraAgentTemplateV1 } from '@intera/shared/contracts/agent-template'
import type { ScenarioReceipt, ScenarioValidationSummary } from '@intera/shared/contracts/scenarios'

type VersionRole = 'live' | 'draft' | 'historical'

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

interface PendingPackageImport {
  fileName: string
  template: InteraAgentTemplateV1
  report: AgentTemplateImportReport
}

interface VersionValidationSnapshot {
  label: string
  detail: string
  meta: string
  tone: 'success' | 'warning' | 'danger' | 'neutral'
}

interface ReleaseData {
  configs: AgentVersion[]
  family: AgentVersion[]
  current: AgentVersion | null
  live: AgentVersion | null
  draft: AgentVersion | null
  history: AgentVersion[]
  scenariosById: Record<string, ScenarioListResponse | null>
  scenarioErrors: Record<string, string>
  templates: Record<string, InteraAgentTemplateV1 | null>
  templateErrors: Record<string, string>
}

const EMPTY_RELEASE_DATA: ReleaseData = {
  configs: [],
  family: [],
  current: null,
  live: null,
  draft: null,
  history: [],
  scenariosById: {},
  scenarioErrors: {},
  templates: {},
  templateErrors: {},
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
  scenarios: {
    title: 'Scenarios',
    description: 'Portable Scenario definitions for fixture and runtime-backed validation.',
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

function buildDiffGroups(liveTemplate: InteraAgentTemplateV1 | null, selectedTemplate: InteraAgentTemplateV1 | null): ConfigDiffGroup[] {
  const brainBefore = liveTemplate?.agent ? [{ key: 'brain', ...liveTemplate.agent }] : []
  const brainAfter = selectedTemplate?.agent ? [{ key: 'brain', ...selectedTemplate.agent }] : []
  const hookRowsBefore = [
    ...(liveTemplate?.hooks ?? []).map((hook) => ({ kind: 'Hook', key: `hook:${hook.name}`, ...hook })),
    ...(liveTemplate?.hookBindings ?? []).map((binding) => ({ kind: 'Binding', key: `binding:${binding.hookName}:${binding.scopeKey}`, ...binding })),
  ]
  const hookRowsAfter = [
    ...(selectedTemplate?.hooks ?? []).map((hook) => ({ kind: 'Hook', key: `hook:${hook.name}`, ...hook })),
    ...(selectedTemplate?.hookBindings ?? []).map((binding) => ({ kind: 'Binding', key: `binding:${binding.hookName}:${binding.scopeKey}`, ...binding })),
  ]
  const scenarioRowsBefore = scenarioRows(liveTemplate)
  const scenarioRowsAfter = scenarioRows(selectedTemplate)

  return [
    makeGroup('brain', diffCollection(brainBefore, brainAfter, (item) => item.key, () => 'Agent Brain settings', (item) => typeof item.model === 'string' ? `Model ${item.model}` : undefined)),
    makeGroup('procedures', diffCollection(liveTemplate?.caseTypes ?? [], selectedTemplate?.caseTypes ?? [], (item) => item.type, (item) => item.displayName || item.type, (item) => `${item.type} · ${item.procedure?.steps?.length ?? 0} steps`)),
    makeGroup('tools', diffCollection(liveTemplate?.tools ?? [], selectedTemplate?.tools ?? [], (item) => item.name, (item) => item.name, (item) => `${item.mode}${item.enabled === false ? ' · disabled' : ''}`)),
    makeGroup('hooks', diffCollection(hookRowsBefore, hookRowsAfter, (item) => item.key, (item) => `${item.kind}: ${'name' in item ? item.name : item.hookName}`, (item) => 'checkpoint' in item ? String(item.checkpoint) : String(item.scopeType))),
    makeGroup('scenarios', diffCollection(scenarioRowsBefore, scenarioRowsAfter, (item) => item.name, (item) => item.displayName || item.name, (item) => `${item.turns?.length ?? 0} turns`)),
    makeGroup('knowledge', diffCollection(liveTemplate?.knowledgeRefs ?? [], selectedTemplate?.knowledgeRefs ?? [], (item) => item.name, (item) => item.name, (item) => `${item.provider}${item.status ? ` · ${item.status}` : ''}`)),
    makeGroup('integrations', diffCollection(liveTemplate?.integrationRefs ?? [], selectedTemplate?.integrationRefs ?? [], (item) => item.channel, (item) => item.name || item.channel, (item) => `${item.provider ?? item.channel}${item.status ? ` · ${item.status}` : ''}`)),
  ]
}

function scenarioRows(template: InteraAgentTemplateV1 | null) {
  return template?.scenarioDefinitions?.length ? template.scenarioDefinitions : template?.scenarios ?? []
}

function packageCoverageRows(template: InteraAgentTemplateV1 | null) {
  const scenarios = scenarioRows(template)
  return [
    { label: 'Brain', value: template?.agent ? 1 : 0 },
    { label: 'Procedures', value: template?.caseTypes.filter((item) => item.procedure).length ?? 0 },
    { label: 'Tools', value: template?.tools.length ?? 0 },
    { label: 'Hooks', value: template?.hooks.length ?? 0 },
    { label: 'HookBindings', value: template?.hookBindings.length ?? 0 },
    { label: 'Scenarios', value: scenarios.length },
    { label: 'Knowledge', value: template?.knowledgeRefs.length ?? 0 },
    { label: 'Integrations', value: template?.integrationRefs.length ?? 0 },
    { label: 'Required secrets', value: template?.requiredSecrets.length ?? template?.secrets?.length ?? 0 },
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

function versionRoleFor(config: AgentVersion | null, liveId: string | null, draftId: string | null): VersionRole | null {
  if (!config) return null
  if (config.id === liveId) return 'live'
  if (config.id === draftId) return 'draft'
  return 'historical'
}

function roleLabel(role: VersionRole) {
  if (role === 'live') return 'Live'
  if (role === 'draft') return 'Draft'
  return 'Historical'
}

function roleTone(role: VersionRole): 'success' | 'warning' | 'neutral' {
  if (role === 'live') return 'success'
  if (role === 'draft') return 'warning'
  return 'neutral'
}

function roleSubtitle(role: VersionRole) {
  if (role === 'live') return 'Customer channels are currently using this version.'
  if (role === 'draft') return 'Edits stay isolated until Publish is confirmed explicitly.'
  return 'Frozen reference version for rollback review or draft forking.'
}

function executionModeLabel(mode: ScenarioReceipt['executionMode'] | undefined): string {
  return mode === 'agentRuntime' ? 'Runtime-backed' : 'Fixture-only'
}

function buildValidationSnapshot(
  validation: ScenarioValidationSummary | undefined,
  latestReceipt: ScenarioReceipt | null,
  error?: string | null,
): VersionValidationSnapshot {
  if (error) {
    return {
      label: 'Validation unavailable',
      detail: error,
      meta: 'Release can still show version history, but evidence failed to load.',
      tone: 'danger',
    }
  }
  if (!validation) {
    return {
      label: 'Not validated',
      detail: 'No Scenario receipt is recorded for this version.',
      meta: 'Publish requires an override reason until fresh validation exists.',
      tone: 'warning',
    }
  }
  if (validation.runtimeValidated) {
    return {
      label: 'Runtime validated',
      detail: `Runtime receipt recorded ${formatDate(validation.runtimeValidatedAt ?? validation.lastValidatedAt)}`,
      meta: latestReceipt ? `${executionModeLabel(latestReceipt.executionMode)} receipt ${latestReceipt.status} · ${latestReceipt.scenarioName}` : 'Runtime-backed validation is available.',
      tone: 'success',
    }
  }
  if (validation.state === 'Validated') {
    return {
      label: latestReceipt?.executionMode === 'fixture' ? 'Fixture-only validated' : 'Validated',
      detail: latestReceipt?.executionMode === 'fixture' ? 'Latest receipt is fixture-only' : `Validated ${formatDate(validation.lastValidatedAt)}`,
      meta: latestReceipt ? `${executionModeLabel(latestReceipt.executionMode)} receipt ${latestReceipt.status}` : 'Validation exists but no receipt summary loaded.',
      tone: latestReceipt?.executionMode === 'fixture' ? 'warning' : 'success',
    }
  }
  if (validation.state === 'Changed since last validation') {
    return {
      label: validation.state,
      detail: `Draft changed after ${formatDate(validation.lastValidatedAt, 'the last validation run')}`,
      meta: latestReceipt ? `${executionModeLabel(latestReceipt.executionMode)} receipt ${latestReceipt.status} · override required before publish` : 'Override required before publish.',
      tone: 'warning',
    }
  }
  if (validation.state === 'Validation failed') {
    return {
      label: validation.state,
      detail: latestReceipt ? `${executionModeLabel(latestReceipt.executionMode)} receipt failed` : 'The latest validation did not pass.',
      meta: 'Publish is still possible, but an override reason is required.',
      tone: 'danger',
    }
  }
  return {
    label: validation.state ?? 'Not validated',
    detail: 'No fresh validation summary is available.',
    meta: latestReceipt ? `${executionModeLabel(latestReceipt.executionMode)} receipt ${latestReceipt.status}` : 'Run Pilot Lab before publish.',
    tone: validationTone(validation.state),
  }
}

function summarizeDiffGroups(groups: ConfigDiffGroup[]) {
  return groups.reduce(
    (summary, group) => {
      const changedRows = group.items.filter((item) => item.status !== 'unchanged').length
      if (changedRows > 0) {
        summary.changedGroups += 1
        summary.changedRows += changedRows
      }
      return summary
    },
    { changedGroups: 0, changedRows: 0 },
  )
}

function describeDiffSummary(liveTemplate: InteraAgentTemplateV1 | null, versionTemplate: InteraAgentTemplateV1 | null, role: VersionRole) {
  if (role === 'live') return 'Current live baseline'
  if (!liveTemplate || !versionTemplate) return 'Template diff preview unavailable'
  const summary = summarizeDiffGroups(buildDiffGroups(liveTemplate, versionTemplate))
  if (summary.changedRows === 0) return 'No material changes vs live'
  return `${summary.changedRows} changed rows across ${summary.changedGroups} groups vs live`
}

function parentVersionFor(config: AgentVersion, family: AgentVersion[]) {
  return family.find((item) => item.id === config.parentId)?.version ?? null
}

function selectedTitle(config: AgentVersion | null, role: VersionRole | null) {
  if (!config || !role) return 'Selected version'
  return `Selected ${roleLabel(role).toLowerCase()} version`
}

function actionHintsForRole(role: VersionRole) {
  if (role === 'live') return ['Export selected package', 'Create editable draft']
  if (role === 'draft') return ['Publish selected version', 'Export selected package', 'Create editable draft']
  return ['Preview rollback', 'Create editable draft', 'Export selected package']
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
  const [pendingImport, setPendingImport] = useState<PendingPackageImport | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  const reload = useCallback(() => setReloadKey((key) => key + 1), [])
  const openPilotLab = useCallback(() => {
    window.location.assign('/build/pilot-lab')
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
        const draft = [...family].filter((config) => !config.isActive).sort((a, b) => b.version - a.version)[0] ?? null
        const history = family.filter((config) => config.id !== live?.id && config.id !== draft?.id).sort((a, b) => b.version - a.version)
        const versionIds = family.map((config) => config.id)

        const templates: Record<string, InteraAgentTemplateV1 | null> = {}
        const templateErrors: Record<string, string> = {}
        const scenariosById: Record<string, ScenarioListResponse | null> = {}
        const scenarioErrors: Record<string, string> = {}

        await Promise.all(versionIds.map(async (id) => {
          const [scenarioResult, templateResult] = await Promise.all([
            readJson<ScenarioListResponse>(`/api/admin/scenarios?agentConfigId=${encodeURIComponent(id)}`)
              .then((scenarios) => ({ scenarios, error: null as string | null }))
              .catch((err: Error) => ({ scenarios: null, error: err.message })),
            fetchTemplate(id)
              .then((template) => ({ template, error: null as string | null }))
              .catch((err: Error) => ({ template: null, error: err.message })),
          ])

          scenariosById[id] = scenarioResult.scenarios
          if (scenarioResult.error) scenarioErrors[id] = scenarioResult.error

          templates[id] = templateResult.template
          if (templateResult.error) templateErrors[id] = templateResult.error
        }))

        if (!cancelled) {
          setData({
            configs,
            family,
            current,
            live,
            draft,
            history,
            scenariosById,
            scenarioErrors,
            templates,
            templateErrors,
          })
          setReleaseNote(current?.releaseNote ?? '')
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

  const selectedVersion = data.current
  const selectedRole = versionRoleFor(selectedVersion, data.live?.id ?? null, data.draft?.id ?? null)
  const selectedScenarioData = selectedVersion ? data.scenariosById[selectedVersion.id] ?? null : null
  const selectedScenarioError = selectedVersion ? data.scenarioErrors[selectedVersion.id] ?? null : null
  const selectedValidation = selectedScenarioData?.validation
  const selectedReceipt = useMemo(() => pickLatestReceipt(selectedScenarioData?.receipts ?? []), [selectedScenarioData?.receipts])
  const selectedValidationSnapshot = buildValidationSnapshot(selectedValidation, selectedReceipt, selectedScenarioError)
  const liveTemplate = data.live ? data.templates[data.live.id] ?? null : null
  const selectedTemplate = selectedVersion ? data.templates[selectedVersion.id] ?? null : null
  const diffGroups = useMemo(() => buildDiffGroups(liveTemplate, selectedTemplate), [liveTemplate, selectedTemplate])
  const diffSummary = useMemo(() => summarizeDiffGroups(diffGroups), [diffGroups])
  const rollbackTarget = selectedVersion && data.live && selectedVersion.id !== data.live.id ? selectedVersion : null
  const rollbackTemplate = rollbackTarget ? data.templates[rollbackTarget.id] ?? null : null
  const rollbackGroups = useMemo(() => (rollbackTarget ? buildDiffGroups(liveTemplate, rollbackTemplate) : []), [liveTemplate, rollbackTarget, rollbackTemplate])
  const canPublish = Boolean(selectedVersion && !selectedVersion.isActive)
  const overrideRequired = canPublish ? (selectedValidation?.overrideRequired ?? true) : false
  const publishDisabledReason = selectedVersion?.isActive
    ? 'Select the draft or a historical version from the timeline before publishing.'
    : null

  async function handleExport() {
    const target = selectedVersion ?? data.draft ?? data.live
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
      const result = await readJson<{ dryRun: true; report: AgentTemplateImportReport }>('/api/admin/agent-templates/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template,
          parentAgentConfigId: selectedVersion?.id,
          dryRun: true,
          strategy: 'createDraft',
        }),
      })
      setPendingImport({ fileName: file.name, template, report: result.report })
      setNotice(`Package dry-run completed for ${file.name}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import dry-run failed')
    } finally {
      setBusyAction(null)
      if (importInputRef.current) importInputRef.current.value = ''
    }
  }

  async function handleConfirmImport() {
    if (!pendingImport) return
    setBusyAction('import-apply')
    setNotice(null)
    setError(null)
    try {
      const result = await readJson<{ config: AgentVersion; imported?: Record<string, number>; warnings?: string[] }>('/api/admin/agent-templates/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template: pendingImport.template,
          parentAgentConfigId: selectedVersion?.id,
          strategy: 'createDraft',
        }),
      })
      await refreshConfigs()
      if (result.config?.id) selectAgent(result.config.id)
      setPendingImport(null)
      setNotice(`Imported ${result.config?.name ?? pendingImport.fileName} as a draft package`)
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setBusyAction(null)
    }
  }

  async function handleDuplicate() {
    const target = selectedVersion ?? data.live
    if (!target) return
    setBusyAction('duplicate')
    setNotice(null)
    setError(null)
    try {
      const result = await readJson<{ config: AgentVersion }>(`/api/admin/agent-configs/${encodeURIComponent(target.id)}/fork`, { method: 'POST' })
      await refreshConfigs()
      if (result.config?.id) selectAgent(result.config.id)
      setNotice(`Created editable draft v${result.config.version} from ${target.name} v${target.version}`)
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Duplicate failed')
    } finally {
      setBusyAction(null)
    }
  }

  async function handlePublish() {
    const target = selectedVersion
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

  if (loadError || (error && !data.current)) {
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
            <h1 className="text-[30px] font-semibold leading-[1.08] text-[var(--color-text-primary)] sm:text-[34px]">{selectedVersion?.name ?? data.live?.name ?? 'Agent'}</h1>
            {selectedRole ? (
              <span className={`rounded-[var(--radius-control)] border px-2.5 py-1 text-[12px] font-semibold ${toneClass(roleTone(selectedRole))}`}>
                Viewing {roleLabel(selectedRole)} version
              </span>
            ) : null}
          </div>
          <p className="mt-2 max-w-3xl text-[15px] leading-6 text-[var(--color-text-secondary)]">Understand the Agent family timeline, validation evidence, and package actions before you publish.</p>
        </div>

        <label className="intera-q2-button flex min-h-11 items-center gap-3 border border-[var(--color-border-subtle)] bg-white px-4 text-[13px] shadow-[0_1px_2px_rgba(21,23,25,0.04)]">
          <span className="text-[var(--color-text-tertiary)]">Selected version</span>
          <select
            aria-label="Release agent version"
            value={selectedVersion?.id ?? ''}
            onChange={(event) => selectAgent(event.target.value)}
            className="min-w-[210px] bg-transparent text-[13px] font-semibold text-[var(--color-text-primary)] outline-none"
          >
            {data.family.map((config) => {
              const role = versionRoleFor(config, data.live?.id ?? null, data.draft?.id ?? null)
              return (
                <option key={config.id} value={config.id}>
                  {config.name} v{config.version}{role ? ` · ${roleLabel(role)}` : ''}
                </option>
              )
            })}
          </select>
        </label>
      </div>

      {(notice || error) ? (
        <div className={`mb-4 rounded-[var(--radius-control)] border px-4 py-3 text-[13px] ${error ? toneClass('danger') : toneClass('success')}`}>{error || notice}</div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <VersionTimelineSection
            currentId={selectedVersion?.id ?? null}
            draftId={data.draft?.id ?? null}
            family={data.family}
            history={data.history}
            liveId={data.live?.id ?? null}
            liveTemplate={liveTemplate}
            scenariosById={data.scenariosById}
            scenarioErrors={data.scenarioErrors}
            templates={data.templates}
            onSelectVersion={selectAgent}
          />

          <div className="grid gap-4 2xl:grid-cols-[minmax(340px,0.78fr)_minmax(0,1.22fr)]">
            <SelectedVersionCard
              config={selectedVersion}
              role={selectedRole}
              family={data.family}
              diffSummary={diffSummary}
              validationSnapshot={selectedValidationSnapshot}
            />
            <SelectedReceiptCard
              config={selectedVersion}
              latestReceipt={selectedReceipt}
              validationSnapshot={selectedValidationSnapshot}
              validation={selectedValidation}
            />
          </div>

          <ConfigDiffViewer
            title="Changed since live"
            subtitle={selectedVersion && data.live
              ? `${data.live.name} v${data.live.version} compared with selected v${selectedVersion.version}.`
              : 'Select a version in the timeline to compare it with live.'}
            groups={diffGroups}
          />

          <PackageActionsPanel
            busyAction={busyAction}
            canPublish={canPublish}
            coverageTemplate={selectedTemplate}
            current={selectedVersion}
            importInputRef={importInputRef}
            pendingImport={pendingImport}
            publishDisabledReason={publishDisabledReason}
            rollbackTarget={rollbackTarget}
            role={selectedRole}
            onClearImport={() => setPendingImport(null)}
            onConfirmImport={handleConfirmImport}
            onDuplicate={handleDuplicate}
            onExport={handleExport}
            onImport={(file) => handleImport(file)}
            onImportClick={() => importInputRef.current?.click()}
            onPublish={() => setPublishOpen(true)}
            onRollback={() => setRollbackOpen(true)}
          />
        </div>

        <ReleaseConfigPilotRail
          current={selectedVersion}
          role={selectedRole}
          validation={selectedValidation}
          validationSnapshot={selectedValidationSnapshot}
          latestReceipt={selectedReceipt}
          onOpen={openPilotLab}
        />
      </div>

      {Object.keys(data.templateErrors).length > 0 ? (
        <section className="mt-4 rounded-[var(--radius-control)] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-bg-surface-muted)] px-4 py-3 text-[12px] text-[var(--color-text-secondary)]">
          Template previews are isolated because export failed for: {Object.entries(data.templateErrors).map(([id, message]) => `${id} (${message})`).join(', ')}
        </section>
      ) : null}

      {publishOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20 px-4 backdrop-blur-sm">
          <section role="dialog" aria-label="Publish version" className="w-full max-w-lg rounded-[var(--radius-panel)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-tertiary)]">Explicit publish</p>
                <h2 className="mt-1 text-[18px] font-semibold text-[var(--color-text-primary)]">
                  Publish {selectedVersion?.name} v{selectedVersion?.version}
                </h2>
                <p className="mt-1 text-[13px] leading-5 text-[var(--color-text-secondary)]">
                  {selectedRole === 'historical'
                    ? 'This reactivates the selected historical version. Rollback preview stays read-only until you confirm publish.'
                    : 'This activates the selected non-live version for customer channels. Draft save and import actions remain isolated until publish.'}
                </p>
              </div>
              <button type="button" aria-label="Close publish dialog" onClick={() => setPublishOpen(false)} className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white p-2 text-[var(--color-text-tertiary)]">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className={`mt-5 rounded-[var(--radius-control)] border px-4 py-3 text-[12px] ${toneClass(selectedValidationSnapshot.tone)}`}>
              <p className="font-semibold text-[var(--color-text-primary)]">{selectedValidationSnapshot.label}</p>
              <p className="mt-1 text-[var(--color-text-secondary)]">{selectedValidationSnapshot.detail}</p>
              <p className="mt-1 text-[var(--color-text-tertiary)]">{selectedValidationSnapshot.meta}</p>
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
          <p className="text-[13px] leading-5 text-[var(--color-text-secondary)]">
            Preview how live v{data.live?.version ?? '?'} differs from {rollbackTarget ? `selected v${rollbackTarget.version}` : 'a non-live version'} before any mutation. This drawer never activates rollback by itself.
          </p>
          {rollbackTarget ? (
            <div className="mt-4 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white/70 px-4 py-3 text-[12px] text-[var(--color-text-secondary)]">
              Candidate: <span className="font-semibold text-[var(--color-text-primary)]">{rollbackTarget.name} v{rollbackTarget.version}</span>
              <span className="ml-3 text-[var(--color-text-tertiary)]">If you want to reactivate it, close this preview and use Publish explicitly.</span>
            </div>
          ) : (
            <div className="mt-4 rounded-[var(--radius-control)] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-bg-surface-muted)] px-4 py-3 text-[12px] text-[var(--color-text-secondary)]">
              Select a draft or historical version from the timeline first.
            </div>
          )}
          <div className="mt-4">
            <ConfigDiffViewer title="Rollback diff preview" subtitle="Live version compared with the selected non-live version." groups={rollbackGroups} />
          </div>
        </LightDrawer>
      ) : null}
    </main>
  )
}

function VersionTimelineSection({
  family,
  history,
  liveId,
  draftId,
  currentId,
  scenariosById,
  scenarioErrors,
  templates,
  liveTemplate,
  onSelectVersion,
}: {
  family: AgentVersion[]
  history: AgentVersion[]
  liveId: string | null
  draftId: string | null
  currentId: string | null
  scenariosById: Record<string, ScenarioListResponse | null>
  scenarioErrors: Record<string, string>
  templates: Record<string, InteraAgentTemplateV1 | null>
  liveTemplate: InteraAgentTemplateV1 | null
  onSelectVersion: (id: string) => void
}) {
  const live = family.find((config) => config.id === liveId) ?? null
  const draft = family.find((config) => config.id === draftId) ?? null
  const retainedRatio = family.length / MAX_AGENT_CONFIG_VERSIONS

  return (
    <section className="intera-q2-panel overflow-hidden">
      <div className="border-b border-[var(--color-border-subtle)] px-5 py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-tertiary)]">Version control UX</p>
            <h2 className="mt-1 text-[18px] font-semibold text-[var(--color-text-primary)]">Agent version timeline</h2>
            <p className="mt-2 max-w-3xl text-[13px] leading-6 text-[var(--color-text-secondary)]">
              One Agent family timeline: one live version, one editable draft, and retained historical versions for rollback review.
            </p>
          </div>

          <div className="min-w-[240px] rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white/70 px-4 py-3">
            <div className="flex items-center justify-between gap-3 text-[12px] font-semibold text-[var(--color-text-primary)]">
              <span>{family.length} of {MAX_AGENT_CONFIG_VERSIONS} retained</span>
              <span className="text-[var(--color-text-tertiary)]">{Math.max(MAX_AGENT_CONFIG_VERSIONS - family.length, 0)} slots left</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--color-bg-surface-muted)]">
              <div className="h-full rounded-full bg-[var(--color-accent-primary)]" style={{ width: `${Math.min(retainedRatio, 1) * 100}%` }} />
            </div>
            <p className="mt-3 text-[12px] leading-5 text-[var(--color-text-secondary)]">
              P0 keeps at most {MAX_AGENT_CONFIG_VERSIONS} retained versions in one family so publish, rollback preview, and package diff stay readable. When the family is full, duplicate and import-to-draft stop until older history is retired intentionally.
            </p>
          </div>
        </div>
      </div>

      <div className="divide-y divide-[var(--color-border-subtle)]">
        <TimelineGroup
          title="Live version"
          empty="No live version is currently active."
          versions={live ? [live] : []}
          family={family}
          currentId={currentId}
          liveId={liveId}
          draftId={draftId}
          scenariosById={scenariosById}
          scenarioErrors={scenarioErrors}
          templates={templates}
          liveTemplate={liveTemplate}
          onSelectVersion={onSelectVersion}
        />
        <TimelineGroup
          title="Draft version"
          empty="No editable draft exists yet. Create editable draft from live or a historical version."
          versions={draft ? [draft] : []}
          family={family}
          currentId={currentId}
          liveId={liveId}
          draftId={draftId}
          scenariosById={scenariosById}
          scenarioErrors={scenarioErrors}
          templates={templates}
          liveTemplate={liveTemplate}
          onSelectVersion={onSelectVersion}
        />
        <TimelineGroup
          title="Historical versions"
          empty="No historical versions retained yet."
          versions={history}
          family={family}
          currentId={currentId}
          liveId={liveId}
          draftId={draftId}
          scenariosById={scenariosById}
          scenarioErrors={scenarioErrors}
          templates={templates}
          liveTemplate={liveTemplate}
          onSelectVersion={onSelectVersion}
        />
      </div>
    </section>
  )
}

function TimelineGroup({
  title,
  empty,
  versions,
  family,
  currentId,
  liveId,
  draftId,
  scenariosById,
  scenarioErrors,
  templates,
  liveTemplate,
  onSelectVersion,
}: {
  title: string
  empty: string
  versions: AgentVersion[]
  family: AgentVersion[]
  currentId: string | null
  liveId: string | null
  draftId: string | null
  scenariosById: Record<string, ScenarioListResponse | null>
  scenarioErrors: Record<string, string>
  templates: Record<string, InteraAgentTemplateV1 | null>
  liveTemplate: InteraAgentTemplateV1 | null
  onSelectVersion: (id: string) => void
}) {
  return (
    <div>
      <div className="bg-[var(--color-bg-surface-muted)] px-5 py-3">
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">{title}</p>
      </div>
      {versions.length > 0 ? (
        <div className="divide-y divide-[var(--color-border-subtle)]">
          {versions.map((config) => {
            const role = versionRoleFor(config, liveId, draftId) as VersionRole
            const latestReceipt = pickLatestReceipt(scenariosById[config.id]?.receipts ?? [])
            const validationSnapshot = buildValidationSnapshot(scenariosById[config.id]?.validation, latestReceipt, scenarioErrors[config.id] ?? null)
            const diffLabel = describeDiffSummary(liveTemplate, templates[config.id] ?? null, role)
            return (
              <VersionTimelineRow
                key={config.id}
                config={config}
                current={config.id === currentId}
                diffLabel={diffLabel}
                family={family}
                role={role}
                validationSnapshot={validationSnapshot}
                onSelectVersion={onSelectVersion}
              />
            )
          })}
        </div>
      ) : (
        <div className="px-5 py-4 text-[13px] text-[var(--color-text-secondary)]">{empty}</div>
      )}
    </div>
  )
}

function VersionTimelineRow({
  config,
  current,
  diffLabel,
  family,
  role,
  validationSnapshot,
  onSelectVersion,
}: {
  config: AgentVersion
  current: boolean
  diffLabel: string
  family: AgentVersion[]
  role: VersionRole
  validationSnapshot: VersionValidationSnapshot
  onSelectVersion: (id: string) => void
}) {
  const parentVersion = parentVersionFor(config, family)

  return (
    <article className={`grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.95fr)_minmax(0,1.05fr)_160px] ${current ? 'bg-[color:color-mix(in_srgb,var(--color-accent-primary)_4%,white)]' : 'bg-white/80'}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-[var(--radius-control)] border px-2.5 py-1 text-[11px] font-semibold ${toneClass(roleTone(role))}`}>{roleLabel(role)}</span>
          {current ? <span className="rounded-[var(--radius-control)] border border-[rgba(53,127,124,0.24)] bg-[rgba(53,127,124,0.08)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-accent-primary)]">Selected</span> : null}
        </div>
        <h3 className="mt-3 text-[16px] font-semibold text-[var(--color-text-primary)]">v{config.version}</h3>
        <p className="mt-1 text-[12px] leading-5 text-[var(--color-text-secondary)]">{roleSubtitle(role)}</p>
        <div className="mt-3 space-y-1 text-[12px] text-[var(--color-text-tertiary)]">
          <p>{config.publishedAt ? `Published ${formatDate(config.publishedAt)}` : 'Not published yet'}</p>
          <p>{config.publishedBy ? `Published by ${config.publishedBy}` : 'Publisher unavailable'}</p>
          <p>Last edited {formatDate(config.updatedAt)}</p>
        </div>
      </div>

      <div className="min-w-0">
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">Validation</p>
        <div className={`mt-3 rounded-[var(--radius-control)] border px-3 py-3 text-[12px] ${toneClass(validationSnapshot.tone)}`}>
          <p className="font-semibold text-[var(--color-text-primary)]">{validationSnapshot.label}</p>
          <p className="mt-1 text-[var(--color-text-secondary)]">{validationSnapshot.detail}</p>
          <p className="mt-2 text-[var(--color-text-tertiary)]">{validationSnapshot.meta}</p>
        </div>
      </div>

      <div className="min-w-0">
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">Lineage and actions</p>
        <div className="mt-3 space-y-2 text-[12px] leading-5 text-[var(--color-text-secondary)]">
          <p>{parentVersion ? `Forked from v${parentVersion}` : 'Original family baseline'}</p>
          <p>{diffLabel}</p>
          <div className="flex flex-wrap gap-2">
            {actionHintsForRole(role).map((label) => (
              <span key={label} className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white px-2.5 py-1 text-[11px] font-medium text-[var(--color-text-secondary)]">
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-start justify-start lg:justify-end">
        <button
          type="button"
          onClick={() => onSelectVersion(config.id)}
          disabled={current}
          className="intera-q2-button inline-flex min-h-[40px] items-center justify-center border border-[var(--color-border-subtle)] bg-white px-3 py-2 text-[12px] font-semibold text-[var(--color-text-primary)] disabled:cursor-default disabled:opacity-55"
        >
          {current ? 'Viewing' : 'View version'}
        </button>
      </div>
    </article>
  )
}

function SelectedVersionCard({
  config,
  role,
  family,
  diffSummary,
  validationSnapshot,
}: {
  config: AgentVersion | null
  role: VersionRole | null
  family: AgentVersion[]
  diffSummary: { changedGroups: number; changedRows: number }
  validationSnapshot: VersionValidationSnapshot
}) {
  const parentVersion = config ? parentVersionFor(config, family) : null
  const diffLabel = !config || !role
    ? 'No version selected.'
    : role === 'live'
      ? 'Live baseline'
      : diffSummary.changedRows > 0
        ? `${diffSummary.changedRows} changed rows across ${diffSummary.changedGroups} groups vs live`
        : 'No material changes vs live'

  return (
    <section className="intera-q2-panel overflow-hidden">
      <div className="border-b border-[var(--color-border-subtle)] px-5 py-4">
        <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)]">{selectedTitle(config, role)}</h2>
      </div>

      {config && role ? (
        <div className="space-y-5 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-[var(--radius-control)] border px-2.5 py-1 text-[11px] font-semibold ${toneClass(roleTone(role))}`}>{roleLabel(role)}</span>
            {config.model ? <span className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white/80 px-2.5 py-1 text-[11px] text-[var(--color-text-secondary)]">{config.model}</span> : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <InfoCard label="Lineage" value={parentVersion ? `Forked from v${parentVersion}` : 'Original family baseline'} />
            <InfoCard label="Updated" value={formatDate(config.updatedAt)} />
            <InfoCard label="Published" value={formatDate(config.publishedAt, 'Not published')} />
            <InfoCard label="Publisher" value={config.publishedBy || 'Unavailable'} />
          </div>

          <div className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white/70 p-4">
            <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
              <GitCompare className="h-4 w-4 text-[var(--color-accent-primary)]" />
              Changed since live
            </p>
            <p className="mt-3 text-[14px] font-semibold text-[var(--color-text-primary)]">{diffLabel}</p>
            <p className="mt-2 text-[12px] leading-5 text-[var(--color-text-secondary)]">{roleSubtitle(role)}</p>
          </div>

          <div className={`rounded-[var(--radius-control)] border px-4 py-3 text-[12px] ${toneClass(validationSnapshot.tone)}`}>
            <p className="font-semibold text-[var(--color-text-primary)]">{validationSnapshot.label}</p>
            <p className="mt-1 text-[var(--color-text-secondary)]">{validationSnapshot.detail}</p>
            <p className="mt-1 text-[var(--color-text-tertiary)]">{validationSnapshot.meta}</p>
          </div>

          {config.releaseNote ? (
            <div className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface-muted)] px-4 py-3">
              <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">Release note</p>
              <p className="mt-2 text-[13px] leading-6 text-[var(--color-text-secondary)]">{config.releaseNote}</p>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="p-5 text-[13px] text-[var(--color-text-secondary)]">Select a version in the timeline to inspect validation and diff context.</div>
      )}
    </section>
  )
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white/75 px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">{label}</p>
      <p className="mt-2 text-[13px] font-medium text-[var(--color-text-primary)]">{value}</p>
    </div>
  )
}

function SelectedReceiptCard({
  config,
  latestReceipt,
  validationSnapshot,
  validation,
}: {
  config: AgentVersion | null
  latestReceipt: ScenarioReceipt | null
  validationSnapshot: VersionValidationSnapshot
  validation: ScenarioValidationSummary | undefined
}) {
  return (
    <section className="intera-q2-panel overflow-hidden">
      <div className="border-b border-[var(--color-border-subtle)] px-5 py-4">
        <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)]">Validation evidence</h2>
      </div>

      <div className="p-5">
        <div className={`rounded-[var(--radius-control)] border px-4 py-3 text-[12px] ${toneClass(validationSnapshot.tone)}`}>
          <p className="font-semibold text-[var(--color-text-primary)]">{validationSnapshot.label}</p>
          <p className="mt-1 text-[var(--color-text-secondary)]">{validationSnapshot.detail}</p>
          <p className="mt-1 text-[var(--color-text-tertiary)]">{validationSnapshot.meta}</p>
        </div>

        {latestReceipt ? (
          <>
            <div className="mt-5 flex flex-wrap items-start justify-between gap-3">
              <div>
                <span className={`inline-flex rounded-[var(--radius-control)] border px-2.5 py-1 text-[12px] font-semibold capitalize ${toneClass(receiptTone(latestReceipt.status))}`}>{latestReceipt.status}</span>
                <h3 className="mt-4 text-[14px] font-semibold text-[var(--color-text-primary)]">{latestReceipt.scenarioName}</h3>
                <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">{executionModeLabel(latestReceipt.executionMode)} · Run {formatDate(latestReceipt.completedAt ?? latestReceipt.finishedAt ?? latestReceipt.startedAt)}</p>
              </div>
              {config ? <span className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white px-2.5 py-1 text-[11px] font-medium text-[var(--color-text-secondary)]">v{config.version}</span> : null}
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

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <InfoCard label="Receipt type" value={executionModeLabel(latestReceipt.executionMode)} />
              <InfoCard label="Runtime-backed" value={validation?.runtimeValidated ? 'Yes' : 'No'} />
            </div>
          </>
        ) : (
          <p className="mt-5 rounded-[var(--radius-control)] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-bg-surface-muted)] px-4 py-3 text-[12px] leading-5 text-[var(--color-text-secondary)]">
            No Scenario receipt has been recorded for this selected version yet. Run Pilot Lab validation before publishing or provide an override reason.
          </p>
        )}
      </div>
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
  coverageTemplate,
  current,
  importInputRef,
  pendingImport,
  publishDisabledReason,
  rollbackTarget,
  role,
  onClearImport,
  onConfirmImport,
  onDuplicate,
  onExport,
  onImport,
  onImportClick,
  onPublish,
  onRollback,
}: {
  busyAction: string | null
  canPublish: boolean
  coverageTemplate: InteraAgentTemplateV1 | null
  current: AgentVersion | null
  importInputRef: RefObject<HTMLInputElement | null>
  pendingImport: PendingPackageImport | null
  publishDisabledReason: string | null
  rollbackTarget: AgentVersion | null
  role: VersionRole | null
  onClearImport: () => void
  onConfirmImport: () => void
  onDuplicate: () => void
  onExport: () => void
  onImport: (file: File | undefined) => void
  onImportClick: () => void
  onPublish: () => void
  onRollback: () => void
}) {
  const coverage = packageCoverageRows(coverageTemplate)
  const selectedLabel = current ? `${current.name} v${current.version}` : 'No version selected'

  return (
    <section className="intera-q2-panel p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)]">Version control actions</h2>
          <p className="mt-1 text-[13px] leading-5 text-[var(--color-text-secondary)]">
            Release owns publish, rollback preview, duplicate draft creation, and package import/export for the selected version.
          </p>
        </div>
        <input ref={importInputRef} aria-label="Import .intera-agent.json file" type="file" accept="application/json,.json,.intera-agent.json" className="hidden" onChange={(event) => onImport(event.target.files?.[0])} />
      </div>

      <div className="mt-4 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface-muted)] px-4 py-3 text-[12px] leading-5 text-[var(--color-text-secondary)]">
        <p><span className="font-semibold text-[var(--color-text-primary)]">Selected:</span> {selectedLabel}{role ? ` · ${roleLabel(role)}` : ''}</p>
        <p className="mt-1">Export always downloads the currently selected package. Import always runs a dry-run first and never activates silently.</p>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-5">
        <ActionRuleCard title="Publish" body="Activates the selected non-live version only after an explicit confirmation and validation review." />
        <ActionRuleCard title="Rollback preview" body="Shows the diff from live to the selected non-live version. Preview stays read-only." />
        <ActionRuleCard title="Create editable draft" body="Forks the selected version into a new draft when the family still has retention capacity." />
        <ActionRuleCard title="Import" body="Runs a compatibility report first, then creates a draft package if you confirm apply." />
        <ActionRuleCard title="Export" body="Exports the current selected version package so the file is never ambiguous." />
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9">
        {coverage.map((item) => (
          <PackageCoverageCell key={item.label} label={item.label} value={item.value} />
        ))}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <ActionButton icon={<FileDown className="h-4 w-4" />} label="Export selected package" busy={busyAction === 'export'} onClick={onExport} />
        <ActionButton icon={<Upload className="h-4 w-4" />} label="Import package" busy={busyAction === 'import'} onClick={onImportClick} />
        <ActionButton icon={<Copy className="h-4 w-4" />} label="Create editable draft" busy={busyAction === 'duplicate'} onClick={onDuplicate} />
        <ActionButton icon={<PackageOpen className="h-4 w-4" />} label="Publish selected version" busy={busyAction === 'publish'} disabled={!canPublish} onClick={onPublish} />
        <ActionButton icon={<RotateCcw className="h-4 w-4" />} label="Rollback preview" disabled={!rollbackTarget} onClick={onRollback} />
      </div>

      {publishDisabledReason ? <p className="mt-3 text-[12px] text-[var(--color-text-tertiary)]">{publishDisabledReason}</p> : null}

      {pendingImport ? (
        <ImportDryRunReport
          busy={busyAction === 'import-apply'}
          pendingImport={pendingImport}
          onClear={onClearImport}
          onConfirm={onConfirmImport}
        />
      ) : null}
    </section>
  )
}

function ActionRuleCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white/70 px-3 py-3">
      <p className="text-[12px] font-semibold text-[var(--color-text-primary)]">{title}</p>
      <p className="mt-2 text-[12px] leading-5 text-[var(--color-text-secondary)]">{body}</p>
    </div>
  )
}

function PackageCoverageCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white/70 px-3 py-2">
      <p className="text-[11px] font-medium text-[var(--color-text-tertiary)]">{label}</p>
      <p className="mt-1 text-[18px] font-semibold text-[var(--color-text-primary)]">{value}</p>
    </div>
  )
}

function ImportDryRunReport({
  busy,
  pendingImport,
  onClear,
  onConfirm,
}: {
  busy: boolean
  pendingImport: PendingPackageImport
  onClear: () => void
  onConfirm: () => void
}) {
  const report = pendingImport.report
  return (
    <section className="mt-5 rounded-[var(--radius-panel)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface-muted)] p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-[12px] font-semibold text-[var(--color-text-tertiary)]">Import dry-run report</p>
          <h3 className="mt-1 text-[15px] font-semibold text-[var(--color-text-primary)]">{pendingImport.fileName}</h3>
          <p className="mt-1 text-[12px] text-[var(--color-text-secondary)]">{report.canImport ? 'Ready to create a draft version.' : 'Import is blocked until conflicts are resolved.'}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onClear} className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white px-3 py-2 text-[12px] text-[var(--color-text-secondary)]">Clear</button>
          <button type="button" disabled={!report.canImport || busy} onClick={onConfirm} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-[color:color-mix(in_srgb,var(--color-accent-primary)_45%,transparent)] bg-[var(--color-accent-primary)] px-3 py-2 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageOpen className="h-4 w-4" />}
            Create draft
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <ReportList title="Missing secrets" items={report.requiredSecrets.map((secret) => secret.name)} empty="No required secret placeholders." tone={report.requiredSecrets.length > 0 ? 'warning' : 'neutral'} />
        <ReportList title="Conflicts" items={report.conflicts.map((conflict) => conflict.message)} empty="No blocking conflicts." tone={report.conflicts.some((conflict) => conflict.severity === 'error') ? 'danger' : 'warning'} />
        <ReportList title="Unsupported integrations" items={report.unsupportedIntegrations.map((integration) => `${integration.channel}: ${integration.reason}`)} empty="No unsupported integrations." tone={report.unsupportedIntegrations.length > 0 ? 'warning' : 'neutral'} />
        <ReportList title="Knowledge requirements" items={report.missingKnowledgeRefs.map((ref) => ref.name)} empty="No missing Knowledge refs." tone={report.missingKnowledgeRefs.length > 0 ? 'warning' : 'neutral'} />
      </div>

      {report.warnings.length > 0 ? (
        <div className="mt-3 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white px-3 py-3 text-[12px] text-[var(--color-text-secondary)]">
          <p className="font-semibold text-[var(--color-text-primary)]">Warnings</p>
          <ul className="mt-2 space-y-1">
            {report.warnings.slice(0, 4).map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

function ReportList({ title, items, empty, tone }: { title: string; items: string[]; empty: string; tone: 'warning' | 'danger' | 'neutral' }) {
  return (
    <div className={`rounded-[var(--radius-control)] border px-3 py-3 text-[12px] ${toneClass(tone)}`}>
      <p className="font-semibold text-[var(--color-text-primary)]">{title}</p>
      {items.length > 0 ? (
        <ul className="mt-2 space-y-1 text-[var(--color-text-secondary)]">
          {items.slice(0, 4).map((item) => <li key={item} className="break-words">{item}</li>)}
        </ul>
      ) : (
        <p className="mt-2 text-[var(--color-text-tertiary)]">{empty}</p>
      )}
    </div>
  )
}

function ReleaseConfigPilotRail({
  current,
  role,
  validation,
  validationSnapshot,
  latestReceipt,
  onOpen,
}: {
  current: AgentVersion | null
  role: VersionRole | null
  validation: ScenarioValidationSummary | undefined
  validationSnapshot: VersionValidationSnapshot
  latestReceipt: ScenarioReceipt | null
  onOpen: () => void
}) {
  const validated = Boolean(validation?.runtimeValidated)

  return (
    <aside className="intera-q2-rail p-5 xl:sticky xl:top-6 xl:self-start">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-accent-primary)]">
          <OrganicLoader variant={validated ? '20' : '12'} size={24} title="ConfigPilot release rail loader" />
        </span>
        <div className="min-w-0">
          <p className="text-[16px] font-semibold text-[var(--color-text-primary)]">ConfigPilot <span className="ml-1 rounded bg-[var(--color-bg-surface-muted)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-text-tertiary)]">BETA</span></p>
          <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">Pilot Lab owns conversational building. Release links there when you need guided fixes.</p>
        </div>
      </div>

      <p className="mt-8 text-[13px] leading-6 text-[var(--color-text-secondary)]">
        Selected {role ? roleLabel(role).toLowerCase() : 'version'}{current ? ` v${current.version}` : ''} is ready for Release review.
      </p>

      <RailInsight
        tone={validated ? 'success' : 'warning'}
        title={validated ? 'Validation is fresh' : 'Validation needs review'}
        body={validated ? 'Ask ConfigPilot for one small draft improvement before the next publish.' : validationSnapshot.detail}
        action="Open Pilot Lab"
        onClick={onOpen}
      />
      <RailInsight
        tone="info"
        title="Latest evidence"
        body={latestReceipt ? `${executionModeLabel(latestReceipt.executionMode)} receipt ${latestReceipt.status}: ${latestReceipt.scenarioName}` : 'No receipt yet. Run validation before publishing.'}
        action="Ask ConfigPilot"
        onClick={onOpen}
      />
      <RailInsight
        tone="success"
        title="Release boundary"
        body="Import, duplicate, and draft edits stay isolated until Release publishes explicitly. ConfigPilot cannot publish for you."
        action="Review workflow"
        onClick={onOpen}
      />
    </aside>
  )
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
