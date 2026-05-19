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
  /** Error state: shown as a banner with optional retry */
  error?: string | null
  onRetry?: () => void
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
  error,
  onRetry,
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

  if (messages.length === 0 && !isResponding && !error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-xs text-fog/25 select-none">
          {typeof window !== 'undefined' && navigator.language.toLowerCase().startsWith('zh')
            ? '发送消息开始对话'
            : 'Send a message to start'}
        </p>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto py-6 space-y-4 scroll-thin"
      role="log"
      aria-live="polite"
    >
      {/* Error banner with retry */}
      {error && (
        <div className="mx-4 flex items-center gap-2 rounded-lg border border-red-400/20 bg-red-400/5 px-3 py-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(248,113,113,0.7)" strokeWidth="2" className="shrink-0">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span className="text-[11px] text-red-300/80 flex-1 truncate">{error}</span>
          {onRetry && (
            <button
              onClick={onRetry}
              className="text-[10px] font-medium text-red-300 hover:text-red-200 underline underline-offset-2 shrink-0"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {messages.map((msg, idx) => (
        <MessageBubble
          key={msg.id}
          msg={msg}
          priorUserContent={priorUserContent(messages, idx)}
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
