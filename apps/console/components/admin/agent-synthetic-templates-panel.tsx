'use client'

import { useMemo } from 'react'
import { MessageSquareText } from 'lucide-react'
import {
  HARNESS_DEFAULT_FORM_RESPONSE_APPEND,
  HARNESS_DEFAULT_RESUME_PROMPT_APPEND,
} from '@intera/shared/defaults'
import { useConsoleLocale } from '@/components/locale-provider'

const SAMPLE_FORM_LINES = '[Form submitted]\namount: 100 USD\ntxnId: demo-order-9821'

interface Props {
  resumePrompt: string
  formResponseTemplate: string
  onResumeChange: (v: string) => void
  onFormChange: (v: string) => void
}

export default function AgentSyntheticTemplatesPanel({
  resumePrompt,
  formResponseTemplate,
  onResumeChange,
  onFormChange,
}: Props) {
  const { t } = useConsoleLocale()

  const resumeAppend = resumePrompt.trim() ? resumePrompt : HARNESS_DEFAULT_RESUME_PROMPT_APPEND
  const formTail = formResponseTemplate.trim()
    ? formResponseTemplate.trim()
    : HARNESS_DEFAULT_FORM_RESPONSE_APPEND

  const resumeMock = useMemo(() => {
    const header = `[Human task resolved — operator closed the case]
Operator verdict: approved_delay
Expected resolution time: ~2h`
    return `${header}\nInternal notes (do NOT share verbatim with customer): routing queue #4821\n${resumeAppend}`
  }, [resumeAppend])

  const formMock = useMemo(() => `${SAMPLE_FORM_LINES}\n\n${formTail}`, [formTail])

  return (
    <div className="space-y-5">
      {/* Resume */}
      <div className="rounded-xl border border-sky-500/20 bg-gradient-to-br from-sky-400/8 via-white/40 to-transparent overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-black/[0.05] flex items-center gap-2 bg-sky-500/10">
          <MessageSquareText className="w-4 h-4 text-sky-600" />
          <div>
            <h3 className="text-[13px] font-semibold text-[var(--mist)]">{t('agent.template.resumeCardTitle')}</h3>
            <p className="text-[10px] text-[var(--fog)]">{t('agent.template.resumeCardLead')}</p>
          </div>
        </div>
        <div className="p-4 space-y-4">
          <div className="rounded-lg bg-black/[0.03] border border-black/[0.06] p-3">
            <div className="text-[10px] uppercase tracking-wide text-[var(--fog)]/60 mb-2">
              {t('agent.template.previewLabel')}
            </div>
            <pre className="text-[11px] font-mono text-[var(--mist)] whitespace-pre-wrap leading-relaxed opacity-92">
              {resumeMock}
            </pre>
          </div>

          {!resumePrompt.trim() && (
            <p className="text-[11px] text-[var(--fog)] rounded-lg bg-black/[0.04] px-3 py-2 border border-black/[0.05]">
              {t('agent.template.resumeFallbackNote')}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="text-[11px] px-2.5 py-1.5 rounded-lg border border-black/[0.08] bg-white/60 hover:border-indigo/30 hover:text-indigo"
              onClick={() => onResumeChange(HARNESS_DEFAULT_RESUME_PROMPT_APPEND)}
            >
              {t('agent.template.fillHarnessDefault')}
            </button>
            <button
              type="button"
              className="text-[11px] px-2.5 py-1.5 rounded-lg border border-black/[0.08] bg-white/60 hover:border-indigo/30 hover:text-indigo"
              onClick={() => onResumeChange('')}
            >
              {t('agent.template.clearUseBuiltin')}
            </button>
          </div>

          <label className="space-y-1 block">
            <span className="text-[11px] text-[var(--fog)]">{t('agent.resumePrompt')}</span>
            <textarea
              value={resumePrompt}
              rows={6}
              onChange={(e) => onResumeChange(e.target.value)}
              spellCheck={false}
              placeholder={t('agent.template.resumePlaceholder')}
              className="glass-input-console text-[12px] font-mono resize-y w-full leading-relaxed"
            />
            <span className="text-[10px] text-[var(--fog)]/70 leading-snug block">{t('agent.resumePromptHint')}</span>
          </label>
        </div>
      </div>

      {/* Form */}
      <div className="rounded-xl border border-malachite/25 bg-gradient-to-br from-malachite/10 via-white/40 to-transparent overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-black/[0.05] flex items-center gap-2 bg-malachite/15">
          <MessageSquareText className="w-4 h-4 text-malachite" />
          <div>
            <h3 className="text-[13px] font-semibold text-[var(--mist)]">{t('agent.template.formCardTitle')}</h3>
            <p className="text-[10px] text-[var(--fog)]">{t('agent.template.formCardLead')}</p>
          </div>
        </div>
        <div className="p-4 space-y-4">
          <div className="rounded-lg bg-black/[0.03] border border-black/[0.06] p-3">
            <div className="text-[10px] uppercase tracking-wide text-[var(--fog)]/60 mb-2">
              {t('agent.template.previewLabel')}
            </div>
            <pre className="text-[11px] font-mono text-[var(--mist)] whitespace-pre-wrap leading-relaxed opacity-92">
              {formMock}
            </pre>
          </div>

          {!formResponseTemplate.trim() && (
            <p className="text-[11px] text-[var(--fog)] rounded-lg bg-black/[0.04] px-3 py-2 border border-black/[0.05]">
              {t('agent.template.formFallbackNote')}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="text-[11px] px-2.5 py-1.5 rounded-lg border border-black/[0.08] bg-white/60 hover:border-indigo/30 hover:text-indigo"
              onClick={() => onFormChange(HARNESS_DEFAULT_FORM_RESPONSE_APPEND)}
            >
              {t('agent.template.fillHarnessDefault')}
            </button>
            <button
              type="button"
              className="text-[11px] px-2.5 py-1.5 rounded-lg border border-black/[0.08] bg-white/60 hover:border-indigo/30 hover:text-indigo"
              onClick={() => onFormChange('')}
            >
              {t('agent.template.clearUseBuiltin')}
            </button>
            <button
              type="button"
              className="text-[11px] px-2.5 py-1.5 rounded-lg border border-dashed border-black/[0.1] hover:border-malachite/35 hover:text-malachite transition-colors"
              onClick={() =>
                onFormChange(
                  (formResponseTemplate.trim() ? `${formResponseTemplate.trim()}\n\n` : '') +
                    t('agent.template.formSnippetFactsAppend'),
                )
              }
            >
              {t('agent.template.formSnippetFacts')}
            </button>
          </div>

          <label className="space-y-1 block">
            <span className="text-[11px] text-[var(--fog)]">{t('agent.formResponseTemplate')}</span>
            <textarea
              value={formResponseTemplate}
              rows={5}
              onChange={(e) => onFormChange(e.target.value)}
              spellCheck={false}
              placeholder={t('agent.template.formPlaceholder')}
              className="glass-input-console text-[12px] font-mono resize-y w-full leading-relaxed"
            />
            <span className="text-[10px] text-[var(--fog)]/70 leading-snug block">{t('agent.formResponseTemplateHint')}</span>
          </label>
        </div>
      </div>
    </div>
  )
}
