'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Settings2,
  Wand2, Loader2, Trash2, Code, Layout, CheckCircle, XCircle, Plus,
} from 'lucide-react'

import StageConfigEditor from '@/components/admin/stage-config-editor'
import ChipInput from '@/components/ui/chip-input'
import ConfirmDialog from '@/components/ui/confirm-dialog'
import { apiClient, bustConfigCache } from '@/lib/api/client'
import { useSession } from '@/lib/hooks/use-session'
import { PageLoader } from '@/components/ui/page-loader'
import VersionContextBar, { useSelectedAgentId } from '@/components/admin/version-context-bar'
import { PROCEDURE_ACTIONS, parseProcedure } from '@intera/shared/contracts/case-types'

// ── Types ──────────────────────────────────────────────────────────────

interface CaseTypeDetail {
  id: string
  type: string
  displayName: string
  description: string
  icon: string
  defaultGoal: string
  stages: string
  requiredFacts: string
  escalateOn: string
  autoCloseConditions: string
  stageConfigs: string
  orchestratorConfig: string
  enabled: boolean
  requireHumanReview?: boolean
  executionMode?: string
  sop?: string | null
  sopMaxAutoTurns?: number
  procedure?: string | null
  guardrails?: string | null
}

interface StageCfg {
  name: string
  description?: string
  model?: string
  systemPrompt?: string
  temperature?: number
  thinkingBudget?: number
  maxIterations?: number
  requiredSkills?: string[]
  availableSkills?: string[]
  guardrails?: unknown[]
  evidenceRequirements?: unknown[]
  transition?: unknown
}

interface ProcedureStepInput {
  id: string
  action: (typeof PROCEDURE_ACTIONS)[number]
  target: string
  guidance: string
  when: string
  required: boolean
}

interface HookBinding {
  id: string
  hookName?: string | null
  scopeType: 'agent' | 'caseType' | 'procedureStep' | 'tool'
  scopeKey: string
  caseTypeId?: string | null
  procedureStepId?: string | null
  enabled: boolean
}

interface ProcedureHook {
  id: string
  name: string
  displayName?: string | null
  enabled: boolean
  bindings: HookBinding[]
}

type HookBindingKind = 'agent' | 'caseType' | 'procedureStep'

type FormMode = 'simple' | 'advanced'

// ── Page ───────────────────────────────────────────────────────────────

export default function CaseTypeDetailPage() {
  const params = useParams<{ name: string }>()
  const router = useRouter()
  const name = params.name

  const [ct, setCt] = useState<CaseTypeDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(null)
  const ctRef = useRef(ct)
  const loadedRef = useRef(false)
  const agentConfigId = useSelectedAgentId()
  const [allTools, setAllTools] = useState<string[]>([])
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [confirmDeleteName, setConfirmDeleteName] = useState<string | null>(null)
  const [confirmExecMode, setConfirmExecMode] = useState<string | null>(null)
  const [hooks, setHooks] = useState<ProcedureHook[]>([])
  const [hookStepDrafts, setHookStepDrafts] = useState<Record<string, string>>({})
  const [newHookDrafts, setNewHookDrafts] = useState<Record<string, string>>({})
  const [hookBusyStepId, setHookBusyStepId] = useState<string | null>(null)
  const { orgId } = useSession()

  // Form mode for JSON fields
  const [fieldsMode, setFieldsMode] = useState<Record<string, FormMode>>({
    stages: 'simple',
    requiredFacts: 'simple',
    escalateOn: 'simple',
    autoCloseConditions: 'simple',
  })

  // Load case type
  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (!agentConfigId) return
      const result = await apiClient<{ caseType: CaseTypeDetail }>(`/api/admin/case-types/${encodeURIComponent(name)}?agentConfigId=${encodeURIComponent(agentConfigId)}`)
      setCt(result.data.caseType)
      loadedRef.current = true
      setHookBusyStepId(null)
    } catch {
      router.replace('/admin/case-types')
    } finally {
      setLoading(false)
    }
  }, [name, router, agentConfigId])

  useEffect(() => {
    load()
  }, [load])

  const notifyConfigChanged = useCallback(() => {
    bustConfigCache(orgId).catch(() => {})
  }, [orgId])

  useEffect(() => {
    ctRef.current = ct
    if (loadedRef.current && ct) {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      setSyncStatus('syncing')
      saveTimer.current = setTimeout(async () => {
        const current = ctRef.current
        if (!current) return
        if (!agentConfigId) return
        try {
          await apiClient(`/api/admin/case-types/${encodeURIComponent(current.type)}?agentConfigId=${encodeURIComponent(agentConfigId)}`, {
            method: 'PUT',
            body: { ...current, agentConfigId },
          })
          notifyConfigChanged()
          setSyncStatus('synced')
          setSaveError(null)
        } catch {
          setSaveError('Save failed')
          setSyncStatus('error')
        }
      }, 800)
    }
  }, [ct, notifyConfigChanged, agentConfigId])

  // Fetch skills and models
  useEffect(() => {
    apiClient<{ tools?: Array<{ name: string }> }>('/api/admin/tools')
      .then((r) => setAllTools((r.data.tools || []).map((s) => s.name)))
      .catch(() => {})
    apiClient<{ models?: Array<{ id: string }> }>('/api/admin/models')
      .then((r) => setAvailableModels((r.data.models || []).map((m) => m.id)))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!agentConfigId) return
    apiClient<{ hooks: ProcedureHook[] }>(`/api/admin/hooks?agentConfigId=${encodeURIComponent(agentConfigId)}`)
      .then((r) => setHooks(r.data.hooks || []))
      .catch(() => setHooks([]))
  }, [agentConfigId])

  // Parse helpers
  const parseStages = (): string[] => {
    try { return JSON.parse(ct?.stages || '[]') } catch { return [] }
  }

  const parseField = (field: string): string[] => {
    try { return JSON.parse(ct ? (ct as any)[field] || '[]' : '[]') } catch { return [] }
  }

  const setParsedField = (field: string, values: string[]) => {
    if (!ct) return
    setCt({ ...ct, [field]: JSON.stringify(values) })
  }

  const parseStageConfigs = (): Record<string, StageCfg> => {
    try { return JSON.parse(ct?.stageConfigs || '{}') } catch { return {} }
  }

  const parseProcedureState = (): ProcedureStepInput[] => {
    const procedure = ct?.procedure ? parseProcedure(ct.procedure) : null
    if (!procedure?.steps?.length) return []
    return procedure.steps.map((step: {
      id: string
      action: (typeof PROCEDURE_ACTIONS)[number]
      target?: string
      guidance?: string
      when?: string
      required?: boolean
    }) => ({
      id: step.id,
      action: step.action,
      target: step.target || '',
      guidance: step.guidance || '',
      when: step.when || '',
      required: !!step.required,
    }))
  }

  const setProcedureSteps = (steps: ProcedureStepInput[]) => {
    if (!ct) return
    setCt({ ...ct, procedure: JSON.stringify({ steps }) })
  }

  const parseLegacyGuardrails = (): string[] => {
    if (!ct?.guardrails) return []
    try {
      const parsed = JSON.parse(ct.guardrails)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  const getBindingsForStep = (scopeType: HookBindingKind, stepId: string) => {
    return hooks.flatMap((hook) =>
      hook.bindings
        .filter((binding) => {
          if (!binding.enabled) return false
          if (binding.scopeType !== scopeType) return false
          if (scopeType === 'agent') return true
          if (binding.caseTypeId !== ct?.id) return false
          if (scopeType === 'caseType') return true
          return binding.procedureStepId === stepId
        })
        .map((binding) => ({
          ...binding,
          hookName: binding.hookName || hook.name,
        }))
    )
  }

  const getCaseStepBindings = (stepId: string) => getBindingsForStep('procedureStep', stepId)

  const isHookAlreadyBoundToStep = (stepId: string, hookName: string) =>
    getBindingsForStep('procedureStep', stepId).some((binding) => binding.hookName === hookName)

  const addProcedureStep = () => {
    if (!ct) return
    const steps = parseProcedureState()
    const stepId = `step_${steps.length + 1}`
    steps.push({
      id: stepId,
      action: PROCEDURE_ACTIONS[0],
      target: '',
      guidance: '',
      when: '',
      required: false,
    })
    setProcedureSteps(steps)
  }

  const updateProcedureStep = (index: number, patch: Partial<ProcedureStepInput>) => {
    if (!ct) return
    const steps = parseProcedureState()
    if (!steps[index]) return
    steps[index] = { ...steps[index], ...patch }
    setProcedureSteps(steps)
  }

  const removeProcedureStep = (index: number) => {
    if (!ct) return
    const steps = parseProcedureState()
    steps.splice(index, 1)
    setProcedureSteps(steps)
  }

  const bindExistingHookToStep = async (stepId: string) => {
    const selectedName = hookStepDrafts[stepId]?.trim()
    if (!agentConfigId || !ct || !selectedName) return
    setHookBusyStepId(stepId)
    try {
      await apiClient(`/api/admin/hooks/${encodeURIComponent(selectedName)}/bindings`, {
        method: 'POST',
        body: {
          agentConfigId,
          scopeType: 'procedureStep',
          caseTypeId: ct.id,
          procedureStepId: stepId,
        },
      })
      setHookStepDrafts((prev) => ({ ...prev, [stepId]: '' }))
      await bustConfigCache(orgId).catch(() => {})
      const result = await apiClient<{ hooks: ProcedureHook[] }>(`/api/admin/hooks?agentConfigId=${encodeURIComponent(agentConfigId)}`)
      setHooks(result.data.hooks || [])
    } catch {
      setSaveError('Failed to bind hook')
    } finally {
      setHookBusyStepId(null)
    }
  }

  const createAndBindHookToStep = async (stepId: string) => {
    const hookName = newHookDrafts[stepId]?.trim()
    if (!agentConfigId || !ct || !hookName) return
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
          caseTypeId: ct.id,
          procedureStepId: stepId,
        },
      })
      setNewHookDrafts((prev) => ({ ...prev, [stepId]: '' }))
      await bustConfigCache(orgId).catch(() => {})
      const result = await apiClient<{ hooks: ProcedureHook[] }>(`/api/admin/hooks?agentConfigId=${encodeURIComponent(agentConfigId)}`)
      setHooks(result.data.hooks || [])
    } catch {
      setSaveError('Failed to create hook')
    } finally {
      setHookBusyStepId(null)
    }
  }

  const removeStepBinding = async (stepId: string, hookName: string, bindingId: string) => {
    if (!agentConfigId) return
    setHookBusyStepId(stepId)
    try {
      await apiClient(`/api/admin/hooks/${encodeURIComponent(hookName)}/bindings/${encodeURIComponent(bindingId)}?agentConfigId=${encodeURIComponent(agentConfigId)}`, {
        method: 'DELETE',
      })
      await bustConfigCache(orgId).catch(() => {})
      const result = await apiClient<{ hooks: ProcedureHook[] }>(`/api/admin/hooks?agentConfigId=${encodeURIComponent(agentConfigId)}`)
      setHooks(result.data.hooks || [])
    } catch {
      setSaveError('Failed to remove hook binding')
    } finally {
      setHookBusyStepId(null)
    }
  }

  const stageNames = parseStages()
  const stageConfigs = parseStageConfigs()
  const isStageMode = ct?.executionMode !== 'cc'

  // Update stage config (used by StageConfigEditor onChange callback)
  const updateStage = (stage: string, patch: Partial<StageCfg>) => {
    if (!ct) return
    const current = stageConfigs[stage] || { name: stage }
    const updated = { ...stageConfigs, [stage]: { ...current, ...patch } }
    setCt({ ...ct, stageConfigs: JSON.stringify(updated) })
  }

  // ── Stage management ──────────────────────────────────────────

  const addStage = () => {
    if (!ct) return
    const stages = parseStages()
    const name = `stage_${stages.length + 1}`
    stages.push(name)
    setCt({ ...ct, stages: JSON.stringify(stages) })
  }

  const removeStage = (stage: string) => {
    if (!ct) return
    const stages = parseStages().filter((s) => s !== stage)
    setCt({ ...ct, stages: JSON.stringify(stages) })
  }

  const renameStage = (oldName: string, newName: string) => {
    if (!ct || !newName.trim()) return
    const stages = parseStages().map((s) => (s === oldName ? newName.trim() : s))
    setCt({ ...ct, stages: JSON.stringify(stages) })
    // Also rename in stageConfigs
    const cfgs = parseStageConfigs()
    if (cfgs[oldName]) {
      cfgs[newName.trim()] = cfgs[oldName]
      delete cfgs[oldName]
      setCt((prev) => prev ? { ...prev, stageConfigs: JSON.stringify(cfgs) } : prev)
    }
  }

  const changeExecutionMode = (newMode: string) => {
    if (!ct) return
    if (newMode === ct.executionMode) return
    setConfirmExecMode(newMode)
  }

  const confirmExecModeChange = () => {
    if (!ct || !confirmExecMode) return
    setCt({ ...ct, executionMode: confirmExecMode })
    setConfirmExecMode(null)
  }

  // Delete
  const handleDelete = () => {
    if (!ct) return
    setConfirmDeleteName(ct.type)
  }

  const confirmDelete = async () => {
    if (!confirmDeleteName) return
    setConfirmDeleteName(null)
    if (!agentConfigId) return
    try {
      await apiClient(`/api/admin/case-types/${encodeURIComponent(confirmDeleteName)}?agentConfigId=${encodeURIComponent(agentConfigId)}`, { method: 'DELETE' })
    } catch {
      setSaveError('Save failed')
      return
    }
    router.replace('/admin/case-types')
  }

  // ── Render ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--fog)]" />
      </div>
    )
  }

  if (!agentConfigId) {
    return (
      <PageLoader loading={false} error="Select an agent configuration first." onRetry={() => window.location.reload()}>
        <div />
      </PageLoader>
    )
  }

  if (!ct) return null

  const stageList = parseStages()
  const requiredFactsList = parseField('requiredFacts')
  const escalateOnList = parseField('escalateOn')
  const autoCloseConditionsList = parseField('autoCloseConditions')
  const procedureSteps = parseProcedureState()
  const legacyHooks = parseLegacyGuardrails()

  const renderFieldEditor = (field: string, label: string, helpText: string) => {
    const mode = fieldsMode[field] || 'simple'
    const values = parseField(field)

    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-[var(--fog)]">{label}</span>
          <div className="flex rounded border border-[var(--border-subtle)] bg-black/[0.02] p-0.5">
            <button
              type="button"
              onClick={() => setFieldsMode({ ...fieldsMode, [field]: 'simple' })}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                mode === 'simple'
                  ? 'bg-white shadow-sm text-[var(--mist)]'
                  : 'text-[var(--fog)] hover:text-[var(--mist)]'
              }`}
            >
              <Layout className="w-3 h-3 inline mr-0.5" />
              Simple
            </button>
            <button
              type="button"
              onClick={() => setFieldsMode({ ...fieldsMode, [field]: 'advanced' })}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                mode === 'advanced'
                  ? 'bg-white shadow-sm text-[var(--mist)]'
                  : 'text-[var(--fog)] hover:text-[var(--mist)]'
              }`}
            >
              <Code className="w-3 h-3 inline mr-0.5" />
              JSON
            </button>
          </div>
        </div>
        {helpText && (
          <p className="text-[10px] text-[var(--smoke)] -mt-1">{helpText}</p>
        )}
        {mode === 'simple' ? (
          <ChipInput
            values={values}
            onChange={(v) => setParsedField(field, v)}
            placeholder={`Add ${label.toLowerCase()}…`}
          />
        ) : (
          <textarea
            value={ct ? String((ct as any)[field] || '[]') : '[]'}
            onChange={(e) => {
              if (!ct) return
              setCt({ ...ct, [field]: e.target.value })
            }}
            rows={4}
            className="glass-input-console text-[12px] font-mono resize-y"
          />
        )}
      </div>
    )
  }

  return (
    <div className="px-8 py-8 animate-fade-up max-w-3xl">
      <VersionContextBar />
      {/* Back link */}
      <div className="flex items-center justify-between mb-6">
        <Link
          href="/admin/case-types"
          className="inline-flex items-center gap-1.5 text-[12px] text-[var(--fog)] hover:text-[var(--mist)] transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Procedure Types
        </Link>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDelete}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] text-vermillion/70 hover:bg-vermillion/5 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
        </div>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-[20px] font-semibold text-[var(--mist)]">
            {ct.displayName || ct.type}
          </h1>
          <p className="text-[13px] text-[var(--fog)] mt-0.5 font-mono">{ct.type}</p>
        </div>
        {/* Persistent save-state chip */}
        <div className="flex items-center gap-2 rounded-xl border border-black/[0.06] bg-white/60 px-3 py-2">
          {syncStatus === 'syncing' ? (
            <><Loader2 className="w-3 h-3 animate-spin text-amber" /><span className="text-[11px] font-medium text-amber">Saving…</span></>
          ) : syncStatus === 'error' ? (
            <><XCircle className="w-3 h-3 text-vermillion" /><span className="text-[11px] font-medium text-vermillion">Failed</span></>
          ) : (
            <><CheckCircle className="w-3 h-3 text-malachite" /><span className="text-[11px] font-medium text-malachite">Saved</span></>
          )}
        </div>
      </div>

      {saveError && (
        <div className="mb-4 text-[12px] text-vermillion bg-vermillion/[0.06] border border-vermillion/15 rounded-lg px-3 py-2">{saveError}</div>
      )}

      {/* Basic info */}
      <div className="rounded-xl border border-[var(--border-subtle)] bg-white/30 p-5 space-y-4 mb-6">
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-[10px] text-[var(--fog)] uppercase tracking-wide">Display Name</span>
            <input
              value={ct.displayName || ''}
              onChange={(e) => setCt({ ...ct, displayName: e.target.value })}
              className="glass-input-console text-[13px]"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] text-[var(--fog)] uppercase tracking-wide">Icon</span>
            <input
              value={ct.icon || ''}
              onChange={(e) => setCt({ ...ct, icon: e.target.value })}
              className="glass-input-console text-[13px]"
            />
          </label>
        </div>
        <label className="space-y-1 block">
          <span className="text-[10px] text-[var(--fog)] uppercase tracking-wide">Description</span>
          <input
            value={ct.description || ''}
            onChange={(e) => setCt({ ...ct, description: e.target.value })}
            className="glass-input-console text-[13px]"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-[10px] text-[var(--fog)] uppercase tracking-wide">Default Goal</span>
            <input
              value={ct.defaultGoal || ''}
              onChange={(e) => setCt({ ...ct, defaultGoal: e.target.value })}
              className="glass-input-console text-[13px]"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] text-[var(--fog)] uppercase tracking-wide">Type Key</span>
            <input
              value={ct.type}
              disabled
              className="glass-input-console text-[13px] font-mono opacity-50"
            />
          </label>
        </div>

        <label className="flex items-center gap-2 cursor-pointer py-1">
          <input
            type="checkbox"
            checked={ct.enabled}
            onChange={(e) => setCt({ ...ct, enabled: e.target.checked })}
            className="accent-indigo rounded"
          />
          <span className="text-[12px] text-[var(--fog)]">Eligible for intent routing</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer py-1">
          <input
            type="checkbox"
            checked={!!ct.requireHumanReview}
            onChange={(e) => setCt({ ...ct, requireHumanReview: e.target.checked })}
            className="accent-vermillion rounded"
          />
          <span className="text-[12px] text-[var(--fog)]">Require human review before the procedure final response</span>
        </label>

        {/* Execution Mode selector */}
        <div className="space-y-1.5">
          <span className="text-[10px] text-[var(--fog)] uppercase tracking-wide">Procedure Runtime</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => changeExecutionMode('stage')}
              className={`flex-1 py-2 px-3 rounded-lg text-[12px] font-medium border transition-all flex items-center justify-center gap-1.5 ${
                isStageMode
                  ? 'bg-lavender/[0.12] border-lavender/30 text-lavender'
                  : 'bg-transparent border-[var(--border-subtle)] text-[var(--fog)] hover:border-[var(--border-hover)]'
              }`}
              >
                <Settings2 className="w-3.5 h-3.5" />
              Legacy runtime
            </button>
            <button
              type="button"
              onClick={() => changeExecutionMode('cc')}
              className={`flex-1 py-2 px-3 rounded-lg text-[12px] font-medium border transition-all flex items-center justify-center gap-1.5 ${
                !isStageMode
                  ? 'bg-malachite/[0.12] border-malachite/30 text-malachite'
                  : 'bg-transparent border-[var(--border-subtle)] text-[var(--fog)] hover:border-[var(--border-hover)]'
              }`}
            >
              <Wand2 className="w-3.5 h-3.5" />
              Procedure
            </button>
          </div>
          <p className="text-[10px] text-[var(--smoke)]">
            {isStageMode
              ? 'Legacy runtime mode (migration only). New configurations should use Procedure mode with step-level Hook bindings.'
              : 'Procedure mode executes defined steps and evaluates hook bindings at each step. Hook behavior is inherited from Agent/CaseType scopes.'}
          </p>
        </div>

        {/* Structured field editors with JSON escape hatch */}
        <div className="border-t border-[var(--border-subtle)] pt-4 space-y-4">
          {renderFieldEditor('requiredFacts', 'Required Facts', 'Facts the agent must collect before advancing (e.g. transaction_id, amount, payment_method)')}
          {renderFieldEditor('escalateOn', 'Escalate On', 'Conditions that trigger human escalation (e.g. "payment_not_found", "fraud_suspected")')}
          {renderFieldEditor('autoCloseConditions', 'Auto-Close Conditions', 'Conditions that allow automatic case resolution')}
        </div>

        {legacyHooks.length > 0 && (
          <div className="rounded-lg border border-[var(--border-subtle)] bg-black/[0.02] p-3 text-[11px] text-[var(--smoke)]">
            Legacy hook references (read-only migration data only): {legacyHooks.join(', ')}
          </div>
        )}
      </div>

      {/* Lifecycle — legacy runtime mode only */}
      {isStageMode && (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-white/30 p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-[14px] font-semibold text-[var(--mist)]">Legacy runtime steps</h2>
              <p className="text-[11px] text-[var(--fog)] mt-0.5">Migration-only ordering data. New work should use Procedure Steps.</p>
            </div>
            <button
              type="button"
              onClick={addStage}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-lavender/[0.08] border border-lavender/20 text-lavender hover:bg-lavender/[0.14] transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add Legacy Step
            </button>
          </div>
          {stageList.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--border-subtle)] bg-black/[0.01] p-6 text-center">
              <p className="text-[12px] text-[var(--fog)]">
                No legacy runtime steps defined. Click "Add Legacy Step" only when preserving migration data.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {stageList.map((stage, i) => (
                <div
                  key={stage}
                  className="flex items-center gap-3 p-3 rounded-lg bg-white/60 border border-[var(--border-subtle)] group hover:border-lavender/20 transition-colors"
                >
                  {/* Step number */}
                  <div className="w-7 h-7 rounded-full bg-lavender/[0.1] text-lavender flex items-center justify-center text-[11px] font-bold flex-shrink-0">
                    {i + 1}
                  </div>

                  {/* Stage name input */}
                  <input
                    value={stage}
                    onChange={(e) => renameStage(stage, e.target.value)}
                    className="flex-1 px-2.5 py-1.5 rounded-md bg-transparent text-[12px] font-medium text-[var(--mist)] outline-none border border-transparent focus:border-lavender/25 hover:border-[var(--border-subtle)] transition-colors"
                    placeholder="Legacy step name"
                  />

                  {/* Arrow to next */}
                  {i < stageList.length - 1 && (
                    <span className="text-[var(--smoke)]/30 text-[16px]">→</span>
                  )}

                  {/* Remove */}
                  <button
                    type="button"
                    onClick={() => removeStage(stage)}
                    className="w-6 h-6 rounded-md flex items-center justify-center text-[var(--smoke)]/30 hover:text-vermillion hover:bg-vermillion/[0.06] transition-colors opacity-0 group-hover:opacity-100"
                    title="Remove legacy step"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Legacy runtime steps JSON escape hatch */}
          <details className="mt-3 rounded-lg border border-[var(--border-subtle)] bg-black/[0.02] px-3 py-2">
            <summary className="text-[10px] text-[var(--fog)] cursor-pointer">Edit legacy runtime steps as JSON</summary>
            <textarea
              value={ct.stages || '[]'}
              onChange={(e) => setCt({ ...ct, stages: e.target.value })}
              rows={3}
              className="glass-input-console text-[12px] font-mono resize-y mt-2 w-full"
            />
          </details>
        </div>
      )}

      {/* Adaptive mode: SOP document editor */}
      {!isStageMode && (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-white/30 p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-[14px] font-semibold text-[var(--mist)]">Procedure Steps</h2>
              <p className="text-[11px] text-[var(--fog)] mt-0.5">Define step-by-step actions and bind Hooks per step.</p>
            </div>
            <button
              type="button"
              onClick={addProcedureStep}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-malachite/[0.08] border border-malachite/20 text-malachite hover:bg-malachite/[0.14] transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add Step
            </button>
          </div>

          <p className="text-[11px] text-[var(--fog)] mb-3">
            Procedure steps live in the CaseType procedure JSON and can be tied to step-level Hook bindings.
          </p>

          {procedureSteps.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[var(--border-subtle)] bg-black/[0.01] px-4 py-3 text-[12px] text-[var(--fog)]">
              No steps yet. Add a step to configure Hook bindings per action.
            </p>
          ) : (
            <div className="space-y-3">
              {procedureSteps.map((step, index) => {
                const caseScopeBindings = getBindingsForStep('caseType', step.id)
                const agentScopeBindings = getBindingsForStep('agent', step.id)
                const directBindings = getCaseStepBindings(step.id)

                return (
                  <div key={step.id} className="rounded-lg border border-[var(--border-subtle)] bg-white/70 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <input
                        value={step.id}
                        onChange={(event) => updateProcedureStep(index, { id: event.target.value })}
                        className="glass-input-console text-[12px] font-semibold"
                        placeholder="step id"
                      />
                      <select
                        value={step.action}
                        onChange={(event) => updateProcedureStep(index, { action: event.target.value as (typeof PROCEDURE_ACTIONS)[number] })}
                        className="glass-input-console text-[12px]"
                      >
                        {PROCEDURE_ACTIONS.map((action) => <option key={action} value={action}>{action}</option>)}
                      </select>
                      <button
                        type="button"
                        onClick={() => removeProcedureStep(index)}
                        className="px-2 py-1 rounded border border-vermillion/25 text-[11px] text-vermillion hover:bg-vermillion/[0.08]"
                      >
                        Remove
                      </button>
                    </div>
                    <label className="space-y-1 block">
                      <span className="text-[10px] text-[var(--fog)]">Target</span>
                      <input
                        value={step.target}
                        onChange={(event) => updateProcedureStep(index, { target: event.target.value })}
                        className="glass-input-console text-[12px]"
                      />
                    </label>
                    <label className="space-y-1 block">
                      <span className="text-[10px] text-[var(--fog)]">When</span>
                      <input
                        value={step.when}
                        onChange={(event) => updateProcedureStep(index, { when: event.target.value })}
                        className="glass-input-console text-[12px]"
                      />
                    </label>
                    <label className="space-y-1 block">
                      <span className="text-[10px] text-[var(--fog)]">Guidance</span>
                      <textarea
                        value={step.guidance}
                        onChange={(event) => updateProcedureStep(index, { guidance: event.target.value })}
                        rows={2}
                        className="glass-input-console text-[12px]"
                      />
                    </label>
                    <label className="flex items-center gap-2 text-[11px] text-[var(--fog)]">
                      <input
                        type="checkbox"
                        checked={step.required}
                        onChange={(event) => updateProcedureStep(index, { required: event.target.checked })}
                      />
                      Required to proceed
                    </label>

                    <div className="rounded-lg border border-[var(--border-subtle)] bg-black/[0.02] p-3 space-y-3">
                      <div>
                        <p className="text-[10px] font-medium text-[var(--fog)] mb-1">Inherited active hooks</p>
                        <div className="flex flex-wrap gap-2 text-[11px]">
                          {(agentScopeBindings.length > 0 || caseScopeBindings.length > 0) ? (
                            <>
                              {agentScopeBindings.map((binding) => (
                                <span key={`agent-${binding.hookName}-${binding.id}`} className="px-2 py-1 rounded-full bg-[var(--abyss)]/10 text-[var(--fog)]">
                                  {binding.hookName}
                                </span>
                              ))}
                              {caseScopeBindings.map((binding) => (
                                <span key={`case-${binding.hookName}-${binding.id}`} className="px-2 py-1 rounded-full bg-[var(--smoke)]/10 text-[var(--fog)]">
                                  {binding.hookName}
                                </span>
                              ))}
                            </>
                          ) : (
                            <span className="text-[var(--smoke)]">No inherited active hooks.</span>
                          )}
                        </div>
                      </div>

                      <div>
                        <p className="text-[10px] font-medium text-[var(--fog)] mb-1">Hooks for this step</p>
                        {directBindings.length === 0 ? (
                          <p className="text-[11px] text-[var(--smoke)]">No direct step hooks bound.</p>
                        ) : (
                          <div className="space-y-2">
                            {directBindings.map((binding) => (
                              <div key={binding.id} className="rounded border border-[var(--border-subtle)] bg-white/60 px-2 py-1.5 flex items-center justify-between gap-2">
                                <span className="text-[11px] text-[var(--mist)]">{binding.hookName}</span>
                                <button
                                  type="button"
                                  onClick={() => removeStepBinding(step.id, String(binding.hookName), binding.id)}
                                  disabled={hookBusyStepId === step.id}
                                  className="text-[11px] text-vermillion hover:underline disabled:opacity-50"
                                >
                                  Remove
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <label className="space-y-1 block">
                        <span className="text-[10px] text-[var(--fog)]">Bind existing Hook to this step</span>
                        <div className="flex gap-2">
                          <select
                            value={hookStepDrafts[step.id] || ''}
                            onChange={(event) => setHookStepDrafts((prev) => ({ ...prev, [step.id]: event.target.value }))}
                            className="glass-input-console text-[12px] flex-1"
                            data-testid={`procedure-step-${step.id}-existing-hook-select`}
                          >
                            <option value="">Select hook</option>
                            {hooks.map((hook) => (
                              <option
                                key={hook.name}
                                value={hook.name}
                                disabled={!hook.enabled || isHookAlreadyBoundToStep(step.id, hook.name)}
                              >
                                {hook.displayName || hook.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => bindExistingHookToStep(step.id)}
                            disabled={!hookStepDrafts[step.id] || hookBusyStepId === step.id}
                            className="px-3 py-2 rounded border border-lavender/25 text-[11px] text-lavender hover:bg-lavender/[0.08] disabled:opacity-50"
                            data-testid={`procedure-step-${step.id}-existing-hook-add`}
                          >
                            Add
                          </button>
                        </div>
                      </label>

                      <label className="space-y-1 block">
                        <span className="text-[10px] text-[var(--fog)]">Create and bind new Hook to this step</span>
                        <div className="flex gap-2">
                          <input
                            value={newHookDrafts[step.id] || ''}
                            onChange={(event) => setNewHookDrafts((prev) => ({ ...prev, [step.id]: event.target.value }))}
                            className="glass-input-console text-[12px] flex-1"
                            placeholder="new_hook_name"
                            data-testid={`procedure-step-${step.id}-new-hook-input`}
                          />
                          <button
                            type="button"
                            onClick={() => createAndBindHookToStep(step.id)}
                            disabled={!newHookDrafts[step.id] || hookBusyStepId === step.id}
                            className="px-3 py-2 rounded border border-malachite/25 text-[11px] text-malachite hover:bg-malachite/[0.08] disabled:opacity-50"
                            data-testid={`procedure-step-${step.id}-new-hook-create`}
                          >
                            Create & Bind
                          </button>
                        </div>
                      </label>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <label className="space-y-1 block mt-3">
            <span className="text-[10px] text-[var(--fog)] uppercase tracking-wide">Max Auto Turns</span>
            <input
              type="number"
              value={ct.sopMaxAutoTurns ?? 10}
              onChange={(e) => setCt({ ...ct, sopMaxAutoTurns: parseInt(e.target.value) || 10 })}
              min={3} max={30}
              className="glass-input-console text-[13px] w-24"
            />
          </label>
        </div>
      )}

      {/* ── Legacy runtime: full migration configuration ─────── */}
      {isStageMode && (
        <div className="space-y-4">
          <StageConfigEditor
            stages={stageList}
            stageConfigs={stageConfigs as any}
            allSkills={allTools}
            availableModels={availableModels.length > 0 ? availableModels : ['MiniMax-M2.7-highspeed']}
            onChange={(updated) => {
              if (ct) setCt({ ...ct, stageConfigs: JSON.stringify(updated) })
            }}
          />
        </div>
      )}

      {/* ── Delete Confirmation Dialog ── */}
      <ConfirmDialog
        open={!!confirmDeleteName}
        title="Delete Procedure Type"
        message={confirmDeleteName ? `Permanently delete "${confirmDeleteName}"? This action cannot be undone.` : ''}
        onConfirm={confirmDelete}
        onCancel={() => setConfirmDeleteName(null)}
      />

      {/* ── Execution Mode Change Confirmation ── */}
      <ConfirmDialog
        open={!!confirmExecMode}
        title="Change Execution Mode"
        message={
          confirmExecMode === 'cc'
            ? 'Switch to Procedure mode? Legacy runtime migration data will be preserved as read-only scope metadata.'
            : 'Switch to legacy runtime mode? Existing step Hooks and execution config are preserved as read-only migration data.'
        }
        variant="warning"
        confirmLabel="Switch"
        onConfirm={confirmExecModeChange}
        onCancel={() => setConfirmExecMode(null)}
      />
    </div>
  )
}
