'use client'

// IntentClarificationCard — multi-select case types (confidence-sorted options).

import { useState, useMemo } from 'react'
import { motion } from 'motion/react'
import GlassCard from '@intera/shared/ui/glass-card'

interface CaseTypeOption {
  type: string
  displayName: string
  icon: string
  confidence: number
}

interface IntentClarificationCardProps {
  locale?: 'zh' | 'en'
  options: CaseTypeOption[]
  /** Selected types sorted by descending confidence among checked items */
  onConfirm: (selectedTypes: string[]) => void
}

const COPY = {
  zh: {
    lead: '仅当检测到多种工单类型可能与同一条描述相关时才会出现此卡。可多选处理方式；系统将按置信度开立并行专项调查。',
    recommended: '优先推荐',
    confidence: (n: number) => `置信 ${Math.round(n * 100)}%`,
    hint: '至少勾选一项后确认。',
    confirm: '确认并开始',
    ariaCheckbox: '选择工单类型',
  },
  en: {
    lead: 'Your message may match more than one issue type. Select all that apply—we’ll open parallel investigations, prioritizing higher-confidence cases first.',
    recommended: 'Suggested first',
    confidence: (n: number) => `${Math.round(n * 100)}% match`,
    hint: 'Pick at least one, then confirm.',
    confirm: 'Confirm & start',
    ariaCheckbox: 'Select issue type',
  },
} as const

export default function IntentClarificationCard({
  locale = 'en',
  options,
  onConfirm,
}: IntentClarificationCardProps) {
  const copy = COPY[locale]
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(options.map((o) => o.type)))
  const [locked, setLocked] = useState(false)

  const recommendedType = options[0]?.type

  const toggle = (type: string) => {
    if (locked) return
    setChosen((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  const orderedSelection = useMemo(() => {
    const score = new Map(options.map((o) => [o.type, o.confidence]))
    return [...chosen].sort((a, b) => (score.get(b) ?? 0) - (score.get(a) ?? 0))
  }, [chosen, options])

  const submit = () => {
    if (locked || orderedSelection.length === 0) return
    setLocked(true)
    onConfirm(orderedSelection)
  }

  return (
    <GlassCard variant="chat-assistant">
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-fog/60 font-sans leading-relaxed">
          {copy.lead}
        </p>
        <div className="flex flex-col gap-2">
          {options.map((opt, i) => {
            const checked = chosen.has(opt.type)
            const isTop = opt.type === recommendedType
            return (
              <motion.button
                key={opt.type}
                type="button"
                role="checkbox"
                aria-checked={checked}
                aria-label={`${copy.ariaCheckbox}: ${opt.displayName}`}
                onClick={() => toggle(opt.type)}
                disabled={locked}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06, duration: 0.28, ease: 'easeOut' }}
                className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-left transition-all duration-200
                  ${checked
                    ? 'border-indigo/35 bg-indigo/[0.07] shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]'
                    : 'border-[var(--border-subtle)] hover:border-indigo/18 hover:bg-indigo/[0.02]'
                  }
                  ${locked ? 'opacity-90' : ''}
                `}
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border text-[11px] font-bold
                    ${checked ? 'border-indigo/40 bg-indigo/15 text-indigo' : 'border-fog/25 bg-white/30 text-transparent'}
                  `}
                  aria-hidden
                >
                  ✓
                </span>
                <span className="text-xl flex-shrink-0 leading-none">{opt.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[14px] font-medium text-mist">{opt.displayName}</span>
                    {isTop && (
                      <span className="rounded-md bg-amber/[0.12] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber/90">
                        {copy.recommended}
                      </span>
                    )}
                    <span className="text-[11px] tabular-nums text-fog/45">{copy.confidence(opt.confidence)}</span>
                  </span>
                </span>
              </motion.button>
            )
          })}
        </div>

        <p className="text-[11px] text-fog/40">{copy.hint}</p>

        <motion.button
          type="button"
          disabled={locked || orderedSelection.length === 0}
          onClick={submit}
          whileTap={{ scale: locked ? 1 : 0.98 }}
          className="rounded-xl bg-gradient-to-r from-indigo/90 to-indigo/75 px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_8px_24px_-10px_rgba(91,110,245,0.55)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {copy.confirm}
        </motion.button>
      </div>
    </GlassCard>
  )
}
