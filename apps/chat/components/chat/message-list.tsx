'use client'

import { useEffect, useRef, useCallback } from 'react'
import MessageBubble from './message-bubble'
import RespondingBubble from './responding-bubble'
import type { MessageShape } from './message-bubble'

interface MessageListProps {
  messages: MessageShape[]
  activeCaseId?: string | null
  isResponding?: boolean
  coreAgentTask?: string
  executingToolName?: string | null
  skillsCalled?: string[]
  /** Case / investigation split — pop forms to center focus */
  elevateInteractiveForms?: boolean
  onFormSubmit?: (msgId: string, answers: Record<string, string>) => void | Promise<void>
  onFormCancel?: (msgId: string) => void
  onIntentConfirm?: (msgId: string, selectedCaseTypes: string[]) => void | Promise<void>
  onInteractionSelect?: (msgId: string, optionId: string, input?: string) => void | Promise<void>
}

const SCROLL_THRESHOLD = 80 // px from bottom to consider "at bottom"

function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD
}

function priorUserContent(messages: MessageShape[], index: number): string | undefined {
  for (let i = index - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i].content
  }
  return undefined
}

export default function MessageList({
  messages,
  activeCaseId,
  isResponding,
  coreAgentTask,
  executingToolName,
  skillsCalled,
  elevateInteractiveForms,
  onFormSubmit,
  onFormCancel,
  onIntentConfirm,
  onInteractionSelect,
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const wasNearBottom = useRef(true)

  const scrollToBottom = useCallback((smooth: boolean) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  // Auto-scroll only if user was already at the bottom
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    if (wasNearBottom.current) {
      scrollToBottom(true)
    }
  }, [messages, isResponding, scrollToBottom, activeCaseId, executingToolName, skillsCalled])

  // Track whether user is near bottom
  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (el) wasNearBottom.current = isNearBottom(el)
  }, [])

  if (messages.length === 0) return null

  const visible =
    activeCaseId != null && activeCaseId !== ''
      ? messages.filter((m) => {
          if (m.role === 'user') return true
          if (!m.relatedCaseId) return true
          return m.relatedCaseId === activeCaseId
        })
      : messages

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto py-6 space-y-4 scroll-thin"
      role="log"
      aria-live="polite"
    >
      {visible.map((msg, idx) => (
        <MessageBubble
          key={msg.id}
          msg={msg}
          priorUserContent={priorUserContent(visible, idx)}
          elevateInteractiveForms={elevateInteractiveForms}
          onFormSubmit={onFormSubmit}
          onFormCancel={onFormCancel}
          onIntentConfirm={onIntentConfirm}
          onInteractionSelect={onInteractionSelect}
        />
      ))}

      <RespondingBubble
        isVisible={!!isResponding}
        coreAgentTask={coreAgentTask}
        executingToolName={executingToolName}
        skillsCalled={skillsCalled}
      />

      <div ref={bottomRef} />
    </div>
  )
}
