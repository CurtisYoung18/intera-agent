'use client'

// Intera Harness — Chat Page
// Atomic multi-bubble agent responses: each tool call + text segment = independent bubble

import { useState, useCallback, useRef } from 'react'
import ChatShell from '@/components/chat/chat-shell'
import StatusPill from '@intera/shared/ui/status-pill'
import MessageList from '@/components/chat/message-list'
import VoiceInputBar from '@/components/chat/voice-input-bar'
import WelcomeMessage from '@/components/chat/welcome-message'
import CaseCard from '@/components/chat/case-card'
import type { CaseStatus } from '@/components/chat/case-card'
import type { ThinkState } from '@/components/chat/thinking-indicator'
import type { IconType } from '@/lib/spinner-verbs'
import { pickThinkingVerb, pickToolVerb } from '@/lib/spinner-verbs'

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
  const [thinkState, setThinkState] = useState<ThinkState>('done')
  const [thinkVerb, setThinkVerb] = useState('Thinking')
  const [thinkIcon, setThinkIcon] = useState<IconType>('dots')
  const thinkStartRef = useRef<number>(0)
  const verbIndexRef = useRef<number>(-1)
  const verbIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const caseIdRef = useRef<string>(`case_${Date.now()}`)
  const lastUserMsgRef = useRef<string>('')
  const [caseCard, setCaseCard] = useState<{
    caseId: string; title?: string; type?: string; status: CaseStatus;
    confirmedFacts?: Record<string, unknown>; skillsCalled?: string[]; missingFacts?: string[];
  } | null>(null)

  const handleSubmit = useCallback(
    async (text: string, options?: { silent?: boolean }) => {
      if (isLoading) return
      const silent = options?.silent ?? false
      setIsLoading(true)
      setAgentStatus('thinking')
      setThinkState('thinking')
      thinkStartRef.current = Date.now()

      // Start verb cycling
      const { verb: initialVerb, index } = pickThinkingVerb()
      verbIndexRef.current = index
      setThinkVerb(initialVerb.text)
      setThinkIcon(initialVerb.icon)

      verbIntervalRef.current = setInterval(() => {
        const { verb, index: newIdx } = pickThinkingVerb(verbIndexRef.current)
        verbIndexRef.current = newIdx
        setThinkVerb(verb.text)
        setThinkIcon(verb.icon)
      }, 2500)

      // User message (skip for silent — form dismissal / form submit)
      if (!silent) {
        lastUserMsgRef.current = text
        setMessages((prev) => [...prev, makeMsg({
          id: crypto.randomUUID(), role: 'user', msgType: 'text', content: text,
        })])
      }

      // First text bubble doubles as the loading placeholder (no separate empty bubble)
      const firstTextMsgId = crypto.randomUUID()
      const textBubbles: string[] = [firstTextMsgId]
      let textMsgId: string | null = firstTextMsgId
      const toolMsgIds = new Map<string, string>()
      let activeToolCount = 0
      let textHasArrived = false

      // Add placeholder (shows ThinkingIndicator since content='' and isStreaming=true)
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
                    // Only create case card if there are meaningful facts (not casual chat)
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
                    if (textMsgId) {
                      // Append to current text bubble (includes filling the placeholder)
                      setMessages((prev) =>
                        prev.map((m) => m.id === textMsgId
                          ? { ...m, content: m.content + (event.data as string) }
                          : m),
                      )
                    } else {
                      // Create fresh text bubble after tool batch
                      const newId = crypto.randomUUID()
                      textMsgId = newId
                      textBubbles.push(newId)
                      setMessages((prev) => [...prev, makeMsg({
                        id: newId, role: 'assistant', msgType: 'text',
                        content: event.data as string, isStreaming: true,
                      })])
                    }

                    if (activeToolCount === 0) {
                      setAgentStatus('online')
                      if (verbIntervalRef.current) {
                        clearInterval(verbIntervalRef.current)
                        verbIntervalRef.current = null
                      }
                      setThinkState('done')
                    }
                    break
                  }

                  case 'thinking_delta':
                    setAgentStatus('thinking')
                    break

                  case 'tool_executing': {
                    setAgentStatus('executing')
                    setThinkState('executing')
                    activeToolCount++
                    // Reset textMsgId so next text_delta creates a FRESH bubble after tools
                    textMsgId = null
                    if (verbIntervalRef.current) {
                      clearInterval(verbIntervalRef.current)
                      verbIntervalRef.current = null
                    }
                    const td = event.data as { name: string; status: string }
                    const toolVerb = pickToolVerb(td.name)
                    setThinkVerb(toolVerb.text)
                    setThinkIcon(toolVerb.icon)

                    // Track skill in case card
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
                      if (verbIntervalRef.current) {
                        clearInterval(verbIntervalRef.current)
                        verbIntervalRef.current = null
                      }
                      setThinkState('done')
                    }
                    break
                  }

                  case 'human_task_created':
                    // Agent generates its own escalation message via text — no hardcoded text
                    setAgentStatus('online') // Allow user to continue chatting while escalated
                    setCaseCard((prev) => prev ? { ...prev, status: 'waiting_human' } : null)
                    if (verbIntervalRef.current) { clearInterval(verbIntervalRef.current); verbIntervalRef.current = null }
                    setThinkState('done')
                    break

                  case 'form_request':
                    setAgentStatus('waiting')
                    if (verbIntervalRef.current) { clearInterval(verbIntervalRef.current); verbIntervalRef.current = null }
                    setThinkState('done')
                    setCaseCard((prev) => prev ? { ...prev, status: 'collecting' } : null)
                    // Add form as inline message (chronological order preserved)
                    const fr = event.data as { title: string; description?: string; fields: Array<{ key: string; label: string; type: string; required?: boolean; placeholder?: string; options?: string[] }> }
                    setMessages((prev) => [...prev, makeMsg({
                      id: crypto.randomUUID(), role: 'assistant', msgType: 'form_active', content: '',
                      formData: {
                        title: fr.title, description: fr.description,
                        fields: fr.fields,
                      },
                    })])
                    break

                  case 'consultation_complete':
                    setAgentStatus('online')
                    setCaseCard((prev) => prev ? { ...prev, status: 'investigating' } : null)
                    break

                  case 'finalized':
                    setAgentStatus('online')
                    break

                  case 'message_stop': {
                    // Keep input locked for waiting states; unlock only for next_turn/resolved
                    const trans = (event.data as any)?.transition as string | undefined
                    if (trans === 'waiting_form') {
                      setAgentStatus('waiting') // Lock input only for form
                    } else {
                      setAgentStatus('online') // Unlock for next_turn, waiting_human, resolved
                    }
                    if (verbIntervalRef.current) { clearInterval(verbIntervalRef.current); verbIntervalRef.current = null }
                    setThinkState('done')
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
                    if (verbIntervalRef.current) { clearInterval(verbIntervalRef.current); verbIntervalRef.current = null }
                    setThinkState('done')
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
        // Remove placeholder if still empty
        setMessages((prev) => prev.filter((m) => m.id !== firstTextMsgId || m.content !== ''))
      } finally {
        setIsLoading(false)
      }
    },
    [isLoading],
  )

  return (
    <ChatShell>
      <div className="flex justify-center pt-6 pb-8">
        <StatusPill status={agentStatus} label="Intera AI" />
      </div>

      {messages.length === 0 ? (
        <WelcomeMessage />
      ) : (
        <MessageList
          messages={messages}
          thinkState={thinkState}
          thinkVerb={thinkVerb}
          thinkIcon={thinkIcon}
          onFormSubmit={(msgId, answers) => {
            // Update form_active → form_submitted
            setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, msgType: 'form_submitted' as MsgType, formData: { ...m.formData!, answers } } : m))
            // Send silently
            // Format with field labels so model understands the data
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
      )}

      <VoiceInputBar onSubmit={handleSubmit} isLoading={isLoading} />

      {/* Customer case dashboard — slides in from right, settles at edge */}
      <CaseCard data={caseCard} />
    </ChatShell>
  )
}
