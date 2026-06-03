'use client'

import { useMemo } from 'react'
import { MessageSquareText } from 'lucide-react'
import { HARNESS_DEFAULT_RESUME_PROMPT_APPEND } from '@intera/shared/defaults'
import { useConsoleLocale } from '@/components/locale-provider'

interface Props {
  resumePrompt: string
  onResumeChange: (v: string) => void
}

export default function AgentSyntheticTemplatesPanel({
  resumePrompt,
  onResumeChange,
}: Props) {
  const { t } = useConsoleLocale()

  const resumeAppend = resumePrompt.trim() ? resumePrompt : HARNESS_DEFAULT_RESUME_PROMPT_APPEND

  const resumeMock = useMemo(() => {
    const header = `[Human task resolved — operator closed the case]
Operator verdict: approved_delay
Expected resolution time: ~2h`
    return `${header}\nInternal notes (do NOT share verbatim with customer): routing queue #4821\n${resumeAppend}`
  }, [resumeAppend])

  return (
    <div className="space-y-4">
      {/* Resume prompt */}
      <p className="text-[11px] text-[var(--fog)]/70 leading-snug">{t('agent.resumePromptHint')}</p>
      <label className="block space-y-1.5">
        <span className="text-[11px] font-medium text-[var(--fog)]">{t('agent.resumePrompt')}</span>
        <textarea
          value={resumePrompt}
          onChange={e => onResumeChange(e.target.value)}
          rows={8}
          className="glass-input-console text-[12px] font-mono resize-y w-full"
          placeholder={HARNESS_DEFAULT_RESUME_PROMPT_APPEND}
        />
        <span className="text-[10px] text-[var(--fog)]/70 leading-snug block">{t('agent.resumePromptHint')}</span>
      </label>

      {/* Live preview */}
      <div>
        <p className="text-[11px] font-semibold text-[var(--fog)] mb-2">{t('agent.preview')}</p>
        <div className="p-3 rounded-xl border border-indigo/10 bg-indigo/[0.02] text-[12px] font-mono text-[var(--mist)] whitespace-pre-wrap leading-relaxed">
          {resumeMock}
        </div>
      </div>
    </div>
  )
}
