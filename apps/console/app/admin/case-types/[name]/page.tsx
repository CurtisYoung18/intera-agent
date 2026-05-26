'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ChevronDown, ChevronRight, Plus, ArrowLeft, Settings2, Bot,
  Wand2, Save, Loader2,
} from 'lucide-react'
import { chatApiUrl } from '@/lib/chat-api'
import SubAgentForm, { type SubAgentConfig } from '@/components/admin/sub-agent-form'

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
  subAgents?: SubAgentConfig[]
}

// ── Default empty sub-agent ────────────────────────────────────────────

function emptySubAgent(model: string): SubAgentConfig {
  return {
    name: '',
    description: '',
    model: model || 'MiniMax-M2.7-highspeed',
    systemPrompt: '',
    skills: [],
    maxIterations: 3,
    parallel: true,
  }
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
  const [expandedStages, setExpandedStages] = useState<Record<string, boolean>>({})

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
    const body = JSON.stringify({ customerId: 'default' })
    Promise.allSettled([
      fetch('/api/admin/config-changed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }),
      fetch(chatApiUrl('/api/admin/config-changed'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }),
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
  const defaultModel = availableModels.length > 0 ? availableModels[0] : 'MiniMax-M2.7-highspeed'

  // Toggle stage expansion
  const toggleStage = (stage: string) => {
    setExpandedStages((prev) => ({ ...prev, [stage]: !prev[stage] }))
  }

  // Update stage config
  const updateStage = (stage: string, patch: Partial<StageCfg>) => {
    if (!ct) return
    const current = stageConfigs[stage] || { name: stage }
    const updated = { ...stageConfigs, [stage]: { ...current, ...patch } }
    setCt({ ...ct, stageConfigs: JSON.stringify(updated) })
  }

  // Add sub-agent to a stage
  const addSubAgent = (stage: string) => {
    const cfg = stageConfigs[stage] || { name: stage }
    const agents = [...(cfg.subAgents || []), emptySubAgent(defaultModel)]
    updateStage(stage, { subAgents: agents })
  }

  // Remove sub-agent from a stage
  const removeSubAgent = (stage: string, idx: number) => {
    const cfg = stageConfigs[stage] || { name: stage }
    const agents = (cfg.subAgents || []).filter((_, i) => i !== idx)
    updateStage(stage, { subAgents: agents })
  }

  // Update a single sub-agent
  const updateSubAgent = (stage: string, idx: number, sa: SubAgentConfig) => {
    const cfg = stageConfigs[stage] || { name: stage }
    const agents = [...(cfg.subAgents || [])]
    agents[idx] = sa
    updateStage(stage, { subAgents: agents })
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

      {/* Lifecycle */}
      <div className="rounded-xl border border-[var(--border-subtle)] bg-white/30 p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[14px] font-semibold text-[var(--mist)]">Lifecycle</h2>
          <button
            type="button"
            onClick={addStage}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border border-[var(--border-subtle)] text-[var(--fog)] hover:text-[var(--mist)] hover:bg-black/[0.03] transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add Stage
          </button>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap p-3 rounded-xl bg-[var(--abyss)]/50 border border-[var(--border-subtle)]">
          {stageNames.map((stage, i) => (
            <div key={stage} className="flex items-center gap-1.5 group/stage">
              <div className="relative">
                <input
                  value={stage}
                  onChange={(e) => renameStage(stage, e.target.value)}
                  className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-white/40 border border-[var(--border-subtle)] text-[var(--mist)] w-[150px] outline-none focus:border-lavender/30 hover:border-lavender/20 transition-colors"
                  title="Click to rename"
                />
                <button
                  type="button"
                  onClick={() => removeStage(stage)}
                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-vermillion/80 text-white flex items-center justify-center text-[8px] opacity-0 group-hover/stage:opacity-100 transition-opacity hover:bg-vermillion"
                  title="Remove stage"
                >
                  x
                </button>
              </div>
              {i < stageNames.length - 1 && (
                <span className="text-[var(--smoke)]/40 text-[11px]">&rarr;</span>
              )}
            </div>
          ))}
          {stageNames.length === 0 && (
            <span className="text-[12px] text-[var(--smoke)] italic">No stages defined — click "Add Stage"</span>
          )}
        </div>
      </div>

      {/* ── Stage-mode: Per-stage sub-agent panels ────────────── */}
      {isStageMode && (
        <div className="space-y-4">
          <h2 className="text-[14px] font-semibold text-[var(--mist)] flex items-center gap-2">
            <Bot className="w-4 h-4 text-gold" />
            Stage Sub-Agents
          </h2>

          {stageNames.map((stage) => {
            const cfg = stageConfigs[stage] || { name: stage }
            const expanded = expandedStages[stage] ?? false
            const subAgents = cfg.subAgents || []

            return (
              <div
                key={stage}
                className="rounded-xl border border-[var(--border-subtle)] bg-white/30 overflow-hidden"
              >
                {/* Stage header */}
                <button
                  type="button"
                  onClick={() => toggleStage(stage)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-black/[0.02] transition-colors text-left"
                >
                  <ChevronRight
                    className={`w-3.5 h-3.5 text-[var(--fog)] transition-transform duration-200 ${
                      expanded ? 'rotate-90' : ''
                    }`}
                  />
                  <Settings2 className="w-4 h-4 text-lavender" />
                  <span className="text-[13px] font-semibold text-[var(--mist)] flex-1">{stage}</span>
                  <span className="text-[10px] text-[var(--smoke)]">
                    {subAgents.length} sub-agent{subAgents.length !== 1 ? 's' : ''}
                  </span>
                </button>

                {expanded && (
                  <div className="px-4 pb-4 space-y-3 border-t border-[var(--border-subtle)]/50 pt-3">
                    {/* Stage prompt (optional, lightweight) */}
                    <label className="space-y-1 block">
                      <span className="text-[10px] text-[var(--fog)] uppercase tracking-wide">Stage Prompt</span>
                      <textarea
                        value={cfg.systemPrompt || ''}
                        onChange={(e) => updateStage(stage, { systemPrompt: e.target.value || undefined })}
                        placeholder="Stage-specific instructions appended to system prompt..."
                        rows={2}
                        className="glass-input-console text-[12px] font-mono resize-y"
                      />
                    </label>

                    {/* Sub-agents */}
                    {subAgents.map((sa, i) => (
                      <SubAgentForm
                        key={i}
                        value={sa}
                        onChange={(updated) => updateSubAgent(stage, i, updated)}
                        onRemove={() => removeSubAgent(stage, i)}
                        allSkills={allSkills}
                        availableModels={
                          availableModels.length > 0
                            ? availableModels
                            : ['MiniMax-M2.7-highspeed', 'MiniMax-M2.5-highspeed']
                        }
                      />
                    ))}

                    {/* Add buttons */}
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => addSubAgent(stage)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-medium text-[var(--fog)] border border-dashed border-[var(--border-subtle)] hover:border-indigo/30 hover:text-indigo transition-all"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add Inline
                      </button>
                      <Link
                        href="/admin/sub-agents"
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-medium text-[var(--fog)] border border-dashed border-[var(--border-subtle)] hover:border-indigo/30 hover:text-indigo transition-all"
                      >
                        <Bot className="w-3.5 h-3.5" />
                        Pick from Registry
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
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
              Configure sub-agents in the registry, then select them as suggestions here.
            </p>
            <Link
              href="/admin/sub-agents"
              className="inline-flex items-center gap-1.5 text-[12px] font-medium text-indigo hover:underline"
            >
              <Bot className="w-3.5 h-3.5" />
              Open Sub-Agent Registry
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
