'use client'

import { MessageSquareText, Zap, Wand2 } from 'lucide-react'
import {
  HARNESS_DEFAULT_FORM_RESPONSE_APPEND,
  HARNESS_DEFAULT_RESUME_PROMPT_APPEND,
} from '@intera/shared/defaults'
import { useConsoleLocale } from '@/components/locale-provider'

const SAMPLE_FORM_LINES = '[Form submitted]\namount: 100 USD\ntxnId: demo-order-9821'

interface Props {
  resumePrompt: string
  formResponseTemplate: string
  humanSkills: string
  onResumeChange: (v: string) => void
  onFormChange: (v: string) => void
  onHumanSkillsChange: (v: string) => void
  // Composer assist (DeepSeek beta prefix continuation)
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
  resumePrompt,
  formResponseTemplate,
  humanSkills,
  onResumeChange,
  onFormChange,
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

  const resumeAppend = resumePrompt.trim() ? resumePrompt : HARNESS_DEFAULT_RESUME_PROMPT_APPEND
  const formTail = formResponseTemplate.trim()
    ? formResponseTemplate.trim()
    : HARNESS_DEFAULT_FORM_RESPONSE_APPEND

  const resumeMock = `${t('agent.human.resumeMockHeader')}\n${resumeAppend}`
  const formMock = `${SAMPLE_FORM_LINES}\n\n${formTail}`

  return (
    <div className="space-y-5">
      {/* ── Consultation Prompts ── */}
      <div className="rounded-xl border border-sky-500/20 bg-gradient-to-br from-sky-400/8 via-white/40 to-transparent overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-black/[0.05] flex items-center gap-2 bg-sky-500/10">
          <MessageSquareText className="w-4 h-4 text-sky-600" />
          <div>
            <h3 className="text-[13px] font-semibold text-[var(--mist)]">{t('agent.human.resumeTitle')}</h3>
            <p className="text-[10px] text-[var(--fog)]">{t('agent.human.resumeLead')}</p>
          </div>
        </div>
        <div className="p-4 space-y-4">
          <div className="rounded-lg bg-black/[0.03] border border-black/[0.06] p-3">
            <div className="text-[10px] uppercase tracking-wide text-[var(--fog)]/60 mb-2">{t('agent.template.previewLabel')}</div>
            <pre className="text-[11px] font-mono text-[var(--mist)] whitespace-pre-wrap leading-relaxed opacity-92">{resumeMock}</pre>
          </div>
          {!resumePrompt.trim() && (
            <p className="text-[11px] text-[var(--fog)] rounded-lg bg-black/[0.04] px-3 py-2 border border-black/[0.05]">{t('agent.template.resumeFallbackNote')}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="text-[11px] px-2.5 py-1.5 rounded-lg border border-black/[0.08] bg-white/60 hover:border-indigo/30 hover:text-indigo" onClick={() => onResumeChange(HARNESS_DEFAULT_RESUME_PROMPT_APPEND)}>{t('agent.template.fillHarnessDefault')}</button>
            <button type="button" className="text-[11px] px-2.5 py-1.5 rounded-lg border border-black/[0.08] bg-white/60 hover:border-indigo/30 hover:text-indigo" onClick={() => onResumeChange('')}>{t('agent.template.clearUseBuiltin')}</button>
          </div>
          <label className="space-y-1 block">
            <span className="text-[11px] text-[var(--fog)]">{t('agent.human.resumePromptLabel')}</span>
            <textarea value={resumePrompt} rows={4} onChange={(e) => onResumeChange(e.target.value)} spellCheck={false} className="glass-input-console text-[12px] font-mono resize-y w-full leading-relaxed" />
            <span className="text-[10px] text-[var(--fog)]/70 leading-snug block">{t('agent.human.resumePromptHint')}</span>
          </label>
        </div>
      </div>

      {/* ── Form Response ── */}
      <div className="rounded-xl border border-malachite/25 bg-gradient-to-br from-malachite/10 via-white/40 to-transparent overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-black/[0.05] flex items-center gap-2 bg-malachite/15">
          <MessageSquareText className="w-4 h-4 text-malachite" />
          <div>
            <h3 className="text-[13px] font-semibold text-[var(--mist)]">{t('agent.human.formTitle')}</h3>
            <p className="text-[10px] text-[var(--fog)]">{t('agent.human.formLead')}</p>
          </div>
        </div>
        <div className="p-4 space-y-4">
          <div className="rounded-lg bg-black/[0.03] border border-black/[0.06] p-3">
            <div className="text-[10px] uppercase tracking-wide text-[var(--fog)]/60 mb-2">{t('agent.template.previewLabel')}</div>
            <pre className="text-[11px] font-mono text-[var(--mist)] whitespace-pre-wrap leading-relaxed opacity-92">{formMock}</pre>
          </div>
          {!formResponseTemplate.trim() && (
            <p className="text-[11px] text-[var(--fog)] rounded-lg bg-black/[0.04] px-3 py-2 border border-black/[0.05]">{t('agent.template.formFallbackNote')}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="text-[11px] px-2.5 py-1.5 rounded-lg border border-black/[0.08] bg-white/60 hover:border-indigo/30 hover:text-indigo" onClick={() => onFormChange(HARNESS_DEFAULT_FORM_RESPONSE_APPEND)}>{t('agent.template.fillHarnessDefault')}</button>
            <button type="button" className="text-[11px] px-2.5 py-1.5 rounded-lg border border-black/[0.08] bg-white/60 hover:border-indigo/30 hover:text-indigo" onClick={() => onFormChange('')}>{t('agent.template.clearUseBuiltin')}</button>
          </div>
          <label className="space-y-1 block">
            <span className="text-[11px] text-[var(--fog)]">{t('agent.human.formPromptLabel')}</span>
            <textarea value={formResponseTemplate} rows={3} onChange={(e) => onFormChange(e.target.value)} spellCheck={false} className="glass-input-console text-[12px] font-mono resize-y w-full leading-relaxed" />
            <span className="text-[10px] text-[var(--fog)]/70 leading-snug block">{t('agent.human.formPromptHint')}</span>
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
          <label className="space-y-1 block">
            <span className="text-[11px] text-[var(--fog)]">{t('agent.human.skillsLabel')}</span>
            <textarea
              value={humanSkills}
              rows={4}
              onChange={(e) => onHumanSkillsChange(e.target.value)}
              spellCheck={false}
              placeholder={t('agent.human.skillsPlaceholder') || 'query_order_status\nquery_payment_channel_status\nquery_account_status\nsearch_delay_notice'}
              className="glass-input-console text-[12px] font-mono resize-y w-full leading-relaxed"
            />
            <span className="text-[10px] text-[var(--fog)]/70 leading-snug block">{t('agent.human.skillsHint')}</span>
          </label>
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
              <input
                type="checkbox"
                checked={composerEnabled}
                onChange={(e) => onComposerEnabledChange(e.target.checked)}
                className="accent-purple-600 rounded"
              />
              <span className="text-[11px] font-medium text-[var(--mist)]">{t('agent.human.composerToggle')}</span>
            </label>
          </div>
        </div>
        {composerEnabled && (
          <div className="p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="space-y-1 block">
                <span className="text-[10px] text-[var(--fog)]">{t('agent.human.composerModel')}</span>
                <input
                  type="text"
                  value={composerModel}
                  onChange={(e) => onComposerModelChange(e.target.value)}
                  className="glass-input-console text-[12px] font-mono w-full"
                  placeholder="deepseek-chat"
                />
              </label>
              <label className="space-y-1 block">
                <span className="text-[10px] text-[var(--fog)]">{t('agent.human.composerBaseUrl')}</span>
                <input
                  type="text"
                  value={composerBaseUrl}
                  onChange={(e) => onComposerBaseUrlChange(e.target.value)}
                  className="glass-input-console text-[12px] font-mono w-full"
                  placeholder="https://api.deepseek.com/beta"
                />
              </label>
            </div>
            <label className="space-y-1 block">
              <span className="text-[10px] text-[var(--fog)]">{t('agent.human.composerPrefix')}</span>
              <input
                type="text"
                value={composerAssistantPrefix}
                onChange={(e) => onComposerAssistantPrefixChange(e.target.value)}
                className="glass-input-console text-[12px] font-mono w-full"
              />
              <span className="text-[10px] text-[var(--fog)]/70 leading-snug block">{t('agent.human.composerPrefixHint')}</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="space-y-1 block">
                <span className="text-[10px] text-[var(--fog)]">{t('agent.human.composerStopText')}</span>
                <textarea
                  value={composerStopText}
                  rows={2}
                  onChange={(e) => onComposerStopTextChange(e.target.value)}
                  className="glass-input-console text-[12px] font-mono resize-y w-full"
                  placeholder={'"\\n\\n"' + '\n' + '"\\n"'}
                />
                <span className="text-[10px] text-[var(--fog)]/70 leading-snug block">{t('agent.human.composerStopHint')}</span>
              </label>
              <label className="space-y-1 block">
                <span className="text-[10px] text-[var(--fog)]">{t('agent.human.composerMinDraft')}</span>
                <input
                  type="number"
                  value={composerMinDraftChars}
                  min={1}
                  max={20}
                  step={1}
                  onChange={(e) => onComposerMinDraftCharsChange(Math.max(1, parseInt(e.target.value, 10) || 4))}
                  className="glass-input-console text-[12px] font-mono w-full"
                />
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
