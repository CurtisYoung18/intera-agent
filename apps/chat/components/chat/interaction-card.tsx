'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import GlassCard from '@intera/shared/ui/glass-card'
import type { InteractionOption } from '@intera/shared/types'

interface InteractionCardProps {
  locale: 'zh' | 'en'
  title: string
  description: string
  options: InteractionOption[]
  multiSelect?: boolean
  onSelect: (optionId: string, input?: string) => void
}

const copy = {
  zh: { select: '请选择一个选项', confirm: '确认', inputPlaceholder: '请输入…', locked: '已确认' },
  en: { select: 'Select an option', confirm: 'Confirm', inputPlaceholder: 'Enter…', locked: 'Confirmed' },
}

export default function InteractionCard({ locale, title, description, options, multiSelect, onSelect }: InteractionCardProps) {
  const t = copy[locale] ?? copy.en
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [inputValues, setInputValues] = useState<Record<string, string>>({})
  const [locked, setLocked] = useState(false)

  const toggle = (id: string) => {
    if (locked) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (multiSelect) {
        next.has(id) ? next.delete(id) : next.add(id)
      } else {
        next.clear()
        next.add(id)
      }
      return next
    })
  }

  const handleConfirm = () => {
    if (locked || selected.size === 0) return
    setLocked(true)
    const chosen = [...selected][0]
    onSelect(chosen, inputValues[chosen] || undefined)
  }

  return (
    <GlassCard variant="chat-assistant" className="w-full max-w-sm p-4 space-y-3">
      {title && <p className="text-sm font-semibold text-[var(--void)]">{title}</p>}
      {description && <p className="text-xs text-[var(--fog)] leading-relaxed">{description}</p>}

      <div className="space-y-2">
        {options.map((opt) => {
          const isSelected = selected.has(opt.id)
          const needsInput = opt.inputType && opt.inputType !== 'none'

          return (
            <motion.button
              key={opt.id}
              whileTap={{ scale: 0.985 }}
              onClick={() => toggle(opt.id)}
              disabled={locked}
              className={`
                w-full text-left p-3 rounded-xl border transition-all duration-150
                ${locked ? 'cursor-default' : 'cursor-pointer'}
                ${isSelected
                  ? 'border-[var(--accent)] bg-[var(--accent)]/8 shadow-[0_0_0_1px_var(--accent)]'
                  : 'border-black/[0.06] bg-white/60 hover:border-black/[0.12] hover:bg-white/80'
                }
              `}
            >
              <div className="flex items-start gap-2.5">
                <span className={`
                  mt-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full border-2 shrink-0 transition-colors
                  ${isSelected ? 'border-[var(--accent)] bg-[var(--accent)]' : 'border-black/15'}
                `}>
                  {isSelected && (
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                      <path d="M1.5 4L3.5 6L6.5 2" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--void)]">{opt.label}</p>
                  {opt.description && (
                    <p className="text-xs text-[var(--fog)] mt-0.5">{opt.description}</p>
                  )}
                </div>
              </div>

              <AnimatePresence>
                {isSelected && needsInput && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <input
                      type={opt.inputType === 'number' ? 'number' : 'text'}
                      placeholder={opt.inputPlaceholder || t.inputPlaceholder}
                      value={inputValues[opt.id] || ''}
                      onChange={(e) => setInputValues((prev) => ({ ...prev, [opt.id]: e.target.value }))}
                      disabled={locked}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-2 w-full rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm text-[var(--void)] placeholder:text-[var(--fog)]/60 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.button>
          )
        })}
      </div>

      {!locked && (
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={handleConfirm}
          disabled={selected.size === 0}
          className={`
            w-full py-2.5 rounded-xl text-sm font-semibold transition-all duration-150
            ${selected.size > 0
              ? 'bg-[var(--void)] text-white hover:bg-[var(--void)]/90'
              : 'bg-black/5 text-[var(--fog)]/40 cursor-not-allowed'
            }
          `}
        >
          {t.confirm}
        </motion.button>
      )}

      {locked && (
        <p className="text-xs text-center text-[var(--fog)] select-none">✓ {t.locked}</p>
      )}
    </GlassCard>
  )
}
