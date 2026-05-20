'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  pickRandomEyebrow,
  pickRandomGeneralLine,
  pickRandomToolVerb,
  pickCaptionFromSkillsCalled,
} from '@/lib/spinner-verbs'
import OrganicLoader from '@intera/shared/ui/organic-loader'
import type { SpinnerIcon } from '@intera/shared/types'

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
      setLine((prev) => {
        const next = pickStatusLine({ executingToolName, coreAgentTask, skillsCalled, previous: prev })
        lineRef.current = next
        return next
      })
    }

    tick()
    intervalRef.current = setInterval(tick, 2300)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [isVisible, executingToolName, coreAgentTask, skillsCalled])

  return (
    <AnimatePresence mode="wait">
      {isVisible && (
        <motion.div
          className="flex justify-start w-full"
          role="status"
          aria-live="polite"
          aria-label="Intera is preparing a reply"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.15 } }}
          transition={{ duration: 0.2 }}
        >
          <div className="glass-chat-assistant flex items-center gap-3 w-full max-w-[min(100%,34rem)] px-4 py-3 rounded-xl">
            {/* Organic loader — icon type derived from current state */}
            <OrganicLoader
              icon={executingToolName ? 'scan' : 'dots'}
              size={20}
              className="text-indigo/60 shrink-0"
            />

            {/* Status line */}
            <motion.span
              key={line}
              initial={{ opacity: 0.6 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.25 }}
              className="font-sans leading-none text-fog/55 text-[12px]"
            >
              {line}
            </motion.span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
