'use client'

import { useState, useEffect } from 'react'
import { Brain, Zap } from 'lucide-react'
import { useConsoleLocale } from '@/components/locale-provider'
import { useSelectedAgentId } from '@/components/admin/version-context-bar'

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
}

export default function AgentHumanInteractionPanel({
  consultationPrompt,
  humanSkills,
  onConsultationPromptChange,
  onHumanSkillsChange,
}: Props) {
  const { t } = useConsoleLocale()
  const agentConfigId = useSelectedAgentId()
  const [availableSkills, setAvailableSkills] = useState<SkillRow[]>([])
  const selectedSkills = humanSkills
    ? humanSkills.split('\n').map((s) => s.trim()).filter(Boolean)
    : []

  useEffect(() => {
    fetch(`/api/admin/tools?agentConfigId=${encodeURIComponent(agentConfigId ?? '')}`).then(r => r.json()).then(d => d.data || d)
      .then((data) => {
        const tools = Array.isArray(data.tools) ? data.tools : []
        setAvailableSkills(tools.filter((s: SkillRow) => s.enabled))
      })
      .catch(() => { /* catalog unavailable */ })
  }, [agentConfigId])

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
          <label className="space-y-1 block">
            <span className="text-[11px] text-[var(--fog)]">{t('agent.human.promptLabel')}</span>
            <textarea
              value={consultationPrompt}
              rows={14}
              onChange={(e) => onConsultationPromptChange(e.target.value)}
              spellCheck={false}
              placeholder={t('agent.human.promptPlaceholder')}
              className="glass-input-console text-[12px] font-mono resize-y w-full leading-relaxed"
            />
            <span className="text-[10px] text-[var(--fog)]/70 leading-snug block">{t('agent.human.promptHint')}</span>
          </label>
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
    </div>
  )
}
