'use client'

// RespondingBubble — CC-style loading bubble at the bottom of the message list
// Three staggered pulsing dots + cycling verb phrase from a 15-phrase pool
// Shows while Intera is generating a response, disappears on completion

import { useState, useEffect, useRef } from 'react'

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

  if (!isVisible) return null

  return (
    <div className="flex justify-start py-1">
      <div className="responding-bubble animate-fade-up">
        <div className="flex gap-1 items-center">
          <span className="responding-dot dot-1" />
          <span className="responding-dot dot-2" />
          <span className="responding-dot dot-3" />
        </div>
        <span className="responding-verb">Intera is {verb}…</span>
      </div>
    </div>
  )
}
