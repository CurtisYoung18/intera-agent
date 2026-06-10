'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, ArrowUpRight, CheckCircle2, Loader2, Plus, Trash2 } from 'lucide-react'
import { BuildComponentsRouteShell } from '../../_components/components-route-shell'
import ChipInput from '@/components/ui/chip-input'
import ConfirmDialog from '@/components/ui/confirm-dialog'
import { PageLoader } from '@/components/ui/page-loader'
import VersionContextBar, { useSelectedAgentId } from '@/components/admin/version-context-bar'
import { apiClient, bustConfigCache } from '@/lib/api/client'
import { useSession } from '@/lib/hooks/use-session'
import {
  parseProcedure,
  PROCEDURE_ACTIONS,
  type CaseTypeItem,
} from '@intera/shared/contracts/case-types'

type ProcedureStepInput = {
  id: string
  action: (typeof PROCEDURE_ACTIONS)[number]
  target: string
  guidance: string
  when: string
  required: boolean
}

type HookBinding = {
  id: string
  hookName?: string | null
  scopeType: 'agent' | 'caseType' | 'procedureStep' | 'tool'
  scopeKey: string
  caseTypeId?: string | null
  procedureStepId?: string | null
  enabled: boolean
}

type ProcedureHook = {
  id: string
  name: string
  displayName?: string | null
  enabled: boolean
  bindings: HookBinding[]
}

function parseList(json: string | null | undefined) {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return []
  }
}

function nextStepId(steps: ProcedureStepInput[]) {
  return `step_${steps.length + 1}`
}

function toDraft(item: CaseTypeItem) {
  const procedure = parseProcedure(item.procedure ?? null)
  return {
    type: item.type,
    displayName: item.displayName || '',
    description: item.description || '',
    icon: item.icon || '📋',
    defaultGoal: item.defaultGoal || '',
    enabled: item.enabled,
    maxAutoTurns: item.maxAutoTurns ?? 10,
    requiredFacts: parseList(item.requiredFacts),
    escalateOn: parseList(item.escalateOn),
    autoCloseConditions: parseList(item.autoCloseConditions ?? '[]'),
    steps: (procedure?.steps || []).map((step) => ({
      id: step.id,
      action: step.action,
      target: step.target || '',
      guidance: step.guidance || '',
      when: step.when || '',
      required: !!step.required,
    })),
  }
}

export default function BuildProcedureDetailPage() {
  const params = useParams<{ name: string }>()
  const router = useRouter()
  const agentConfigId = useSelectedAgentId()
  const { orgId } = useSession()
  const procedureName = params.name

  const [item, setItem] = useState<CaseTypeItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [hooks, setHooks] = useState<ProcedureHook[]>([])
  const [hookBusyStepId, setHookBusyStepId] = useState<string | null>(null)
  const [hookStepDrafts, setHookStepDrafts] = useState<Record<string, string>>({})
  const [newHookDrafts, setNewHookDrafts] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState(() => ({
    type: '',
    displayName: '',
    description: '',
    icon: '📋',
    defaultGoal: '',
    enabled: true,
    maxAutoTurns: 10,
    requiredFacts: [] as string[],
    escalateOn: [] as string[],
    autoCloseConditions: [] as string[],
    steps: [] as ProcedureStepInput[],
  }))

  const load = useCallback(async () => {
    if (!agentConfigId) {
      setLoading(false)
      setError('Select an agent version first.')
      return
    }
    try {
      const [caseTypeResult, hooksResult] = await Promise.all([
        apiClient<{ caseType: CaseTypeItem }>(
          `/api/admin/case-types/${encodeURIComponent(procedureName)}?agentConfigId=${encodeURIComponent(agentConfigId)}`,
        ),
        apiClient<{ hooks: ProcedureHook[] }>(
          `/api/admin/hooks?agentConfigId=${encodeURIComponent(agentConfigId)}`,
        ).catch(() => ({ data: { hooks: [] } })),
      ])
      setItem(caseTypeResult.data.caseType)
      setDraft(toDraft(caseTypeResult.data.caseType))
      setHooks(hooksResult.data.hooks || [])
      setError(null)
      setSaveError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Procedure type')
    } finally {
      setLoading(false)
    }
  }, [agentConfigId, procedureName])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  const getStepBindings = useCallback((stepId: string) => {
    if (!item) return []
    return hooks.flatMap((hook) =>
      hook.bindings
        .filter((binding) => binding.enabled && binding.scopeType === 'procedureStep' && binding.caseTypeId === item.id && binding.procedureStepId === stepId)
        .map((binding) => ({
          ...binding,
          hookName: binding.hookName || hook.name,
        })),
    )
  }, [hooks, item])

  const isHookAlreadyBoundToStep = useCallback((stepId: string, hookName: string) => {
    return getStepBindings(stepId).some((binding) => binding.hookName === hookName)
  }, [getStepBindings])

  const availableHooksForStep = useCallback((stepId: string) => {
    return hooks.filter((hook) => hook.enabled && !isHookAlreadyBoundToStep(stepId, hook.name))
  }, [hooks, isHookAlreadyBoundToStep])

  const dirty = useMemo(() => {
    if (!item) return false
    return JSON.stringify(draft) !== JSON.stringify(toDraft(item))
  }, [draft, item])

  const updateStep = useCallback((index: number, patch: Partial<ProcedureStepInput>) => {
    setDraft((current) => {
      const next = [...current.steps]
      if (!next[index]) return current
      next[index] = { ...next[index], ...patch }
      return { ...current, steps: next }
    })
  }, [])

  const addStep = useCallback(() => {
    setDraft((current) => ({
      ...current,
      steps: [
        ...current.steps,
        {
          id: nextStepId(current.steps),
          action: 'use',
          target: '',
          guidance: '',
          when: '',
          required: false,
        },
      ],
    }))
  }, [])

  const removeStep = useCallback((index: number) => {
    setDraft((current) => ({
      ...current,
      steps: current.steps.filter((_, stepIndex) => stepIndex !== index),
    }))
  }, [])

  const save = useCallback(async () => {
    if (!agentConfigId || !item) return
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(null)
    try {
      await apiClient(`/api/admin/case-types/${encodeURIComponent(item.type)}?agentConfigId=${encodeURIComponent(agentConfigId)}`, {
        method: 'PUT',
        body: {
          agentConfigId,
          type: draft.type,
          displayName: draft.displayName,
          description: draft.description,
          icon: draft.icon,
          defaultGoal: draft.defaultGoal,
          enabled: draft.enabled,
          maxAutoTurns: draft.maxAutoTurns,
          requiredFacts: draft.requiredFacts,
          escalateOn: draft.escalateOn,
          autoCloseConditions: draft.autoCloseConditions,
          procedure: { steps: draft.steps },
        },
      })
      await bustConfigCache(orgId).catch(() => {})
      setSaveSuccess('Saved')
      if (draft.type !== item.type) {
        router.replace(`/build/components/procedures/${encodeURIComponent(draft.type)}`)
        return
      }
      await load()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save Procedure type')
    } finally {
      setSaving(false)
    }
  }, [agentConfigId, draft, item, load, orgId, router])

  const deleteProcedure = useCallback(async () => {
    if (!agentConfigId || !item) return
    setSaving(true)
    try {
      await apiClient(`/api/admin/case-types/${encodeURIComponent(item.type)}?agentConfigId=${encodeURIComponent(agentConfigId)}`, {
        method: 'DELETE',
      })
      await bustConfigCache(orgId).catch(() => {})
      router.replace('/build/components/procedures')
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to delete Procedure type')
    } finally {
      setSaving(false)
      setConfirmDelete(false)
    }
  }, [agentConfigId, item, orgId, router])

  const bindExistingHookToStep = useCallback(async (stepId: string) => {
    const hookName = hookStepDrafts[stepId]?.trim()
    if (!agentConfigId || !item || !hookName) return
    setHookBusyStepId(stepId)
    try {
      await apiClient(`/api/admin/hooks/${encodeURIComponent(hookName)}/bindings`, {
        method: 'POST',
        body: {
          agentConfigId,
          scopeType: 'procedureStep',
          caseTypeId: item.id,
          procedureStepId: stepId,
        },
      })
      await bustConfigCache(orgId).catch(() => {})
      setHookStepDrafts((current) => ({ ...current, [stepId]: '' }))
      await load()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to bind Hook')
    } finally {
      setHookBusyStepId(null)
    }
  }, [agentConfigId, hookStepDrafts, item, load, orgId])

  const createAndBindHookToStep = useCallback(async (stepId: string) => {
    const hookName = newHookDrafts[stepId]?.trim()
    if (!agentConfigId || !item || !hookName) return
    setHookBusyStepId(stepId)
    try {
      const created = await apiClient<{ hook: { name: string } }>('/api/admin/hooks', {
        method: 'POST',
        body: {
          agentConfigId,
          name: hookName,
          checkpoint: 'PreToolUse',
          handlerKind: 'declarative',
          handler: {
            kind: 'declarative',
            check: {},
            effect: { action: 'allow' },
          },
          enabled: true,
          severity: 'medium',
        },
      })
      await apiClient(`/api/admin/hooks/${encodeURIComponent(created.data.hook.name)}/bindings`, {
        method: 'POST',
        body: {
          agentConfigId,
          scopeType: 'procedureStep',
          caseTypeId: item.id,
          procedureStepId: stepId,
        },
      })
      await bustConfigCache(orgId).catch(() => {})
      setNewHookDrafts((current) => ({ ...current, [stepId]: '' }))
      await load()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to create Hook')
    } finally {
      setHookBusyStepId(null)
    }
  }, [agentConfigId, item, load, newHookDrafts, orgId])

  const removeStepBinding = useCallback(async (stepId: string, hookName: string, bindingId: string) => {
    if (!agentConfigId) return
    setHookBusyStepId(stepId)
    try {
      await apiClient(
        `/api/admin/hooks/${encodeURIComponent(hookName)}/bindings/${encodeURIComponent(bindingId)}?agentConfigId=${encodeURIComponent(agentConfigId)}`,
        { method: 'DELETE' },
      )
      await bustConfigCache(orgId).catch(() => {})
      await load()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to remove Hook binding')
    } finally {
      setHookBusyStepId(null)
    }
  }, [agentConfigId, load, orgId])

  return (
    <BuildComponentsRouteShell
      currentLabelKey="sidebar.procedures"
      descriptionKey="procedureDetail"
    >
      <VersionContextBar />
      <PageLoader loading={loading} error={error} onRetry={() => load()}>
        <div className="mx-auto max-w-[1200px] px-8 py-8">
          <div className="mb-6 flex items-center justify-between gap-4">
            <Link
              href="/build/components/procedures"
              className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--fog)] transition-colors hover:text-[var(--mist)]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Procedures
            </Link>

            <div className="flex items-center gap-2">
              {saveSuccess ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-malachite/18 bg-malachite/[0.08] px-3 py-1.5 text-[12px] font-medium text-malachite">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {saveSuccess}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-medium text-vermillion transition-colors hover:bg-vermillion/[0.06] disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving || !dirty}
                className="inline-flex items-center gap-2 rounded-xl border border-[#357f7c]/18 bg-[#357f7c]/[0.08] px-4 py-2.5 text-[13px] font-semibold text-[#357f7c] transition-colors hover:bg-[#357f7c]/[0.14] disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Save Procedure
              </button>
            </div>
          </div>

          {saveError ? (
            <div className="mb-4 rounded-xl border border-vermillion/15 bg-vermillion/[0.06] px-4 py-3 text-[12px] text-vermillion">
              {saveError}
            </div>
          ) : null}

          <div className="grid gap-6 xl:grid-cols-[minmax(0,0.7fr)_minmax(320px,0.3fr)]">
            <section className="space-y-6">
              <div className="rounded-[24px] border border-black/[0.06] bg-white/[0.74] p-6 shadow-[var(--shadow-card)] backdrop-blur-xl">
                <div className="mb-5">
                  <h1 className="text-[22px] font-semibold text-[var(--mist)]">{draft.displayName || draft.type}</h1>
                  <p className="mt-1 text-[13px] text-[var(--fog)]">Procedure-first editor using the current backend contract. Legacy runtime migration fields are intentionally excluded.</p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-1.5">
                    <span className="text-[11px] font-medium text-[var(--fog)]">Display name</span>
                    <input
                      value={draft.displayName}
                      onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))}
                      className="glass-input-console text-[13px]"
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[11px] font-medium text-[var(--fog)]">Procedure key</span>
                    <input
                      value={draft.type}
                      onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value }))}
                      className="glass-input-console font-mono text-[13px]"
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[11px] font-medium text-[var(--fog)]">Icon</span>
                    <input
                      value={draft.icon}
                      onChange={(event) => setDraft((current) => ({ ...current, icon: event.target.value }))}
                      className="glass-input-console text-[13px]"
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[11px] font-medium text-[var(--fog)]">Max auto turns</span>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={draft.maxAutoTurns}
                      onChange={(event) => setDraft((current) => ({ ...current, maxAutoTurns: Number(event.target.value || 10) }))}
                      className="glass-input-console text-[13px]"
                    />
                  </label>
                </div>

                <label className="mt-4 block space-y-1.5">
                  <span className="text-[11px] font-medium text-[var(--fog)]">Description</span>
                  <textarea
                    value={draft.description}
                    onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                    rows={3}
                    className="glass-input-console resize-y text-[13px]"
                  />
                </label>

                <label className="mt-4 block space-y-1.5">
                  <span className="text-[11px] font-medium text-[var(--fog)]">Default goal</span>
                  <textarea
                    value={draft.defaultGoal}
                    onChange={(event) => setDraft((current) => ({ ...current, defaultGoal: event.target.value }))}
                    rows={2}
                    className="glass-input-console resize-y text-[13px]"
                  />
                </label>

                <label className="mt-4 inline-flex items-center gap-2 text-[13px] text-[var(--mist)]">
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))}
                    className="h-4 w-4 rounded border-[var(--color-border-subtle)]"
                  />
                  Eligible for routing
                </label>
              </div>

              <div className="rounded-[24px] border border-black/[0.06] bg-white/[0.74] p-6 shadow-[var(--shadow-card)] backdrop-blur-xl">
                <h2 className="text-[15px] font-semibold text-[var(--mist)]">Procedure requirements</h2>
                <div className="mt-5 grid gap-5 md:grid-cols-3">
                  <div className="space-y-2">
                    <p className="text-[11px] font-medium text-[var(--fog)]">Required facts</p>
                    <ChipInput
                      values={draft.requiredFacts}
                      onChange={(values) => setDraft((current) => ({ ...current, requiredFacts: values }))}
                      placeholder="Add required facts..."
                    />
                  </div>
                  <div className="space-y-2">
                    <p className="text-[11px] font-medium text-[var(--fog)]">Escalate on</p>
                    <ChipInput
                      values={draft.escalateOn}
                      onChange={(values) => setDraft((current) => ({ ...current, escalateOn: values }))}
                      placeholder="Add escalation conditions..."
                    />
                  </div>
                  <div className="space-y-2">
                    <p className="text-[11px] font-medium text-[var(--fog)]">Auto-close conditions</p>
                    <ChipInput
                      values={draft.autoCloseConditions}
                      onChange={(values) => setDraft((current) => ({ ...current, autoCloseConditions: values }))}
                      placeholder="Add auto-close conditions..."
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-[24px] border border-black/[0.06] bg-white/[0.74] p-6 shadow-[var(--shadow-card)] backdrop-blur-xl">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-[15px] font-semibold text-[var(--mist)]">Procedure steps</h2>
                    <p className="mt-1 text-[12px] text-[var(--fog)]">Define the runtime step sequence. Hooks bind directly to step ids and stay inside current backend constraints.</p>
                  </div>
                  <button
                    type="button"
                    onClick={addStep}
                    className="inline-flex items-center gap-2 rounded-xl border border-indigo/18 bg-indigo/[0.08] px-3.5 py-2 text-[12px] font-semibold text-indigo transition-colors hover:bg-indigo/[0.14]"
                  >
                    <Plus className="h-4 w-4" />
                    Add step
                  </button>
                </div>

                {draft.steps.length === 0 ? (
                  <div className="rounded-[20px] border border-dashed border-black/[0.08] bg-white/60 px-5 py-8 text-center text-[13px] text-[var(--fog)]">
                    No steps yet. Add the first Procedure step and then attach step-level Hooks as needed.
                  </div>
                ) : (
                  <div className="space-y-5">
                    {draft.steps.map((step, index) => {
                      const bindings = getStepBindings(step.id)
                      const availableHooks = availableHooksForStep(step.id)
                      const busy = hookBusyStepId === step.id
                      return (
                        <div key={step.id} className="rounded-[20px] border border-black/[0.06] bg-white/80 p-5">
                          <div className="mb-4 flex items-start justify-between gap-4">
                            <div>
                              <p className="text-[13px] font-semibold text-[var(--mist)]">{step.id}</p>
                              <p className="mt-1 text-[11px] text-[var(--fog)]">Step {index + 1}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeStep(index)}
                              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium text-vermillion transition-colors hover:bg-vermillion/[0.06]"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Remove
                            </button>
                          </div>

                          <div className="grid gap-4 md:grid-cols-2">
                            <label className="space-y-1.5">
                              <span className="text-[11px] font-medium text-[var(--fog)]">Step id</span>
                              <input
                                value={step.id}
                                onChange={(event) => updateStep(index, { id: event.target.value })}
                                className="glass-input-console font-mono text-[13px]"
                              />
                            </label>
                            <label className="space-y-1.5">
                              <span className="text-[11px] font-medium text-[var(--fog)]">Action</span>
                              <select
                                value={step.action}
                                onChange={(event) => updateStep(index, { action: event.target.value as ProcedureStepInput['action'] })}
                                className="glass-input-console text-[13px]"
                              >
                                {PROCEDURE_ACTIONS.map((action) => (
                                  <option key={action} value={action}>
                                    {action}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="space-y-1.5">
                              <span className="text-[11px] font-medium text-[var(--fog)]">Target</span>
                              <input
                                value={step.target}
                                onChange={(event) => updateStep(index, { target: event.target.value })}
                                placeholder="tool / destination / intent key"
                                className="glass-input-console text-[13px]"
                              />
                            </label>
                            <label className="space-y-1.5">
                              <span className="text-[11px] font-medium text-[var(--fog)]">When</span>
                              <input
                                value={step.when}
                                onChange={(event) => updateStep(index, { when: event.target.value })}
                                placeholder="optional condition"
                                className="glass-input-console text-[13px]"
                              />
                            </label>
                          </div>

                          <label className="mt-4 block space-y-1.5">
                            <span className="text-[11px] font-medium text-[var(--fog)]">Guidance</span>
                            <textarea
                              value={step.guidance}
                              onChange={(event) => updateStep(index, { guidance: event.target.value })}
                              rows={3}
                              className="glass-input-console resize-y text-[13px]"
                            />
                          </label>

                          <label className="mt-4 inline-flex items-center gap-2 text-[12px] text-[var(--mist)]">
                            <input
                              type="checkbox"
                              checked={step.required}
                              onChange={(event) => updateStep(index, { required: event.target.checked })}
                              className="h-4 w-4 rounded border-[var(--color-border-subtle)]"
                            />
                            Required step
                          </label>

                          <div className="mt-5 rounded-[18px] border border-black/[0.06] bg-[rgba(250,248,242,0.7)] p-4">
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <div>
                                <p className="text-[12px] font-semibold text-[var(--mist)]">Step Hooks</p>
                                <p className="mt-1 text-[11px] text-[var(--fog)]">Bindings stay native to Hook records. This editor only attaches or detaches them for the current step.</p>
                              </div>
                              <Link
                                href="/build/components/hooks"
                                className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.06] bg-white/84 px-3 py-1.5 text-[11px] font-medium text-[var(--mist)] transition-colors hover:text-indigo"
                              >
                                Open Hooks
                                <ArrowUpRight className="h-3.5 w-3.5" />
                              </Link>
                            </div>

                            <div className="mb-4 flex flex-wrap gap-2">
                              {bindings.length === 0 ? (
                                <span className="text-[11px] text-[var(--fog)]">No Hook bindings on this step.</span>
                              ) : (
                                bindings.map((binding) => (
                                  <span
                                    key={binding.id}
                                    className="inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white/82 px-3 py-1.5 text-[11px] font-medium text-[var(--mist)]"
                                  >
                                    {binding.hookName}
                                    <button
                                      type="button"
                                      onClick={() => removeStepBinding(step.id, binding.hookName || '', binding.id)}
                                      disabled={busy}
                                      className="text-vermillion transition-opacity hover:opacity-80 disabled:opacity-40"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  </span>
                                ))
                              )}
                            </div>

                            <div className="grid gap-3 md:grid-cols-2">
                              <div className="space-y-2">
                                <span className="text-[11px] font-medium text-[var(--fog)]">Bind existing Hook</span>
                                <div className="flex gap-2">
                                  <select
                                    value={hookStepDrafts[step.id] || ''}
                                    onChange={(event) => setHookStepDrafts((current) => ({ ...current, [step.id]: event.target.value }))}
                                    className="glass-input-console text-[12px]"
                                  >
                                    <option value="">Select a Hook</option>
                                    {availableHooks.map((hook) => (
                                      <option key={hook.id} value={hook.name}>
                                        {hook.displayName || hook.name}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    onClick={() => bindExistingHookToStep(step.id)}
                                    disabled={!hookStepDrafts[step.id] || busy}
                                    className="rounded-xl border border-black/[0.06] bg-white/84 px-3 py-2 text-[12px] font-semibold text-[var(--mist)] transition-colors hover:text-indigo disabled:opacity-40"
                                  >
                                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Bind'}
                                  </button>
                                </div>
                              </div>

                              <div className="space-y-2">
                                <span className="text-[11px] font-medium text-[var(--fog)]">Create and bind new Hook</span>
                                <div className="flex gap-2">
                                  <input
                                    value={newHookDrafts[step.id] || ''}
                                    onChange={(event) => setNewHookDrafts((current) => ({ ...current, [step.id]: event.target.value }))}
                                    placeholder="new_hook_name"
                                    className="glass-input-console text-[12px]"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => createAndBindHookToStep(step.id)}
                                    disabled={!newHookDrafts[step.id] || busy}
                                    className="rounded-xl border border-indigo/18 bg-indigo/[0.08] px-3 py-2 text-[12px] font-semibold text-indigo transition-colors hover:bg-indigo/[0.14] disabled:opacity-40"
                                  >
                                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create'}
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </section>

            <aside className="space-y-6">
              <div className="rounded-[24px] border border-black/[0.06] bg-white/[0.74] p-5 shadow-[var(--shadow-card)] backdrop-blur-xl">
                <p className="text-[12px] font-semibold text-[var(--mist)]">Authoring rules</p>
                <ul className="mt-3 space-y-2 text-[12px] leading-6 text-[var(--fog)]">
                  <li>New authoring stays Procedure-first. Legacy stage runtime is intentionally not part of this page.</li>
                  <li>Routing stays controlled by `enabled` plus current Procedure catalog loading.</li>
                  <li>Step-level Hook bindings are attached through Hook records, not inline JSON.</li>
                </ul>
              </div>

              <div className="rounded-[24px] border border-black/[0.06] bg-white/[0.74] p-5 shadow-[var(--shadow-card)] backdrop-blur-xl">
                <p className="text-[12px] font-semibold text-[var(--mist)]">Current status</p>
                <div className="mt-3 space-y-2 text-[12px] text-[var(--fog)]">
                  <div className="flex items-center justify-between">
                    <span>Routing</span>
                    <span className="font-medium text-[var(--mist)]">{draft.enabled ? 'Enabled' : 'Disabled'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Steps</span>
                    <span className="font-medium text-[var(--mist)]">{draft.steps.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Dirty</span>
                    <span className="font-medium text-[var(--mist)]">{dirty ? 'Unsaved changes' : 'Saved state loaded'}</span>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </PageLoader>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete Procedure type?"
        message={draft.displayName || draft.type ? `This will permanently delete ${draft.displayName || draft.type}.` : 'This will permanently delete this Procedure type.'}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={deleteProcedure}
      />
    </BuildComponentsRouteShell>
  )
}
