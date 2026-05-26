'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, Trash2, ClipboardList, Bot } from 'lucide-react'
import ChipInput from '@/components/ui/chip-input'

// ── Types ──────────────────────────────────────────────────────────────

export interface TaskChecklist {
  requiredChecks: string[]
  outputFormat: string
  rules: string[]
}

export interface SubAgentConfig {
  name: string
  description?: string
  model: string
  systemPrompt: string
  skills: string[]
  taskTemplate?: string
  maxIterations?: number
  parallel: boolean
  executionMode?: 'stage' | 'sop'
  taskChecklist?: TaskChecklist
}

interface Props {
  value: SubAgentConfig
  onChange: (config: SubAgentConfig) => void
  onRemove?: () => void
  allSkills?: string[]
  availableModels?: string[]
}

// ── Helpers ────────────────────────────────────────────────────────────

function patch(prev: SubAgentConfig, partial: Partial<SubAgentConfig>): SubAgentConfig {
  return { ...prev, ...partial }
}

// ── Component ──────────────────────────────────────────────────────────

export default function SubAgentForm({
  value,
  onChange,
  onRemove,
  allSkills = [],
  availableModels = [],
}: Props) {
  const [checklistExpanded, setChecklistExpanded] = useState(false)

  const defaultModels =
    availableModels.length > 0
      ? availableModels
      : ['MiniMax-M2.7-highspeed', 'MiniMax-M2.5-highspeed']

  const tc = value.taskChecklist || { requiredChecks: [], outputFormat: '', rules: [] }

  return (
    <div className="p-4 rounded-xl bg-white/40 border border-[var(--border-subtle)] space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-gold" />
          <span className="text-[13px] font-semibold text-[var(--mist)]">
            {value.name || 'New Sub-Agent'}
          </span>
        </div>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="p-1.5 rounded-lg text-[var(--smoke)] hover:text-vermillion hover:bg-vermillion/5 transition-colors"
            title="Remove sub-agent"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* name + description */}
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-[10px] text-[var(--fog)] uppercase tracking-wide">Name</span>
          <input
            value={value.name}
            onChange={(e) => onChange(patch(value, { name: e.target.value }))}
            placeholder="withdrawal_verifier"
            className="glass-input-console text-[12px] py-1.5 font-mono"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] text-[var(--fog)] uppercase tracking-wide">Description</span>
          <input
            value={value.description || ''}
            onChange={(e) => onChange(patch(value, { description: e.target.value }))}
            placeholder="Verifies withdrawal status..."
            className="glass-input-console text-[12px] py-1.5"
          />
        </label>
      </div>

      {/* model + maxIterations + parallel */}
      <div className="grid grid-cols-4 gap-3">
        <label className="space-y-1 col-span-2">
          <span className="text-[10px] text-[var(--fog)] uppercase tracking-wide">Model</span>
          <select
            value={value.model}
            onChange={(e) => onChange(patch(value, { model: e.target.value }))}
            className="glass-input-console text-[12px] py-1.5"
          >
            {defaultModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[10px] text-[var(--fog)] uppercase tracking-wide">Max Iterations</span>
          <input
            type="number"
            min={1}
            max={20}
            value={value.maxIterations ?? 3}
            onChange={(e) =>
              onChange(patch(value, { maxIterations: Math.max(1, parseInt(e.target.value) || 3) }))
            }
            className="glass-input-console text-[12px] py-1.5"
          />
        </label>
        <label className="flex items-center gap-2 pt-5 cursor-pointer">
          <input
            type="checkbox"
            checked={value.parallel}
            onChange={(e) => onChange(patch(value, { parallel: e.target.checked }))}
            className="w-3.5 h-3.5 rounded accent-indigo"
          />
          <span className="text-[11px] text-[var(--fog)]">Parallel</span>
        </label>
      </div>

      {/* allowed skills */}
      <div className="space-y-1">
        <span className="text-[10px] text-[var(--fog)] uppercase tracking-wide">Allowed Skills</span>
        <ChipInput
          values={value.skills || []}
          onChange={(v) => onChange(patch(value, { skills: v }))}
          suggestions={allSkills}
          placeholder="Add skill..."
        />
      </div>

      {/* system prompt */}
      <label className="space-y-1 block">
        <span className="text-[10px] text-[var(--fog)] uppercase tracking-wide">System Prompt</span>
        <textarea
          value={value.systemPrompt}
          onChange={(e) => onChange(patch(value, { systemPrompt: e.target.value }))}
          placeholder="You are a verification agent..."
          rows={4}
          className="glass-input-console text-[12px] font-mono resize-y"
        />
      </label>

      {/* task checklist (collapsible) */}
      <div className="rounded-lg border border-[var(--border-subtle)]/50 overflow-hidden">
        <button
          type="button"
          onClick={() => setChecklistExpanded(!checklistExpanded)}
          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-black/[0.02] transition-colors text-left"
        >
          <ChevronRight
            className={`w-3.5 h-3.5 text-[var(--fog)] transition-transform duration-200 ${
              checklistExpanded ? 'rotate-90' : ''
            }`}
          />
          <ClipboardList className="w-3.5 h-3.5 text-amber" />
          <span className="text-[11px] font-medium text-[var(--mist)] flex-1">
            Task Checklist
          </span>
          <span className="text-[10px] text-[var(--smoke)]">Optional</span>
        </button>
        {checklistExpanded && (
          <div className="px-3 pb-3 space-y-3 border-t border-[var(--border-subtle)]/30 pt-3">
            {/* required checks */}
            <div className="space-y-1">
              <span className="text-[10px] text-[var(--fog)] uppercase tracking-wide">
                Required Checks
              </span>
              <ChipInput
                values={tc.requiredChecks || []}
                onChange={(v) =>
                  onChange(
                    patch(value, {
                      taskChecklist: { ...tc, requiredChecks: v },
                    }),
                  )
                }
                placeholder="Add required check..."
              />
            </div>

            {/* output format */}
            <label className="space-y-1 block">
              <span className="text-[10px] text-[var(--fog)] uppercase tracking-wide">
                Output Format
              </span>
              <input
                value={tc.outputFormat || ''}
                onChange={(e) =>
                  onChange(
                    patch(value, {
                      taskChecklist: { ...tc, outputFormat: e.target.value },
                    }),
                  )
                }
                placeholder='e.g. { "findings": "...", "evidence": "..." }'
                className="glass-input-console text-[12px] py-1.5 font-mono"
              />
            </label>

            {/* rules */}
            <div className="space-y-1">
              <span className="text-[10px] text-[var(--fog)] uppercase tracking-wide">Rules</span>
              <ChipInput
                values={tc.rules || []}
                onChange={(v) =>
                  onChange(
                    patch(value, {
                      taskChecklist: { ...tc, rules: v },
                    }),
                  )
                }
                placeholder="Add rule..."
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
