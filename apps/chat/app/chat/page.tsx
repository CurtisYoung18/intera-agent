'use client'

// Intera Harness — Chat Page
// Void + Fluid Glass design language

import { useState, useCallback } from 'react'
import ChatShell from '@/components/chat/chat-shell'
import StatusPill from '@intera/shared/ui/status-pill'
import MessageList from '@/components/chat/message-list'
import VoiceInputBar from '@/components/chat/voice-input-bar'
import WelcomeMessage from '@/components/chat/welcome-message'
import FormCard from '@/components/chat/form-card'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ToolUseInfo {
  name: string
  status: 'executing' | 'completed' | 'error'
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
  toolUses?: ToolUseInfo[]
  timestamp: string
}

type AgentStatus = 'online' | 'thinking' | 'executing' | 'waiting' | 'offline'

// ---------------------------------------------------------------------------
// Mock data for UI development (remove when API is connected)
// ---------------------------------------------------------------------------

// Fixed timestamps to avoid hydration mismatch
const MOCK_MESSAGES: ChatMessage[] = [
  {
    id: 'mock-1',
    role: 'assistant',
    content: 'Good evening. How can I help you today?',
    timestamp: '2026-04-28T17:22:00.000Z',
  },
  {
    id: 'mock-2',
    role: 'user',
    content:
      'I made a deposit of **500 yuan** yesterday, order number `TXU1_12345`, but it hasn\'t arrived yet.',
    timestamp: '2026-04-28T17:23:00.000Z',
  },
  {
    id: 'mock-3',
    role: 'assistant',
    content:
      'I understand your concern. Let me check your transaction `TXU1_12345` right away.\n\nHere\'s what I\'ll do:\n1. Query the order system\n2. Check the payment channel\n3. Verify with the provider if needed',
    timestamp: '2026-04-28T17:24:00.000Z',
    toolUses: [{ name: 'query_order_status', status: 'completed' }],
  },
  {
    id: 'mock-4',
    role: 'assistant',
    content:
      'I\'ve checked your order. Here are the results:\n\n' +
      '```\n' +
      'Order:    TXU1_12345\n' +
      'Status:   pending\n' +
      'Amount:   500 CNY\n' +
      'Channel:  unknown\n' +
      '```\n\n' +
      '> The transaction shows as **pending** on our side. ' +
      'This sometimes happens when the payment channel is experiencing delays.\n\n' +
      'Let me verify with the payment provider.',
    timestamp: '2026-04-28T17:25:00.000Z',
    toolUses: [
      { name: 'query_order_status', status: 'completed' },
      { name: 'query_payment_channel_status', status: 'executing' },
    ],
  },
]

const MOCK_WELCOME = false // Set to true to show empty state

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>(
    MOCK_WELCOME ? [] : MOCK_MESSAGES,
  )
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('online')
  const [isLoading, setIsLoading] = useState(false)
  const [formRequest, setFormRequest] = useState<{
    skillCallId: string
    title: string
    description?: string
    fields: Array<{ key: string; label: string; type: string; required?: boolean; placeholder?: string; options?: string[] }>
  } | null>(null)

  const handleSubmit = useCallback(
    async (text: string) => {
      if (isLoading) return
      setIsLoading(true)
      setAgentStatus('thinking')

      // Add user message
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: text,
        timestamp: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, userMsg])

      // Add placeholder for streaming assistant response
      const assistantId = crypto.randomUUID()
      setMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: 'assistant',
          content: '',
          isStreaming: true,
          timestamp: new Date().toISOString(),
        },
      ])

      try {
        const response = await fetch('/api/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            customerId: 'default',
            userId: 'anonymous',
          }),
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        const reader = response.body?.getReader()
        const decoder = new TextDecoder()
        let fullContent = ''
        const activeTools = new Map<string, ToolUseInfo>()

        if (reader) {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            const chunk = decoder.decode(value)
            const lines = chunk.split('\n')

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue
              try {
                const event = JSON.parse(line.slice(6))

                switch (event.type) {
                  case 'text_delta':
                    fullContent += event.data as string
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === assistantId
                          ? { ...m, content: fullContent }
                          : m,
                      ),
                    )
                    break

                  case 'thinking_delta':
                    setAgentStatus('thinking')
                    break

                  case 'tool_executing': {
                    setAgentStatus('executing')
                    const td = event.data as { name: string; status: string }
                    activeTools.set(td.name, {
                      name: td.name,
                      status: 'executing',
                    })
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === assistantId
                          ? {
                              ...m,
                              toolUses: Array.from(activeTools.values()),
                            }
                          : m,
                      ),
                    )
                    break
                  }

                  case 'skill_result': {
                    const sd = event.data as { name: string; status: string }
                    const isError = sd.status === 'error'
                    activeTools.set(sd.name, {
                      name: sd.name,
                      status: isError ? 'error' : 'completed',
                    })
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === assistantId
                          ? {
                              ...m,
                              toolUses: Array.from(activeTools.values()),
                            }
                          : m,
                      ),
                    )
                    // Clear tool after 3s
                    setTimeout(() => {
                      activeTools.delete(sd.name)
                      setMessages((prev) =>
                        prev.map((m) =>
                          m.id === assistantId
                            ? {
                                ...m,
                                toolUses: Array.from(activeTools.values()),
                              }
                            : m,
                        ),
                      )
                    }, 3000)
                    break
                  }

                  case 'human_task_created':
                    setAgentStatus('waiting')
                    break

                  case 'form_request':
                    setAgentStatus('waiting')
                    setFormRequest(event.data as typeof formRequest)
                    break

                  case 'finalized':
                    setAgentStatus('online')
                    break

                  case 'message_stop':
                    setAgentStatus('online')
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === assistantId
                          ? { ...m, isStreaming: false }
                          : m,
                      ),
                    )
                    break

                  case 'error':
                    console.error('Agent error:', event.data)
                    setAgentStatus('online')
                    break
                }
              } catch {
                // Skip malformed SSE lines
              }
            }
          }
        }

        // If nothing was streamed, remove placeholder and add fallback
        if (!fullContent) {
          setMessages((prev) => prev.filter((m) => m.id !== assistantId))
        }
      } catch (error) {
        console.error('Chat error:', error)
        setAgentStatus('offline')
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content:
                    'I apologize, but I encountered a connection issue. Please try again.',
                  isStreaming: false,
                }
              : m,
          ),
        )
      } finally {
        setIsLoading(false)
      }
    },
    [isLoading],
  )

  return (
    <ChatShell>
      {/* Status pill */}
      <div className="flex justify-center pt-6 pb-8">
        <StatusPill status={agentStatus} label="Intera AI" />
      </div>

      {/* Messages or welcome */}
      {messages.length === 0 ? (
        <WelcomeMessage />
      ) : (
        <MessageList messages={messages} />
      )}

      {/* Input bar */}
      <VoiceInputBar
        onSubmit={handleSubmit}
        isLoading={isLoading}
      />
    </ChatShell>
  )
}
