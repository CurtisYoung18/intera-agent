'use client'

// RespondingBubble — prominent interim state while assistant stream connects
// Large kinetic orb + glass card aligned with assistant message styling.

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'

const VERB_POOL = [
  'examining your order',
  'checking payment channels',
  'reviewing your case',
  'looking into this',
  'analyzing transaction data',
  'verifying deposit status',
  'tracing the payment',
  'consulting our records',
  'investigating',
  'reviewing details',
  'processing your request',
  'working on it',
  'checking the status',
  'pulling up your information',
  'following the paper trail',
]

function shuffledPool(): string[] {
  const pool = [...VERB_POOL]
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool
}

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

export default function RespondingBubble({ isVisible }: { isVisible: boolean }) {
  const [verb, setVerb] = useState(VERB_POOL[0])
  const poolRef = useRef<string[]>(shuffledPool())
  const indexRef = useRef(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (isVisible) {
      indexRef.current = 0
      poolRef.current = shuffledPool()
      setVerb(poolRef.current[0])

      intervalRef.current = setInterval(() => {
        indexRef.current++
        if (indexRef.current >= poolRef.current.length) {
          poolRef.current = shuffledPool()
          indexRef.current = 0
        }
        setVerb(poolRef.current[indexRef.current])
      }, 2200)
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [isVisible])

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
              <span className="font-sans text-[11px] sm:text-[12px] font-semibold uppercase tracking-[0.2em] text-fog/60">
                Composing
              </span>

              <div className="relative min-h-[3rem] flex items-center">
                <AnimatePresence mode="wait">
                  <motion.span
                    key={verb}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.38, ease: 'easeOut' }}
                    className="block font-serif text-[17px] sm:text-[18px] leading-snug text-mist/[0.88]"
                  >
                    <span className="italic text-mist/[0.78]">Intera is </span>
                    <span className="font-medium text-indigo/[0.85]">{verb}</span>
                    <span className="italic text-mist/[0.78]">…</span>
                  </motion.span>
                </AnimatePresence>
              </div>

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
