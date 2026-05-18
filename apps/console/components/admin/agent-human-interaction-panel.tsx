'use client'

import { useState, useEffect } from 'react'
import { Brain, Zap, Wand2 } from 'lucide-react'
import HighlightedTextarea from '@/components/admin/highlighted-textarea'
import { useConsoleLocale } from '@/components/locale-provider'

const CONSULTATION_PLACEHOLDERS = [
  { pattern: /\{\{caseId\}\}/g, color: '#7c5ce7', label: '{{caseId}}' },
  { pattern: /\{\{caseType\}\}/g, color: '#5b8af7', label: '{{caseType}}' },
  { pattern: /\{\{confirmedFacts\}\}/g, color: '#2ea04a', label: '{{confirmedFacts}}' },
  { pattern: /\{\{skillsCalled\}\}/g, color: '#d4912e', label: '{{skillsCalled}}' },
  { pattern: /\{\{question\}\}/g, color: '#e75c8a', label: '{{question}}' },
  { pattern: /\{\{userId\}\}/g, color: '#5bb8f7', label: '{{userId}}' },
]

interface SkillRow {
  name: string
  description: string
  enabled: boolean
}

interface Props {
  consultationPrompt: string
  humanSkills: string
  onConsultationPromptChange: (v: string) => void
  onHumanSkillsChange: (v: string) => void
  composerEnabled: boolean
  composerModel: string
  composerBaseUrl: string
  composerAssistantPrefix: string
  composerStopText: string
  composerMinDraftChars: number
  onComposerEnabledChange: (v: boolean) => void
  onComposerModelChange: (v: string) => void
  onComposerBaseUrlChange: (v: string) => void
  onComposerAssistantPrefixChange: (v: string) => void
  onComposerStopTextChange: (v: string) => void
  onComposerMinDraftCharsChange: (v: number) => void
}

export default function AgentHumanInteractionPanel({
  consultationPrompt,
  humanSkills,
  onConsultationPromptChange,
  onHumanSkillsChange,
  composerEnabled,
  composerModel,
  composerBaseUrl,
  composerAssistantPrefix,
  composerStopText,
  composerMinDraftChars,
  onComposerEnabledChange,
  onComposerModelChange,
  onComposerBaseUrlChange,
  onComposerAssistantPrefixChange,
  onComposerStopTextChange,
  onComposerMinDraftCharsChange,
}: Props) {
  const { t } = useConsoleLocale()
  const [availableSkills, setAvailableSkills] = useState<SkillRow[]>([])
  const selectedSkills = humanSkills
    ? humanSkills.split('\n').map((s) => s.trim()).filter(Boolean)
    : []

  useEffect(() => {
    fetch('/api/admin/skills')
      .then((r) => r.json())
      .then((data) => {
        const skills = Array.isArray(data.skills) ? data.skills : []
        setAvailableSkills(skills.filter((s: SkillRow) => s.enabled))
      })
      .catch(() => { /* catalog unavailable */ })
  }, [])

  const toggleSkill = (name: string) => {
    if (selectedSkills.includes(name)) {
      onHumanSkillsChange(selectedSkills.filter((s) => s !== name).join('\n'))
    } else {
      onHumanSkillsChange([...selectedSkills, name].join('\n'))
    }
  }

  return (
    <div className="space-y-5">
      {/* ── Consultation System Prompt ── */}
      <div className="rounded-xl border border-sky-500/20 bg-gradient-to-br from-sky-400/8 via-white/40 to-transparent overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-black/[0.05] flex items-center gap-2 bg-sky-500/10">
          <Brain className="w-4 h-4 text-sky-600" />
          <div>
            <h3 className="text-[13px] font-semibold text-[var(--mist)]">{t('agent.human.promptTitle')}</h3>
            <p className="text-[10px] text-[var(--fog)]">{t('agent.human.promptLead')}</p>
          </div>
        </div>
        <div className="p-4 space-y-3">
          <HighlightedTextarea
            id="consultation-prompt-textarea"
            value={consultationPrompt}
            onChange={(v) => onConsultationPromptChange(v)}
            spellCheck={false}
            className="w-full min-h-[180px] text-[12px] font-mono leading-relaxed"
            highlights={CONSULTATION_PLACEHOLDERS}
          />
          <span className="text-[10px] text-[var(--fog)]/70 leading-snug block">{t('agent.human.promptHint')}</span>
          <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-black/[0.05] bg-black/[0.02] px-3 py-2.5">
            <span className="mr-1 font-medium text-[10px] text-[var(--fog)]/80">{t('agent.human.placeholdersTitle')}</span>
            {CONSULTATION_PLACEHOLDERS.map((ph) => (
              <button
                key={ph.label}
                type="button"
                onClick={() => onConsultationPromptChange(consultationPrompt + ' ' + ph.label)}
                className="text-[10px] px-2 py-1 rounded-md border font-medium transition-colors hover:brightness-105 active:scale-[0.98]"
                style={{ borderColor: ph.color + '44', backgroundColor: ph.color + '14', color: ph.color }}
              >
                {ph.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Human Operator Skills ── */}
      <div className="rounded-xl border border-amber/25 bg-gradient-to-br from-amber/8 via-white/40 to-transparent overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-black/[0.05] flex items-center gap-2 bg-amber/10">
          <Zap className="w-4 h-4 text-amber" />
          <div>
            <h3 className="text-[13px] font-semibold text-[var(--mist)]">{t('agent.human.skillsTitle')}</h3>
            <p className="text-[10px] text-[var(--fog)]">{t('agent.human.skillsLead')}</p>
          </div>
        </div>
        <div className="p-4 space-y-3">
          {availableSkills.length === 0 ? (
            <p className="text-[11px] text-[var(--fog)]/60 italic">{t('agent.human.skillsLoading')}</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {availableSkills.map((sk) => {
                const isSelected = selectedSkills.includes(sk.name)
                return (
                  <button
                    key={sk.name}
                    type="button"
                    onClick={() => toggleSkill(sk.name)}
                    title={sk.description}
                    className={`text-[11px] px-2.5 py-1.5 rounded-lg border font-medium transition-all duration-150 ${
                      isSelected
                        ? 'border-amber/40 bg-amber/[0.12] text-amber shadow-[0_0_0_1px_var(--amber)]'
                        : 'border-black/[0.06] bg-white/60 text-[var(--fog)] hover:border-amber/20 hover:bg-amber/[0.04]'
                    }`}
                  >
                    {sk.name.replace(/_/g, ' ')}
                  </button>
                )
              })}
            </div>
          )}
          {selectedSkills.length > 0 && (
            <p className="text-[10px] text-[var(--fog)]/60">{t('agent.human.skillsSelected', { n: selectedSkills.length })}</p>
          )}
        </div>
      </div>

      {/* ── Composer Assist (Beta) ── */}
      <div className="rounded-xl border border-purple-500/20 bg-gradient-to-br from-purple-400/8 via-white/40 to-transparent overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-black/[0.05] flex items-center gap-2 bg-purple-500/10">
          <Wand2 className="w-4 h-4 text-purple-600" />
          <div className="flex items-center gap-3 flex-1">
            <div className="flex-1">
              <h3 className="text-[13px] font-semibold text-[var(--mist)]">{t('agent.human.composerTitle')}</h3>
              <p className="text-[10px] text-[var(--fog)]">{t('agent.human.composerLead')}</p>
            </div>
            <label className="flex items-center gap-2 cursor-pointer shrink-0">
              <input type="checkbox" checked={composerEnabled} onChange={(e) => onComposerEnabledChange(e.target.checked)} className="accent-purple-600 rounded" />
              <span className="text-[11px] font-medium text-[var(--mist)]">{t('agent.human.composerToggle')}</span>
            </label>
          </div>
        </div>
        {composerEnabled && (
          <div className="p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="space-y-1 block">
                <span className="text-[10px] text-[var(--fog)]">{t('agent.human.composerModel')}</span>
                <input type="text" value={composerModel} onChange={(e) => onComposerModelChange(e.target.value)} className="glass-input-console text-[12px] font-mono w-full" placeholder="deepseek-chat" />
              </label>
              <label className="space-y-1 block">
                <span className="text-[10px] text-[var(--fog)]">{t('agent.human.composerBaseUrl')}</span>
                <input type="text" value={composerBaseUrl} onChange={(e) => onComposerBaseUrlChange(e.target.value)} className="glass-input-console text-[12px] font-mono w-full" placeholder="https://api.deepseek.com/beta" />
              </label>
            </div>
            <label className="space-y-1 block">
              <span className="text-[10px] text-[var(--fog)]">{t('agent.human.composerPrefix')}</span>
              <input type="text" value={composerAssistantPrefix} onChange={(e) => onComposerAssistantPrefixChange(e.target.value)} className="glass-input-console text-[12px] font-mono w-full" />
              <span className="text-[10px] text-[var(--fog)]/70 leading-snug block">{t('agent.human.composerPrefixHint')}</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="space-y-1 block">
                <span className="text-[10px] text-[var(--fog)]">{t('agent.human.composerStopText')}</span>
                <textarea value={composerStopText} rows={2} onChange={(e) => onComposerStopTextChange(e.target.value)} className="glass-input-console text-[12px] font-mono resize-y w-full" />
                <span className="text-[10px] text-[var(--fog)]/70 leading-snug block">{t('agent.human.composerStopHint')}</span>
              </label>
              <label className="space-y-1 block">
                <span className="text-[10px] text-[var(--fog)]">{t('agent.human.composerMinDraft')}</span>
                <input type="number" value={composerMinDraftChars} min={1} max={20} step={1} onChange={(e) => onComposerMinDraftCharsChange(Math.max(1, parseInt(e.target.value, 10) || 4))} className="glass-input-console text-[12px] font-mono w-full" />
                <span className="text-[10px] text-[var(--fog)]/70 leading-snug block">{t('agent.human.composerMinDraftHint')}</span>
              </label>
            </div>
            <p className="text-[10px] text-[var(--fog)]/60 rounded-lg bg-purple-500/[0.04] px-3 py-2 border border-purple-500/[0.06]">{t('agent.human.composerNote')}</p>
          </div>
        )}
      </div>
    </div>
  )
}
