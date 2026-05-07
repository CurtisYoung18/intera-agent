'use client'

import { useEffect, useRef, useCallback } from 'react'
import MessageBubble from './message-bubble'
import RespondingBubble from './responding-bubble'
import type { MessageShape } from './message-bubble'

interface MessageListProps {
  messages: MessageShape[]
  isResponding?: boolean
  onFormSubmit?: (msgId: string, answers: Record<string, string>) => void
  onFormCancel?: (msgId: string) => void
}

const SCROLL_THRESHOLD = 80 // px from bottom to consider "at bottom"

function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD
}

export default function MessageList({ messages, isResponding, onFormSubmit, onFormCancel }: MessageListProps) {
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
  }, [messages, isResponding, scrollToBottom])

  // Track whether user is near bottom
  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (el) wasNearBottom.current = isNearBottom(el)
  }, [])

  if (messages.length === 0) return null

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto py-6 space-y-4 scroll-thin"
      role="log"
      aria-live="polite"
    >
      {messages.map((msg) => (
        <MessageBubble
          key={msg.id}
          msg={msg}
          onFormSubmit={onFormSubmit}
          onFormCancel={onFormCancel}
        />
      ))}

      <RespondingBubble isVisible={!!isResponding} />

      <div ref={bottomRef} />
    </div>
  )
}
