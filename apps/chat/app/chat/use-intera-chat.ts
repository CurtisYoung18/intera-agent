'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import type { IntentClassification } from '@intera/shared/types'
import { pickToolVerb } from '@/lib/spinner-verbs'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MsgType = 'text' | 'tool_call' | 'form_active' | 'form_submitted'

export interface ChatMessage {
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

export type AgentStatus = 'online' | 'thinking' | 'executing' | 'waiting' | 'offline'

export type CaseStatus = 'created' | 'collecting' | 'investigating' | 'waiting_human' | 'resolved' | 'escalated'

export interface ActiveCase {
  caseId: string
  caseType: string
  displayName: string
  icon: string
  status: CaseStatus
  stages: string[]
  extractedFacts?: Record<string, string>
  confirmedFacts?: Record<string, unknown>
  skillsCalled?: string[]
  missingFacts?: string[]
  createdAt: string
}

export interface DedicatedAgentState {
  agentId: string
  agentName: string
  status: 'pending' | 'executing' | 'completed' | 'error'
  taskDescription?: string
  stage?: string
  findings?: Record<string, unknown>
  recommendation?: string
  durationMs?: number
  startedAt: string
}

export interface UseInteraChatReturn {
  messages: ChatMessage[]
  agentStatus: AgentStatus
  isLoading: boolean
  queuedCount: number
  cases: ActiveCase[]
  activeCaseIndex: number
  activeCaseId: string | null
  dedicatedAgents: DedicatedAgentState[]
  splitMode: boolean
  rightPanelCollapsed: boolean
  submitMessage: (text: string) => Promise<void>
  switchCase: (index: number) => void
  toggleRightPanel: () => void
  dismissCase: (caseId: string) => void
  clearQueue: () => void
  setMessages: (messages: ChatMessage[]) => void
  onFormSubmit: (msgId: string, answers: Record<string, string>) => void
  onFormCancel: (msgId: string) => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMsg(partial: Partial<ChatMessage> & { id: string; role: 'user' | 'assistant'; msgType: MsgType }): ChatMessage {
  return { content: '', timestamp: new Date().toISOString(), ...partial }
}

function readSessionFromUrl(): { customerId: string; userId: string; caseType: string } {
  if (typeof window === 'undefined') {
    return { customerId: 'default', userId: 'anonymous', caseType: 'general' }
  }
  const q = new URLSearchParams(window.location.search)
  return {
    customerId: q.get('customer') || q.get('tenant') || 'default',
    userId: q.get('user') || 'anonymous',
    caseType: (q.get('caseType') || q.get('type') || 'general').replace(/_/g, ' '),
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useInteraChat(): UseInteraChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('online')
  const [isLoading, setIsLoading] = useState(false)
  const [queuedCount, setQueuedCount] = useState(0)
  const [cases, setCases] = useState<ActiveCase[]>([])
  const [activeCaseIndex, setActiveCaseIndex] = useState(0)
  const [dedicatedAgents, setDedicatedAgents] = useState<DedicatedAgentState[]>([])
  const [splitMode, setSplitMode] = useState(false)
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false)

  const isLoadingRef = useRef(false)
  const queuedRef = useRef<string[]>([])
  const caseIdRef = useRef<string>(`case_${Date.now()}`)
  const [session, setSession] = useState(readSessionFromUrl)
  const lastUserMsgRef = useRef<string>('')

  useEffect(() => {
    setSession(readSessionFromUrl())
  }, [])

  const activeCaseId = cases.length > 0 ? cases[activeCaseIndex]?.caseId ?? null : null
  const actualCaseIdRef = useRef<string>(caseIdRef.current)

  // Keep active case ID ref in sync
  useEffect(() => {
    actualCaseIdRef.current = activeCaseId || caseIdRef.current
  }, [activeCaseId])

  // ── Submit ──────────────────────────────────────────────────────────

  const submitMessage = useCallback(
    async (text: string) => {
      // Queue mode
      if (isLoadingRef.current) {
        queuedRef.current = [...queuedRef.current, text]
        setQueuedCount(queuedRef.current.length)
        return
      }

      isLoadingRef.current = true
      setIsLoading(true)
      setAgentStatus('thinking')

      // User message bubble
      lastUserMsgRef.current = text
      setMessages((prev) => [...prev, makeMsg({
        id: crypto.randomUUID(), role: 'user', msgType: 'text', content: text,
      })])

      // ── Step 1: Intent classification (fast, non-blocking) ──
      let classification: IntentClassification | null = null
      try {
        const classifyRes = await fetch('/api/intent/classify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, customerId: session.customerId }),
        })
        if (classifyRes.ok) {
          classification = await classifyRes.json()
        }
      } catch { /* classification failed, continue without it */ }

      // Show split mode immediately if case intent detected
      if (classification && classification.intent === 'case' && classification.matchedCaseTypes.length > 0) {
        setSplitMode(true)
      }

      // ── Step 2: Main agent loop ──
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
          body: JSON.stringify({
            message: text,
            customerId: session.customerId,
            userId: session.userId,
            caseId: actualCaseIdRef.current,
            classification,
          }),
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

                  case 'case_created': {
                    const cc = event.data as {
                      caseId: string; caseType: string; displayName: string
                      icon: string; extractedFacts?: Record<string, string>
                    }
                    const newCase: ActiveCase = {
                      caseId: cc.caseId,
                      caseType: cc.caseType,
                      displayName: cc.displayName,
                      icon: cc.icon,
                      status: 'created',
                      stages: [],
                      extractedFacts: cc.extractedFacts,
                      createdAt: new Date().toISOString(),
                    }
                    setCases((prev) => {
                      // Prevent duplicates
                      if (prev.some((c) => c.caseId === cc.caseId)) return prev
                      const updated = [...prev, newCase]
                      setActiveCaseIndex(updated.length - 1)
                      return updated
                    })
                    break
                  }

                  case 'intent_classified': {
                    const ic = event.data as IntentClassification
                    if (ic.intent === 'case' && ic.matchedCaseTypes.length > 0) {
                      setSplitMode(true)
                    }
                    break
                  }

                  case 'sub_agent_start': {
                    const sa = event.data as {
                      agentId: string; agentName: string; taskDescription?: string; stage?: string
                    }
                    setDedicatedAgents((prev) => {
                      if (prev.some((a) => a.agentId === sa.agentId)) return prev
                      return [...prev, {
                        agentId: sa.agentId,
                        agentName: sa.agentName,
                        status: 'executing',
                        taskDescription: sa.taskDescription,
                        stage: sa.stage,
                        startedAt: new Date().toISOString(),
                      }]
                    })
                    break
                  }

                  case 'sub_agent_progress': {
                    const sap = event.data as { agentId: string; status: 'thinking' | 'executing'; detail?: string }
                    setDedicatedAgents((prev) =>
                      prev.map((a) => a.agentId === sap.agentId ? { ...a, status: 'executing' } : a),
                    )
                    break
                  }

                  case 'sub_agent_complete': {
                    const sac = event.data as {
                      agentId: string; agentName: string; findings?: Record<string, unknown>
                      recommendation?: string; durationMs?: number
                    }
                    setDedicatedAgents((prev) =>
                      prev.map((a) => a.agentId === sac.agentId
                        ? { ...a, status: 'completed', findings: sac.findings, recommendation: sac.recommendation, durationMs: sac.durationMs }
                        : a),
                    )
                    break
                  }

                  case 'sub_agent_error': {
                    const sae = event.data as { agentId: string; error: string }
                    setDedicatedAgents((prev) =>
                      prev.map((a) => a.agentId === sae.agentId ? { ...a, status: 'error' } : a),
                    )
                    break
                  }

                  case 'memory_update': {
                    const mem = event.data as {
                      confirmedFacts?: Record<string, unknown>
                      missingFacts?: string[]
                      skillsCalled?: string[]
                    }
                    setCases((prev) => prev.map((c, i) =>
                      i === activeCaseIndex
                        ? {
                            ...c,
                            status: (mem.skillsCalled && mem.skillsCalled.length > 0 ? 'investigating' : c.status) as CaseStatus,
                            confirmedFacts: { ...c.confirmedFacts, ...mem.confirmedFacts },
                            skillsCalled: [...new Set([...(c.skillsCalled || []), ...(mem.skillsCalled || [])])],
                            missingFacts: mem.missingFacts,
                          }
                        : c,
                    ))
                    break
                  }

                  case 'text_delta': {
                    textHasArrived = true
                    setAgentStatus('online')
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

                    setCases((prev) => prev.map((c, i) =>
                      i === activeCaseIndex
                        ? { ...c, status: 'investigating', skillsCalled: [...new Set([...(c.skillsCalled || []), td.name])] }
                        : c,
                    ))

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
                    setCases((prev) => prev.map((c, i) =>
                      i === activeCaseIndex ? { ...c, status: 'waiting_human' } : c,
                    ))
                    break

                  case 'form_request':
                    setAgentStatus('waiting')
                    setCases((prev) => prev.map((c, i) =>
                      i === activeCaseIndex ? { ...c, status: 'collecting' } : c,
                    ))
                    {
                      const fr = event.data as { title: string; description?: string; fields: Array<{ key: string; label: string; type: string; required?: boolean; placeholder?: string; options?: string[] }> }
                      setMessages((prev) => [...prev, makeMsg({
                        id: crypto.randomUUID(), role: 'assistant', msgType: 'form_active', content: '',
                        formData: { title: fr.title, description: fr.description, fields: fr.fields },
                      })])
                    }
                    break

                  case 'consultation_complete': {
                    setAgentStatus('online')
                    setCases((prev) => prev.map((c, i) =>
                      i === activeCaseIndex ? { ...c, status: 'investigating' } : c,
                    ))
                    const lang = messages.length > 0 && /[一-鿿]/.test(messages[messages.length - 1]?.content || '')
                      ? 'zh' : 'en'
                    const zhMsg = '人工处理已完成，Agent 正在为您更新案件状态，请稍候。'
                    const enMsg = 'The specialist has finished reviewing your case. Intera is updating you now.'
                    setMessages((prev) => [...prev, makeMsg({
                      id: crypto.randomUUID(), role: 'assistant', msgType: 'text',
                      content: lang === 'zh' ? zhMsg : enMsg, isStreaming: false,
                    })])
                    break
                  }

                  case 'case_status': {
                    const cs = event.data as { stage: string; previousStage?: string; reason?: string }
                    setCases((prev) => prev.map((c, i) =>
                      i === activeCaseIndex ? { ...c, status: cs.stage as CaseStatus } : c,
                    ))
                    break
                  }

                  case 'finalized':
                    setAgentStatus('online')
                    setCases((prev) => prev.map((c, i) =>
                      i === activeCaseIndex ? { ...c, status: 'resolved' } : c,
                    ))
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
                    setAgentStatus('offline')
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
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== firstTextMsgId || m.content !== ''),
          makeMsg({
            id: crypto.randomUUID(), role: 'assistant', msgType: 'text',
            content: 'Sorry, something went wrong. Please try again or refresh the page.',
            isStreaming: false,
          }),
        ])
      } finally {
        isLoadingRef.current = false
        setIsLoading(false)

        // Flush queued messages
        if (queuedRef.current.length > 0) {
          const next = queuedRef.current[0]
          queuedRef.current = queuedRef.current.slice(1)
          setQueuedCount(queuedRef.current.length)
          submitMessage(next)
        }
      }
    },
    [session, activeCaseIndex, messages],
  )

  // ── Case tab management ────────────────────────────────────────────

  const switchCase = useCallback((index: number) => {
    setActiveCaseIndex(index)
    if (index < cases.length) {
      setDedicatedAgents([]) // Reset dedicated agent view for new case
    }
  }, [cases.length])

  const toggleRightPanel = useCallback(() => {
    setRightPanelCollapsed((prev) => !prev)
  }, [])

  const dismissCase = useCallback((caseId: string) => {
    setCases((prev) => {
      const updated = prev.filter((c) => c.caseId !== caseId)
      if (updated.length === 0) {
        setSplitMode(false)
        setDedicatedAgents([])
      }
      if (activeCaseIndex >= updated.length) {
        setActiveCaseIndex(Math.max(0, updated.length - 1))
      }
      return updated
    })
  }, [activeCaseIndex])

  const clearQueue = useCallback(() => {
    queuedRef.current = []
    setQueuedCount(0)
  }, [])

  const onFormSubmit = useCallback((msgId: string, answers: Record<string, string>) => {
    setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, msgType: 'form_submitted' as MsgType, formData: { ...m.formData!, answers } } : m))
    const answerPairs = Object.entries(answers).filter(([, v]) => v)
    const answerLines = answerPairs.map(([k, v]) => `${k}: ${v}`).join('\n')
    submitMessage(`[Form submitted]\n${answerLines}`)
  }, [submitMessage])

  const onFormCancel = useCallback((msgId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== msgId))
    submitMessage('[Form dismissed by user]')
  }, [submitMessage])

  return {
    messages, setMessages,
    agentStatus,
    isLoading,
    queuedCount,
    cases,
    activeCaseIndex,
    activeCaseId,
    dedicatedAgents,
    splitMode,
    rightPanelCollapsed,
    submitMessage,
    switchCase,
    toggleRightPanel,
    dismissCase,
    clearQueue,
    onFormSubmit,
    onFormCancel,
  }
}
