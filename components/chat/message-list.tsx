'use client'

// MessageList — scrollable message area, auto-scrolls to bottom

import { useEffect, useRef } from 'react'
import MessageBubble from './message-bubble'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
  toolUses?: Array<{
    name: string
    status: 'executing' | 'completed' | 'error'
  }>
  timestamp?: string
}

interface MessageListProps {
  messages: Message[]
}

export default function MessageList({ messages }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  if (messages.length === 0) {
    return null
  }

  return (
    <div className="flex-1 overflow-y-auto py-6 space-y-6 scroll-thin">
      {messages.map((msg) => (
        <MessageBubble
          key={msg.id}
          role={msg.role}
          content={msg.content}
          isStreaming={msg.isStreaming}
          toolUses={msg.toolUses}
          timestamp={msg.timestamp}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
