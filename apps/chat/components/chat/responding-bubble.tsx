'use client'

// RespondingBubble — Claude-style inline thinking indicator
// Renders as a subtle assistant message at the bottom of the conversation.
// Smoothly exits with AnimatePresence when the real response arrives.

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
      }, 2500)
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
          className="flex justify-start"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, height: 0, marginBottom: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        >
          <div className="flex items-center gap-2.5 px-4 py-2 rounded-2xl bg-[var(--surface)] border border-[var(--border-subtle)] max-w-[90%]">
            {/* Thin spinning ring */}
            <svg width="16" height="16" viewBox="0 0 16 16" className="flex-shrink-0 animate-spin">
              <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="9 28" strokeLinecap="round" className="text-indigo/50" />
            </svg>

            <span className="font-serif text-[14px] italic text-fog/40">
              Intera is {verb}…
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
