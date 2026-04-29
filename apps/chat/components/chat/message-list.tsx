'use client'

import { useEffect, useRef } from 'react'
import MessageBubble from './message-bubble'
import type { ThinkState } from './thinking-indicator'
import type { IconType } from '@/lib/spinner-verbs'
import type { MessageShape } from './message-bubble'

interface MessageListProps {
  messages: MessageShape[]
  thinkState?: ThinkState
  thinkVerb?: string
  thinkIcon?: IconType
  onFormSubmit?: (msgId: string, answers: Record<string, string>) => void
  onFormCancel?: (msgId: string) => void
}

export default function MessageList({ messages, thinkState, thinkVerb, thinkIcon, onFormSubmit, onFormCancel }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  if (messages.length === 0) return null

  return (
    <div className="flex-1 overflow-y-auto py-6 space-y-4 scroll-thin">
      {messages.map((msg, i) => {
        const isLast = i === messages.length - 1
        const isLastAssistant = isLast && msg.role === 'assistant' && msg.msgType === 'text' && !!msg.isStreaming

        return (
          <MessageBubble
            key={msg.id}
            msg={msg}
            thinkState={isLastAssistant ? thinkState : undefined}
            thinkVerb={isLastAssistant ? thinkVerb : undefined}
            thinkIcon={isLastAssistant ? thinkIcon : undefined}
            onFormSubmit={onFormSubmit}
            onFormCancel={onFormCancel}
          />
        )
      })}
      <div ref={bottomRef} />
    </div>
  )
}
