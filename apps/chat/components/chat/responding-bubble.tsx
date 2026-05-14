'use client'

// RespondingBubble — interim state while assistant stream connects
// Random eyebrow + line; line prefers active tool → stage task → skillsCalled trail → generic pool.

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  pickRandomEyebrow,
  pickRandomGeneralLine,
  pickRandomToolVerb,
  pickCaptionFromSkillsCalled,
} from '@/lib/spinner-verbs'

function RespondingOrb() {
  return (
    <div className="relative size-[4.75rem] shrink-0" aria-hidden>
      <motion.div
        className="absolute inset-0 text-indigo/40"
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 14, ease: 'linear' }}
      >
        <svg viewBox="0 0 100 100" className="size-full overflow-visible">
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeDasharray="12 18"
            strokeLinecap="round"
          />
        </svg>
      </motion.div>
      <motion.div
        className="absolute inset-1 text-sky"
        animate={{ rotate: -360 }}
        transition={{ repeat: Infinity, duration: 9, ease: 'linear' }}
      >
        <svg viewBox="0 0 100 100" className="size-full opacity-70 overflow-visible">
          <circle
            cx="50"
            cy="50"
            r="36"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.9"
            strokeDasharray="8 26"
            strokeLinecap="round"
          />
        </svg>
      </motion.div>
      <motion.div
        className="absolute inset-[22%] rounded-full bg-gradient-to-br from-white via-white/80 to-indigo/[0.14] shadow-[0_8px_28px_-6px_rgba(91,110,245,0.35),inset_0_1px_0_rgba(255,255,255,0.85)] border border-white/70 flex items-center justify-center"
        animate={{ scale: [1, 1.04, 1] }}
        transition={{ repeat: Infinity, duration: 2.6, ease: 'easeInOut' }}
      >
        <div className="size-4 rounded-full bg-gradient-to-br from-indigo to-indigo/55 shadow-[0_0_18px_rgba(91,138,247,0.45)]" />
      </motion.div>
    </div>
  )
}

function pickStatusLine(opts: {
  executingToolName?: string | null
  coreAgentTask?: string
  skillsCalled?: string[]
  previous?: string
}): string {
  const { executingToolName, coreAgentTask, skillsCalled, previous } = opts
  if (executingToolName) {
    let line = pickRandomToolVerb(executingToolName).text
    let g = 0
    while (line === previous && g++ < 6) {
      line = pickRandomToolVerb(executingToolName).text
    }
    return line
  }
  if (coreAgentTask) return coreAgentTask
  if (skillsCalled?.length) return pickCaptionFromSkillsCalled(skillsCalled, previous)
  return pickRandomGeneralLine(previous)
}

export default function RespondingBubble({
  isVisible,
  coreAgentTask,
  executingToolName,
  skillsCalled,
}: {
  isVisible: boolean
  coreAgentTask?: string
  executingToolName?: string | null
  skillsCalled?: string[]
}) {
  const [eyebrow, setEyebrow] = useState(() => pickRandomEyebrow())
  const [line, setLine] = useState(() => pickRandomGeneralLine())
  const lineRef = useRef(line)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    lineRef.current = line
  }, [line])

  useEffect(() => {
    if (!isVisible) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }

    const tick = () => {
      setEyebrow((prev) => pickRandomEyebrow(prev))
      setLine((prev) => {
        const next = pickStatusLine({
          executingToolName,
          coreAgentTask,
          skillsCalled,
          previous: prev,
        })
        lineRef.current = next
        return next
      })
    }

    // Immediate refresh when tool / task / skills change
    tick()

    intervalRef.current = setInterval(tick, 2300)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [isVisible, executingToolName, coreAgentTask, skillsCalled])

  const isTaskLine = !executingToolName && Boolean(coreAgentTask) && line === coreAgentTask

  return (
    <AnimatePresence mode="wait">
      {isVisible && (
        <motion.div
          className="flex justify-start w-full"
          role="status"
          aria-live="polite"
          aria-busy="true"
          aria-label="Intera is preparing a reply"
          initial={{ opacity: 0, y: 14, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.98, transition: { duration: 0.24 } }}
          transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="glass-chat-assistant flex items-start gap-5 sm:gap-6 w-full max-w-[min(100%,34rem)] px-6 py-6 sm:px-8 sm:py-7 rounded-[1.5rem] shadow-[0_12px_40px_-14px_rgba(91,110,245,0.22),0_0_0_1px_rgba(255,255,255,0.55)_inset] animate-glow-pulse">
            <RespondingOrb />

            <div className="flex flex-col gap-2 sm:gap-2.5 min-w-0 flex-1 pt-1">
              <motion.span
                key={eyebrow}
                initial={{ opacity: 0.6, y: 2 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35 }}
                className="font-sans text-[11px] sm:text-[12px] font-semibold uppercase tracking-[0.2em] text-fog/60"
              >
                {eyebrow}
              </motion.span>

              <div className="relative min-h-[3rem] flex items-center">
                <AnimatePresence mode="wait">
                  <motion.span
                    key={`${line}-${executingToolName ?? ''}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.38, ease: 'easeOut' }}
                    className={`block font-serif leading-snug text-mist/[0.88] ${
                      isTaskLine ? 'text-[15px] sm:text-[16px]' : 'text-[17px] sm:text-[18px]'
                    }`}
                  >
                    <span className="italic text-mist/[0.78]">Intera is </span>
                    <span className="font-medium text-indigo/[0.85]">{line}</span>
                    <span className="italic text-mist/[0.78]">…</span>
                  </motion.span>
                </AnimatePresence>
              </div>

              {skillsCalled && skillsCalled.length > 0 && !executingToolName && (
                <p className="text-[10px] uppercase tracking-[0.12em] text-fog/45 font-medium">
                  Skills in this case: {skillsCalled.slice(-4).join(' · ')}
                  {skillsCalled.length > 4 ? ' · …' : ''}
                </p>
              )}

              <div className="relative mt-1 h-1 w-full max-w-[220px] rounded-full bg-fog/[0.12] overflow-hidden">
                <motion.div
                  className="absolute top-0 bottom-0 left-0 w-[38%] rounded-full bg-gradient-to-r from-transparent via-indigo/45 to-transparent"
                  initial={{ x: '-100%' }}
                  animate={{ x: ['0%', '162%'] }}
                  transition={{ repeat: Infinity, duration: 1.85, ease: 'easeInOut' }}
                />
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
