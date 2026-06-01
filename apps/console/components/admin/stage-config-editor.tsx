'use client'

import { useState } from 'react'
import {
  ChevronDown, ChevronRight, ArrowRight, Plus, Trash2, GripVertical,
  Cpu, Shield, FileText, GitBranch, Bot, Wrench, Zap, Wand2,
  Eye, EyeOff,
} from 'lucide-react'
import ChipInput from '@/components/ui/chip-input'

// ── Types ──────────────────────────────────────────────────────────────

interface EvidenceReq {
  factKey: string
  description: string
  source: 'user_input' | 'skill_output' | 'evaluation'
  skillName?: string
  required: boolean
}

interface StageGuardrail {
  name: string
  description?: string
  hook: 'preTool' | 'postTool' | 'preFinalize'
  rule: Record<string, unknown>
}

interface TransitionRule {
  type: 'auto' | 'evaluation' | 'manual'
  conditions?: { type: string; value?: number | string | boolean }[]
  evaluationPrompt?: string
}

interface SubAgentCfg {
  name: string
  model: string
  systemPrompt: string
  skills: string[]
  taskTemplate: string
  maxIterations?: number
  parallel: boolean
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
  guardrails?: StageGuardrail[]
  evidenceRequirements?: EvidenceReq[]
  transition?: TransitionRule
  subAgents?: SubAgentCfg[]
}

interface Props {
  stages: string[]
  stageConfigs: Record<string, StageCfg>
  allSkills: string[]
  availableModels: string[]
  onChange: (configs: Record<string, StageCfg>) => void
}

// ── Constants ──────────────────────────────────────────────────────────

const SOURCE_OPTIONS = [
  { value: 'user_input', label: 'User Input' },
  { value: 'skill_output', label: 'Skill Output' },
  { value: 'evaluation', label: 'Evaluation' },
] as const

const TRANSITION_TYPES = [
  { value: 'auto', label: 'Auto', desc: 'Conditions met → transition' },
  { value: 'evaluation', label: 'LLM Eval', desc: 'Model decides transition' },
  { value: 'manual', label: 'Manual', desc: 'Never auto-transition' },
] as const

const CONDITION_TYPES = [
  { value: 'all_evidence_gathered', label: 'All Evidence Gathered' },
  { value: 'all_skills_called', label: 'All Skills Called' },
  { value: 'min_iterations', label: 'Min Iterations' },
  { value: 'llm_decision', label: 'LLM Decision' },
] as const

const HOOK_OPTIONS = [
  { value: 'preTool', label: 'Pre-Tool' },
  { value: 'postTool', label: 'Post-Tool' },
  { value: 'preFinalize', label: 'Pre-Finalize' },
] as const

// ── Helpers ────────────────────────────────────────────────────────────

function ensureConfig(stage: string, configs: Record<string, StageCfg>): StageCfg {
  return configs[stage] || { name: stage }
}

function updateStage(
  stage: string,
  patch: Partial<StageCfg>,
  configs: Record<string, StageCfg>,
  onChange: (c: Record<string, StageCfg>) => void,
) {
  onChange({ ...configs, [stage]: { ...ensureConfig(stage, configs), ...patch } })
}

// ── Sub-components ─────────────────────────────────────────────────────

function SectionHeader({
  icon: Icon,
  title,
  badge,
  expanded,
  onToggle,
  colorClass = 'text-indigo',
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  badge?: string
  expanded: boolean
  onToggle: () => void
  colorClass?: string
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-2.5 py-2.5 group"
    >
      <ChevronRight
        className={`w-3.5 h-3.5 text-[var(--fog)] transition-transform duration-200 ${
          expanded ? 'rotate-90' : ''
        }`}
      />
      <Icon className={`w-3.5 h-3.5 ${colorClass}`} />
      <span className="text-[12px] font-medium text-[var(--mist)] flex-1 text-left">{title}</span>
      {badge && (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-lavender/[0.08] text-lavender font-medium">
          {badge}
        </span>
      )}
    </button>
  )
}

function MiniInput({
  value,
  onChange,
  placeholder,
  className = '',
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`glass-input-console text-[12px] py-1.5 ${className}`}
    />
  )
}

function MiniTextarea({
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="glass-input-console text-[12px] font-mono resize-y"
    />
  )
}

// ── Main Component ─────────────────────────────────────────────────────

export default function StageConfigEditor({ stages, stageConfigs, allSkills, availableModels, onChange }: Props) {
  const [activeStage, setActiveStage] = useState<string | null>(stages[0] || null)
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    model: true,
    skills: false,
    evidence: false,
    guardrails: false,
    transition: false,
    subagents: false,
  })

  const toggleSection = (key: string) =>
    setExpandedSections((p) => ({ ...p, [key]: !p[key] }))

  if (!stages.length) {
    return (
      <div className="text-center py-8 text-[13px] text-[var(--fog)]">
        Define stages in the Basic tab first, then configure each stage here.
      </div>
    )
  }

  return (
    <div className="space-y-4 animate-fade-up">
      {/* ── Stage Pipeline ──────────────────────────────────── */}
      <div className="flex items-center gap-1.5 flex-wrap p-3 rounded-xl bg-[var(--abyss)]/50 border border-[var(--border-subtle)]">
        {stages.map((stage, i) => {
          const isActive = activeStage === stage
          const cfg = stageConfigs[stage]
          const hasConfig = cfg && (cfg.requiredSkills?.length || cfg.evidenceRequirements?.length || cfg.transition)
          return (
            <div key={stage} className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setActiveStage(stage)}
                className={`relative px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-indigo/[0.10] border border-indigo/20 text-indigo shadow-[0_0_8px_rgba(91,138,247,0.08)]'
                    : 'bg-white/40 border border-[var(--border-subtle)] text-[var(--fog)] hover:border-[var(--border-hover)] hover:text-[var(--mist)]'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  {stage}
                  {hasConfig && (
                    <span className="w-1.5 h-1.5 rounded-full bg-malachite" />
                  )}
                </span>
              </button>
              {i < stages.length - 1 && (
                <ArrowRight className="w-3 h-3 text-[var(--smoke)]/40 flex-shrink-0" />
              )}
            </div>
          )
        })}
      </div>

      {/* ── Active Stage Config ─────────────────────────────── */}
      {activeStage && (() => {
        const cfg = ensureConfig(activeStage, stageConfigs)

        return (
          <div className="space-y-3">
            {/* Stage header */}
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-lg bg-indigo/[0.08] flex items-center justify-center">
                <Zap className="w-3 h-3 text-indigo" />
              </div>
              <div className="flex-1">
                <div className="text-[13px] font-semibold text-[var(--mist)]">{activeStage}</div>
                <MiniInput
                  value={cfg.description || ''}
                  onChange={(v) => updateStage(activeStage, { description: v }, stageConfigs, onChange)}
                  placeholder="Stage description (shown to agent)"
                />
              </div>
            </div>

            {/* ── Model & Prompt ─────────────────────────────── */}
            <div className="rounded-xl border border-[var(--border-subtle)] bg-white/30 overflow-hidden">
              <div className="px-4">
                <SectionHeader
                  icon={Cpu}
                  title="Model & Prompt"
                  badge={cfg.model ? cfg.model.split('/').pop() : 'default'}
                  expanded={expandedSections.model}
                  onToggle={() => toggleSection('model')}
                  colorClass="text-sky"
                />
              </div>
              {expandedSections.model && (
                <div className="px-4 pb-4 space-y-3 border-t border-[var(--border-subtle)]/50 pt-3">
                  <div className="grid grid-cols-4 gap-3">
                    <label className="space-y-1 col-span-2">
                      <span className="text-[10px] text-[var(--fog)] uppercase tracking-wide">Model</span>
                      <select
                        value={cfg.model || ''}
                        onChange={(e) => updateStage(activeStage, { model: e.target.value || undefined }, stageConfigs, onChange)}
                        className="glass-input-console text-[12px] py-1.5"
                      >
                        <option value="">Inherit from Agent Config</option>
                        {availableModels.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10px] text-[var(--fog)] uppercase tracking-wide">Temperature</span>
                      <input
                        type="number"
                        min={0}
                        max={2}
                        step={0.1}
                        value={cfg.temperature ?? ''}
                        onChange={(e) => updateStage(activeStage, { temperature: e.target.value ? parseFloat(e.target.value) : undefined }, stageConfigs, onChange)}
                        placeholder="0.5"
                        className="glass-input-console text-[12px] py-1.5"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10px] text-[var(--fog)] uppercase tracking-wide">Thinking Budget</span>
                      <input
                        type="number"
                        min={0}
                        step={1024}
                        value={cfg.thinkingBudget ?? ''}
                        onChange={(e) => updateStage(activeStage, { thinkingBudget: e.target.value ? parseInt(e.target.value) : undefined }, stageConfigs, onChange)}
                        placeholder="4096"
                        className="glass-input-console text-[12px] py-1.5"
                      />
                    </label>
                  </div>
                  <label className="space-y-1 block">
                    <span className="text-[10px] text-[var(--fog)] uppercase tracking-wide">Stage Prompt</span>
                    <MiniTextarea
                      value={cfg.systemPrompt || ''}
                      onChange={(v) => updateStage(activeStage, { systemPrompt: v || undefined }, stageConfigs, onChange)}
                      placeholder="Stage-specific instructions appended to system prompt..."
                      rows={3}
                    />
                  </label>
                </div>
              )}
            </div>

            {/* ── Skills ─────────────────────────────────────── */}
            <div className="rounded-xl border border-[var(--border-subtle)] bg-white/30 overflow-hidden">
              <div className="px-4">
                <SectionHeader
                  icon={Wrench}
                  title="Skills"
                  badge={cfg.requiredSkills?.length ? `${cfg.requiredSkills.length} required` : undefined}
                  expanded={expandedSections.skills}
                  onToggle={() => toggleSection('skills')}
                  colorClass="text-amber"
                />
              </div>
              {expandedSections.skills && (
                <div className="px-4 pb-4 space-y-4 border-t border-[var(--border-subtle)]/50 pt-3">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-[var(--mist)]">Required Skills</span>
                      <span className="text-[10px] text-[var(--smoke)]">Must be called in this stage</span>
                    </div>
                    <ChipInput
                      values={cfg.requiredSkills || []}
                      onChange={(v) => updateStage(activeStage, { requiredSkills: v }, stageConfigs, onChange)}
                      suggestions={allSkills}
                      placeholder="Add required skill..."
                    />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-[var(--mist)]">Allowed Skills</span>
                      <span className="text-[10px] text-[var(--smoke)]">Empty = all skills allowed. Terminal tools always allowed.</span>
                    </div>
                    <ChipInput
                      values={cfg.availableSkills || []}
                      onChange={(v) => updateStage(activeStage, { availableSkills: v }, stageConfigs, onChange)}
                      suggestions={allSkills}
                      placeholder="Add allowed skill..."
                    />
                  </div>
                  {(cfg.requiredSkills?.length ?? 0) === 0 && (cfg.availableSkills?.length ?? 0) === 0 ? (
                    <p className="text-[10px] leading-relaxed text-[var(--fog)] border-t border-[var(--border-subtle)]/40 pt-3">
                      Skills can stay empty when this stage only auto-advances (e.g. <code className="text-[var(--mist)]">min_iterations</code> / transition
                      rules). Tool requirements belong in downstream stages (
                      <code className="text-[var(--mist)]">collecting</code>,{' '}
                      <code className="text-[var(--mist)]">investigating</code>, … ) — check those tabs if you expected chips here.
                    </p>
                  ) : null}
                </div>
              )}
            </div>

            {/* ── Evidence Requirements ──────────────────────── */}
            <div className="rounded-xl border border-[var(--border-subtle)] bg-white/30 overflow-hidden">
              <div className="px-4">
                <SectionHeader
                  icon={FileText}
                  title="Evidence Requirements"
                  badge={cfg.evidenceRequirements?.length ? `${cfg.evidenceRequirements.length} items` : undefined}
                  expanded={expandedSections.evidence}
                  onToggle={() => toggleSection('evidence')}
                  colorClass="text-malachite"
                />
              </div>
              {expandedSections.evidence && (
                <div className="px-4 pb-4 space-y-2 border-t border-[var(--border-subtle)]/50 pt-3">
                  {(cfg.evidenceRequirements || []).map((ev, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 p-2.5 rounded-lg bg-white/40 border border-[var(--border-subtle)] group"
                    >
                      <GripVertical className="w-3 h-3 text-[var(--smoke)]/40 mt-1.5 flex-shrink-0" />
                      <div className="flex-1 grid grid-cols-12 gap-2">
                        <input
                          value={ev.factKey}
                          onChange={(e) => {
                            const next = [...(cfg.evidenceRequirements || [])]
                            next[i] = { ...next[i], factKey: e.target.value }
                            updateStage(activeStage, { evidenceRequirements: next }, stageConfigs, onChange)
                          }}
                          placeholder="factKey"
                          className="glass-input-console text-[12px] py-1 col-span-3 font-mono"
                        />
                        <input
                          value={ev.description}
                          onChange={(e) => {
                            const next = [...(cfg.evidenceRequirements || [])]
                            next[i] = { ...next[i], description: e.target.value }
                            updateStage(activeStage, { evidenceRequirements: next }, stageConfigs, onChange)
                          }}
                          placeholder="Description"
                          className="glass-input-console text-[12px] py-1 col-span-4"
                        />
                        <select
                          value={ev.source}
                          onChange={(e) => {
                            const next = [...(cfg.evidenceRequirements || [])]
                            next[i] = { ...next[i], source: e.target.value as EvidenceReq['source'] }
                            updateStage(activeStage, { evidenceRequirements: next }, stageConfigs, onChange)
                          }}
                          className="glass-input-console text-[12px] py-1 col-span-2"
                        >
                          {SOURCE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                        {ev.source === 'skill_output' && (
                          <select
                            value={ev.skillName || ''}
                            onChange={(e) => {
                              const next = [...(cfg.evidenceRequirements || [])]
                              next[i] = { ...next[i], skillName: e.target.value || undefined }
                              updateStage(activeStage, { evidenceRequirements: next }, stageConfigs, onChange)
                            }}
                            className="glass-input-console text-[12px] py-1 col-span-2"
                          >
                            <option value="">skill</option>
                            {allSkills.map((s) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        )}
                        <label className="col-span-1 flex items-center gap-1.5 text-[11px] text-[var(--fog)]">
                          <input
                            type="checkbox"
                            checked={ev.required}
                            onChange={(e) => {
                              const next = [...(cfg.evidenceRequirements || [])]
                              next[i] = { ...next[i], required: e.target.checked }
                              updateStage(activeStage, { evidenceRequirements: next }, stageConfigs, onChange)
                            }}
                            className="w-3 h-3 rounded accent-indigo"
                          />
                          req
                        </label>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const next = (cfg.evidenceRequirements || []).filter((_, j) => j !== i)
                          updateStage(activeStage, { evidenceRequirements: next }, stageConfigs, onChange)
                        }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-[var(--smoke)] hover:text-vermillion"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      const next = [...(cfg.evidenceRequirements || []), {
                        factKey: '', description: '', source: 'user_input' as const, required: true,
                      }]
                      updateStage(activeStage, { evidenceRequirements: next }, stageConfigs, onChange)
                    }}
                    className="w-full py-2 rounded-lg text-[11px] text-[var(--fog)] border border-dashed border-[var(--border-subtle)] hover:border-indigo/30 hover:text-indigo transition-all flex items-center justify-center gap-1.5"
                  >
                    <Plus className="w-3 h-3" /> Add Evidence Requirement
                  </button>
                </div>
              )}
            </div>

            {/* ── Guardrails ─────────────────────────────────── */}
            <div className="rounded-xl border border-[var(--border-subtle)] bg-white/30 overflow-hidden">
              <div className="px-4">
                <SectionHeader
                  icon={Shield}
                  title="Guardrails"
                  badge={cfg.guardrails?.length ? `${cfg.guardrails.length} rules` : undefined}
                  expanded={expandedSections.guardrails}
                  onToggle={() => toggleSection('guardrails')}
                  colorClass="text-vermillion"
                />
              </div>
              {expandedSections.guardrails && (
                <div className="px-4 pb-4 space-y-2 border-t border-[var(--border-subtle)]/50 pt-3">
                  {(cfg.guardrails || []).map((g, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 p-2.5 rounded-lg bg-white/40 border border-[var(--border-subtle)] group"
                    >
                      <div className="flex-1 grid grid-cols-12 gap-2">
                        <input
                          value={g.name}
                          onChange={(e) => {
                            const next = [...(cfg.guardrails || [])]
                            next[i] = { ...next[i], name: e.target.value }
                            updateStage(activeStage, { guardrails: next }, stageConfigs, onChange)
                          }}
                          placeholder="Rule name"
                          className="glass-input-console text-[12px] py-1 col-span-3 font-mono"
                        />
                        <input
                          value={g.description || ''}
                          onChange={(e) => {
                            const next = [...(cfg.guardrails || [])]
                            next[i] = { ...next[i], description: e.target.value }
                            updateStage(activeStage, { guardrails: next }, stageConfigs, onChange)
                          }}
                          placeholder="Description"
                          className="glass-input-console text-[12px] py-1 col-span-4"
                        />
                        <select
                          value={g.hook}
                          onChange={(e) => {
                            const next = [...(cfg.guardrails || [])]
                            next[i] = { ...next[i], hook: e.target.value as StageGuardrail['hook'] }
                            updateStage(activeStage, { guardrails: next }, stageConfigs, onChange)
                          }}
                          className="glass-input-console text-[12px] py-1 col-span-2"
                        >
                          {HOOK_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                        <div className="col-span-3">
                          <MiniInput
                            value={JSON.stringify(g.rule)}
                            onChange={(v) => {
                              try {
                                const parsed = JSON.parse(v)
                                const next = [...(cfg.guardrails || [])]
                                next[i] = { ...next[i], rule: parsed }
                                updateStage(activeStage, { guardrails: next }, stageConfigs, onChange)
                              } catch { /* invalid JSON, don't update */ }
                            }}
                            placeholder='{"evaluationPrompt": "Describe the policy check in natural language..."}'
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const next = (cfg.guardrails || []).filter((_, j) => j !== i)
                          updateStage(activeStage, { guardrails: next }, stageConfigs, onChange)
                        }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-[var(--smoke)] hover:text-vermillion"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      const next = [...(cfg.guardrails || []), {
                        name: '', description: '', hook: 'preTool' as const, rule: {},
                      }]
                      updateStage(activeStage, { guardrails: next }, stageConfigs, onChange)
                    }}
                    className="w-full py-2 rounded-lg text-[11px] text-[var(--fog)] border border-dashed border-[var(--border-subtle)] hover:border-indigo/30 hover:text-indigo transition-all flex items-center justify-center gap-1.5"
                  >
                    <Plus className="w-3 h-3" /> Add Guardrail
                  </button>
                </div>
              )}
            </div>

            {/* ── Transition ─────────────────────────────────── */}
            <div className="rounded-xl border border-[var(--border-subtle)] bg-white/30 overflow-hidden">
              <div className="px-4">
                <SectionHeader
                  icon={GitBranch}
                  title="Stage Transition"
                  badge={cfg.transition?.type}
                  expanded={expandedSections.transition}
                  onToggle={() => toggleSection('transition')}
                  colorClass="text-lavender"
                />
              </div>
              {expandedSections.transition && (
                <div className="px-4 pb-4 space-y-3 border-t border-[var(--border-subtle)]/50 pt-3">
                  <div className="flex gap-2">
                    {TRANSITION_TYPES.map((tt) => (
                      <button
                        key={tt.value}
                        type="button"
                        onClick={() => updateStage(activeStage, {
                          transition: { type: tt.value as TransitionRule['type'] },
                        }, stageConfigs, onChange)}
                        className={`flex-1 p-2.5 rounded-lg text-center border transition-all ${
                          (cfg.transition?.type || 'auto') === tt.value
                            ? 'bg-lavender/[0.06] border-lavender/20 text-lavender'
                            : 'bg-white/30 border-[var(--border-subtle)] text-[var(--fog)] hover:border-[var(--border-hover)]'
                        }`}
                      >
                        <div className="text-[12px] font-medium">{tt.label}</div>
                        <div className="text-[10px] opacity-70 mt-0.5">{tt.desc}</div>
                      </button>
                    ))}
                  </div>

                  {cfg.transition?.type === 'auto' && (
                    <div className="space-y-1.5">
                      <span className="text-[10px] text-[var(--fog)] uppercase tracking-wide">Conditions</span>
                      <ChipInput
                        values={(cfg.transition.conditions || []).map((c) => c.type)}
                        onChange={(types) => updateStage(activeStage, {
                          transition: {
                            ...cfg.transition!,
                            conditions: types.map((t) => ({ type: t })),
                          },
                        }, stageConfigs, onChange)}
                        suggestions={CONDITION_TYPES.map((c) => c.value)}
                        placeholder="Add condition..."
                      />
                    </div>
                  )}

                  {cfg.transition?.type === 'evaluation' && (
                    <div className="space-y-3">
                      <label className="space-y-1 block">
                        <span className="text-[10px] text-[var(--fog)] uppercase tracking-wide">Evaluation Prompt</span>
                        <MiniTextarea
                          value={cfg.transition.evaluationPrompt || ''}
                          onChange={(v) => updateStage(activeStage, {
                            transition: { ...cfg.transition!, evaluationPrompt: v || undefined },
                          }, stageConfigs, onChange)}
                          placeholder="Instructions for the evaluation model..."
                          rows={3}
                        />
                      </label>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Sub-Agents ─────────────────────────────────── */}
            <div className="rounded-xl border border-[var(--border-subtle)] bg-white/30 overflow-hidden">
              <div className="px-4">
                <SectionHeader
                  icon={Bot}
                  title="Sub-Agents"
                  badge={cfg.subAgents?.length ? `${cfg.subAgents.length} agents` : undefined}
                  expanded={expandedSections.subagents}
                  onToggle={() => toggleSection('subagents')}
                  colorClass="text-gold"
                />
              </div>
              {expandedSections.subagents && (
                <div className="px-4 pb-4 space-y-3 border-t border-[var(--border-subtle)]/50 pt-3">
                  {(cfg.subAgents || []).map((sa, i) => (
                    <div
                      key={i}
                      className="p-3 rounded-lg bg-white/40 border border-[var(--border-subtle)] space-y-2.5"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Bot className="w-3.5 h-3.5 text-gold" />
                          <span className="text-[12px] font-medium text-[var(--mist)]">{sa.name || 'Unnamed Agent'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <label className="flex items-center gap-1.5 text-[11px] text-[var(--fog)]">
                            <input
                              type="checkbox"
                              checked={sa.parallel}
                              onChange={(e) => {
                                const next = [...(cfg.subAgents || [])]
                                next[i] = { ...next[i], parallel: e.target.checked }
                                updateStage(activeStage, { subAgents: next }, stageConfigs, onChange)
                              }}
                              className="w-3 h-3 rounded accent-indigo"
                            />
                            Parallel
                          </label>
                          <button
                            type="button"
                            onClick={() => {
                              const next = (cfg.subAgents || []).filter((_, j) => j !== i)
                              updateStage(activeStage, { subAgents: next }, stageConfigs, onChange)
                            }}
                            className="p-1 text-[var(--smoke)] hover:text-vermillion transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="space-y-0.5">
                          <span className="text-[10px] text-[var(--fog)]">Name</span>
                          <MiniInput
                            value={sa.name}
                            onChange={(v) => {
                              const next = [...(cfg.subAgents || [])]
                              next[i] = { ...next[i], name: v }
                              updateStage(activeStage, { subAgents: next }, stageConfigs, onChange)
                            }}
                            placeholder="order_investigator"
                          />
                        </label>
                        <label className="space-y-0.5">
                          <span className="text-[10px] text-[var(--fog)]">Model</span>
                          <select
                            value={sa.model}
                            onChange={(e) => {
                              const next = [...(cfg.subAgents || [])]
                              next[i] = { ...next[i], model: e.target.value }
                              updateStage(activeStage, { subAgents: next }, stageConfigs, onChange)
                            }}
                            className="glass-input-console text-[12px] py-1.5"
                          >
                            {availableModels.map((m) => (
                              <option key={m} value={m}>{m}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <label className="space-y-0.5 block">
                        <span className="text-[10px] text-[var(--fog)]">System Prompt</span>
                        <MiniTextarea
                          value={sa.systemPrompt}
                          onChange={(v) => {
                            const next = [...(cfg.subAgents || [])]
                            next[i] = { ...next[i], systemPrompt: v }
                            updateStage(activeStage, { subAgents: next }, stageConfigs, onChange)
                          }}
                          placeholder="You are an investigator agent..."
                          rows={2}
                        />
                      </label>
                      <label className="space-y-0.5 block">
                        <span className="text-[10px] text-[var(--fog)]">Task Template</span>
                        <MiniTextarea
                          value={sa.taskTemplate}
                          onChange={(v) => {
                            const next = [...(cfg.subAgents || [])]
                            next[i] = { ...next[i], taskTemplate: v }
                            updateStage(activeStage, { subAgents: next }, stageConfigs, onChange)
                          }}
                          placeholder="Investigate {{caseId}} for stage {{stage}}..."
                          rows={2}
                        />
                      </label>
                      <div className="space-y-0.5">
                        <span className="text-[10px] text-[var(--fog)]">Skills</span>
                        <ChipInput
                          values={sa.skills || []}
                          onChange={(v) => {
                            const next = [...(cfg.subAgents || [])]
                            next[i] = { ...next[i], skills: v }
                            updateStage(activeStage, { subAgents: next }, stageConfigs, onChange)
                          }}
                          suggestions={allSkills}
                          placeholder="Add skill..."
                        />
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      const next = [...(cfg.subAgents || []), {
                        name: '',
                        model: availableModels[0] || 'MiniMax-M2.7-highspeed',
                        systemPrompt: '',
                        skills: [],
                        taskTemplate: '',
                        maxIterations: 3,
                        parallel: true,
                      }]
                      updateStage(activeStage, { subAgents: next }, stageConfigs, onChange)
                    }}
                    className="w-full py-2 rounded-lg text-[11px] text-[var(--fog)] border border-dashed border-[var(--border-subtle)] hover:border-indigo/30 hover:text-indigo transition-all flex items-center justify-center gap-1.5"
                  >
                    <Plus className="w-3 h-3" /> Add Sub-Agent
                  </button>
                </div>
              )}
            </div>

            {/* ── Quick Actions ──────────────────────────────── */}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  const cleared = { ...stageConfigs }
                  delete cleared[activeStage]
                  onChange(cleared)
                }}
                className="px-3 py-1.5 rounded-lg text-[11px] text-[var(--smoke)] border border-[var(--border-subtle)] hover:text-vermillion hover:border-vermillion/20 transition-all"
              >
                Clear Stage Config
              </button>
              <button
                type="button"
                onClick={() => {
                  const json = JSON.stringify(stageConfigs, null, 2)
                  navigator.clipboard.writeText(json)
                }}
                className="px-3 py-1.5 rounded-lg text-[11px] text-[var(--fog)] border border-[var(--border-subtle)] hover:text-indigo hover:border-indigo/20 transition-all flex items-center gap-1.5"
              >
                <Wand2 className="w-3 h-3" /> Copy JSON
              </button>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
