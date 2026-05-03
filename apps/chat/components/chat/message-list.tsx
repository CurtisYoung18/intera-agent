'use client'

import { useEffect, useRef } from 'react'
import MessageBubble from './message-bubble'
import RespondingBubble from './responding-bubble'
import type { MessageShape } from './message-bubble'

interface MessageListProps {
  messages: MessageShape[]
  isResponding?: boolean
  onFormSubmit?: (msgId: string, answers: Record<string, string>) => void
  onFormCancel?: (msgId: string) => void
}

export default function MessageList({ messages, isResponding, onFormSubmit, onFormCancel }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isResponding])

  if (messages.length === 0) return null

  return (
    <div className="flex-1 overflow-y-auto py-6 space-y-4 scroll-thin">
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
