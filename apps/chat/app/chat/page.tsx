'use client'

// Intera Harness — Chat Page
// Atomic multi-bubble agent responses: each tool call + text segment = independent bubble
// Always-unlocked input with queue mode: messages submitted while agent is responding are queued and sent on message_stop

import { useState, useCallback, useRef } from 'react'
import ChatShell from '@/components/chat/chat-shell'
import StatusPill from '@intera/shared/ui/status-pill'
import MessageList from '@/components/chat/message-list'
import VoiceInputBar from '@/components/chat/voice-input-bar'
import WelcomeMessage from '@/components/chat/welcome-message'
import CaseCard from '@/components/chat/case-card'
import type { CaseStatus } from '@/components/chat/case-card'
import { pickToolVerb } from '@/lib/spinner-verbs'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MsgType = 'text' | 'tool_call' | 'form_active' | 'form_submitted'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  msgType: MsgType
  content: string
  isStreaming?: boolean
  thinking?: string
  thinkingStartedAt?: string
  toolStatus?: 'executing' | 'completed' | 'error'
  toolName?: string
  toolVerb?: string
  formData?: {
    title: string
    description?: string
    fields: Array<{ key: string; label: string; type: string; required?: boolean; placeholder?: string; options?: string[] }>
    answers?: Record<string, string>
  }
  timestamp: string
}

type AgentStatus = 'online' | 'thinking' | 'executing' | 'waiting' | 'offline'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMsg(partial: Partial<ChatMessage> & { id: string; role: 'user' | 'assistant'; msgType: MsgType }): ChatMessage {
  return { content: '', timestamp: new Date().toISOString(), ...partial }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('online')
  const [isLoading, setIsLoading] = useState(false)
  const [queuedCount, setQueuedCount] = useState(0)

  const isLoadingRef = useRef(false)
  const queuedRef = useRef<string[]>([])
  const caseIdRef = useRef<string>(`case_${Date.now()}`)
  const lastUserMsgRef = useRef<string>('')

  const [caseCard, setCaseCard] = useState<{
    caseId: string; title?: string; type?: string; status: CaseStatus;
    confirmedFacts?: Record<string, unknown>; skillsCalled?: string[]; missingFacts?: string[];
  } | null>(null)

  const handleSubmit = useCallback(
    async (text: string, options?: { silent?: boolean }) => {
      // Queue mode: if already loading, enqueue and return
      if (isLoadingRef.current) {
        queuedRef.current = [...queuedRef.current, text]
        setQueuedCount(queuedRef.current.length)
        return
      }

      const silent = options?.silent ?? false
      isLoadingRef.current = true
      setIsLoading(true)
      setAgentStatus('thinking')

      // User message (skip for silent — form dismissal / form submit)
      if (!silent) {
        lastUserMsgRef.current = text
        setMessages((prev) => [...prev, makeMsg({
          id: crypto.randomUUID(), role: 'user', msgType: 'text', content: text,
        })])
      }

      // First text bubble doubles as placeholder (empty while waiting for text)
      const firstTextMsgId = crypto.randomUUID()
      const textBubbles: string[] = [firstTextMsgId]
      let textMsgId: string | null = firstTextMsgId
      const toolMsgIds = new Map<string, string>()
      let activeToolCount = 0
      let textHasArrived = false
      let thinkingBuf = ''
      let thinkingStartedAt = ''

      setMessages((prev) => [...prev, makeMsg({
        id: firstTextMsgId, role: 'assistant', msgType: 'text', content: '', isStreaming: true,
      })])

      try {
        const response = await fetch('/api/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, customerId: 'default', userId: 'anonymous', caseId: caseIdRef.current }),
        })

        if (!response.ok) throw new Error(`HTTP ${response.status}`)

        const reader = response.body?.getReader()
        const decoder = new TextDecoder()

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
                  case 'stream_request_start':
                    setAgentStatus('thinking')
                    break

                  case 'memory_update': {
                    const mem = event.data as {
                      confirmedFacts?: Record<string, unknown>
                      missingFacts?: string[]
                      skillsCalled?: string[]
                    }
                    const hasFacts = mem.confirmedFacts && Object.keys(mem.confirmedFacts).length > 0
                    const hasSkills = mem.skillsCalled && mem.skillsCalled.length > 0
                    if (hasFacts || hasSkills) {
                      setCaseCard((prev) => prev ? {
                        ...prev,
                        status: (hasSkills ? 'investigating' : 'created') as CaseStatus,
                        confirmedFacts: { ...prev.confirmedFacts, ...mem.confirmedFacts },
                        skillsCalled: [...new Set([...(prev.skillsCalled || []), ...(mem.skillsCalled || [])])],
                        missingFacts: mem.missingFacts,
                      } : {
                        caseId: caseIdRef.current,
                        title: lastUserMsgRef.current
                          ? (lastUserMsgRef.current.length > 40 ? lastUserMsgRef.current.slice(0, 40) + '...' : lastUserMsgRef.current)
                          : undefined,
                        status: 'created',
                        confirmedFacts: mem.confirmedFacts,
                        skillsCalled: mem.skillsCalled,
                        missingFacts: mem.missingFacts,
                      })
                    }
                    break
                  }

                  case 'text_delta': {
                    textHasArrived = true
                    setAgentStatus('online')
                    // Attach thinking to the current text bubble on first text
                    if (thinkingBuf && textMsgId) {
                      setMessages((prev) =>
                        prev.map((m) => m.id === textMsgId && !m.thinking
                          ? { ...m, thinking: thinkingBuf, thinkingStartedAt }
                          : m),
                      )
                    }
                    if (textMsgId) {
                      setMessages((prev) =>
                        prev.map((m) => m.id === textMsgId
                          ? { ...m, content: m.content + (event.data as string) }
                          : m),
                      )
                    } else {
                      const newId = crypto.randomUUID()
                      textMsgId = newId
                      textBubbles.push(newId)
                      setMessages((prev) => [...prev, makeMsg({
                        id: newId, role: 'assistant', msgType: 'text',
                        content: event.data as string, isStreaming: true,
                      })])
                    }
                    break
                  }

                  case 'thinking_delta': {
                    setAgentStatus('thinking')
                    const td = event.data as string
                    if (!thinkingStartedAt) thinkingStartedAt = new Date().toISOString()
                    thinkingBuf += td
                    if (textMsgId) {
                      setMessages((prev) =>
                        prev.map((m) => m.id === textMsgId
                          ? { ...m, thinking: thinkingBuf, thinkingStartedAt }
                          : m),
                      )
                    }
                    break
                  }

                  case 'tool_executing': {
                    setAgentStatus('executing')
                    activeToolCount++
                    textMsgId = null
                    const td = event.data as { name: string; status: string }
                    const toolVerb = pickToolVerb(td.name)

                    setCaseCard((prev) => prev ? {
                      ...prev, status: 'investigating',
                      skillsCalled: [...new Set([...(prev.skillsCalled || []), td.name])],
                    } : {
                      caseId: caseIdRef.current,
                      title: lastUserMsgRef.current
                        ? (lastUserMsgRef.current.length > 40 ? lastUserMsgRef.current.slice(0, 40) + '...' : lastUserMsgRef.current)
                        : undefined,
                      status: 'investigating',
                      skillsCalled: [td.name],
                    })

                    const toolMsgId = crypto.randomUUID()
                    toolMsgIds.set(td.name, toolMsgId)

                    setMessages((prev) => [...prev, makeMsg({
                      id: toolMsgId, role: 'assistant', msgType: 'tool_call',
                      toolName: td.name, toolStatus: 'executing', toolVerb: toolVerb.text,
                      content: '',
                    })])
                    break
                  }

                  case 'skill_result': {
                    const sd = event.data as { name: string; status: string }
                    const isError = sd.status === 'error'
                    activeToolCount = Math.max(0, activeToolCount - 1)
                    const tId = toolMsgIds.get(sd.name)

                    if (tId) {
                      setMessages((prev) =>
                        prev.map((m) => m.id === tId
                          ? { ...m, toolStatus: isError ? 'error' : 'completed' }
                          : m),
                      )
                    }

                    if (activeToolCount === 0 && textHasArrived) {
                      setAgentStatus('online')
                    }
                    break
                  }

                  case 'human_task_created':
                    setAgentStatus('online')
                    setCaseCard((prev) => prev ? { ...prev, status: 'waiting_human' } : null)
                    break

                  case 'form_request':
                    setAgentStatus('waiting')
                    setCaseCard((prev) => prev ? { ...prev, status: 'collecting' } : null)
                    const fr = event.data as { title: string; description?: string; fields: Array<{ key: string; label: string; type: string; required?: boolean; placeholder?: string; options?: string[] }> }
                    setMessages((prev) => [...prev, makeMsg({
                      id: crypto.randomUUID(), role: 'assistant', msgType: 'form_active', content: '',
                      formData: {
                        title: fr.title, description: fr.description,
                        fields: fr.fields,
                      },
                    })])
                    break

                  case 'consultation_complete': {
                    setAgentStatus('online')
                    setCaseCard((prev) => prev ? { ...prev, status: 'investigating' } : null)
                    const lang = messages.length > 0 && /[一-鿿]/.test(messages[messages.length - 1]?.content || '')
                      ? 'zh' : 'en'
                    const zhMsg = '人工处理已完成，Agent 正在为您更新案件状态，请稍候。'
                    const enMsg = 'The specialist has finished reviewing your case. Intera is updating you now.'
                    setMessages((prev) => [...prev, makeMsg({
                      id: crypto.randomUUID(),
                      role: 'assistant',
                      msgType: 'text',
                      content: lang === 'zh' ? zhMsg : enMsg,
                      isStreaming: false,
                    })])
                    break
                  }

                  case 'finalized':
                    setAgentStatus('online')
                    break

                  case 'message_stop': {
                    const trans = (event.data as any)?.transition as string | undefined
                    if (trans === 'waiting_form') {
                      setAgentStatus('waiting')
                    } else {
                      setAgentStatus('online')
                    }
                    for (const id of textBubbles) {
                      setMessages((prev) =>
                        prev.map((m) => m.id === id ? { ...m, isStreaming: false } : m),
                      )
                    }
                    if (!textHasArrived) {
                      setMessages((prev) => prev.filter((m) => m.id !== firstTextMsgId))
                    }
                    break
                  }

                  case 'error':
                    console.error('Agent error:', event.data)
                    setAgentStatus('online')
                    break
                }
              } catch { /* skip malformed SSE */ }
            }
          }
        }

        if (!textHasArrived) {
          setMessages((prev) => prev.filter((m) => m.id !== firstTextMsgId))
        }
      } catch (error) {
        console.error('Chat error:', error)
        setAgentStatus('offline')
        setMessages((prev) => prev.filter((m) => m.id !== firstTextMsgId || m.content !== ''))
      } finally {
        isLoadingRef.current = false
        setIsLoading(false)

        // Flush queued messages
        if (queuedRef.current.length > 0) {
          const next = queuedRef.current[0]
          queuedRef.current = queuedRef.current.slice(1)
          setQueuedCount(queuedRef.current.length)
          handleSubmit(next)
        }
      }
    },
    [],
  )

  const handleClearQueue = useCallback(() => {
    queuedRef.current = []
    setQueuedCount(0)
  }, [])

  return (
    <ChatShell>
      <div className="flex justify-center pt-4 pb-5">
        <StatusPill status={agentStatus} label="Intera AI" />
      </div>

      {messages.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center pb-10">
          <WelcomeMessage />
          <div className="w-full max-w-chat px-4">
            <VoiceInputBar
              onSubmit={handleSubmit}
              queuedCount={queuedCount}
              onClearQueue={handleClearQueue}
              isResponding={isLoading}
            />
          </div>
        </div>
      ) : (
        <>
          <MessageList
            messages={messages}
            isResponding={isLoading}
            onFormSubmit={(msgId, answers) => {
              setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, msgType: 'form_submitted' as MsgType, formData: { ...m.formData!, answers } } : m))
              const answerPairs = Object.entries(answers).filter(([,v]) => v)
              const answerLines = answerPairs.map(([k,v]) => `${k}: ${v}`).join('\n')
              handleSubmit(
                `[Form submitted]\n${answerLines}`,
                { silent: true },
              )
            }}
            onFormCancel={(msgId) => {
              setMessages((prev) => prev.filter((m) => m.id !== msgId))
              handleSubmit('[Form dismissed by user]', { silent: true })
            }}
          />

          <VoiceInputBar
            onSubmit={handleSubmit}
            queuedCount={queuedCount}
            onClearQueue={handleClearQueue}
            isResponding={isLoading}
          />
        </>
      )}

      {/* Customer case dashboard — slides in from right, settles at edge */}
      <CaseCard data={caseCard} />
    </ChatShell>
  )
}
