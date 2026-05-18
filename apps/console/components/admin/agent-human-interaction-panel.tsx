'use client'

import { Brain, Zap, Wand2 } from 'lucide-react'
import { useConsoleLocale } from '@/components/locale-provider'

const PLACEHOLDER_HELP = [
  '{{caseId}} — current case ID',
  '{{caseType}} — case type slug (e.g. deposit_issue)',
  '{{confirmedFacts}} — JSON of confirmed facts',
  '{{skillsCalled}} — skills already called',
  '{{question}} — agent\'s escalation question',
  '{{userId}} — customer user ID',
].join('\n')

interface Props {
  consultationPrompt: string
  humanSkills: string
  onConsultationPromptChange: (v: string) => void
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
              rows={12}
              onChange={(e) => onConsultationPromptChange(e.target.value)}
              spellCheck={false}
              placeholder={t('agent.human.promptPlaceholder')}
              className="glass-input-console text-[12px] font-mono resize-y w-full leading-relaxed"
            />
            <span className="text-[10px] text-[var(--fog)]/70 leading-snug block">{t('agent.human.promptHint')}</span>
          </label>
          <details className="text-[10px] text-[var(--fog)]/60 rounded-lg bg-black/[0.02] border border-black/[0.05] overflow-hidden">
            <summary className="px-3 py-2 cursor-pointer hover:text-[var(--mist)] select-none">{t('agent.human.placeholdersTitle')}</summary>
            <pre className="px-3 pb-2.5 font-mono text-[10px] whitespace-pre-wrap leading-relaxed">{PLACEHOLDER_HELP}</pre>
          </details>
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
          <details className="text-[10px] text-[var(--fog)]/60 rounded-lg bg-black/[0.02] border border-black/[0.05] overflow-hidden">
            <summary className="px-3 py-2 cursor-pointer hover:text-[var(--mist)] select-none">{t('agent.human.skillsPlaceholdersTitle')}</summary>
            <pre className="px-3 pb-2.5 font-mono text-[10px] whitespace-pre-wrap leading-relaxed">{t('agent.human.skillsPlaceholdersHelp')}</pre>
          </details>
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
                <textarea value={composerStopText} rows={2} onChange={(e) => onComposerStopTextChange(e.target.value)} className="glass-input-console text-[12px] font-mono resize-y w-full" placeholder={'"\\n\\n"' + '\n' + '"\\n"'} />
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
