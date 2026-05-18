'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import type { IntentClassification } from '@intera/shared/types'
import { isInvestigableCaseType } from '@/lib/agent/case-type-slugs'
import { clampComposerMinDraftChars } from '@intera/shared/composer-min-draft'
import { pickToolVerb } from '@/lib/spinner-verbs'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MsgType =
  | 'text'
  | 'tool_call'
  | 'form_active'
  | 'form_submitted'
  | 'intent_clarification'
  | 'intent_resolved'

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
  /** Associate assistant/tool/form bubbles with a case tab (omit for shared / user lines). */
  relatedCaseId?: string
  formData?: {
    title: string
    description?: string
    fields: Array<{ key: string; label: string; type: string; required?: boolean; placeholder?: string; options?: string[] }>
    answers?: Record<string, string>
  }
  intentOptions?: {
    caseTypes: Array<{
      type: string
      displayName: string
      icon: string
      confidence: number
    }>
    classification?: IntentClassification
  }
  intentResolution?: {
    selectedCaseTypes: string[]
    labelsByType: Record<string, string>
    locale: 'zh' | 'en'
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
  currentStage?: string
  createdAt: string
}

export interface DedicatedAgentState {
  agentId: string
  agentName: string
  /** Owning case — split UI filters side panel by active tab */
  caseId?: string
  status: 'pending' | 'executing' | 'completed' | 'error'
  taskDescription?: string
  stage?: string
  findings?: Record<string, unknown>
  recommendation?: string
  durationMs?: number
  startedAt: string
}

export interface PendingFormOffer {
  caseId: string
  title: string
  description?: string
  fields: Array<{ key: string; label: string; type: string; required?: boolean; placeholder?: string; options?: string[] }>
}

function normalizeFormFields(raw: unknown): PendingFormOffer['fields'] {
  if (!Array.isArray(raw)) return []
  const allowed = new Set(['text', 'number', 'select', 'textarea', 'file', 'date'])
  return raw.map((item, i) => {
    const o = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
    const key = typeof o.key === 'string' ? o.key : `field_${i}`
    const label = typeof o.label === 'string' ? o.label : key
    const tr = typeof o.type === 'string' ? o.type : 'text'
    const type = allowed.has(tr) ? tr : 'text'
    const required = Boolean(o.required)
    const placeholder = typeof o.placeholder === 'string' ? o.placeholder : undefined
    const options = Array.isArray(o.options)
      ? (o.options.filter((x) => typeof x === 'string') as string[])
      : undefined
    return { key, label, type, required, placeholder, options }
  })
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
  coreAgentProgress: { stage: string; iteration: number; task: string; pendingSubAgents: string[] } | null
  splitMode: boolean
  streamingToolName: string | null
  submitMessage: (text: string) => Promise<void>
  switchCase: (index: number) => void
  dismissCase: (caseId: string) => void
  clearQueue: () => void
  setMessages: (messages: ChatMessage[]) => void
  onFormSubmit: (msgId: string, answers: Record<string, string>) => Promise<void>
  onFormCancel: (msgId: string) => void
  onIntentConfirm: (msgId: string, selectedTypes: string[]) => Promise<void>
  userId: string
  customerId: string
  loadHistoricalCase: (caseId: string) => Promise<void>
  composerAssistEnabled: boolean
  composerAssistMissingDeepseekKey?: boolean
  composerMinDraftChars: number
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

function investigableMatches(clf: IntentClassification): IntentClassification['matchedCaseTypes'] {
  return clf.matchedCaseTypes.filter((m) => isInvestigableCaseType(m.type))
}

function orderSelectedByConfidence(selected: string[], clf: IntentClassification): string[] {
  const set = new Set(selected)
  return investigableMatches(clf).filter((m) => set.has(m.type)).map((m) => m.type)
}

interface LaneBuffer {
  caseId: string | null
  firstTextMsgId: string
  textBubbles: string[]
  textMsgId: string | null
  toolMsgIds: Map<string, string>
  activeToolCount: number
  textHasArrived: boolean
  thinkingBuf: string
  thinkingStartedAt: string
}

function createLaneBuffer(firstTextMsgId: string, presetCaseId: string | null): LaneBuffer {
  return {
    caseId: presetCaseId,
    firstTextMsgId,
    textBubbles: [firstTextMsgId],
    textMsgId: firstTextMsgId,
    toolMsgIds: new Map(),
    activeToolCount: 0,
    textHasArrived: false,
    thinkingBuf: '',
    thinkingStartedAt: '',
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
  const [streamingToolName, setStreamingToolName] = useState<string | null>(null)
  const [coreAgentProgress, setCoreAgentProgress] = useState<{
    stage: string
    iteration: number
    task: string
    pendingSubAgents: string[]
  } | null>(null)

  const splitModeRef = useRef(splitMode)

  /** In-flight /api/messages (+ classify) streams; multiple allowed when splitMode. */
  const activeStreamsRef = useRef(0)

  useEffect(() => {
    splitModeRef.current = splitMode
  }, [splitMode])

  const queuedRef = useRef<string[]>([])
  const caseIdRef = useRef<string>(`case_${Date.now()}`)
  const [session, setSession] = useState(readSessionFromUrl)
  const lastUserMsgRef = useRef<string>('')
  const selectedCaseTypeRef = useRef<string | null>(null)
  const submitMessageRef = useRef<(text: string) => Promise<void>>(async () => {})
  const casesRef = useRef<ActiveCase[]>([])
  const activeInteractionRef = useRef<{ msgId: string; caseId: string } | null>(null)
  const pendingFormsRef = useRef<PendingFormOffer[]>([])

  const [composerAssistEnabled, setComposerAssistEnabled] = useState(false)
  const [composerAssistMissingDeepseekKey, setComposerAssistMissingDeepseekKey] = useState(false)
  const [composerMinDraftChars, setComposerMinDraftChars] = useState(4)

  useEffect(() => {
    setSession(readSessionFromUrl())
  }, [])

  useEffect(() => {
    casesRef.current = cases
  }, [cases])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/composer-assist/feature?customerId=${encodeURIComponent(session.customerId)}`)
      .then((r) => r.json())
      .then((d: { enabled?: unknown; missingDeepseekKey?: unknown; minDraftChars?: unknown }) => {
        if (cancelled) return
        setComposerAssistEnabled(Boolean(d?.enabled))
        setComposerAssistMissingDeepseekKey(Boolean(d?.missingDeepseekKey))
        setComposerMinDraftChars(clampComposerMinDraftChars(d?.minDraftChars, 4))
      })
      .catch(() => {
        if (!cancelled) {
          setComposerAssistEnabled(false)
          setComposerAssistMissingDeepseekKey(false)
          setComposerMinDraftChars(4)
        }
      })
    return () => {
      cancelled = true
    }
  }, [session.customerId])

  // Poll for resolved human tasks — triggers auto-resume when operator completes review
  useEffect(() => {
    const waitingCases = casesRef.current.filter((c) => c.status === 'waiting_human')
    if (waitingCases.length === 0) return

    const poll = async () => {
      for (const wc of waitingCases) {
        try {
          const res = await fetch(`/api/human-tasks?caseId=${encodeURIComponent(wc.caseId)}`)
          if (!res.ok) continue
          const data = await res.json()
          const resolved = (data.tasks || []).find((t: any) => t.status === 'resolved')
          if (resolved) {
            // Auto-resume: send resume trigger to /api/messages
            const firstTextMsgId = crypto.randomUUID()
            const lane = createLaneBuffer(firstTextMsgId, wc.caseId)
            setMessages((prev) => [
              ...prev,
              makeMsg({ id: firstTextMsgId, role: 'assistant', msgType: 'text', relatedCaseId: wc.caseId, content: '', isStreaming: true }),
            ])
            patchCaseById(wc.caseId, { status: 'investigating' })
            setAgentStatus('thinking')
            setIsLoading(true)
            try {
              const response = await fetch('/api/messages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  customerId: session.customerId,
                  userId: session.userId,
                  resumeTrigger: resolved.id,
                }),
              })
              if (response.ok) {
                const reader = response.body?.getReader()
                if (reader) await consumeAgentReadableStream(reader, lane, false, { onStreamingTool: setStreamingToolName })
              }
            } catch { /* ignore */ }
            finally {
              setIsLoading(false)
              setStreamingToolName(null)
            }
            return // one resume per poll cycle
          }
        } catch { /* ignore */ }
      }
    }

    poll() // immediate first check
    const interval = setInterval(poll, 5000)
    return () => clearInterval(interval)
  }, [cases])

  const activeCaseId = cases.length > 0 ? cases[activeCaseIndex]?.caseId ?? null : null
  const actualCaseIdRef = useRef<string>(caseIdRef.current)

  useEffect(() => {
    actualCaseIdRef.current = activeCaseId || caseIdRef.current
  }, [activeCaseId])

  const switchCaseByCaseId = useCallback((caseId: string) => {
    const idx = casesRef.current.findIndex((c) => c.caseId === caseId)
    if (idx !== -1) setActiveCaseIndex(idx)
  }, [])

  const patchCaseById = useCallback((caseId: string | null, patch: Partial<ActiveCase>) => {
    if (!caseId) return
    setCases((prev) => prev.map((c) => (c.caseId === caseId ? { ...c, ...patch } : c)))
  }, [])

  const appendPendingFormBubble = useCallback((offer: PendingFormOffer, msgId: string) => {
    setMessages((prev) => [
      ...prev,
      makeMsg({
        id: msgId,
        role: 'assistant',
        msgType: 'form_active',
        relatedCaseId: offer.caseId,
        formData: { title: offer.title, description: offer.description, fields: offer.fields },
      }),
    ])
    patchCaseById(offer.caseId, { status: 'collecting' })
    switchCaseByCaseId(offer.caseId)
    setAgentStatus('waiting')
  }, [patchCaseById, switchCaseByCaseId])

  const offerFormInteraction = useCallback(
    (offer: PendingFormOffer) => {
      if (!activeInteractionRef.current) {
        const msgId = crypto.randomUUID()
        activeInteractionRef.current = { msgId, caseId: offer.caseId }
        appendPendingFormBubble(offer, msgId)
      } else {
        pendingFormsRef.current.push(offer)
      }
    },
    [appendPendingFormBubble],
  )

  const promoteNextFormInteraction = useCallback(() => {
    activeInteractionRef.current = null
    const next = pendingFormsRef.current.shift()
    if (!next) return
    const msgId = crypto.randomUUID()
    activeInteractionRef.current = { msgId, caseId: next.caseId }
    appendPendingFormBubble(next, msgId)
  }, [appendPendingFormBubble])

  async function consumeAgentReadableStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    lane: LaneBuffer,
    preferZhHint: boolean,
    hooks?: {
      recordBootstrapCaseId?: (id: string) => void
      onStreamingTool?: (name: string | null) => void
    },
  ): Promise<void> {
    const decoder = new TextDecoder()
    let carry = ''

    function relate(): string | undefined {
      return lane.caseId ?? undefined
    }

    const dispatch = (event: { type: string; data?: unknown }) => {
      switch (event.type) {
        case 'stream_request_start':
          setAgentStatus('thinking')
          hooks?.onStreamingTool?.(null)
          break

        case 'case_created': {
          const cc = event.data as {
            caseId: string
            caseType: string
            displayName: string
            icon: string
            extractedFacts?: Record<string, string>
          }
          if (!isInvestigableCaseType(cc.caseType)) break
          setSplitMode(true)
          lane.caseId = cc.caseId
          hooks?.recordBootstrapCaseId?.(cc.caseId)
          const tagIds = [...lane.textBubbles]
          setMessages((prev) =>
            prev.map((m) => (tagIds.includes(m.id) ? { ...m, relatedCaseId: cc.caseId } : m)),
          )
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
            if (prev.some((c) => c.caseId === cc.caseId)) return prev
            const updated = [...prev, newCase]
            setActiveCaseIndex(updated.length - 1)
            return updated
          })
          break
        }

        case 'intent_classified': {
          const ic = event.data as IntentClassification
          if (ic.intent === 'case' && investigableMatches(ic).length > 0) setSplitMode(true)
          break
        }

        case 'clarification': {
          const cd = event.data as { cases: Array<{ caseType: string; summary: string }> }
          if (cd.cases?.length > 0) {
            // Build a synthetic IntentClassification for the card + onIntentConfirm
            const syntheticClf: IntentClassification = {
              intent: 'case',
              needsClarification: true,
              reasoning: 'Core Agent detected multiple intents via propose_cases',
              extractedFacts: {},
              matchedCaseTypes: cd.cases.map((c, i) => ({
                type: c.caseType,
                displayName: c.caseType,
                icon: '📋',
                confidence: 1 - i * 0.05,
              })),
              modelUsed: 'core_agent',
            }
            setMessages((prev) => [
              ...prev,
              makeMsg({
                id: `clarify_${crypto.randomUUID()}`,
                role: 'assistant',
                msgType: 'intent_clarification',
                relatedCaseId: undefined,
                content: '',
                intentOptions: {
                  caseTypes: syntheticClf.matchedCaseTypes,
                  classification: syntheticClf,
                },
              }),
            ])
            setSplitMode(true)
          }
          break
        }

        case 'sub_agent_start': {
          const sa = event.data as {
            agentId: string
            agentName: string
            taskDescription?: string
            stage?: string
            caseId?: string
          }
          setSplitMode(true)
          setDedicatedAgents((prev) => {
            if (prev.some((a) => a.agentId === sa.agentId)) return prev
            return [
              ...prev,
              {
                agentId: sa.agentId,
                agentName: sa.agentName,
                caseId: sa.caseId,
                status: 'executing',
                taskDescription: sa.taskDescription,
                stage: sa.stage,
                startedAt: new Date().toISOString(),
              },
            ]
          })
          break
        }

        case 'sub_agent_progress': {
          const sap = event.data as { agentId: string }
          setDedicatedAgents((prev) => prev.map((a) => (a.agentId === sap.agentId ? { ...a, status: 'executing' } : a)))
          break
        }

        case 'sub_agent_complete': {
          const sac = event.data as {
            agentId: string
            caseId?: string
            findings?: Record<string, unknown>
            recommendation?: string
            durationMs?: number
          }
          setDedicatedAgents((prev) =>
            prev.map((a) =>
              a.agentId === sac.agentId
                ? {
                    ...a,
                    caseId: sac.caseId ?? a.caseId,
                    status: 'completed',
                    findings: sac.findings,
                    recommendation: sac.recommendation,
                    durationMs: sac.durationMs,
                  }
                : a,
            ),
          )
          break
        }

        case 'sub_agent_error': {
          const sae = event.data as { agentId: string }
          setDedicatedAgents((prev) => prev.map((a) => (a.agentId === sae.agentId ? { ...a, status: 'error' } : a)))
          break
        }

        case 'core_agent_progress': {
          const cap = event.data as {
            stage: string
            iteration: number
            task: string
            pendingSubAgents: string[]
          }
          setCoreAgentProgress(cap)
          if (cap.pendingSubAgents?.length) {
            setSplitMode(true)
          }
          break
        }

        case 'memory_update': {
          const mem = event.data as {
            confirmedFacts?: Record<string, unknown>
            missingFacts?: string[]
            skillsCalled?: string[]
          }
          const cid = lane.caseId
          if (!cid) break
          setCases((prev) =>
            prev.map((c) =>
              c.caseId === cid
                ? {
                    ...c,
                    status: (mem.skillsCalled && mem.skillsCalled.length > 0 ? 'investigating' : c.status) as CaseStatus,
                    confirmedFacts: { ...c.confirmedFacts, ...mem.confirmedFacts },
                    skillsCalled: [...new Set([...(c.skillsCalled || []), ...(mem.skillsCalled || [])])],
                    missingFacts: mem.missingFacts,
                  }
                : c,
            ),
          )
          break
        }

        case 'text_delta': {
          lane.textHasArrived = true
          setAgentStatus('online')
          const rid = relate()
          if (lane.thinkingBuf && lane.textMsgId) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === lane.textMsgId && !m.thinking
                  ? { ...m, thinking: lane.thinkingBuf, thinkingStartedAt: lane.thinkingStartedAt }
                  : m,
              ),
            )
          }
          if (lane.textMsgId) {
            const tid = lane.textMsgId
            setMessages((prev) =>
              prev.map((m) => (m.id === tid ? { ...m, content: m.content + (event.data as string) } : m)),
            )
          } else {
            const newId = crypto.randomUUID()
            lane.textMsgId = newId
            lane.textBubbles.push(newId)
            setMessages((prev) => [
              ...prev,
              makeMsg({
                id: newId,
                role: 'assistant',
                msgType: 'text',
                relatedCaseId: rid,
                content: event.data as string,
                isStreaming: true,
              }),
            ])
          }
          break
        }

        case 'thinking_delta': {
          setAgentStatus('thinking')
          const td = event.data as string
          if (!lane.thinkingStartedAt) lane.thinkingStartedAt = new Date().toISOString()
          lane.thinkingBuf += td
          if (lane.textMsgId) {
            const tid = lane.textMsgId
            setMessages((prev) =>
              prev.map((m) =>
                m.id === tid ? { ...m, thinking: lane.thinkingBuf, thinkingStartedAt: lane.thinkingStartedAt } : m,
              ),
            )
          }
          break
        }

        case 'tool_executing': {
          setAgentStatus('executing')
          lane.activeToolCount++
          lane.textMsgId = null
          const td = event.data as { name: string }
          hooks?.onStreamingTool?.(td.name)
          const toolVerb = pickToolVerb(td.name)
          const cid = lane.caseId
          if (cid) {
            setCases((prev) =>
              prev.map((c) =>
                c.caseId === cid
                  ? {
                      ...c,
                      status: 'investigating',
                      skillsCalled: [...new Set([...(c.skillsCalled || []), td.name])],
                    }
                  : c,
              ),
            )
          }
          const toolMsgId = crypto.randomUUID()
          lane.toolMsgIds.set(td.name, toolMsgId)
          const rid = relate()
          setMessages((prev) => [
            ...prev,
            makeMsg({
              id: toolMsgId,
              role: 'assistant',
              msgType: 'tool_call',
              relatedCaseId: rid,
              toolName: td.name,
              toolStatus: 'executing',
              toolVerb: toolVerb.text,
              content: '',
            }),
          ])
          break
        }

        case 'skill_result': {
          const sd = event.data as { name: string; status: string }
          const isError = sd.status === 'error'
          lane.activeToolCount = Math.max(0, lane.activeToolCount - 1)
          const tId = lane.toolMsgIds.get(sd.name)
          if (tId) {
            setMessages((prev) =>
              prev.map((m) => (m.id === tId ? { ...m, toolStatus: isError ? 'error' : 'completed' } : m)),
            )
          }
          if (lane.activeToolCount === 0 && lane.textHasArrived) setAgentStatus('online')
          if (lane.activeToolCount === 0) hooks?.onStreamingTool?.(null)
          break
        }

        case 'human_task_created':
          setAgentStatus('online')
          if (lane.caseId) patchCaseById(lane.caseId, { status: 'waiting_human' })
          break

        case 'form_request': {
          const fr = event.data as {
            caseId?: string
            title: string
            description?: string
            fields: unknown
          }
          const cid = fr.caseId ?? lane.caseId
          if (!cid) break
          if (fr.caseId) lane.caseId = fr.caseId
          offerFormInteraction({
            caseId: cid,
            title: fr.title,
            description: fr.description,
            fields: normalizeFormFields(fr.fields),
          })
          break
        }

        case 'consultation_complete': {
          setAgentStatus('online')
          if (lane.caseId) patchCaseById(lane.caseId, { status: 'investigating' })
          const zhMsg = '人工处理已完成，Agent 正在为您更新案件状态，请稍候。'
          const enMsg = 'The specialist has finished reviewing your case. Intera is updating you now.'
          const rid = relate()
          setMessages((prev) => [
            ...prev,
            makeMsg({
              id: crypto.randomUUID(),
              role: 'assistant',
              msgType: 'text',
              relatedCaseId: rid,
              content: preferZhHint ? zhMsg : enMsg,
              isStreaming: false,
            }),
          ])
          break
        }

        case 'case_status': {
          const cs = event.data as { stage: string }
          if (lane.caseId) patchCaseById(lane.caseId, { status: cs.stage as CaseStatus, currentStage: cs.stage })
          break
        }

        case 'finalized':
          setAgentStatus('online')
          if (lane.caseId) patchCaseById(lane.caseId, { status: 'resolved' })
          break

        case 'message_stop': {
          hooks?.onStreamingTool?.(null)
          const trans = (event.data as { transition?: string })?.transition
          if (trans === 'waiting_form') setAgentStatus('waiting')
          else setAgentStatus('online')
          for (const id of lane.textBubbles) {
            setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, isStreaming: false } : m)))
          }
          if (!lane.textHasArrived) {
            const fid = lane.firstTextMsgId
            setMessages((prev) => prev.filter((m) => m.id !== fid))
          }
          break
        }

        case 'withheld':
          // Context compaction notification — agent is still working
          break

        case 'error':
          hooks?.onStreamingTool?.(null)
          console.error('Agent error:', event.data)
          setAgentStatus('offline')
          break
      }
    }

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      carry += decoder.decode(value, { stream: true })
      const lines = carry.split('\n')
      carry = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          dispatch(JSON.parse(line.slice(6)))
        } catch {
          /* malformed */
        }
      }
    }

    if (!lane.textHasArrived) {
      const fid = lane.firstTextMsgId
      setMessages((prev) => prev.filter((m) => m.id !== fid))
    }
  }

  async function fetchCoordinatorSummary(caseIds: string[], userUtterance: string, preferZh: boolean) {
    if (caseIds.length === 0) return
    const firstTextMsgId = crypto.randomUUID()
    const lane = createLaneBuffer(firstTextMsgId, null)
    setMessages((prev) => [
      ...prev,
      makeMsg({
        id: firstTextMsgId,
        role: 'assistant',
        msgType: 'text',
        content: '',
        isStreaming: true,
      }),
    ])
    try {
      const response = await fetch('/api/coordinate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: session.customerId,
          userId: session.userId,
          caseIds,
          userUtterance,
          preferZh,
        }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const reader = response.body?.getReader()
      if (reader)
        await consumeAgentReadableStream(reader, lane, preferZh, {
          onStreamingTool: setStreamingToolName,
        })
    } catch (e) {
      console.error('Coordinator failed:', e)
      setAgentStatus('online')
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== firstTextMsgId),
        makeMsg({
          id: crypto.randomUUID(),
          role: 'assistant',
          msgType: 'text',
          content: preferZh
            ? '合并汇总暂时不可用，请稍后重试或在各工单标签下查看进度。'
            : 'Could not generate a merged summary. Please check each case tab or try again shortly.',
          isStreaming: false,
        }),
      ])
    } finally {
      setStreamingToolName(null)
    }
  }

  const submitCaseForm = useCallback(
    async (caseId: string, answers: Record<string, string>) => {
      const preferZh = /[一-鿿]/.test(lastUserMsgRef.current || '')
      const splitNow = splitModeRef.current
      if (!splitNow && activeStreamsRef.current > 0) return

      activeStreamsRef.current++
      setIsLoading(true)
      setAgentStatus('thinking')

      const clearHints = !(splitNow && activeStreamsRef.current > 1)
      if (clearHints) {
        setCoreAgentProgress(null)
        setStreamingToolName(null)
      }

      const firstTextMsgId = crypto.randomUUID()
      const lane = createLaneBuffer(firstTextMsgId, caseId)

      setMessages((prev) => [
        ...prev,
        makeMsg({
          id: firstTextMsgId,
          role: 'assistant',
          msgType: 'text',
          relatedCaseId: caseId,
          content: '',
          isStreaming: true,
        }),
      ])

      try {
        const response = await fetch('/api/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerId: session.customerId,
            userId: session.userId,
            formResult: { caseId, answers },
          }),
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const reader = response.body?.getReader()
        if (reader)
          await consumeAgentReadableStream(reader, lane, preferZh, {
            onStreamingTool: setStreamingToolName,
          })
      } catch (e) {
        console.error('Form continuation error:', e)
        setAgentStatus('offline')
      } finally {
        activeStreamsRef.current -= 1
        const remain = activeStreamsRef.current
        setIsLoading(remain > 0)
        if (remain <= 0) {
          setStreamingToolName(null)
        }
        promoteNextFormInteraction()
        if (!splitModeRef.current && queuedRef.current.length > 0) {
          const next = queuedRef.current[0]
          queuedRef.current = queuedRef.current.slice(1)
          setQueuedCount(queuedRef.current.length)
          void submitMessageRef.current(next)
        }
      }
    },
    [promoteNextFormInteraction, session.customerId, session.userId],
  )

  const submitMessage = useCallback(
    async (text: string) => {
      const splitNow = splitModeRef.current

      if (!splitNow && activeStreamsRef.current > 0) {
        queuedRef.current = [...queuedRef.current, text]
        setQueuedCount(queuedRef.current.length)
        return
      }

      lastUserMsgRef.current = text
      setMessages((prev) => [...prev, makeMsg({ id: crypto.randomUUID(), role: 'user', msgType: 'text', content: text })])

      activeStreamsRef.current++
      setIsLoading(true)
      setAgentStatus('thinking')

      const clearHints = !(splitNow && activeStreamsRef.current > 1)
      if (clearHints) {
        setCoreAgentProgress(null)
        setStreamingToolName(null)
      }

      const preferZh = /[一-鿿]/.test(text)
      let firstTextMsgId: string | undefined

      try {
        // Fire-and-forget classify for split-mode animation only — does NOT block /api/messages.
        fetch('/api/intent/classify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, customerId: session.customerId }),
        }).then(async (res) => {
          if (!res.ok) return
          const c = await res.json() as IntentClassification
          if (c?.intent === 'case' && investigableMatches(c).length > 0) {
            setSplitMode(true)
          }
        }).catch(() => {})

        const streamMsgId = crypto.randomUUID()
        firstTextMsgId = streamMsgId
        const lane = createLaneBuffer(streamMsgId, actualCaseIdRef.current)

        setMessages((prev) => [
          ...prev,
          makeMsg({
            id: streamMsgId,
            role: 'assistant',
            msgType: 'text',
            content: '',
            isStreaming: true,
          }),
        ])

        const response = await fetch('/api/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            customerId: session.customerId,
            userId: session.userId,
            caseId: actualCaseIdRef.current,
            ...(selectedCaseTypeRef.current
              ? { caseType: selectedCaseTypeRef.current, skipClassification: true }
              : {}),
          }),
        })

        selectedCaseTypeRef.current = null

        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const reader = response.body?.getReader()
        if (reader)
          await consumeAgentReadableStream(reader, lane, preferZh, {
            onStreamingTool: setStreamingToolName,
          })
      } catch (error) {
        console.error('Chat error:', error)
        setAgentStatus('offline')
        if (firstTextMsgId) {
          setMessages((prev) => [
            ...prev.filter((m) => m.id !== firstTextMsgId || m.content !== ''),
            makeMsg({
              id: crypto.randomUUID(),
              role: 'assistant',
              msgType: 'text',
              content: 'Sorry, something went wrong. Please try again or refresh the page.',
              isStreaming: false,
            }),
          ])
        } else {
          setMessages((prev) => [
            ...prev,
            makeMsg({
              id: crypto.randomUUID(),
              role: 'assistant',
              msgType: 'text',
              content: preferZh ? '抱歉，请求失败，请稍后重试。' : 'Sorry, something went wrong. Please try again.',
              isStreaming: false,
            }),
          ])
        }
      } finally {
        activeStreamsRef.current -= 1
        const remain = activeStreamsRef.current
        setIsLoading(remain > 0)
        if (remain <= 0) {
          setStreamingToolName(null)
        }

        if (!splitModeRef.current && queuedRef.current.length > 0) {
          const next = queuedRef.current[0]
          queuedRef.current = queuedRef.current.slice(1)
          setQueuedCount(queuedRef.current.length)
          void submitMessageRef.current(next)
        }
      }
    },
    [session.customerId, session.userId],
  )

  const runParallelBootstrap = useCallback(
    async (classification: IntentClassification, orderedTypes: string[], userText: string) => {
      const preferZh = /[一-鿿]/.test(userText)
      const splitNowBoot = splitModeRef.current

      activeStreamsRef.current++
      setIsLoading(true)
      setAgentStatus('thinking')
      if (!(splitNowBoot && activeStreamsRef.current > 1)) {
        setCoreAgentProgress(null)
        setStreamingToolName(null)
      }

      const laneIds = orderedTypes.map(() => crypto.randomUUID())
      setMessages((prev) => [
        ...prev,
        ...laneIds.map((id) =>
          makeMsg({
            id,
            role: 'assistant',
            msgType: 'text',
            content: '',
            isStreaming: true,
          }),
        ),
      ])

      const lanes = laneIds.map((id) => createLaneBuffer(id, null))

      try {
        const parallelCaseIds = new Set<string>()
        const failedLanes: string[] = []
        await Promise.all(
          orderedTypes.map(async (caseType, i) => {
            try {
              const response = await fetch('/api/messages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  message: userText,
                  customerId: session.customerId,
                  userId: session.userId,
                  classification,
                  caseType,
                  skipClassification: true,
                  bootstrapNewCase: true,
                }),
              })
              if (!response.ok) throw new Error(`HTTP ${response.status}`)
              const reader = response.body?.getReader()
              if (reader) {
                await consumeAgentReadableStream(reader, lanes[i], preferZh, {
                  recordBootstrapCaseId: (id) => parallelCaseIds.add(id),
                  onStreamingTool: setStreamingToolName,
                })
              }
            } catch (e) {
              console.error(`Parallel lane failed (${caseType}):`, e)
              failedLanes.push(caseType)
              // Show error bubble for the failed lane
              const failedLaneId = lanes[i].firstTextMsgId
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === failedLaneId
                    ? { ...m, content: preferZh ? `处理 ${caseType} 时出错，请稍后重试` : `Error processing ${caseType}. Please try again later.`, isStreaming: false }
                    : m,
                ),
              )
            }
          }),
        )

        if (parallelCaseIds.size > 0) {
          await fetchCoordinatorSummary([...parallelCaseIds], userText, preferZh)
        } else if (failedLanes.length > 0) {
          setAgentStatus('offline')
        }
      } finally {
        activeStreamsRef.current -= 1
        const remain = activeStreamsRef.current
        setIsLoading(remain > 0)
        if (remain <= 0) {
          setStreamingToolName(null)
          setAgentStatus('online')
        }
      }
    },
    [session.customerId, session.userId],
  )

  const onIntentConfirm = useCallback(
    async (msgId: string, selectedTypes: string[]) => {
      const preferZh = /[一-鿿]/.test(lastUserMsgRef.current || '')
      const locale: 'zh' | 'en' = preferZh ? 'zh' : 'en'

      let clf: IntentClassification | null = null
      let labelsByType: Record<string, string> = {}

      setMessages((prev) => {
        const msg = prev.find((m) => m.id === msgId)
        clf = msg?.intentOptions?.classification ?? null
        const opts = msg?.intentOptions?.caseTypes ?? []
        labelsByType = Object.fromEntries(opts.map((o) => [o.type, o.displayName]))
        return prev.map((m) =>
          m.id === msgId
            ? {
                ...m,
                msgType: 'intent_resolved' as MsgType,
                intentOptions: undefined,
                intentResolution: {
                  selectedCaseTypes: selectedTypes,
                  labelsByType,
                  locale,
                },
                content: '',
              }
            : m,
        )
      })

      if (!clf || selectedTypes.length === 0) return

      const ordered = orderSelectedByConfidence(selectedTypes, clf)

      await runParallelBootstrap(clf, ordered, lastUserMsgRef.current)
    },
    [runParallelBootstrap],
  )

  useEffect(() => {
    submitMessageRef.current = submitMessage
  }, [submitMessage])

  const switchCase = useCallback((index: number) => {
    setActiveCaseIndex(index)
  }, [])

  const dismissCase = useCallback(
    (caseId: string) => {
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
    },
    [activeCaseIndex],
  )

  const loadHistoricalCase = useCallback(async (caseId: string) => {
    try {
      const res = await fetch(`/api/cases/${caseId}/messages?limit=100`)
      if (!res.ok) return
      const data = await res.json()
      const msgs: ChatMessage[] = (data.messages || []).map((m: any) => ({
        id: m.id,
        role: m.role,
        msgType: 'text' as MsgType,
        content: m.content || '',
        isStreaming: false,
        relatedCaseId: caseId,
        timestamp: m.createdAt,
      }))
      setMessages(msgs)
      caseIdRef.current = caseId

      // Create case tab if not exists
      const existingCase: ActiveCase = {
        caseId,
        caseType: data.caseType || 'general',
        displayName: data.caseType || 'general',
        icon: '📋',
        status: data.status || 'created',
        stages: [],
        createdAt: data.createdAt || new Date().toISOString(),
      }
      setCases((prev) => {
        if (prev.some((c) => c.caseId === caseId)) return prev
        const updated = [...prev, existingCase]
        setActiveCaseIndex(updated.length - 1)
        return updated
      })
      setSplitMode(true)
    } catch (e) {
      console.error('Failed to load historical case:', e)
    }
  }, [])

  const clearQueue = useCallback(() => {
    queuedRef.current = []
    setQueuedCount(0)
  }, [])

  const onFormSubmit = useCallback(
    async (msgId: string, answers: Record<string, string>) => {
      let caseIdForForm: string | undefined
      setMessages((prev) => {
        const found = prev.find((m) => m.id === msgId)
        caseIdForForm = found?.relatedCaseId
        return prev.map((m) =>
          m.id === msgId ? { ...m, msgType: 'form_submitted' as MsgType, formData: { ...m.formData!, answers } } : m,
        )
      })
      if (!caseIdForForm) return
      await submitCaseForm(caseIdForForm, answers)
    },
    [submitCaseForm],
  )

  const onFormCancel = useCallback(
    (msgId: string) => {
      setMessages((prev) => prev.filter((m) => m.id !== msgId))
      if (activeInteractionRef.current?.msgId === msgId) {
        activeInteractionRef.current = null
        promoteNextFormInteraction()
      }
      submitMessage('[Form dismissed by user]')
    },
    [promoteNextFormInteraction, submitMessage],
  )

  return {
    messages,
    setMessages,
    agentStatus,
    isLoading,
    queuedCount,
    cases,
    activeCaseIndex,
    activeCaseId,
    dedicatedAgents,
    coreAgentProgress,
    splitMode,
    streamingToolName,
    submitMessage,
    switchCase,
    dismissCase,
    clearQueue,
    onFormSubmit,
    onFormCancel,
    onIntentConfirm,
    userId: session.userId,
    customerId: session.customerId,
    loadHistoricalCase,
    composerAssistEnabled,
    composerAssistMissingDeepseekKey,
    composerMinDraftChars,
  }
}
