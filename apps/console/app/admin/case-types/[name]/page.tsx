'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ChevronDown, Plus, ArrowLeft, Settings2, Bot, Puzzle,
  Wand2, Save, Loader2,
} from 'lucide-react'

import StageConfigEditor from '@/components/admin/stage-config-editor'

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
}

interface StageCfg {
  name: string
  description?: string
  model?: string
  systemPrompt?: string
  temperature?: number
  thinkingBudget?: number
  requiredSkills?: string[]
  availableSkills?: string[]
  guardrails?: unknown[]
  evidenceRequirements?: unknown[]
  transition?: unknown
}

// ── Page ───────────────────────────────────────────────────────────────

export default function CaseTypeDetailPage() {
  const params = useParams<{ name: string }>()
  const router = useRouter()
  const name = params.name

  const [ct, setCt] = useState<CaseTypeDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [allSkills, setAllSkills] = useState<string[]>([])
  const [availableModels, setAvailableModels] = useState<string[]>([])
  // Load case type
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/case-types/${encodeURIComponent(name)}`)
      if (!res.ok) {
        router.replace('/admin/case-types')
        return
      }
      const data = await res.json()
      setCt(data.caseType)
    } catch {
      router.replace('/admin/case-types')
    } finally {
      setLoading(false)
    }
  }, [name, router])

  useEffect(() => {
    load()
  }, [load])

  // Fetch skills and models
  useEffect(() => {
    fetch('/api/admin/skills')
      .then((r) => r.json())
      .then((d) => setAllSkills((d.skills || []).map((s: { name: string }) => s.name)))
      .catch(() => {})
    fetch('/api/admin/models')
      .then((r) => r.json())
      .then((d) => setAvailableModels((d.models || []).map((m: { id: string }) => m.id)))
      .catch(() => {})
  }, [])

  const notifyConfigChanged = useCallback(() => {
    const body = JSON.stringify({ orgId: 'default' })
    Promise.allSettled([
      fetch('/api/admin/config-changed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }),
      fetch('/api/admin/config-changed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }),
    ]).catch(() => {})
  }, [])

  // Parse helpers
  const parseStages = (): string[] => {
    try { return JSON.parse(ct?.stages || '[]') } catch { return [] }
  }

  const parseStageConfigs = (): Record<string, StageCfg> => {
    try { return JSON.parse(ct?.stageConfigs || '{}') } catch { return {} }
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

  // Change execution mode with warning
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

    if (ct.executionMode !== 'cc' && newMode === 'cc') {
      // stage -> adaptive
      if (!confirm(
        'Switch to Adaptive mode? Stage-mode sub-agent configs will be archived to JSON metadata but no longer dispatched.'
      )) return
    } else if (ct.executionMode === 'cc' && newMode !== 'cc') {
      // adaptive -> stage
      if (!confirm(
        'Switch to Stage mode? You\'ll need to assign sub-agents per stage. Existing sub-agent suggestions will be preserved.'
      )) return
    }

    setCt({ ...ct, executionMode: newMode })
  }

  // Save
  const handleSave = async () => {
    if (!ct) return
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/case-types/${encodeURIComponent(ct.type)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ct),
      })
      if (!res.ok) {
        alert(`Save failed (${res.status})`)
        return
      }
      notifyConfigChanged()
    } finally {
      setSaving(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--fog)]" />
      </div>
    )
  }

  if (!ct) return null

  return (
    <div className="px-8 py-8 animate-fade-up max-w-3xl">
      {/* Back link */}
      <Link
        href="/admin/case-types"
        className="inline-flex items-center gap-1.5 text-[12px] text-[var(--fog)] hover:text-[var(--mist)] mb-6 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to Case Types
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-[20px] font-semibold text-[var(--mist)]">
            {ct.displayName || ct.type}
          </h1>
          <p className="text-[13px] text-[var(--fog)] mt-0.5 font-mono">{ct.type}</p>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-medium bg-indigo/[0.08] border border-indigo/20 text-indigo hover:bg-indigo/[0.15] transition-all disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save
        </button>
      </div>

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

        {/* Execution Mode selector */}
        <div className="space-y-1.5">
          <span className="text-[10px] text-[var(--fog)] uppercase tracking-wide">Execution Mode</span>
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
              Stage Mode
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
              Adaptive
            </button>
          </div>
          <p className="text-[10px] text-[var(--smoke)]">
            {isStageMode
              ? 'Predefined stage pipeline with configurable guardrails. Best for structured workflows.'
              : 'LLM-driven execution. The agent autonomously plans and adapts — define sub-agents in the global registry.'}
          </p>
        </div>
      </div>

      {/* Lifecycle — Stage mode only */}
      {isStageMode && (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-white/30 p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-[14px] font-semibold text-[var(--mist)]">Lifecycle</h2>
              <p className="text-[11px] text-[var(--fog)] mt-0.5">Define the stage pipeline. Drag to reorder.</p>
            </div>
            <button
              type="button"
              onClick={addStage}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-lavender/[0.08] border border-lavender/20 text-lavender hover:bg-lavender/[0.14] transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add Stage
            </button>
          </div>
          {stageNames.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--border-subtle)] bg-black/[0.01] p-6 text-center">
              <p className="text-[12px] text-[var(--fog)]">
                No stages defined. Click "Add Stage" to build the pipeline.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {stageNames.map((stage, i) => (
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
                    placeholder="Stage name"
                  />

                  {/* Arrow to next */}
                  {i < stageNames.length - 1 && (
                    <span className="text-[var(--smoke)]/30 text-[16px]">→</span>
                  )}

                  {/* Remove */}
                  <button
                    type="button"
                    onClick={() => removeStage(stage)}
                    className="w-6 h-6 rounded-md flex items-center justify-center text-[var(--smoke)]/30 hover:text-vermillion hover:bg-vermillion/[0.06] transition-colors opacity-0 group-hover:opacity-100"
                    title="Remove stage"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Adaptive mode: SOP document editor */}
      {!isStageMode && (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-white/30 p-5 mb-6">
          <h2 className="text-[14px] font-semibold text-[var(--mist)] mb-1">SOP Document</h2>
          <p className="text-[11px] text-[var(--fog)] mb-3">
            The SOP (Standard Operating Procedure) guides the agent in Adaptive mode. Write it as a step-by-step playbook — the agent uses this to plan its investigation via todo_write/todo_read.
          </p>
          <textarea
            value={ct.sop || ''}
            onChange={(e) => setCt({ ...ct, sop: e.target.value })}
            placeholder={`Example SOP for deposit_issue:\n\n1. Greet the customer and acknowledge their deposit issue\n2. Ask for transaction ID, amount, and payment method\n3. Call query_order_status with the transaction ID\n4. If status is pending, call query_payment_channel_status\n5. If channel shows delayed batch, inform customer of ETA\n6. If payment not found at all, escalate to payment_ops`}
            rows={10}
            className="glass-input-console text-[12px] font-mono resize-y w-full"
          />
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

      {/* ── Stage-mode: Full stage configuration ────────────── */}
      {isStageMode && (
        <div className="space-y-4">
          <StageConfigEditor
            stages={stageNames}
            stageConfigs={stageConfigs as any}
            allSkills={allSkills}
            availableModels={availableModels.length > 0 ? availableModels : ['MiniMax-M2.7-highspeed']}
            onChange={(updated) => {
              if (ct) setCt({ ...ct, stageConfigs: JSON.stringify(updated) })
            }}
          />
        </div>
      )}

      {/* ── Adaptive mode: Sub-agent suggestions ──────────────── */}
      {!isStageMode && (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-white/30 p-5 space-y-4">
          <h2 className="text-[14px] font-semibold text-[var(--mist)] flex items-center gap-2">
            <Bot className="w-4 h-4 text-gold" />
            Sub-Agent Suggestions
          </h2>
          <p className="text-[12px] text-[var(--fog)]">
            Suggested sub-agents appear in the main agent&apos;s prompt as preferred candidates.
            The agent can pick any registered sub-agent to dispatch subtasks.
          </p>

          {/* For now, show a message linking to the registry */}
          <div className="p-4 rounded-lg bg-[var(--abyss)]/30 border border-[var(--border-subtle)] text-center">
            <p className="text-[12px] text-[var(--fog)] mb-3">
              Each case type acts as a sub-agent. Configure stage SOPs and skill suggestions to define sub-agent behavior.
            </p>
            <Link
              href="/admin/tools"
              className="inline-flex items-center gap-1.5 text-[12px] font-medium text-indigo hover:underline"
            >
              <Puzzle className="w-3.5 h-3.5" />
              Manage Skills & Tools
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
