'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Braces,
  CheckCircle2,
  Code2,
  Globe2,
  Link2,
  Loader2,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  Unlink,
} from 'lucide-react'
import VersionContextBar, { useSelectedAgentId } from '@/components/admin/version-context-bar'
import { ApiClientError, apiClient, bustConfigCache } from '@/lib/api/client'
import { useSession } from '@/lib/hooks/use-session'
import type { HookHandler } from '@intera/shared/contracts/hooks'

type HookCheckpoint = 'PreToolUse' | 'PostToolUse' | 'Stop'
type HookSeverity = 'low' | 'medium' | 'high' | 'critical'
type HandlerKind = 'declarative' | 'code' | 'http'
type ScopeType = 'agent' | 'caseType' | 'procedureStep' | 'tool'

interface HookBinding {
  id: string
  hookName?: string
  scopeType: ScopeType
  scopeKey: string
  caseTypeId?: string | null
  procedureStepId?: string | null
  toolId?: string | null
  enabled: boolean
}

interface HookItem {
  id: string
  agentConfigId: string
  name: string
  displayName?: string | null
  description?: string | null
  checkpoint: HookCheckpoint
  handlerKind: HandlerKind
  handler: HookHandler
  enabled: boolean
  severity: HookSeverity
  bindings: HookBinding[]
}

interface CaseTypeOption {
  id: string
  type: string
  displayName?: string | null
  enabled?: boolean
}

interface ProcedureStepOption {
  caseTypeId: string
  caseTypeType: string
  caseTypeDisplayName: string
  id: string
  action: string
  target?: string | null
  guidance?: string | null
  label: string
}

interface ToolOption {
  id: string
  name: string
  description?: string | null
  mode?: string | null
  enabled?: boolean
}

interface HooksBootstrap {
  hooks: HookItem[]
  caseTypes: CaseTypeOption[]
  procedureSteps: ProcedureStepOption[]
  tools: ToolOption[]
}

interface HookDraft {
  name: string
  displayName: string
  description: string
  checkpoint: HookCheckpoint
  handlerKind: HandlerKind
  enabled: boolean
  severity: HookSeverity
  declarativeCheck: string
  declarativeEffect: string
  codeSource: string
  httpEndpoint: string
  httpTimeoutMs: number
  httpHeaders: string
  httpSecretRefs: string
}

interface BindingDraft {
  scopeType: ScopeType
  caseTypeId: string
  procedureStepValue: string
  toolId: string
}

const CHECKPOINTS: HookCheckpoint[] = ['PreToolUse', 'PostToolUse', 'Stop']
const SEVERITIES: HookSeverity[] = ['low', 'medium', 'high', 'critical']
const HANDLER_KINDS: { value: HandlerKind; label: string; icon: typeof Braces }[] = [
  { value: 'declarative', label: 'Declarative', icon: Braces },
  { value: 'code', label: 'Code', icon: Code2 },
  { value: 'http', label: 'HTTP', icon: Globe2 },
]

function jsonText(value: unknown, fallback = '{}') {
  if (value === undefined || value === null) return fallback
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return fallback
  }
}

function parseJsonField(raw: string, field: string): unknown {
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  try {
    return JSON.parse(trimmed)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`${field}: ${message}`)
  }
}

function emptyDraft(): HookDraft {
  return {
    name: '',
    displayName: '',
    description: '',
    checkpoint: 'PreToolUse',
    handlerKind: 'declarative',
    enabled: true,
    severity: 'medium',
    declarativeCheck: '{}',
    declarativeEffect: '{\n  "action": "allow"\n}',
    codeSource: 'async function hook(ctx) {\n  return { action: "allow" }\n}',
    httpEndpoint: 'https://example.com/intera-hook',
    httpTimeoutMs: 5000,
    httpHeaders: '{}',
    httpSecretRefs: '[]',
  }
}

function draftFromHook(hook: HookItem): HookDraft {
  const draft = emptyDraft()
  draft.name = hook.name
  draft.displayName = hook.displayName ?? ''
  draft.description = hook.description ?? ''
  draft.checkpoint = hook.checkpoint
  draft.handlerKind = hook.handlerKind
  draft.enabled = hook.enabled
  draft.severity = hook.severity

  if (hook.handler.kind === 'declarative') {
    draft.declarativeCheck = jsonText(hook.handler.check)
    draft.declarativeEffect = jsonText(hook.handler.effect, '{\n  "action": "allow"\n}')
  } else if (hook.handler.kind === 'code') {
    draft.codeSource = hook.handler.source
  } else if (hook.handler.kind === 'http') {
    draft.httpEndpoint = hook.handler.endpoint
    draft.httpTimeoutMs = hook.handler.timeoutMs
    draft.httpHeaders = jsonText(hook.handler.headers ?? {})
    draft.httpSecretRefs = jsonText(hook.handler.secretRefs ?? [], '[]')
  }
  return draft
}

function handlerFromDraft(draft: HookDraft): HookHandler {
  if (draft.handlerKind === 'code') {
    return { kind: 'code', runtime: 'javascript', source: draft.codeSource }
  }
  if (draft.handlerKind === 'http') {
    return {
      kind: 'http',
      endpoint: draft.httpEndpoint,
      method: 'POST',
      timeoutMs: Number(draft.httpTimeoutMs) || 5000,
      headers: (parseJsonField(draft.httpHeaders, 'Headers JSON') ?? {}) as Record<string, string>,
      secretRefs: (parseJsonField(draft.httpSecretRefs, 'Secret refs JSON') ?? []) as { name: string; ref: string }[],
    }
  }
  return {
    kind: 'declarative',
    check: (parseJsonField(draft.declarativeCheck, 'Check JSON') ?? {}) as Record<string, unknown>,
    effect: (parseJsonField(draft.declarativeEffect, 'Effect JSON') ?? {}) as Record<string, unknown>,
  }
}

function bindingDraftDefault(): BindingDraft {
  return { scopeType: 'agent', caseTypeId: '', procedureStepValue: '', toolId: '' }
}

function procedureStepValue(step: ProcedureStepOption) {
  return JSON.stringify({ caseTypeId: step.caseTypeId, procedureStepId: step.id })
}

function parseProcedureStepValue(value: string) {
  try {
    return JSON.parse(value) as { caseTypeId: string; procedureStepId: string }
  } catch {
    return { caseTypeId: '', procedureStepId: '' }
  }
}

function scopeTypeLabel(scopeType: ScopeType) {
  if (scopeType === 'agent') return 'Agent'
  if (scopeType === 'caseType') return 'Procedure type'
  if (scopeType === 'procedureStep') return 'Procedure step'
  return 'Tool'
}

export default function HookBuilder({ embedded = false }: { embedded?: boolean }) {
  const agentConfigId = useSelectedAgentId()
  const { orgId } = useSession()
  const [hooks, setHooks] = useState<HookItem[]>([])
  const [caseTypes, setCaseTypes] = useState<CaseTypeOption[]>([])
  const [procedureSteps, setProcedureSteps] = useState<ProcedureStepOption[]>([])
  const [tools, setTools] = useState<ToolOption[]>([])
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [draft, setDraft] = useState<HookDraft>(emptyDraft)
  const [isNew, setIsNew] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bindingDraft, setBindingDraft] = useState<BindingDraft>(bindingDraftDefault)
  const selectedNameRef = useRef<string | null>(null)

  const selectedHook = useMemo(
    () => hooks.find((hook) => hook.name === selectedName) ?? null,
    [hooks, selectedName],
  )

  useEffect(() => {
    selectedNameRef.current = selectedName
  }, [selectedName])

  const load = useCallback(async () => {
    if (!agentConfigId) return
    setLoading(true)
    setError(null)
    try {
      const result = await apiClient<HooksBootstrap>(`/api/admin/hooks?agentConfigId=${encodeURIComponent(agentConfigId)}`)
      setHooks(result.data.hooks)
      setCaseTypes(result.data.caseTypes)
      setProcedureSteps(result.data.procedureSteps)
      setTools(result.data.tools)
      const currentSelected = selectedNameRef.current
      const nextSelected = currentSelected && result.data.hooks.some((hook) => hook.name === currentSelected)
        ? currentSelected
        : result.data.hooks[0]?.name ?? null
      setSelectedName(nextSelected)
      const nextHook = result.data.hooks.find((hook) => hook.name === nextSelected)
      if (nextHook) {
        setDraft(draftFromHook(nextHook))
        setIsNew(false)
      } else {
        setDraft(emptyDraft())
        setIsNew(true)
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? err.envelope.error.message : 'Failed to load hooks')
    } finally {
      setLoading(false)
    }
  }, [agentConfigId])

  useEffect(() => { load() }, [load])

  const selectHook = (hook: HookItem) => {
    selectedNameRef.current = hook.name
    setSelectedName(hook.name)
    setDraft(draftFromHook(hook))
    setIsNew(false)
    setError(null)
  }

  const startNew = () => {
    selectedNameRef.current = null
    setSelectedName(null)
    setDraft(emptyDraft())
    setIsNew(true)
    setError(null)
  }

  const saveHook = async () => {
    if (!agentConfigId) return
    setSaving(true)
    setError(null)
    try {
      const handler = handlerFromDraft(draft)
      const body = {
        agentConfigId,
        name: draft.name,
        displayName: draft.displayName || null,
        description: draft.description || null,
        checkpoint: draft.checkpoint,
        handlerKind: draft.handlerKind,
        handler,
        enabled: draft.enabled,
        severity: draft.severity,
      }
      const url = isNew ? '/api/admin/hooks' : `/api/admin/hooks/${encodeURIComponent(selectedName ?? draft.name)}`
      const result = await apiClient<{ hook: HookItem }>(url, {
        method: isNew ? 'POST' : 'PUT',
        body,
      })
      await bustConfigCache(orgId).catch(() => {})
      selectedNameRef.current = result.data.hook.name
      setSelectedName(result.data.hook.name)
      setDraft(draftFromHook(result.data.hook))
      setIsNew(false)
      await load()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.envelope.error.message : err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const deleteHook = async () => {
    if (!agentConfigId || !selectedHook) return
    setSaving(true)
    setError(null)
    try {
      await apiClient(`/api/admin/hooks/${encodeURIComponent(selectedHook.name)}?agentConfigId=${encodeURIComponent(agentConfigId)}`, {
        method: 'DELETE',
      })
      await bustConfigCache(orgId).catch(() => {})
      selectedNameRef.current = null
      setSelectedName(null)
      setDraft(emptyDraft())
      await load()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.envelope.error.message : 'Delete failed')
    } finally {
      setSaving(false)
    }
  }

  const addBinding = async () => {
    if (!agentConfigId || !selectedHook) return
    setSaving(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {
        agentConfigId,
        scopeType: bindingDraft.scopeType,
        enabled: true,
      }
      if (bindingDraft.scopeType === 'caseType') body.caseTypeId = bindingDraft.caseTypeId
      if (bindingDraft.scopeType === 'tool') body.toolId = bindingDraft.toolId
      if (bindingDraft.scopeType === 'procedureStep') {
        const parsed = parseProcedureStepValue(bindingDraft.procedureStepValue)
        body.caseTypeId = parsed.caseTypeId
        body.procedureStepId = parsed.procedureStepId
      }
      await apiClient(`/api/admin/hooks/${encodeURIComponent(selectedHook.name)}/bindings`, {
        method: 'POST',
        body,
      })
      await bustConfigCache(orgId).catch(() => {})
      setBindingDraft(bindingDraftDefault())
      await load()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.envelope.error.message : 'Binding save failed')
    } finally {
      setSaving(false)
    }
  }

  const toggleBinding = async (binding: HookBinding) => {
    if (!agentConfigId || !selectedHook) return
    await apiClient(`/api/admin/hooks/${encodeURIComponent(selectedHook.name)}/bindings/${encodeURIComponent(binding.id)}`, {
      method: 'PUT',
      body: { agentConfigId, enabled: !binding.enabled },
    })
    await bustConfigCache(orgId).catch(() => {})
    await load()
  }

  const deleteBinding = async (binding: HookBinding) => {
    if (!agentConfigId || !selectedHook) return
    await apiClient(`/api/admin/hooks/${encodeURIComponent(selectedHook.name)}/bindings/${encodeURIComponent(binding.id)}?agentConfigId=${encodeURIComponent(agentConfigId)}`, {
      method: 'DELETE',
    })
    await bustConfigCache(orgId).catch(() => {})
    await load()
  }

  const scopeLabel = (binding: HookBinding) => {
    if (binding.scopeType === 'agent') return 'Agent'
    if (binding.scopeType === 'caseType') {
      const ct = caseTypes.find((item) => item.id === binding.caseTypeId)
      return ct?.displayName || ct?.type || binding.scopeKey
    }
    if (binding.scopeType === 'procedureStep') {
      const step = procedureSteps.find((item) => item.caseTypeId === binding.caseTypeId && item.id === binding.procedureStepId)
      return step?.label || binding.scopeKey
    }
    const tool = tools.find((item) => item.id === binding.toolId)
    return tool?.name || binding.scopeKey
  }

  return (
    <div>
      {!embedded ? <VersionContextBar /> : null}
      <div className={embedded ? 'px-0 py-2' : 'px-8 py-8'}>
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[20px] font-semibold text-[var(--mist)]">Hooks</h1>
            <p className="mt-1 text-[13px] text-[var(--fog)]">{hooks.length} configured controls</p>
          </div>
          <button
            type="button"
            onClick={startNew}
            className="inline-flex items-center gap-2 rounded-lg border border-indigo/20 bg-indigo/[0.08] px-4 py-2 text-[13px] font-medium text-indigo transition hover:bg-indigo/[0.14]"
          >
            <Plus className="h-4 w-4" />
            New Hook
          </button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 rounded-lg border border-black/[0.06] bg-white/60 px-4 py-3 text-[13px] text-[var(--fog)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading hooks
          </div>
        ) : !agentConfigId ? (
          <div className="rounded-lg border border-black/[0.06] bg-white/60 px-4 py-3 text-[13px] text-[var(--fog)]">Select an agent version.</div>
        ) : (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
            <aside className="space-y-3">
              {hooks.length === 0 && !isNew ? (
                <button
                  type="button"
                  onClick={startNew}
                  className="w-full rounded-lg border border-dashed border-black/15 bg-white/50 px-4 py-5 text-left text-[13px] text-[var(--fog)] transition hover:border-indigo/30 hover:text-[var(--mist)]"
                >
                  Create the first Hook
                </button>
              ) : null}
              {hooks.map((hook) => (
                <button
                  key={hook.id}
                  type="button"
                  onClick={() => selectHook(hook)}
                  className={`w-full rounded-lg border px-4 py-3 text-left transition ${hook.name === selectedName ? 'border-indigo/35 bg-indigo/[0.08]' : 'border-black/[0.06] bg-white/60 hover:border-black/10 hover:bg-white/80'}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-[13px] font-semibold text-[var(--mist)]">{hook.displayName || hook.name}</span>
                    <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] ${hook.enabled ? 'bg-emerald-500/10 text-emerald-700' : 'bg-black/[0.05] text-[var(--fog)]'}`}>
                      {hook.enabled ? 'On' : 'Off'}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-[var(--fog)]">
                    <span className="rounded-md bg-black/[0.04] px-2 py-0.5">{hook.checkpoint}</span>
                    <span className="rounded-md bg-black/[0.04] px-2 py-0.5">{hook.handlerKind}</span>
                    <span className="rounded-md bg-black/[0.04] px-2 py-0.5">{hook.bindings.length} bindings</span>
                  </div>
                </button>
              ))}
            </aside>

            <main className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1fr)_360px]">
              <section className="rounded-lg border border-black/[0.06] bg-white/70 p-5 shadow-[0_12px_36px_rgba(21,23,25,0.05)]">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-indigo" />
                    <h2 className="text-[15px] font-semibold text-[var(--mist)]">{isNew ? 'Create Hook' : 'Edit Hook'}</h2>
                  </div>
                  <div className="flex items-center gap-2">
                    {!isNew && selectedHook ? (
                      <button
                        type="button"
                        onClick={deleteHook}
                        title="Delete hook"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-500/20 text-red-600 transition hover:bg-red-500/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={saveHook}
                      disabled={saving || !draft.name.trim()}
                      className="inline-flex items-center gap-2 rounded-lg bg-[var(--mist)] px-4 py-2 text-[13px] font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Save
                    </button>
                  </div>
                </div>

                {error ? (
                  <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[13px] text-red-700">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span className="break-words">{error}</span>
                  </div>
                ) : null}

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <label className="space-y-1.5">
                    <span className="text-[12px] font-medium text-[var(--fog)]">Name</span>
                    <input
                      value={draft.name}
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                      className="glass-input-console text-[13px]"
                      placeholder="investigate_before_transfer"
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[12px] font-medium text-[var(--fog)]">Display name</span>
                    <input
                      value={draft.displayName}
                      onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
                      className="glass-input-console text-[13px]"
                      placeholder="Investigate before transfer"
                    />
                  </label>
                  <label className="space-y-1.5 lg:col-span-2">
                    <span className="text-[12px] font-medium text-[var(--fog)]">Description</span>
                    <textarea
                      value={draft.description}
                      onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                      className="glass-input-console min-h-[78px] resize-y text-[13px]"
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[12px] font-medium text-[var(--fog)]">Checkpoint</span>
                    <select
                      value={draft.checkpoint}
                      onChange={(event) => setDraft({ ...draft, checkpoint: event.target.value as HookCheckpoint })}
                      className="glass-input-console text-[13px]"
                    >
                      {CHECKPOINTS.map((checkpoint) => <option key={checkpoint} value={checkpoint}>{checkpoint}</option>)}
                    </select>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[12px] font-medium text-[var(--fog)]">Severity</span>
                    <select
                      value={draft.severity}
                      onChange={(event) => setDraft({ ...draft, severity: event.target.value as HookSeverity })}
                      className="glass-input-console text-[13px]"
                    >
                      {SEVERITIES.map((severity) => <option key={severity} value={severity}>{severity}</option>)}
                    </select>
                  </label>
                </div>

                <div className="mt-5">
                  <span className="text-[12px] font-medium text-[var(--fog)]">Handler</span>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {HANDLER_KINDS.map((kind) => {
                      const Icon = kind.icon
                      return (
                        <button
                          key={kind.value}
                          type="button"
                          onClick={() => setDraft({ ...draft, handlerKind: kind.value })}
                          className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-[13px] transition ${draft.handlerKind === kind.value ? 'border-indigo/35 bg-indigo/[0.08] text-indigo' : 'border-black/[0.06] bg-white/60 text-[var(--fog)] hover:bg-white'}`}
                        >
                          <Icon className="h-4 w-4" />
                          {kind.label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {draft.handlerKind === 'declarative' ? (
                  <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <label className="space-y-1.5">
                      <span className="text-[12px] font-medium text-[var(--fog)]">Check JSON</span>
                      <textarea
                        value={draft.declarativeCheck}
                        onChange={(event) => setDraft({ ...draft, declarativeCheck: event.target.value })}
                        className="glass-input-console min-h-[220px] resize-y font-mono text-[12px]"
                        spellCheck={false}
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-[12px] font-medium text-[var(--fog)]">Effect JSON</span>
                      <textarea
                        value={draft.declarativeEffect}
                        onChange={(event) => setDraft({ ...draft, declarativeEffect: event.target.value })}
                        className="glass-input-console min-h-[220px] resize-y font-mono text-[12px]"
                        spellCheck={false}
                      />
                    </label>
                  </div>
                ) : null}

                {draft.handlerKind === 'code' ? (
                  <label className="mt-4 block space-y-1.5">
                    <span className="text-[12px] font-medium text-[var(--fog)]">JavaScript</span>
                    <textarea
                      value={draft.codeSource}
                      onChange={(event) => setDraft({ ...draft, codeSource: event.target.value })}
                      className="glass-input-console min-h-[300px] resize-y font-mono text-[12px]"
                      spellCheck={false}
                    />
                  </label>
                ) : null}

                {draft.handlerKind === 'http' ? (
                  <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_160px]">
                    <label className="space-y-1.5">
                      <span className="text-[12px] font-medium text-[var(--fog)]">Endpoint</span>
                      <input
                        value={draft.httpEndpoint}
                        onChange={(event) => setDraft({ ...draft, httpEndpoint: event.target.value })}
                        className="glass-input-console text-[13px]"
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-[12px] font-medium text-[var(--fog)]">Timeout ms</span>
                      <input
                        type="number"
                        min={1}
                        max={30000}
                        value={draft.httpTimeoutMs}
                        onChange={(event) => setDraft({ ...draft, httpTimeoutMs: Number(event.target.value) })}
                        className="glass-input-console text-[13px]"
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-[12px] font-medium text-[var(--fog)]">Headers JSON</span>
                      <textarea
                        value={draft.httpHeaders}
                        onChange={(event) => setDraft({ ...draft, httpHeaders: event.target.value })}
                        className="glass-input-console min-h-[160px] resize-y font-mono text-[12px]"
                        spellCheck={false}
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-[12px] font-medium text-[var(--fog)]">Secret refs JSON</span>
                      <textarea
                        value={draft.httpSecretRefs}
                        onChange={(event) => setDraft({ ...draft, httpSecretRefs: event.target.value })}
                        className="glass-input-console min-h-[160px] resize-y font-mono text-[12px]"
                        spellCheck={false}
                      />
                    </label>
                  </div>
                ) : null}

                <label className="mt-5 flex items-center gap-3 text-[13px] text-[var(--mist)]">
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
                    className="h-4 w-4 rounded border-black/20"
                  />
                  Enabled
                </label>
              </section>

              <aside className="rounded-lg border border-black/[0.06] bg-white/70 p-5 shadow-[0_12px_36px_rgba(21,23,25,0.05)]">
                <div className="mb-4 flex items-center gap-2">
                  <Link2 className="h-5 w-5 text-indigo" />
                  <h2 className="text-[15px] font-semibold text-[var(--mist)]">Bindings</h2>
                </div>

                {!selectedHook ? (
                  <div className="rounded-lg border border-dashed border-black/15 px-4 py-5 text-[13px] text-[var(--fog)]">Save a Hook first.</div>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-3">
                      {selectedHook.bindings.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-black/15 px-4 py-4 text-[13px] text-[var(--fog)]">No bindings</div>
                      ) : selectedHook.bindings.map((binding) => (
                        <div key={binding.id} className="rounded-lg border border-black/[0.06] bg-white/65 px-3 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="break-words text-[13px] font-medium text-[var(--mist)]">{scopeLabel(binding)}</div>
                              <div className="mt-1 text-[11px] text-[var(--fog)]">{scopeTypeLabel(binding.scopeType)}</div>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              <button
                                type="button"
                                onClick={() => toggleBinding(binding)}
                                title={binding.enabled ? 'Disable binding' : 'Enable binding'}
                                className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition ${binding.enabled ? 'border-emerald-500/20 text-emerald-700 hover:bg-emerald-500/10' : 'border-black/10 text-[var(--fog)] hover:bg-black/[0.04]'}`}
                              >
                                <CheckCircle2 className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteBinding(binding)}
                                title="Remove binding"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-500/20 text-red-600 transition hover:bg-red-500/10"
                              >
                                <Unlink className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="border-t border-black/[0.06] pt-4">
                      <label className="space-y-1.5">
                        <span className="text-[12px] font-medium text-[var(--fog)]">Scope</span>
                        <select
                          value={bindingDraft.scopeType}
                          onChange={(event) => setBindingDraft({ ...bindingDraftDefault(), scopeType: event.target.value as ScopeType })}
                          className="glass-input-console text-[13px]"
                        >
                          <option value="agent">Agent</option>
                          <option value="caseType">Procedure type</option>
                          <option value="procedureStep">Procedure step</option>
                          <option value="tool">Tool</option>
                        </select>
                      </label>

                      {bindingDraft.scopeType === 'caseType' ? (
                        <label className="mt-3 block space-y-1.5">
                          <span className="text-[12px] font-medium text-[var(--fog)]">Procedure type</span>
                          <select
                            value={bindingDraft.caseTypeId}
                            onChange={(event) => setBindingDraft({ ...bindingDraft, caseTypeId: event.target.value })}
                            className="glass-input-console text-[13px]"
                          >
                            <option value="">Select Procedure type</option>
                            {caseTypes.map((ct) => <option key={ct.id} value={ct.id}>{ct.displayName || ct.type}</option>)}
                          </select>
                        </label>
                      ) : null}

                      {bindingDraft.scopeType === 'procedureStep' ? (
                        <label className="mt-3 block space-y-1.5">
                          <span className="text-[12px] font-medium text-[var(--fog)]">Procedure step</span>
                          <select
                            value={bindingDraft.procedureStepValue}
                            onChange={(event) => setBindingDraft({ ...bindingDraft, procedureStepValue: event.target.value })}
                            className="glass-input-console text-[13px]"
                          >
                            <option value="">Select Procedure step</option>
                            {procedureSteps.map((step) => <option key={`${step.caseTypeId}:${step.id}`} value={procedureStepValue(step)}>{step.label}</option>)}
                          </select>
                        </label>
                      ) : null}

                      {bindingDraft.scopeType === 'tool' ? (
                        <label className="mt-3 block space-y-1.5">
                          <span className="text-[12px] font-medium text-[var(--fog)]">Tool</span>
                          <select
                            value={bindingDraft.toolId}
                            onChange={(event) => setBindingDraft({ ...bindingDraft, toolId: event.target.value })}
                            className="glass-input-console text-[13px]"
                          >
                            <option value="">Select Tool</option>
                            {tools.map((tool) => <option key={tool.id} value={tool.id}>{tool.name}</option>)}
                          </select>
                        </label>
                      ) : null}

                      <button
                        type="button"
                        onClick={addBinding}
                        disabled={saving}
                        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-indigo/20 bg-indigo/[0.08] px-4 py-2 text-[13px] font-medium text-indigo transition hover:bg-indigo/[0.14] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Plus className="h-4 w-4" />
                        Add Binding
                      </button>
                    </div>
                  </div>
                )}
              </aside>
            </main>
          </div>
        )}
      </div>
    </div>
  )
}
