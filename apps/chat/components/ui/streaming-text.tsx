'use client'

// StreamingText — word-by-word blur→clear reveal for AI streaming output
// Newly arrived words animate from blur(4px)+transparent → clear+visible

import { useEffect, useRef, useMemo } from 'react'
import { motion } from 'motion/react'

interface StreamingTextProps {
  text: string
  isStreaming?: boolean
}

export default function StreamingText({ text, isStreaming }: StreamingTextProps) {
  const prevCountRef = useRef(0)

  const words = useMemo(() => {
    if (!text) return []
    // Split keeping trailing spaces for natural flow
    return text.split(/(?<=\s)/g).filter(w => w.length > 0)
  }, [text])

  // Track how many words were already animated
  useEffect(() => {
    prevCountRef.current = words.length
  }, [words.length])

  if (!text) return null

  const animatedCount = Math.max(0, prevCountRef.current)

  return (
    <span>
      {words.map((word, idx) => {
        const key = `${idx}-${word.length}`
        const isNew = idx >= animatedCount

        if (!isNew) {
          return <span key={key}>{word}</span>
        }

        const staggerDelay = (idx - animatedCount) * 0.025

        return (
          <motion.span
            key={key}
            initial={{ filter: 'blur(4px)', opacity: 0 }}
            animate={{ filter: 'blur(0px)', opacity: 1 }}
            transition={{
              duration: 0.3,
              delay: staggerDelay,
              ease: 'easeOut',
            }}
            style={{ display: 'inline-block' }}
          >
            {word}
          </motion.span>
        )
      })}
      {/* Streaming cursor */}
      {isStreaming && (
        <motion.span
          className="inline-block w-[2px] h-[1em] bg-indigo/60 align-middle ml-[1px]"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
    </span>
  )
}
