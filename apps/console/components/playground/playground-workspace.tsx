'use client'

import { useState, useCallback, useEffect, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import Link from 'next/link'
import {
  FlaskConical, Send,
  Sparkles, AlertCircle, CheckCircle2, Clock, XCircle,
  Brain, ExternalLink, RefreshCw,
  ChevronDown, ChevronLeft, ChevronRight, ImageIcon, LockKeyhole, Maximize2, Minimize2, MoreHorizontal,
} from 'lucide-react'
import { useAgentContext } from '@/lib/agent/agent-context'
import { AGENT_CONFIG_UPDATED_EVENT } from '@/lib/agent-config-events'
import { apiClient } from '@/lib/api/client'
import type { ContentBlock, LifecycleNotice } from '@intera/shared/types'
import { useSession } from '@/lib/hooks/use-session'
import { useConsoleLocale } from '@/components/locale-provider'
import { resolveEffectiveModel } from '@/lib/agent/resolve-model'
import { detectMemoryMode, normalizeMemoryStrategy } from '@/components/memory/memory-strategy-utils'
import { OrganicLoader, TokenStreamPreview } from '@/components/config-pilot/ai-motion'
import CopyButton from '@/components/ui/copy-button'
import MessageContent from '@/components/chat/message-content'
import RenderHintCard from '@/components/chat/render-hint-card'
import TraceSidebar from '@/components/playground/trace-sidebar'
import type { LiveTool } from '@/components/playground/trace-sidebar'
import { groupRestoredTracesByTurn } from '@/components/playground/session-restore'
import {
  aggregateTraces,
  type PlaygroundCapabilityTruth,
  type PlaygroundTraceEvent,
  type PlaygroundTraceStep,
} from '@/lib/agent/trace-aggregator'

/* ── Types ── */

interface ModelInfo {
  id: string; name: string; provider: string; providerLabel: string
  supportsVision?: boolean
}

interface AttachedImage {
  base64: string
  mimeType: string
  name: string
}

interface AgentListItem {
  id: string
  name: string
  version: number
  isActive: boolean
}

interface AgentSnapshot {
  name: string
  resolvedModelId: string
  resolvedModelLabel: string
  promptPreview: string | null
  memoryModeLabel: string
  enabledHookCount: number | null
  temperature: number
}

type PlaygroundSurface = 'legacy' | 'pilot-lab'
type ToolExecutionMode = 'runtime' | 'dry_run'

interface VisionSupportState {
  status: 'supported' | 'unsupported' | 'unknown'
  label: string
  note: string
}

interface TurnDebugDigest {
  turnNumber: number
  status: 'ready' | 'running' | 'warning' | 'blocked'
  statusLabel: string
  turnMs: number
  toolCalls: number
  toolResults: number
  hookEvents: PlaygroundTraceEvent[]
  procedureEvents: PlaygroundTraceEvent[]
  staleEvents: PlaygroundTraceEvent[]
  warnings: string[]
  promptCaptured: boolean
  promptChars: number
  latestInput: string | null
  latestReply: string | null
}

/** Per-tool status — driven by real `tool_executing` / `tool_result` SSE events. */
/* ── Constants ── */

const QUICK_STARTS = [
  { label: 'My deposit still has not arrived. Please check it.', hint: 'Procedure start + evidence lookup' },
  { label: 'What evidence do you still need before a human handoff?', hint: 'Hook + handoff reasoning' },
  { label: 'Please reconcile the new payment amount before you continue.', hint: 'Reconcile + stale evidence path' },
  { label: 'I uploaded the receipt screenshot. What can you confirm from it?', hint: 'Image input capability test' },
]


/* ── Helpers ── */

function formatMemoryModeLabel(raw: unknown): string {
  const mode = detectMemoryMode(normalizeMemoryStrategy(raw))
  if (mode === 'short') return 'Short'
  if (mode === 'long') return 'Long'
  if (mode === 'custom') return 'Custom'
  return 'Balanced'
}

function buildPromptPreview(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  return trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed
}

function resolveSnapshotModel(
  resolvedModel: unknown,
  rawModel: unknown,
  models: ModelInfo[],
): { id: string; label: string } {
  const fallbackId = resolveEffectiveModel({
    model: typeof rawModel === 'string' ? rawModel : null,
  })
  const resolvedId =
    typeof resolvedModel === 'string' && resolvedModel.trim()
      ? resolvedModel.trim()
      : typeof rawModel === 'string' && rawModel.trim()
        ? rawModel.trim()
        : fallbackId
  const match = models.find((model) => model.id === resolvedId || model.name === resolvedId)
  return {
    id: match?.id || resolvedId,
    label: match?.name || resolvedId,
  }
}

function imagesFromContentBlocks(blocks: unknown): AttachedImage[] | undefined {
  if (!Array.isArray(blocks)) return undefined
  const images = blocks.flatMap((block) => {
    const candidate = block as { type?: unknown; source?: { type?: unknown; media_type?: unknown; data?: unknown } }
    if (candidate.type !== 'image' || candidate.source?.type !== 'base64') return []
    if (typeof candidate.source.data !== 'string' || typeof candidate.source.media_type !== 'string') return []
    return [{
      base64: candidate.source.data,
      mimeType: candidate.source.media_type,
      name: 'restored image',
    }]
  })
  return images.length > 0 ? images : undefined
}

function imagesToContentBlocks(images: AttachedImage[] | undefined): ContentBlock[] | undefined {
  if (!images || images.length === 0) return undefined
  return images.map((img) => ({
    type: 'image',
    source: {
      type: 'base64',
      media_type: img.mimeType,
      data: img.base64,
    },
  }))
}

function findLatestRuntimeTruth(turnTraces: Array<Array<{ runtimeTruth?: PlaygroundCapabilityTruth }>>): PlaygroundCapabilityTruth | null {
  for (let turnIdx = turnTraces.length - 1; turnIdx >= 0; turnIdx -= 1) {
    const steps = turnTraces[turnIdx]
    if (!Array.isArray(steps)) continue
    const match = steps.find((step) => step.runtimeTruth)?.runtimeTruth
    if (match) return match
  }
  return null
}

function runtimeTruthMatchesSnapshot(runtimeTruth: PlaygroundCapabilityTruth, snapshot: AgentSnapshot | null): boolean {
  if (!snapshot) return true
  const runtimeModel = runtimeTruth.model.trim().toLowerCase()
  const snapshotId = snapshot.resolvedModelId.trim().toLowerCase()
  const snapshotLabel = snapshot.resolvedModelLabel.trim().toLowerCase()
  return runtimeModel === snapshotId || runtimeModel === snapshotLabel
}

function resolveCurrentRuntimeTruth(
  snapshot: AgentSnapshot | null,
  runtimeTruth: PlaygroundCapabilityTruth | null,
): PlaygroundCapabilityTruth | null {
  if (!runtimeTruth) return null
  return runtimeTruthMatchesSnapshot(runtimeTruth, snapshot) ? runtimeTruth : null
}

function deriveVisionSupport(snapshot: AgentSnapshot | null, models: ModelInfo[], runtimeTruth: PlaygroundCapabilityTruth | null): VisionSupportState {
  if (runtimeTruth?.imageSupport) {
    return {
      status: runtimeTruth.imageSupport.status,
      label: runtimeTruth.imageSupport.label,
      note: runtimeTruth.imageSupport.note ?? 'Image input support was derived from the active runtime model registry.',
    }
  }

  if (!snapshot) {
    return {
      status: 'unknown',
      label: 'Unknown',
      note: 'Load the selected agent snapshot to confirm whether image input is available.',
    }
  }

  const model = models.find((entry) => entry.id === snapshot.resolvedModelId || entry.name === snapshot.resolvedModelId)
  if (!model) {
    return {
      status: 'unknown',
      label: 'Unknown',
      note: `${snapshot.resolvedModelLabel} is not present in the active model registry, so image input support cannot be confirmed yet.`,
    }
  }

  if (model.supportsVision) {
    return {
      status: 'supported',
      label: 'Supported',
      note: `${snapshot.resolvedModelLabel} accepts image input in the active model registry.`,
    }
  }

  return {
    status: 'unsupported',
    label: 'Not supported',
    note: `${snapshot.resolvedModelLabel} is currently text-only in the active model registry.`,
  }
}

function formatToolSurfaceSummary(truth: PlaygroundCapabilityTruth['toolSummary']): string {
  const parts: string[] = []
  if (truth.mockedDryRun > 0) parts.push(`${truth.mockedDryRun} mocked`)
  if (truth.runtimeBacked > 0) parts.push(`${truth.runtimeBacked} runtime-backed`)
  if (truth.runtimeManaged > 0) parts.push(`${truth.runtimeManaged} runtime-managed`)
  if (truth.staticFixture > 0) parts.push(`${truth.staticFixture} fixture-backed`)
  if (truth.unknown > 0) parts.push(`${truth.unknown} unknown`)
  return parts.join(' · ') || 'Refreshes after the first run'
}

function toneForVisionSupport(status: VisionSupportState['status']) {
  if (status === 'supported') return 'success' as const
  if (status === 'unsupported') return 'warning' as const
  return 'neutral' as const
}

function formatDurationLabel(ms: number): string {
  if (ms <= 0) return '0ms'
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

function summarizeToolPairing(toolCalls: number, toolResults: number, responding: boolean): string {
  if (toolCalls === 0 && toolResults === 0) {
    return responding ? 'Waiting for the first tool event' : 'No tool events yet'
  }
  if (toolCalls === toolResults) return `${toolCalls} calls matched to results`
  if (toolCalls > toolResults) {
    const gap = toolCalls - toolResults
    return `${gap} result${gap === 1 ? '' : 's'} still pending`
  }
  const extra = toolResults - toolCalls
  return `${extra} extra result${extra === 1 ? '' : 's'} captured`
}

function latestMessageByRole(
  chatMessages: Array<{ role: 'user' | 'agent' | 'system'; content: string }>,
  role: 'user' | 'agent',
): string | null {
  for (let idx = chatMessages.length - 1; idx >= 0; idx -= 1) {
    const message = chatMessages[idx]
    if (message.role === role && message.content.trim()) return message.content.trim()
  }
  return null
}

function traceValueCharCount(value: unknown): number {
  if (typeof value === 'string') return value.length
  if (value == null) return 0
  try { return JSON.stringify(value).length } catch { return String(value).length }
}

function buildTurnDebugDigest(
  turnTraces: PlaygroundTraceStep[][],
  turnTotalMs: number[],
  responding: boolean,
  chatMessages: Array<{ role: 'user' | 'agent' | 'system'; content: string }>,
  reply: string,
): TurnDebugDigest | null {
  if (turnTraces.length === 0) {
    if (!responding) return null
    return {
      turnNumber: 1,
      status: 'running',
      statusLabel: 'Waiting for runtime evidence',
      turnMs: 0,
      toolCalls: 0,
      toolResults: 0,
      hookEvents: [],
      procedureEvents: [],
      staleEvents: [],
      warnings: [],
      promptCaptured: false,
      promptChars: 0,
      latestInput: latestMessageByRole(chatMessages, 'user'),
      latestReply: reply.trim() || null,
    }
  }

  const latestIndex = turnTraces.length - 1
  const steps = turnTraces[latestIndex] ?? []
  const toolEvents = steps.flatMap((step) =>
    step.events?.filter((event) => event.kind === 'tool_call' || event.kind === 'tool_result') ?? [],
  )
  const evidenceEvents = steps.flatMap((step) =>
    step.events?.filter((event) => event.kind === 'hook_decision' || event.kind === 'runtime_guard' || event.kind === 'stale_evidence') ?? [],
  )
  const hookEvents = evidenceEvents.filter((event) => event.kind === 'hook_decision')
  const staleEvents = evidenceEvents.filter((event) => event.kind === 'stale_evidence')
  const procedureEvents = evidenceEvents.filter((event) => event.kind === 'runtime_guard')
  const modelStep = steps.find((step) => step.stage === 'Model generation')
  const runtimeTruth = steps.find((step) => step.runtimeTruth)?.runtimeTruth
  const hasBlock = steps.some((step) => step.status === 'block')
  const hasWarn = !hasBlock && steps.some((step) => step.status === 'warn')
  const promptChars = traceValueCharCount(modelStep?.promptData?.systemPrompt)
    + traceValueCharCount(modelStep?.promptData?.messages)
    + traceValueCharCount(modelStep?.promptData?.tools)

  return {
    turnNumber: latestIndex + 1,
    status: responding ? 'running' : hasBlock ? 'blocked' : hasWarn ? 'warning' : 'ready',
    statusLabel: responding
      ? 'Streaming runtime evidence'
      : hasBlock
        ? 'Runtime blocked or failed'
        : hasWarn
          ? 'Captured with warnings'
          : 'Captured cleanly',
    turnMs: turnTotalMs[latestIndex] ?? 0,
    toolCalls: toolEvents.filter((event) => event.kind === 'tool_call').length,
    toolResults: toolEvents.filter((event) => event.kind === 'tool_result').length,
    hookEvents,
    procedureEvents,
    staleEvents,
    warnings: runtimeTruth?.warnings ?? [],
    promptCaptured: Boolean(modelStep?.promptData && (
      modelStep.promptData.systemPrompt ||
      modelStep.promptData.messages?.length ||
      modelStep.promptData.tools?.length
    )),
    promptChars,
    latestInput: latestMessageByRole(chatMessages, 'user'),
    latestReply: reply.trim() || latestMessageByRole(chatMessages, 'agent'),
  }
}

function toneForDigestStatus(status: TurnDebugDigest['status']) {
  if (status === 'blocked') return 'warning' as const
  if (status === 'warning') return 'warning' as const
  if (status === 'ready') return 'success' as const
  return 'neutral' as const
}

function readStoredTraceCollapsed(scopeId: string) {
  try {
    const scoped = localStorage.getItem(`pg_trace_collapsed_${scopeId}`)
    if (scoped != null) return scoped === 'true'
    const legacy = localStorage.getItem('pg_trace_collapsed')
    if (legacy != null) return legacy === 'true'
  } catch {}
  return null
}

function hasPersistedPlaygroundSession(scopeId: string, selectedAgentId: string | null) {
  try {
    return Boolean(
      localStorage.getItem(`pg_chatId_${scopeId}_${selectedAgentId ?? ''}`),
    )
  } catch {}
  return false
}


/* ── Page ── */

export default function PlaygroundWorkspace({ surface = 'legacy' }: { surface?: PlaygroundSurface }) {
  const { selectedAgentId } = useAgentContext()
  const { userId, orgId } = useSession()
  const { locale } = useConsoleLocale()
  const isZh = locale === 'zh'
  const userBoundaryId = userId || 'anonymous'
  const orgBoundaryId = orgId || 'default'
  const scopeId = `${orgBoundaryId}_${userBoundaryId}`

  // Scoped localStorage keys — prevents chat history from leaking across orgs/users/agents
  const lsk = useMemo(() => ({
    chatId: `pg_chatId_${scopeId}_${selectedAgentId ?? ''}`,
    formRequest: `pg_formRequest_${scopeId}_${selectedAgentId ?? ''}`,
    traceCollapsed: `pg_trace_collapsed_${scopeId}`,
  }), [scopeId, selectedAgentId])

  const [agentList, setAgentList] = useState<AgentListItem[]>([])
  const [selectedIsActive, setSelectedIsActive] = useState(true)
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [snapshot, setSnapshot] = useState<AgentSnapshot | null>(null)
  const [snapshotReloadKey, setSnapshotReloadKey] = useState(0)
  const [formRequest, setFormRequest] = useState<{ title: string; description?: string; fields: Array<{ key: string; label: string; type: string; required?: boolean; placeholder?: string; options?: string[] }>; skillCallId: string } | null>(null)
  const [debugMode, setDebugMode] = useState(false)
  const [toolExecutionMode, setToolExecutionMode] = useState<ToolExecutionMode>(() => {
    try { return localStorage.getItem('pg_toolExecutionMode') === 'dry_run' ? 'dry_run' : 'runtime' } catch { return 'runtime' }
  })

  const [message, setMessage] = useState('')
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'agent' | 'system'; content: string; thinking?: string; images?: AttachedImage[]; notice?: LifecycleNotice }>>([])
  const [reply, setReply] = useState('')
  const [showThinking, setShowThinking] = useState(false)
  const [openThinkings, setOpenThinkings] = useState<Set<number>>(new Set())
  const thinkingAccRef = useRef('')
  const [responding, setResponding] = useState(false)
  const runningRef = useRef(false)
  const composingRef = useRef(false)
  const [liveTools, setLiveTools] = useState<LiveTool[]>([])
  const [turnTraces, setTurnTraces] = useState<PlaygroundTraceStep[][]>([])
  const [turnTotalMs, setTurnTotalMs] = useState<number[]>([])
  const turnNumRef = useRef(0)
  const [expandedTurns, setExpandedTurns] = useState<Set<number>>(new Set())
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set())
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const hasPersistedSession = hasPersistedPlaygroundSession(scopeId, selectedAgentId)
    const stored = readStoredTraceCollapsed(scopeId)
    if (stored != null && hasPersistedSession) return stored
    return true
  })
  useEffect(() => {
    try { localStorage.setItem(lsk.traceCollapsed, String(sidebarCollapsed)) } catch {}
  }, [sidebarCollapsed, lsk.traceCollapsed])
  useEffect(() => {
    try {
      const scoped = localStorage.getItem(lsk.formRequest)
      setFormRequest(scoped ? JSON.parse(scoped) : null)
      localStorage.removeItem('pg_formRequest')
      localStorage.removeItem('pg_chatId')
    } catch {
      setFormRequest(null)
    }
  }, [lsk.formRequest])
  const [error, setError] = useState('')
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([])
  const [toastMessage, setToastMessage] = useState('')
  const [savingToChat, setSavingToChat] = useState(false)
  const [savedChatId, setSavedChatId] = useState<string | null>(null)
  const [isRestoringSession, setIsRestoringSession] = useState(true)
  const [immersiveMode, setImmersiveMode] = useState(false)
  const [immersiveLeft, setImmersiveLeft] = useState(0)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [chatId, setChatId] = useState<string | null>(null)

  const composerRef = useRef<HTMLTextAreaElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const moreMenuRef = useRef<HTMLDivElement>(null)
  const emptyTraceAutocollapseRef = useRef(false)

  // Refs that mirror mutable values read inside runTurn (stale-closure fix)
  const attachedImagesRef = useRef<AttachedImage[]>([])
  useEffect(() => { attachedImagesRef.current = attachedImages }, [attachedImages])
  const showThinkingRef = useRef(showThinking)
  useEffect(() => { showThinkingRef.current = showThinking }, [showThinking])
  const toolExecutionModeRef = useRef<ToolExecutionMode>(toolExecutionMode)
  useEffect(() => {
    toolExecutionModeRef.current = toolExecutionMode
    try { localStorage.setItem('pg_toolExecutionMode', toolExecutionMode) } catch {}
  }, [toolExecutionMode])
  const chatIdRef = useRef<string | null>(null)
  useEffect(() => { chatIdRef.current = chatId }, [chatId])
  const lskRef = useRef(lsk)
  useEffect(() => { lskRef.current = lsk }, [lsk])
  const prevAgentIdRef = useRef<string | null>(null)
  const prevOrgIdRef = useRef<string | null>(null)
  const prevUserIdRef = useRef<string | null>(null)
  const hasRestoredRef = useRef(false)
  const prevAgentConfigIdRef = useRef<string | null>(null)

  // ── Message queue (allow typing while responding) ──
  const [queuedMessages, setQueuedMessages] = useState<Array<{ text: string; images: AttachedImage[] }>>([])
  const queuedMessagesRef = useRef<Array<{ text: string; images: AttachedImage[] }>>([])
  useEffect(() => { queuedMessagesRef.current = queuedMessages }, [queuedMessages])

  const syncComposerHeight = useCallback(() => {
    const composer = composerRef.current
    if (!composer) return

    composer.style.height = '0px'
    const nextHeight = Math.min(Math.max(composer.scrollHeight, 42), 132)
    composer.style.height = `${nextHeight}px`
    composer.style.overflowY = composer.scrollHeight > 132 ? 'auto' : 'hidden'
  }, [])

  useEffect(() => {
    syncComposerHeight()
  }, [message, syncComposerHeight])

  // Auto-send next queued message when current turn finishes
  const respondingRef = useRef(false)
  useEffect(() => {
    if (!responding && respondingRef.current && queuedMessagesRef.current.length > 0) {
      const next = queuedMessagesRef.current[0]
      setQueuedMessages(prev => prev.slice(1))
      runTurn(next.text, next.images)
    }
    respondingRef.current = responding
  }, [responding])

  // ── Restore session on mount + agent/org switch ──
  useEffect(() => {
    const isAgentSwitch = hasRestoredRef.current && prevAgentIdRef.current != null && prevAgentIdRef.current !== selectedAgentId
    // Only treat as org switch when moving between two real org ids (skip initial 'default' → real transition)
    const isOrgSwitch = hasRestoredRef.current && prevOrgIdRef.current != null && prevOrgIdRef.current !== orgId && prevOrgIdRef.current !== 'default'
    const isUserSwitch = hasRestoredRef.current && prevUserIdRef.current != null && prevUserIdRef.current !== userBoundaryId && prevUserIdRef.current !== 'anonymous'
    const isSwitch = isAgentSwitch || isOrgSwitch || isUserSwitch
    hasRestoredRef.current = true
    prevAgentIdRef.current = selectedAgentId
    prevOrgIdRef.current = orgId
    prevUserIdRef.current = userBoundaryId

    setIsRestoringSession(true)

    if (isSwitch) {
      setChatId(null)
      setChatMessages([])
      setTurnTraces([])
      setTurnTotalMs([])
      prevTurnCountRef.current = 0
      setReply('')
      setError('')
      setLiveTools([])
      setSavedChatId(null)
      setFormRequest(null)
      try {
        // Remove both the old unscoped key (migration) and the current scoped key
        localStorage.removeItem('pg_chatId')
        localStorage.removeItem('pg_formRequest')
        localStorage.removeItem(lsk.chatId)
        localStorage.removeItem(lsk.formRequest)
      } catch {}
    }

    const configId = selectedAgentId
    const initialChatId = isSwitch ? null : (() => {
      try { return localStorage.getItem(lsk.chatId) } catch { return null }
    })()
    let cancelled = false

    async function loadSession(sessionChatId: string) {
      const cid = configId
      const detailRes = await fetch(`/api/admin/playground/sessions/${sessionChatId}?configId=${encodeURIComponent(cid || 'default')}`)
      if (!detailRes.ok || cancelled) return
      const { data: detailData } = await detailRes.json() as { data: {
        chatId: string
        messages: Array<{ id: string; role: string; content: string; contentBlocks?: unknown; createdAt: string }>
        traces: Array<{ id: string; actionType: string; title: string; detail: string; payload: string; createdAt: string }>
        renderHintsMap: Record<string, unknown>
      } }
      if (cancelled) return
      setChatId(detailData.chatId)
      try { localStorage.setItem(lsk.chatId, detailData.chatId) } catch {}
      setChatMessages(detailData.messages.map((m) => ({
        role: m.role === 'assistant' ? 'agent' as const : 'user' as const,
        content: m.content,
        images: imagesFromContentBlocks(m.contentBlocks),
      })))

      // Restore traces: group raw traces by runtime turn markers instead of
      // persisted message timestamps. Production message rows can be written
      // after trace rows and sometimes share the same millisecond across turns,
      // which can collapse one restored turn on refresh/reopen.
      if (detailData.traces?.length > 0) {
        const turnGroups = groupRestoredTracesByTurn(detailData.traces)

        // Rebuild liveTools from the last turn's tool_result traces so
        // RenderHintCard components survive page refresh. During live use
        // liveTools resets per turn — only the final turn's hints are shown.
        if (turnGroups.length > 0) {
          const lastTurn = turnGroups[turnGroups.length - 1]
          const rebuiltTools: LiveTool[] = []
          const seenNames = new Set<string>()
          for (const trace of lastTurn) {
            if (trace.actionType !== 'tool_result') continue
            let payload: Record<string, unknown> = {}
            try { payload = JSON.parse(trace.payload || '{}') } catch {}
            const toolName = (payload.toolName as string) || trace.title?.replace(/^Tool result: /, '') || ''
            if (!toolName || seenNames.has(toolName)) continue
            seenNames.add(toolName)
            // Prefer renderHints from the actual execution trace payload;
            // fall back to the static DB tool definition.
            const traceHints = payload.renderHints as LiveTool['renderHints'] | undefined
            const dbHints = detailData.renderHintsMap?.[toolName] as LiveTool['renderHints'] | undefined
            const renderHints = traceHints ?? dbHints ?? undefined
            rebuiltTools.push({
              name: toolName,
              status: 'done',
              startedAt: new Date(trace.createdAt).getTime(),
              finishedAt: new Date(trace.createdAt).getTime(),
              result: payload.output ?? undefined,
              renderHints: renderHints ?? undefined,
            })
          }
          if (rebuiltTools.length > 0) {
            setLiveTools(rebuiltTools)
          }
        }

        // Aggregate each turn's traces
        const restoredTraces = turnGroups.map((group) => {
          const startTime = new Date(group[0].createdAt).getTime()
          return aggregateTraces(
            group.map(t => ({
              id: t.id,
              caseId: '',
              actionType: t.actionType,
              title: t.title,
              detail: t.detail,
              payload: t.payload,
              createdAt: t.createdAt,
            })),
            startTime,
            false,
          )
        })

        setTurnTraces(restoredTraces)
        prevTurnCountRef.current = restoredTraces.length
        setTurnTotalMs(restoredTraces.map((steps) => {
          const msArr = steps.filter(s => s.fired && s.ms > 0).map(s => s.ms)
          return msArr.length > 0 ? msArr.reduce((a, b) => a + b, 0) : 0
        }))
      }
    }

    async function restore() {
      try {
        // If we have a chatId from localStorage (page refresh), load it directly
        if (initialChatId) {
          await loadSession(initialChatId)
          return
        }
        // Otherwise search for latest session by configId
        const params = configId ? `?configId=${encodeURIComponent(configId)}` : ''
        const res = await fetch(`/api/admin/playground/sessions${params}`)
        if (!res.ok || cancelled) return
        const { data } = await res.json() as { data: { sessions: Array<{ chatId: string; firstMessage: string; createdAt: string }> } }
        const latestSession = data.sessions?.[0]
        if (!latestSession) return
        await loadSession(latestSession.chatId)
      } catch { /* session restore is best-effort */ }
    }
    restore().finally(() => {
      if (!cancelled) {
        setIsRestoringSession(false)
      }
    })
    // Cancel in-flight fetch when switching agent/org/user or scoped storage keys.
    return () => { cancelled = true }
  }, [selectedAgentId, orgId, userBoundaryId, lsk.chatId, lsk.formRequest])

  // Auto-expand latest turn; collapse older turns when a NEW turn starts; error tools default expanded
  const prevTurnCountRef = useRef(0)
  useEffect(() => {
    if (turnTraces.length === 0) return
    const latestIdx = turnTraces.length - 1
    // Only collapse older turns when a new turn is added (count increased)
    if (turnTraces.length > prevTurnCountRef.current) {
      setExpandedTurns(new Set([latestIdx]))
    } else {
      // Same turn — just ensure latest is expanded
      setExpandedTurns(prev => {
        if (prev.has(latestIdx)) return prev
        const next = new Set(prev)
        next.add(latestIdx)
        return next
      })
    }
    prevTurnCountRef.current = turnTraces.length
    const latestSteps = turnTraces[latestIdx] || []
    latestSteps.forEach((step: any, toolIdx: number) => {
      if (step.status === 'warn' || step.status === 'block') {
        setExpandedTools(prev => {
          const next = new Set(prev)
          next.add(`${latestIdx}-${toolIdx}`)
          return next
        })
      }
    })
  }, [turnTraces])

  /* ── Data loading ── */

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/agent-configs', { cache: 'no-store' }).then(r => r.json()).then(d => d.data || d),
      fetch('/api/admin/models', { cache: 'no-store' }).then(r => r.json()).then(d => d.data || d),
    ]).then(([agentsData, modelsData]) => {
      setAgentList(agentsData.configs || [])
      setModels(modelsData.models || [])
    }).catch(() => { /* non-critical; picker will retry */ })
  }, [])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ agentId?: string }>).detail
      if (!detail?.agentId || detail.agentId === selectedAgentId) {
        setSnapshotReloadKey((value) => value + 1)
      }
    }
    window.addEventListener(AGENT_CONFIG_UPDATED_EVENT, handler)
    return () => window.removeEventListener(AGENT_CONFIG_UPDATED_EVENT, handler)
  }, [selectedAgentId])

  useEffect(() => {
    if (!moreMenuOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!moreMenuRef.current?.contains(event.target as Node)) {
        setMoreMenuOpen(false)
      }
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setMoreMenuOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [moreMenuOpen])

  useEffect(() => {
    const shouldAutocollapse =
      !isRestoringSession
      && !responding
      && chatMessages.length === 0
      && turnTraces.length === 0

    if (!shouldAutocollapse) {
      emptyTraceAutocollapseRef.current = false
      return
    }
    if (emptyTraceAutocollapseRef.current) return

    setSidebarCollapsed(true)
    emptyTraceAutocollapseRef.current = true
  }, [chatMessages.length, isRestoringSession, responding, turnTraces.length])

  useEffect(() => {
    if (!selectedAgentId) return
    // Track draft/active state
    const selected = agentList.find(a => a.id === selectedAgentId)
    setSelectedIsActive(selected?.isActive ?? false)
    setSelectedVersion(selected?.version ?? null)
    // Reset traces only on actual agent switch (not on first agent-config load)
    const isAgentSwitch = prevAgentConfigIdRef.current !== null && prevAgentConfigIdRef.current !== selectedAgentId
    if (isAgentSwitch) {
      setTurnTraces([])
      setTurnTotalMs([])
      turnNumRef.current = 0
      prevTurnCountRef.current = 0
      setExpandedTurns(new Set())
      setExpandedTools(new Set())
    }
    prevAgentConfigIdRef.current = selectedAgentId

    let cancelled = false

    async function loadSnapshot() {
      try {
        const [agentResult, hooksResult] = await Promise.all([
          apiClient(`/api/admin/agent?agentId=${selectedAgentId}`, { cache: 'no-store' }),
          apiClient(`/api/admin/hooks?agentConfigId=${selectedAgentId}`, { cache: 'no-store' }).catch(() => null),
        ])
        if (cancelled) return

        const payload = agentResult as any
        const raw = payload.data?.config || payload.config || {}
        const hooksPayload = hooksResult as any
        const hooks = Array.isArray(hooksPayload?.data?.hooks)
          ? hooksPayload.data.hooks
          : Array.isArray(hooksPayload?.hooks)
            ? hooksPayload.hooks
            : null
        const resolvedModel = resolveSnapshotModel(
          payload.data?.resolvedModel || payload.resolvedModel || payload.data?.config?.resolvedModel || payload.config?.resolvedModel,
          raw.model,
          models,
        )

        setSnapshot({
          name: raw.name || 'Default',
          resolvedModelId: resolvedModel.id,
          resolvedModelLabel: resolvedModel.label,
          promptPreview: buildPromptPreview(raw.coreSystemPrompt),
          memoryModeLabel: formatMemoryModeLabel(raw.memoryStrategy),
          enabledHookCount: hooks ? hooks.filter((hook: any) => hook?.enabled !== false).length : null,
          temperature: raw.temperature ?? 0.5,
        })
        setDebugMode(Boolean(raw.debugMode))
        if (raw.showThinking !== undefined) setShowThinking(Boolean(raw.showThinking))
      } catch {
        if (!cancelled) setSnapshot(null)
      }
    }

    loadSnapshot()
    return () => {
      cancelled = true
    }
  }, [selectedAgentId, models, agentList, snapshotReloadKey])

  /* ── Auto-scroll ── */

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [reply, turnTraces])

  const measureSidebarInset = useCallback(() => {
    if (typeof document === 'undefined') return 0
    const sidebar = document.querySelector('.console-sidebar')
    const measured = sidebar?.getBoundingClientRect().right ?? 0
    return window.innerWidth < 700 ? Math.min(measured, 96) : measured
  }, [])

  useEffect(() => {
    if (!immersiveMode) return

    const previousOverflow = document.body.style.overflow
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setImmersiveMode(false)
      }
    }

    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [immersiveMode])

  useEffect(() => {
    if (!immersiveMode) return

    const syncSidebarInset = () => {
      setImmersiveLeft(measureSidebarInset())
      if (window.innerWidth < 700) setSidebarCollapsed(true)
    }

    syncSidebarInset()
    window.addEventListener('resize', syncSidebarInset)

    const sidebar = document.querySelector('.console-sidebar')
    const observer = sidebar ? new MutationObserver(syncSidebarInset) : null
    if (sidebar && observer) {
      observer.observe(sidebar, { attributes: true, attributeFilter: ['data-collapsed', 'class', 'style'] })
    }

    return () => {
      window.removeEventListener('resize', syncSidebarInset)
      observer?.disconnect()
    }
  }, [immersiveMode, measureSidebarInset])

  const latestRuntimeTruth = useMemo(() => findLatestRuntimeTruth(turnTraces), [turnTraces])
  const currentRuntimeTruth = useMemo(
    () => resolveCurrentRuntimeTruth(snapshot, latestRuntimeTruth),
    [latestRuntimeTruth, snapshot],
  )
  const visionSupport = useMemo(() => deriveVisionSupport(snapshot, models, currentRuntimeTruth), [snapshot, models, currentRuntimeTruth])
  const canAttachImages = visionSupport.status === 'supported'
  const latestTurnDigest = useMemo(
    () => buildTurnDebugDigest(turnTraces, turnTotalMs, responding, chatMessages, reply),
    [chatMessages, reply, responding, turnTotalMs, turnTraces],
  )
  const latestUserMessageIndex = useMemo(() => {
    for (let index = chatMessages.length - 1; index >= 0; index -= 1) {
      if (chatMessages[index].role === 'user') return index
    }
    return -1
  }, [chatMessages])
  const selectedAgentName = useMemo(
    () => snapshot?.name || agentList.find((agent) => agent.id === selectedAgentId)?.name || 'Default',
    [agentList, selectedAgentId, snapshot?.name],
  )
  const versionContextLabel = selectedVersion
    ? `v${selectedVersion} ${selectedIsActive ? (isZh ? '当前' : 'Live') : (isZh ? '草稿' : 'Draft')}`
    : selectedIsActive
      ? (isZh ? '当前版本' : 'Live version')
      : (isZh ? '草稿版本' : 'Draft version')
  const workspaceEyebrow = surface === 'pilot-lab'
    ? 'Pilot Lab / Playground'
    : (isZh ? '兼容路由 / Playground' : 'Compatibility route / Playground')
  const workspaceTitle = surface === 'pilot-lab'
    ? (isZh ? '运行调试工作台' : 'Runtime test desk')
    : (isZh ? 'Playground 兼容工作台' : 'Playground compatibility desk')
  const executionSurfaceLabel = currentRuntimeTruth?.executionSurface.label ?? (
    toolExecutionMode === 'dry_run'
      ? (isZh ? 'Dry-run 工具模式' : 'Dry-run tool mode')
      : (isZh ? 'Runtime 工具模式' : 'Runtime tool mode')
  )
  const executionSurfaceNote = currentRuntimeTruth?.executionSurface.note
    ?? (isZh
      ? (toolExecutionMode === 'dry_run'
          ? 'Prompt、Hook、Procedure runtime、trace 写入和会话恢复都走真实 AgentLoop 路径；业务工具会被 dry-run 拦截。'
          : 'Prompt、Hook、Procedure runtime、trace 写入、会话恢复和配置工具都走真实 AgentLoop 路径。')
      : (toolExecutionMode === 'dry_run'
          ? 'Prompting, Hooks, Procedure runtime, trace writing, and session restore are real runtime paths. Operational tools are intercepted.'
          : 'Prompting, Hooks, Procedure runtime, trace writing, session restore, and configured tools use the real AgentLoop path.'))
  const toolSurfaceSummary = currentRuntimeTruth ? formatToolSurfaceSummary(currentRuntimeTruth.toolSummary) : (isZh ? '首轮运行后刷新' : 'Refreshes after the first run')
  const runtimeWarnings = currentRuntimeTruth?.warnings ?? (
    toolExecutionMode === 'dry_run'
      ? [isZh ? '业务工具会在 dry-run 下被模拟。' : 'Operational tools are mocked in dry-run mode.']
      : []
  )
  const toolPairingLabel = latestTurnDigest ? summarizeToolPairing(latestTurnDigest.toolCalls, latestTurnDigest.toolResults, responding) : (isZh ? '暂无工具事件' : 'No tool events yet')
  const operateBridgeLabel = isZh ? '仅导出评审副本' : 'Synthetic export only'
  const quickStarts = isZh
    ? [
        { label: '我的充值还没到账，请帮我查一下。', hint: 'Procedure 启动 + 证据查询' },
        { label: '在转人工前，你还缺哪些证据？', hint: 'Hook + 转人工推理' },
        { label: '继续之前，请先对齐我刚补充的支付金额。', hint: 'Reconcile + 陈旧证据路径' },
        { label: '我上传了回单截图，你现在能确认什么？', hint: '图片输入能力测试' },
      ]
    : QUICK_STARTS

  /* ── Image helpers ── */

  const handleImageAttach = useCallback(async (files: FileList | File[]) => {
    if (!canAttachImages) {
      setToastMessage(visionSupport.status === 'unknown'
        ? (isZh ? '当前模型的图片输入支持状态未知，请先切到已确认支持视觉的模型再附加截图。' : 'Image input support is unknown for this model. Switch to a confirmed vision-capable model before attaching screenshots.')
        : `${snapshot?.resolvedModelLabel || (isZh ? '当前模型' : 'This model')}${isZh ? ' 不支持图片输入，请先切到已确认支持视觉的模型再附加截图。' : ' does not support image input. Switch to a confirmed vision-capable model before attaching screenshots.'}`)
      setTimeout(() => setToastMessage(''), 4000)
      return
    }
    const limit = 5 * 1024 * 1024 // 5MB
    const newImages: AttachedImage[] = []
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue
      if (file.size > limit) { setToastMessage(isZh ? `“${file.name}” 超过 5MB 限制` : `"${file.name}" exceeds 5MB limit`); setTimeout(() => setToastMessage(''), 3000); continue }
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve((reader.result as string).split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      newImages.push({ base64, mimeType: file.type, name: file.name })
    }
    setAttachedImages(prev => [...prev, ...newImages])
  }, [canAttachImages, snapshot?.resolvedModelLabel, visionSupport.status])

  const removeImage = useCallback((idx: number) => {
    setAttachedImages(prev => prev.filter((_, i) => i !== idx))
  }, [])

  /* ── Save to Chat ── */

  const handleSaveToChat = useCallback(async () => {
    if (chatMessages.length === 0) return
    setSavingToChat(true)
    try {
      const res = await fetch('/api/admin/playground/save-to-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: selectedAgentId,
          messages: chatMessages.map(m => ({
            role: m.role,
            content: m.content,
            thinking: m.thinking,
            contentBlocks: m.images?.map((img) => ({
              type: 'image',
              source: {
                type: 'base64',
                media_type: img.mimeType,
                data: img.base64,
              },
            })),
          })),
          traces: turnTraces,
        }),
      })
      if (!res.ok) { setToastMessage(isZh ? `导出失败：HTTP ${res.status}` : `Export failed: HTTP ${res.status}`); setTimeout(() => setToastMessage(''), 4000); return }
      const data = await res.json(); const p = data.data || data
      setSavedChatId(p.chatId)
      setToastMessage(isZh ? '已将试跑评审副本导出到 Operate。' : 'Exported synthetic review transcript to Operate.')
      setTimeout(() => setToastMessage(''), 4000)
    } catch (err) {
      setToastMessage(isZh ? '导出失败：网络错误' : 'Export failed: network error')
      setTimeout(() => setToastMessage(''), 4000)
    } finally {
      setSavingToChat(false)
    }
  }, [chatMessages, turnTraces, selectedAgentId])

  /* ── Run turn ── */

  const runTurn = useCallback(async (
    displayMessage: string,
    queuedImages?: AttachedImage[],
    requestOverride?: {
      message?: string
      formResult?: { answers: Record<string, string> }
    },
  ) => {
    if (runningRef.current) return
    const currentImages = queuedImages ?? attachedImagesRef.current
    if (currentImages.length > 0 && !canAttachImages) {
      setError(visionSupport.status === 'unknown'
        ? (isZh ? '当前激活运行时目录里还无法确认此模型是否支持图片输入，请先切到已确认支持视觉的模型再运行。' : 'Image input support is unknown for this model in the active runtime registry. Switch to a confirmed vision-capable model before running this turn.')
        : `${snapshot?.resolvedModelLabel || (isZh ? '当前模型' : 'This model')}${isZh ? ' 不支持图片输入，请先切到已确认支持视觉的模型再运行。' : ' does not support image input. Switch to a confirmed vision-capable model before running this turn.'}`)
      return
    }
    runningRef.current = true
    setReply('')
    thinkingAccRef.current = ''
    turnNumRef.current += 1
    setTurnTraces(prev => [...prev, []])
    setTurnTotalMs(prev => [...prev, 0])
    setLiveTools([])
    setFormRequest(null)
    try { localStorage.removeItem(lskRef.current.formRequest) } catch {}
    setError('')
    setResponding(true)
    setSidebarCollapsed(false)
    setAttachedImages([])
    setChatMessages(prev => [...prev, { role: 'user' as const, content: displayMessage, images: currentImages.length > 0 ? currentImages : undefined }])

    try {
      const body: Record<string, unknown> = {
        message: requestOverride?.message ?? (requestOverride?.formResult ? '' : displayMessage),
      }
      if (selectedAgentId) body.configId = selectedAgentId
      body.config = { debug: debugMode, emitThinking: showThinkingRef.current, toolExecutionMode: toolExecutionModeRef.current }
      if (chatIdRef.current) body.chatId = chatIdRef.current
      if (requestOverride?.formResult) body.formResult = requestOverride.formResult
      if (currentImages.length > 0) {
        body.contentBlocks = currentImages.map(img => ({
          type: 'image',
          source: { type: 'base64', media_type: img.mimeType, data: img.base64 },
        }))
      }

      const pushNotice = (notice: LifecycleNotice) => {
        setChatMessages(prev => [...prev, { role: 'system' as const, content: '', notice }])
      }

      const res = await fetch('/api/admin/playground/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) { setError(`HTTP ${res.status}: ${await res.text()}`); return }

      const reader = res.body?.getReader()
      if (!reader) { setError(isZh ? '响应流不可用' : 'No response stream'); return }

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            if (event.type === 'text_delta') setReply(r => r + event.data)
            else if (event.type === 'thinking_delta') {
              thinkingAccRef.current += event.data
            }
            else if (event.type === 'session_init') {
              const d = event.data as { chatId: string; caseId: string }
              if (d?.chatId && !chatIdRef.current) {
                setChatId(d.chatId)
                try { localStorage.setItem(lskRef.current.chatId, d.chatId) } catch {}
              }
            }
            else if (event.type === 'error') {
              const errData = event.data
              if (typeof errData === 'string') setError(errData)
              else if (errData && typeof errData === 'object') setError((errData as any)?.message ?? (isZh ? '未知错误' : 'Unknown error'))
              else setError(String(errData))
            }
            else if (event.type === 'tool_executing') {
              const d = event.data as any
              const name = d?.name || 'tool'
              setLiveTools(prev => [
                ...prev.filter(t => t.name !== name || t.status !== 'running'),
                { name, status: 'running', startedAt: Date.now() },
              ])
            }
            else if (event.type === 'tool_result') {
              const d = event.data as any
              const name = d?.name || 'tool'
              setLiveTools(prev => prev.map(t =>
                t.name === name && t.status === 'running'
                  ? { ...t, status: d?.ok === false ? 'error' : 'done', finishedAt: Date.now(), result: d?.result, renderHints: d?.renderHints }
                  : t
              ))
            }
            else if (event.type === 'form_request') {
              const d = event.data as any
              const fr = {
                title: d?.title || (isZh ? '需要补充信息' : 'Information Needed'),
                description: d?.description,
                fields: d?.fields || [],
                skillCallId: d?.skillCallId || '',
              }
              setFormRequest(fr)
              try { localStorage.setItem(lskRef.current.formRequest, JSON.stringify(fr)) } catch {}
            }
            else if (event.type === 'trace') {
              const t = event.data.trace || []
              setTurnTraces(prev => {
                const next = [...prev]
                if (next.length > 0) next[next.length - 1] = t
                return next
              })
              setTurnTotalMs(prev => {
                const next = [...prev]
                if (next.length > 0) next[next.length - 1] = (event.data as any).totalMs ?? 0
                return next
              })
            }
            else if (event.type === 'escalated') pushNotice({ kind: 'escalated', label: isZh ? 'Agent 已转给人工' : 'Agent escalated to a human', detail: (event.data as any)?.reason })
            else if (event.type === 'case_created') pushNotice({ kind: 'case_created', label: isZh ? `ProcedureRun 已启动：${(event.data as any)?.displayName ?? (event.data as any)?.caseType ?? ''}` : `ProcedureRun started: ${(event.data as any)?.displayName ?? (event.data as any)?.caseType ?? ''}` })
            else if (event.type === 'human_task_created') pushNotice({ kind: 'human_task', label: isZh ? '已创建人工任务' : 'Human task created' })
            else if (event.type === 'retry_pending') pushNotice({ kind: 'retry', label: isZh ? `正在重试（${(event.data as any)?.errorClass ?? 'transient'}）…` : `Retrying (${(event.data as any)?.errorClass ?? 'transient'})…` })
          } catch { /* */ }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : (isZh ? '网络错误' : 'Network error'))
    } finally {
      runningRef.current = false
      setResponding(false)
      // Clean up trailing empty turns (race condition: trace event may arrive after responding=false)
      setTurnTraces(prev => prev.length > 0 && prev[prev.length - 1].length === 0 ? prev.slice(0, -1) : prev)
      setTurnTotalMs(prev => prev.length > 0 && prev[prev.length - 1] === 0 ? prev.slice(0, -1) : prev)
      const archivedThinking = thinkingAccRef.current
      setReply(r => {
        if (r) setChatMessages(prev => [...prev, { role: 'agent' as const, content: r, thinking: archivedThinking || undefined }])
        return ''
      })
    }
  }, [selectedAgentId, debugMode, canAttachImages, visionSupport.status, snapshot?.resolvedModelLabel])

  const canSubmitManualTurn = message.trim().length > 0 || attachedImages.length > 0

  const submitManualTurn = useCallback(() => {
    const trimmed = message.trim()
    const queuedImages = attachedImagesRef.current
    if (!trimmed && queuedImages.length === 0) return
    setMessage('')
    setAttachedImages([])
    if (responding) {
      setQueuedMessages((prev) => [...prev, { text: trimmed, images: queuedImages }])
      return
    }
    runTurn(trimmed, queuedImages)
  }, [message, responding, runTurn])

  const handleComposerKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !composingRef.current) {
      event.preventDefault()
      if (message.trim() || attachedImagesRef.current.length > 0) submitManualTurn()
    }
  }, [message, submitManualTurn])

  // ── Session metrics ──
  const sessionMetrics = useMemo(() => {
    let totalInput = 0, totalCacheRead = 0, totalCacheWrite = 0, totalOutput = 0, totalTools = 0, llmCalls = 0
    for (const steps of turnTraces) {
      for (const step of steps) {
        if (step.usage) {
          totalInput += step.usage.inputTokens || 0
          totalCacheRead += step.usage.cacheReadTokens || 0
          totalCacheWrite += step.usage.cacheWriteTokens || 0
          totalOutput += step.usage.outputTokens || 0
          llmCalls++
        }
        if (step.stage === 'Tools' || step.stage === 'Knowledge retrieval') totalTools += step.detail?.length || 0
      }
    }
    const totalMs = turnTotalMs.reduce((a, b) => a + b, 0)
    return { totalInput, totalCacheRead, totalCacheWrite, totalOutput, totalTools, llmCalls, totalMs }
  }, [turnTraces, turnTotalMs])
  const shouldRenderTraceSidebar = !sidebarCollapsed
    || responding
    || chatMessages.length > 0
    || turnTraces.length > 0
    || liveTools.length > 0

  const tb = (key: string) => {
    const labels: Record<string, string> = {
      'trace.sessionTokens': 'tokens', 'trace.sessionWall': 'wall',
      'trace.sessionLlm': 'llm', 'trace.sessionTools': 'tools',
      'trace.breakdownInput': 'prompt', 'trace.breakdownOutput': 'output',
      'trace.breakdownCache': 'cache hit', 'trace.breakdownLlm': 'llm',
      'trace.breakdownTools': 'tools', 'trace.breakdownTokPerS': 'tok/s',
      'trace.inputLabel': 'Input', 'trace.outputLabel': 'Output',
      'trace.outputError': 'error', 'trace.modelResponse': 'Model response',
      'trace.running': 'running...', 'trace.failed': 'failed',
    }
    return labels[key] || key.split('.').pop() || key
  }

  /* ── Render ── */

  return (
    <>
    <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}@keyframes wc-think-pulse{0%,100%{opacity:.3;transform:scale(.85)}50%{opacity:.8;transform:scale(1)}}@media(max-width:700px){[data-playground-immersive="true"] .pg-toolbar{padding:12px 10px 8px!important}[data-playground-immersive="true"] .pg-title-group{flex-basis:100%!important}[data-playground-immersive="true"] .pg-picker-wrap{min-width:0!important;max-width:100%!important}[data-playground-immersive="true"] .pg-actions{justify-content:flex-start!important;flex-wrap:nowrap!important;overflow-x:auto!important;max-width:100%;padding-bottom:4px;scrollbar-width:none}[data-playground-immersive="true"] .pg-actions>*{flex:0 0 auto!important;white-space:nowrap!important}[data-playground-immersive="true"] .pg-actions::-webkit-scrollbar{display:none}[data-playground-immersive="true"] .pg-status-row{padding-left:0!important;flex-wrap:nowrap!important;overflow-x:auto!important;scrollbar-width:none}[data-playground-immersive="true"] .pg-status-row>*{flex:0 0 auto!important;white-space:nowrap!important}[data-playground-immersive="true"] .pg-status-row::-webkit-scrollbar{display:none}[data-playground-immersive="true"] .pg-chat-scroll{padding-left:10px!important;padding-right:10px!important}}`}</style>
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: immersiveMode ? '100dvh' : '100%',
        overflow: 'hidden',
        position: immersiveMode ? 'fixed' : 'relative',
        top: immersiveMode ? 0 : undefined,
        right: immersiveMode ? 0 : undefined,
        bottom: immersiveMode ? 0 : undefined,
        left: immersiveMode ? immersiveLeft : undefined,
        zIndex: immersiveMode ? 18 : 'auto',
        background: immersiveMode ? 'linear-gradient(180deg, rgba(255,252,249,0.98), rgba(255,249,245,0.96))' : 'transparent',
      }}
      data-playground-immersive={immersiveMode ? 'true' : 'false'}
    >
      {/* ═══════════════════════════════════════════
          Ambient background orbs
          ═══════════════════════════════════════════ */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
        <div style={{
          position: 'absolute', width: 480, height: 480, top: '-8%', left: '-5%',
          borderRadius: '50%', filter: 'blur(100px)', opacity: 0.45,
          background: 'radial-gradient(circle, rgba(212,118,78,0.06), transparent 70%)',
        }} />
        <div style={{
          position: 'absolute', width: 400, height: 400, bottom: '5%', right: '-3%',
          borderRadius: '50%', filter: 'blur(90px)', opacity: 0.35,
          background: 'radial-gradient(circle, rgba(201,136,74,0.05), transparent 70%)',
        }} />
      </div>

      {/* ═══════════════════════════════════════════
          Playground toolbar
          ═══════════════════════════════════════════ */}
      <header className="pg-toolbar" style={{
        position: 'relative', zIndex: 3, flexShrink: 0,
        display: 'flex', flexDirection: 'column', gap: 4,
        padding: '8px 16px 6px',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'rgba(255,255,255,0.58)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 10, flexWrap: 'wrap',
        }}>
          <div className="pg-title-group" style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 360px', minWidth: 0 }}>
            <div style={{
              width: 30, height: 30, borderRadius: 10,
              background: 'linear-gradient(135deg, rgba(212,118,78,0.14), rgba(201,136,74,0.10))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 0 1px rgba(212,118,78,0.08) inset',
              flexShrink: 0,
            }}>
              <FlaskConical size={14} color="#b87347" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontSize: 8, fontWeight: 700, letterSpacing: '0.12em',
                textTransform: 'uppercase', color: 'var(--fog)', opacity: 0.66, marginBottom: 1,
              }}>
                {workspaceEyebrow}
              </div>
              <h1 style={{
                margin: 0,
                fontSize: 14,
                fontWeight: 640,
                color: 'var(--mist)',
                letterSpacing: '-0.02em',
              }}>
                {workspaceTitle}
              </h1>
              {surface === 'legacy' && (
                <div style={{
                  marginTop: 6,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  borderRadius: 999,
                  border: '1px solid rgba(212,118,78,0.14)',
                  background: 'rgba(212,118,78,0.07)',
                  padding: '6px 10px',
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#8a5a38',
                }}>
                  {isZh ? '这里只是兼容入口。产品主工作台已迁到 Build -> Pilot Lab。' : 'Compatibility route only. Build -> Pilot Lab owns the product workspace.'}
                </div>
              )}
            </div>
          </div>
          <div className="pg-actions" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 5, flex: '0 1 auto' }}>
            <div
              role="group"
              aria-label={isZh ? '工具执行模式' : 'Tool execution mode'}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 2,
                padding: 3,
                borderRadius: 10,
                border: '1px solid rgba(45,127,131,0.14)',
                background: 'rgba(255,255,255,0.72)',
              }}
            >
              {([
                { mode: 'runtime' as const, label: 'Runtime', icon: <CheckCircle2 size={12} /> },
                { mode: 'dry_run' as const, label: 'Dry-run', icon: <FlaskConical size={12} /> },
              ]).map((item) => {
                const active = toolExecutionMode === item.mode
                return (
                  <button
                    key={item.mode}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setToolExecutionMode(item.mode)}
                    title={item.mode === 'runtime'
                      ? (isZh ? '使用真实配置工具执行。' : 'Run configured tools through the real runtime path.')
                      : (isZh ? '拦截业务工具，仅保留安全调试。' : 'Intercept operational tools for side-effect-safe debugging.')}
                    style={{
                      height: 30,
                      border: 'none',
                      borderRadius: 7,
                      padding: '0 9px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      cursor: 'pointer',
                      background: active ? 'rgba(45,127,131,0.10)' : 'transparent',
                      color: active ? 'var(--teal)' : 'var(--fog)',
                      fontSize: 11,
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.icon}
                    {item.label}
                  </button>
                )
              })}
            </div>
            <ActionButton
              active={!sidebarCollapsed}
              onClick={() => setSidebarCollapsed((value) => !value)}
              title={sidebarCollapsed
                ? (isZh ? '展开 Trace 时间线，查看 tool call、result、Hook 决策和 Procedure runtime 证据。' : 'Open the trace timeline to inspect tool calls, results, Hook decisions, and Procedure runtime evidence.')
                : (isZh ? '收起 Trace 时间线。' : 'Collapse the trace timeline.')}
            >
              {sidebarCollapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
              {sidebarCollapsed ? (isZh ? '打开 Trace' : 'Open trace') : (isZh ? '收起 Trace' : 'Hide trace')}
            </ActionButton>
            <ActionButton
              active={immersiveMode}
              onClick={() => {
                if (immersiveMode) {
                  setImmersiveMode(false)
                  return
                }
                setImmersiveLeft(measureSidebarInset())
                setImmersiveMode(true)
              }}
              title={immersiveMode
                ? (isZh ? '退出沉浸模式。也可以按 Esc。' : 'Exit immersive mode. You can also press Esc.')
                : (isZh ? '进入沉浸模式，专注进行手动调试。' : 'Enter immersive mode for focused manual debugging.')}
            >
              {immersiveMode ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              {immersiveMode ? (isZh ? '退出沉浸' : 'Exit immersion') : (isZh ? '沉浸模式' : 'Immersive mode')}
            </ActionButton>
            <ActionButton
              onClick={handleSaveToChat}
              disabled={chatMessages.length === 0 || savingToChat}
              title={chatMessages.length === 0
                ? (isZh ? '至少先发起一轮测试，再导出评审副本。' : 'Send at least one turn before exporting a review transcript.')
                : (isZh ? '会在 Operate 中创建一份试跑评审副本，不会继续真实客户会话。' : 'Creates a synthetic review transcript in Operate. It does not resume a live customer chat.')}
            >
              <Clock size={13} />
              {savingToChat ? (isZh ? '导出中…' : 'Exporting…') : (isZh ? '导出试跑评审副本' : 'Export synthetic review transcript')}
            </ActionButton>
            <div ref={moreMenuRef} style={{ position: 'relative' }}>
              <ActionButton
                active={moreMenuOpen}
                onClick={() => setMoreMenuOpen((value) => !value)}
                title={isZh ? '打开更多工作台动作。' : 'Open more workspace actions.'}
              >
                <MoreHorizontal size={13} />
                {isZh ? '更多' : 'More'}
                <ChevronDown size={12} style={{ opacity: 0.7 }} />
              </ActionButton>
              {moreMenuOpen ? (
                <div style={{
                  position: 'absolute',
                  top: 'calc(100% + 8px)',
                  right: 0,
                  width: 220,
                  padding: 8,
                  borderRadius: 16,
                  border: '1px solid rgba(212,118,78,0.10)',
                  background: 'rgba(255,252,249,0.96)',
                  boxShadow: '0 20px 40px rgba(58,39,24,0.12)',
                  backdropFilter: 'blur(18px)',
                  WebkitBackdropFilter: 'blur(18px)',
                  zIndex: 24,
                }}>
                  <ToolbarMenuItem
                    active={showThinking}
                    icon={<Brain size={13} />}
                    label={showThinking ? (isZh ? '隐藏思考' : 'Hide thinking') : (isZh ? '显示思考' : 'Show thinking')}
                    onClick={() => {
                      setShowThinking((value) => !value)
                      setMoreMenuOpen(false)
                    }}
                  />
                  <ToolbarMenuItem
                    icon={<RefreshCw size={13} />}
                    label={isZh ? '刷新快照' : 'Refresh snapshot'}
                    onClick={() => {
                      setSnapshotReloadKey((value) => value + 1)
                      setMoreMenuOpen(false)
                    }}
                  />
                  <Link
                    href={`/build/components/brain?mode=model&agentId=${selectedAgentId}`}
                    onClick={() => setMoreMenuOpen(false)}
                    style={{ textDecoration: 'none' }}
                  >
                    <ToolbarMenuItem
                      interactive={false}
                      icon={<ExternalLink size={13} />}
                      label={isZh ? '打开 Brain' : 'Open Brain'}
                    />
                  </Link>
                  {savedChatId ? (
                    <Link
                      href={`/operate/conversations/${savedChatId}`}
                      target="_blank"
                      onClick={() => setMoreMenuOpen(false)}
                      style={{ textDecoration: 'none' }}
                    >
                      <ToolbarMenuItem
                        interactive={false}
                        icon={<ExternalLink size={13} />}
                        label={isZh ? '在 Operate 打开' : 'Open in Operate'}
                      />
                    </Link>
                  ) : null}
                  <div style={{
                    height: 1,
                    margin: '6px 4px',
                    background: 'rgba(212,118,78,0.10)',
                  }} />
                  <ToolbarMenuItem
                    danger
                    disabled={!chatId}
                    icon={<XCircle size={13} />}
                    label={isZh ? '清空会话' : 'Clear session'}
                    onClick={async () => {
                      if (!chatId) return
                      try {
                        await fetch(`/api/admin/playground/sessions/${chatId}`, { method: 'DELETE' })
                      } catch { /* best-effort */ }
                      setChatId(null)
                      setChatMessages([])
                      setTurnTraces([])
                      setTurnTotalMs([])
                      prevTurnCountRef.current = 0
                      setReply('')
                      setError('')
                      setLiveTools([])
                      setSavedChatId(null)
                      setFormRequest(null)
                      setSidebarCollapsed(true)
                      setMoreMenuOpen(false)
                      try { localStorage.removeItem(lsk.chatId); localStorage.removeItem(lsk.formRequest); localStorage.removeItem('pg_chatId'); localStorage.removeItem('pg_formRequest') } catch {}
                    }}
                  />
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <div className="pg-status-row" style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          flexWrap: 'wrap',
          paddingLeft: 38,
          paddingTop: 0,
        }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            minHeight: 20,
            paddingRight: 4,
            fontSize: 10.5,
            color: 'var(--mist)',
            minWidth: 0,
            whiteSpace: 'nowrap',
          }}>
            <span style={{ fontWeight: 650 }}>{selectedAgentName}</span>
            <span style={{ opacity: 0.28 }}>·</span>
            <span style={{ color: 'var(--fog)', fontWeight: 600 }}>{versionContextLabel}</span>
            <span style={{ opacity: 0.28 }}>·</span>
            <span style={{ color: 'var(--fog)' }}>
              {snapshot?.resolvedModelLabel || (isZh ? '加载模型中' : 'Loading model')}
            </span>
          </div>
          <InlineTruthPill compact label={isZh ? '图片' : 'Image'} value={visionSupport.label} tone={toneForVisionSupport(visionSupport.status)} />
          <InlineTruthPill compact label="Memory" value={snapshot?.memoryModeLabel || (isZh ? '加载中' : 'Loading')} />
          <InlineTruthPill
            compact
            label="Hooks"
            value={snapshot?.enabledHookCount == null ? (isZh ? '未知' : 'Unknown') : isZh ? `${snapshot.enabledHookCount} 个` : `${snapshot.enabledHookCount} active`}
          />
          <InlineTruthPill compact label="Temp" value={snapshot ? String(snapshot.temperature) : '...'} />
        </div>
      </header>

      {/* ═══════════════════════════════════════════
          Main row — chat (left) + sidebar (right)
          ═══════════════════════════════════════════ */}
      <div style={{
        position: 'relative', zIndex: 1, flex: 1,
        display: 'flex', overflow: 'hidden', minWidth: 0,
      }}>

        {/* ── Chat column ── */}
        <div style={{
          flex: 1, minWidth: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          overflow: 'hidden',
        }}>
          <div className="pg-chat-scroll" style={{
            flex: 1, width: '100%',
            padding: '20px 16px 0 24px',
            overflowY: 'auto',
            display: 'flex', flexDirection: 'column',
          }}>
            {/* ── Empty state ── */}
            {chatMessages.length === 0 && !responding && !error && !isRestoringSession && (
              <div className="pg-empty-state">
                <div className="pg-quickstarts-grid">
                  {quickStarts.map(q => (
                    <button
                      className="pg-quickstart-card"
                      key={q.label}
                      onClick={() => { runTurn(q.label); setMessage('') }}
                      onMouseEnter={e => {
                        e.currentTarget.style.borderColor = 'var(--border-hover)'
                        e.currentTarget.style.boxShadow = 'var(--shadow-card-hover)'
                        e.currentTarget.style.transform = 'translateY(-1px)'
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.borderColor = 'var(--border-subtle)'
                        e.currentTarget.style.boxShadow = 'none'
                        e.currentTarget.style.transform = 'translateY(0)'
                      }}
                    >
                      <div className="pg-quickstart-title">
                        {q.label}
                      </div>
                      <div className="pg-quickstart-hint">
                        {q.hint}
                      </div>
                    </button>
                  ))}
                </div>

              </div>
            )}

            {/* ── Chat messages ── */}
            {chatMessages.map((m, i) => (
              <div key={i} style={{ alignSelf: m.role === 'system' ? 'center' : m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: m.role === 'system' ? '100%' : '85%' }}>
                {m.role === 'system' && m.notice && (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0' }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '6px 14px', borderRadius: 20,
                      background: 'rgba(212,118,78,0.06)',
                      border: '1px solid rgba(212,118,78,0.1)',
                      fontSize: 11, color: 'var(--fog)',
                    }}>
                      {m.notice.kind === 'escalated' && <AlertCircle size={12} color="var(--amber)" />}
                      {m.notice.kind === 'case_created' && <CheckCircle2 size={12} color="var(--malachite)" />}
                      {m.notice.kind === 'human_task' && <Clock size={12} color="var(--amber)" />}
                      {m.notice.kind === 'retry' && <XCircle size={12} color="var(--vermillion)" />}
                      <span>{m.notice.label}</span>
                      {m.notice.detail && <span style={{ opacity: 0.5 }}>— {m.notice.detail}</span>}
                    </div>
                  </div>
                )}
                {/* Per-message thinking (above agent bubble, collapsed, survives turns) */}
                {m.role !== 'system' && (
                  <>
                {showThinking && m.role === 'agent' && m.thinking && (() => {
                  const isOpen = openThinkings.has(i)
                  return (
                    <div key={`think-${i}`} style={{
                      borderRadius: 16,
                      background: '#fffcf9',
                      border: '1px solid rgba(0,0,0,0.06)',
                      marginBottom: 6,
                      boxShadow: '0 1px 2px rgba(60,40,20,0.04)',
                      overflow: 'hidden',
                      fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
                    }}>
                      <div
                        onClick={() => {
                          setOpenThinkings(prev => {
                            const next = new Set(prev)
                            if (next.has(i)) next.delete(i)
                            else next.add(i)
                            return next
                          })
                        }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '14px 18px', cursor: 'pointer',
                          userSelect: 'none',
                        }}
                      >
                        <svg
                          width="18" height="18" viewBox="0 0 24 24" fill="none"
                          stroke="#b8a99a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                          style={{
                            transition: 'transform 0.3s cubic-bezier(0.4,0,0.2,1)',
                            transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                            flexShrink: 0,
                          }}
                        >
                          <path d="M9 18l6-6-6-6" />
                        </svg>
                        <span style={{
                          fontSize: 13, fontWeight: 600,
                          color: '#b87347',
                          letterSpacing: '0.01em',
                        }}>
                          {isZh ? '思考过程' : 'Thinking'}
                        </span>
                        <span style={{
                          width: 7, height: 7, borderRadius: '50%',
                          background: '#d4764e', opacity: 0.6,
                          animation: 'wc-think-pulse 2.5s ease-in-out infinite',
                        }} />
                      </div>
                      <div style={{
                        maxHeight: isOpen ? 400 : 0,
                        overflow: 'hidden',
                        transition: 'max-height 0.4s cubic-bezier(0.4,0,0.2,1), padding 0.3s ease',
                        padding: isOpen ? '0 18px 16px' : '0 18px',
                      }}>
                        <div style={{
                          height: 1, marginBottom: 12,
                          background: 'linear-gradient(90deg, transparent, rgba(0,0,0,0.06), transparent)',
                        }} />
                        <div style={{
                          fontFamily: "'Literata', Georgia, serif",
                          fontSize: 14, fontStyle: 'italic',
                          color: '#6b5e54', lineHeight: 1.8,
                          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                        }}>
                          {m.thinking}
                        </div>
                      </div>
                    </div>
                  )
                })()}
                <div
                  style={{
                    padding: '12px 16px', borderRadius: 14,
                    marginBottom: 8,
                    background: m.role === 'user'
                      ? 'rgba(212,118,78,0.06)'
                      : 'rgba(255,255,255,0.55)',
                    backdropFilter: m.role === 'agent' ? 'blur(12px)' : undefined,
                    WebkitBackdropFilter: m.role === 'agent' ? 'blur(12px)' : undefined,
                    border: m.role === 'agent' ? '1px solid var(--border-subtle)' : '1px solid rgba(212,118,78,0.1)',
                  }}
                >
                  <div style={{
                    fontSize: 11, fontWeight: 600, color: 'var(--fog)',
                    marginBottom: 4, opacity: 0.5,
                  }}>
                    {m.role === 'user' ? (isZh ? '你' : 'You') : snapshot?.name || 'Agent'}
                  </div>
                  {m.role === 'agent' ? (
                    <MessageContent
                      content={m.content}
                      contentBlocks={imagesToContentBlocks(m.images)}
                      imagePreviewMode="auto"
                    />
                  ) : (
                    <>
                      {m.images && m.images.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                          {m.images.map((img, idx) => (
                            <span key={idx} style={{ position: 'relative', display: 'inline-flex' }}>
                              <img
                                src={`data:${img.mimeType};base64,${img.base64}`}
                                alt={img.name}
                                title={img.name}
                                style={{
                                  maxWidth: 120, maxHeight: 80,
                                  borderRadius: 8, objectFit: 'cover',
                                  border: '1px solid rgba(212,118,78,0.12)',
                                }}
                              />
                              {responding && i === latestUserMessageIndex && (
                                <span style={{
                                  position: 'absolute',
                                  right: 5,
                                  bottom: 5,
                                  display: 'inline-flex',
                                  width: 20,
                                  height: 20,
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  borderRadius: 999,
                                  background: 'rgba(255,252,249,0.86)',
                                  border: '1px solid rgba(212,118,78,0.14)',
                                  color: '#b87347',
                                  boxShadow: '0 4px 12px rgba(58,39,24,0.10)',
                                }}>
                                  <OrganicLoader variant="17" size={14} title={isZh ? '正在分析图片' : 'Image analysis running'} />
                                </span>
                              )}
                            </span>
                          ))}
                        </div>
                      )}
                      <div style={{
                        fontSize: 13, color: 'var(--mist)', lineHeight: 1.7,
                        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      }}>
                        {m.content}
                      </div>
                    </>
                  )}
                </div>
                  </>
                )}
              </div>
            ))}

            {/* ── Error ── */}
            {error && (
              <div style={{
                padding: '14px 18px', borderRadius: 14,
                background: 'rgba(230,69,57,0.06)', border: '1px solid rgba(230,69,57,0.12)',
                fontSize: 13, color: 'var(--vermillion)', lineHeight: 1.5,
                marginBottom: 16,
              }}>
                {error}
              </div>
            )}

            {/* ── Thinking pill ── */}
            {responding && !reply && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '12px 18px', borderRadius: 16,
                background: 'rgba(255,255,255,0.55)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                border: '1px solid var(--border-subtle)',
                alignSelf: 'flex-start',
                marginBottom: 16,
                color: '#b87347',
              }}>
                <OrganicLoader variant="01" size={18} title={isZh ? '等待首个 token' : 'Waiting for first token'} />
                <span style={{ fontSize: 12, color: 'var(--fog)' }}>
                  {isZh ? '等待首个 token…' : 'Waiting for first token…'}
                </span>
              </div>
            )}

            {/* ── Streaming agent reply ── */}
            {reply && (
              <div style={{
                padding: '12px 16px', borderRadius: 14,
                marginBottom: 8,
                background: 'rgba(255,255,255,0.55)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                border: '1px solid var(--border-subtle)',
                alignSelf: 'flex-start',
                maxWidth: '85%',
              }}>
                <div style={{
                  fontSize: 11, fontWeight: 600, color: 'var(--fog)',
                  marginBottom: 4, opacity: 0.5,
                }}>
                  {snapshot?.name || 'Agent'}
                </div>
                <TokenStreamPreview text={reply} />
              </div>
            )}

            {/* ── Form request (ask_user_questions) ── */}
            {formRequest && (
              <div style={{
                padding: 24, borderRadius: 16,
                marginBottom: 8,
                background: '#fffcf9',
                border: '1px solid rgba(0,0,0,0.06)',
                boxShadow: '0 1px 2px rgba(60,40,20,0.04), 0 4px 12px rgba(60,40,20,0.03)',
                alignSelf: 'flex-start',
                maxWidth: '420px',
                width: '100%',
              }}>
                <p style={{ fontSize: 17, fontWeight: 700, color: '#2d2926', margin: '0 0 2px', fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif" }}>{formRequest.title}</p>
                {formRequest.description && (
                  <p style={{ fontSize: 13.5, color: '#8a7e74', margin: '0 0 12px', fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif" }}>{formRequest.description}</p>
                )}
                <form onSubmit={e => {
                  e.preventDefault()
                  const formData = new FormData(e.currentTarget)
                  const answers: Record<string, string> = {}
                  formData.forEach((v, k) => { answers[k] = String(v) })
                  const answerText = Object.entries(answers)
                    .filter(([, v]) => v.trim())
                    .map(([k, v]) => `${k}: ${v}`)
                    .join('\n')
                  setFormRequest(null)
                  if (answerText) {
                    runTurn(`[Form submission]\n${answerText}`, undefined, {
                      formResult: { answers },
                    })
                  }
                }} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {formRequest.fields.map(f => (
                    <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: '#8a7e74', letterSpacing: '0.02em', fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif" }}>
                        {f.label}{f.required ? ' *' : ''}
                      </label>
                      {f.type === 'select' ? (
                        <select name={f.key} required={f.required}
                          style={{ padding: '11px 14px', fontSize: 14, borderRadius: 10, border: '1.5px solid rgba(0,0,0,0.08)', background: '#faf8f5', color: '#3d3833', outline: 'none', appearance: 'none', cursor: 'pointer', fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif" }}>
                          <option value="">--</option>
                          {f.options?.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : f.type === 'textarea' ? (
                        <textarea name={f.key} required={f.required} placeholder={f.placeholder}
                          rows={3} style={{ padding: '11px 14px', fontSize: 14, borderRadius: 10, border: '1.5px solid rgba(0,0,0,0.08)', background: '#faf8f5', color: '#3d3833', resize: 'vertical', outline: 'none', minHeight: 80, fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif" }} />
                      ) : (
                        <input name={f.key} type={f.type === 'number' ? 'number' : 'text'} required={f.required} placeholder={f.placeholder}
                          style={{ padding: '11px 14px', fontSize: 14, borderRadius: 10, border: '1.5px solid rgba(0,0,0,0.08)', background: '#faf8f5', color: '#3d3833', outline: 'none', fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif" }} />
                      )}
                    </div>
                  ))}
                  <button type="submit"
                    style={{
                      marginTop: 4, padding: '11px 28px', fontSize: 14, fontWeight: 600,
                      borderRadius: 10, border: 'none', cursor: 'pointer',
                      background: 'linear-gradient(135deg, #d4764e, #c9884a)', color: '#fff',
                      boxShadow: '0 1px 2px rgba(212,118,78,0.25)',
                      fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
                    }}>
                    {isZh ? '提交' : 'Submit'}
                  </button>
                </form>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* ── Composer ── */}
          <div style={{
            position: 'relative', zIndex: 1, flexShrink: 0,
            width: '100%', padding: '12px 16px 12px 24px',
          }}>
            {/* ── Attached image previews ── */}
            {attachedImages.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {attachedImages.map((img, idx) => (
                  <div key={idx} style={{ position: 'relative' }}>
                    <img
                      src={`data:${img.mimeType};base64,${img.base64}`}
                      alt={img.name}
                      title={img.name}
                      style={{
                        width: 56, height: 56, borderRadius: 8,
                        objectFit: 'cover', border: '1px solid var(--border-subtle)',
                      }}
                    />
                    <span style={{
                      position: 'absolute',
                      left: 4,
                      bottom: 4,
                      display: 'inline-flex',
                      width: 18,
                      height: 18,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: 999,
                      background: 'rgba(255,252,249,0.86)',
                      border: '1px solid rgba(212,118,78,0.14)',
                      color: '#b87347',
                      boxShadow: '0 4px 12px rgba(58,39,24,0.10)',
                    }}>
                      <OrganicLoader variant="17" size={13} title={isZh ? '图片已附加，等待发送' : 'Image attached and ready'} />
                    </span>
                    <button
                      onClick={() => removeImage(idx)}
                      style={{
                        position: 'absolute', top: -4, right: -4,
                        width: 16, height: 16, borderRadius: '50%',
                        background: 'var(--vermillion)', color: 'white',
                        border: 'none', cursor: 'pointer', fontSize: 9,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        lineHeight: 1,
                      }}
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div style={{
              display: 'flex', alignItems: 'flex-end', gap: 8,
              background: 'rgba(255,255,255,0.55)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              borderRadius: 18,
              border: '1px solid var(--border-subtle)',
              boxShadow: 'var(--shadow-card)',
              padding: 6,
              transition: 'border-color 0.2s, box-shadow 0.2s',
            }}
            onFocusCapture={() => {
              const el = composerRef.current?.parentElement
              if (el) { el.style.borderColor = 'var(--border-focus)'; el.style.boxShadow = 'var(--shadow-glow)' }
            }}
            onBlurCapture={() => {
              const el = composerRef.current?.parentElement
              if (el) { el.style.borderColor = 'var(--border-subtle)'; el.style.boxShadow = 'var(--shadow-card)' }
            }}
            >
              {/* ── Attach button ── */}
              <label
                title={canAttachImages
                  ? (isZh ? '附加图片，在当前运行路径上测试视觉输入。' : 'Attach images to test vision input on the selected runtime path.')
                  : visionSupport.note}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 36, height: 36, borderRadius: 12,
                  background: canAttachImages ? 'rgba(212,118,78,0.06)' : 'rgba(0,0,0,0.03)',
                  border: canAttachImages ? '1px solid rgba(212,118,78,0.12)' : '1px solid rgba(0,0,0,0.06)',
                  cursor: canAttachImages ? 'pointer' : 'not-allowed',
                  opacity: canAttachImages ? 1 : 0.35,
                  transition: 'all 0.15s',
                  flexShrink: 0,
                }}
              >
                <ImageIcon size={14} color={canAttachImages ? '#b87347' : 'var(--fog)'} />
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={!canAttachImages}
                  onChange={e => { if (e.target.files) { handleImageAttach(e.target.files); e.target.value = '' } }}
                  style={{ display: 'none' }}
                />
              </label>

              <textarea
                ref={composerRef}
                value={message}
                rows={1}
                onChange={e => {
                  setMessage(e.target.value)
                  syncComposerHeight()
                }}
                onKeyDown={handleComposerKeyDown}
                onCompositionStart={() => { composingRef.current = true }}
                onCompositionEnd={() => { composingRef.current = false }}
                onPaste={e => {
                  const items = e.clipboardData?.items
                  if (!items) return
                  const imageFiles: File[] = []
                  for (const item of Array.from(items)) {
                    if (item.type.startsWith('image/')) {
                      const file = item.getAsFile()
                      if (file) imageFiles.push(file)
                    }
                  }
                  if (imageFiles.length > 0) {
                    e.preventDefault()
                    if (!canAttachImages) {
                      setToastMessage(visionSupport.status === 'unknown'
                        ? (isZh ? '当前模型的图片输入支持状态未知，请先切到已确认支持视觉的模型再粘贴截图。' : 'Image input support is unknown for this model. Switch to a confirmed vision-capable model before pasting screenshots.')
                        : `${snapshot?.resolvedModelLabel || (isZh ? '当前模型' : 'This model')}${isZh ? ' 不支持图片输入，请先切到已确认支持视觉的模型再粘贴截图。' : ' does not support image input. Switch to a confirmed vision-capable model before pasting screenshots.'}`)
                      setTimeout(() => setToastMessage(''), 4000)
                      return
                    }
                    handleImageAttach(imageFiles)
                  }
                }}
                placeholder={responding ? (isZh ? '排队下一轮手动测试…' : 'Queue the next manual turn…') : (isZh ? '输入一轮手动运行时测试…' : 'Type a manual runtime test turn…')}
                style={{
                  flex: 1, border: 'none', background: 'transparent',
                  fontSize: 13, lineHeight: 1.55, color: 'var(--mist)',
                  outline: 'none', fontFamily: 'inherit',
                  padding: '10px 8px 10px 14px',
                  resize: 'none',
                  minHeight: 42,
                  maxHeight: 132,
                }}
              />
              <button
                type="button"
                aria-label={responding ? (isZh ? '排队手动运行时测试' : 'Queue manual runtime test turn') : (isZh ? '发送手动运行时测试' : 'Send manual runtime test turn')}
                onClick={submitManualTurn}
                disabled={!canSubmitManualTurn}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 40, height: 40, borderRadius: 14,
                  background: canSubmitManualTurn
                    ? responding
                      ? 'linear-gradient(145deg, #88a8ff, #6d86f2 52%, #5f6fe0)'
                      : 'linear-gradient(145deg, #82b0ff, #5b8af7 52%, #4d69dc)'
                    : 'rgba(0,0,0,0.06)',
                  border: canSubmitManualTurn ? '1px solid rgba(255,255,255,0.55)' : '1px solid rgba(0,0,0,0.04)',
                  boxShadow: canSubmitManualTurn
                    ? '0 10px 24px rgba(91,138,247,0.24), inset 0 1px 0 rgba(255,255,255,0.32), inset 0 -8px 16px rgba(55,84,176,0.2)'
                    : 'inset 0 1px 0 rgba(255,255,255,0.28)',
                  cursor: canSubmitManualTurn ? 'pointer' : 'default',
                  opacity: canSubmitManualTurn ? 1 : 0.4,
                  transform: canSubmitManualTurn ? 'translateY(-0.5px)' : 'none',
                  transition: 'all 0.18s ease',
                  flexShrink: 0,
                }}
                onMouseEnter={e => {
                  if (!canSubmitManualTurn) return
                  e.currentTarget.style.transform = 'translateY(-1.5px) scale(1.01)'
                  e.currentTarget.style.boxShadow = '0 14px 28px rgba(91,138,247,0.28), inset 0 1px 0 rgba(255,255,255,0.36), inset 0 -8px 16px rgba(55,84,176,0.22)'
                }}
                onMouseLeave={e => {
                  if (!canSubmitManualTurn) return
                  e.currentTarget.style.transform = 'translateY(-0.5px)'
                  e.currentTarget.style.boxShadow = '0 10px 24px rgba(91,138,247,0.24), inset 0 1px 0 rgba(255,255,255,0.32), inset 0 -8px 16px rgba(55,84,176,0.2)'
                }}
                onMouseDown={e => {
                  if (!canSubmitManualTurn) return
                  e.currentTarget.style.transform = 'translateY(0.5px) scale(0.985)'
                  e.currentTarget.style.boxShadow = '0 6px 14px rgba(91,138,247,0.2), inset 0 2px 6px rgba(55,84,176,0.24)'
                }}
                onMouseUp={e => {
                  if (!canSubmitManualTurn) return
                  e.currentTarget.style.transform = 'translateY(-1.5px) scale(1.01)'
                  e.currentTarget.style.boxShadow = '0 14px 28px rgba(91,138,247,0.28), inset 0 1px 0 rgba(255,255,255,0.36), inset 0 -8px 16px rgba(55,84,176,0.22)'
                }}
              >
                <Send size={14} color="white" style={{ transform: 'translateX(0.5px) rotate(-8deg)' }} />
              </button>
            </div>

            {/* ── Queued messages ── */}
            {queuedMessages.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                {queuedMessages.map((qm, idx) => (
                  <div key={idx} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '7px 12px', borderRadius: 10,
                    background: 'rgba(212,118,78,0.04)',
                    border: '1px dashed rgba(212,118,78,0.18)',
                    opacity: 0.7,
                  }}>
                    <div style={{
                      width: 5, height: 5, borderRadius: '50%',
                      background: '#d4764e', flexShrink: 0,
                      animation: 'pulse 1.5s ease-in-out infinite',
                    }} />
                    <span style={{
                      flex: 1, fontSize: 12, color: '#8a7e74',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
                    }}>
                      {qm.text}
                    </span>
                    <button
                      onClick={() => setQueuedMessages(prev => prev.filter((_, i) => i !== idx))}
                      style={{
                        flexShrink: 0, width: 18, height: 18, borderRadius: '50%',
                        border: 'none', cursor: 'pointer', fontSize: 10,
                        background: 'rgba(0,0,0,0.06)', color: '#b8a99a',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(230,69,57,0.12)'; e.currentTarget.style.color = '#e64539' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.06)'; e.currentTarget.style.color = '#b8a99a' }}
                      title={isZh ? '从队列移除' : 'Remove from queue'}
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* ── Toast ── */}
            {toastMessage && (
              <div style={{
                position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
                padding: '8px 16px', borderRadius: 10,
                background: savedChatId ? 'var(--malachite)' : toastMessage.includes('failed') || toastMessage.includes('exceeds') ? 'var(--vermillion)' : 'var(--malachite)',
                color: 'white',
                fontSize: 11, fontWeight: 500,
                whiteSpace: 'nowrap', boxShadow: savedChatId ? '0 4px 12px rgba(46,160,74,0.3)' : '0 4px 12px rgba(230,69,57,0.3)',
                marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8,
              }}>
                {toastMessage}
                {savedChatId && (toastMessage === 'Exported synthetic review transcript to Operate.' || toastMessage === '已将试跑评审副本导出到 Operate。') && (
                  <Link href={`/operate/conversations/${savedChatId}`} target="_blank" style={{ color: 'white', fontWeight: 600, textDecoration: 'underline', fontSize: 11 }}>
                    {isZh ? '在 Operate 打开' : 'Open in Operate'}
                  </Link>
                )}
              </div>
            )}

          </div>
        </div>

        {/* ── Sidebar (right) ── */}
        {shouldRenderTraceSidebar ? (
          <TraceSidebar
            collapsed={sidebarCollapsed}
            onCollapse={() => setSidebarCollapsed(true)}
            onExpand={() => setSidebarCollapsed(false)}
            liveTools={liveTools}
            turnTraces={turnTraces}
            turnTotalMs={turnTotalMs}
            sessionMetrics={sessionMetrics}
            expandedTurns={expandedTurns}
            expandedTools={expandedTools}
            onToggleTurn={(idx) => setExpandedTurns(prev => {
              const next = new Set(prev)
              if (next.has(idx)) next.delete(idx); else next.add(idx)
              return next
            })}
            onToggleTool={(key) => setExpandedTools(prev => {
              const next = new Set(prev)
              if (next.has(key)) next.delete(key); else next.add(key)
              return next
            })}
            responding={responding}
            onRerunWithMessage={runTurn}
            tb={tb}
          />
        ) : null}
      </div>
    </div>
    </>
  )
}

/* ── Tiny sub-components ── */

function ActionButton({
  active = false,
  children,
  disabled = false,
  onClick,
  title,
  tone = 'neutral',
}: {
  active?: boolean
  children: React.ReactNode
  disabled?: boolean
  onClick?: () => void | Promise<void>
  title?: string
  tone?: 'neutral' | 'danger'
}) {
  const textColor = tone === 'danger'
    ? (disabled ? 'var(--fog)' : 'var(--vermillion)')
    : active ? '#b87347' : 'var(--fog)'
  const borderColor = tone === 'danger'
    ? 'rgba(230,69,57,0.14)'
    : active ? 'rgba(212,118,78,0.16)' : 'var(--border-subtle)'
  const background = tone === 'danger'
    ? 'rgba(230,69,57,0.04)'
    : active ? 'rgba(212,118,78,0.07)' : 'rgba(255,255,255,0.72)'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        minHeight: 28,
        padding: '5px 9px',
        borderRadius: 10,
        border: `1px solid ${borderColor}`,
        background,
        color: textColor,
        fontSize: 10,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        flexShrink: 0,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        boxShadow: active ? '0 8px 20px rgba(212,118,78,0.07)' : '0 4px 14px rgba(58,39,24,0.035)',
      }}
    >
      {children}
    </button>
  )
}

function ToolbarMenuItem({
  active = false,
  danger = false,
  disabled = false,
  icon,
  interactive = true,
  label,
  onClick,
}: {
  active?: boolean
  danger?: boolean
  disabled?: boolean
  icon: React.ReactNode
  interactive?: boolean
  label: string
  onClick?: () => void | Promise<void>
}) {
  const textColor = danger
    ? (disabled ? 'var(--fog)' : 'var(--vermillion)')
    : active
      ? '#b87347'
      : 'var(--mist)'
  const background = active ? 'rgba(212,118,78,0.07)' : 'transparent'
  const cursor = interactive ? (disabled ? 'not-allowed' : 'pointer') : 'default'

  const sharedStyle = {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    minHeight: 34,
    padding: '7px 9px',
    borderRadius: 12,
    border: 'none',
    background,
    color: textColor,
    fontSize: 10.5,
    fontWeight: 600,
    textAlign: 'left' as const,
    cursor,
    opacity: disabled ? 0.45 : 1,
  }

  const content = (
    <>
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'currentColor',
      }}>
        {icon}
      </span>
      <span>{label}</span>
    </>
  )

  if (!interactive) {
    return <div style={sharedStyle}>{content}</div>
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={sharedStyle}
    >
      {content}
    </button>
  )
}

function InlineTruthPill({
  compact = false,
  label,
  value,
  tone = 'neutral',
}: {
  compact?: boolean
  label: string
  value: string
  tone?: 'neutral' | 'success' | 'warning'
}) {
  const textColor = tone === 'success'
    ? 'var(--malachite)'
    : tone === 'warning'
      ? 'var(--amber)'
      : 'var(--mist)'

  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: compact ? 4 : 8,
      minHeight: compact ? 20 : 30,
      padding: compact ? '2px 6px' : '6px 10px',
      borderRadius: 999,
      border: '1px solid rgba(212,118,78,0.08)',
      background: 'rgba(255,255,255,0.72)',
      fontSize: compact ? 9.5 : 11,
      lineHeight: 1.2,
      minWidth: 0,
      flexShrink: 0,
      whiteSpace: 'nowrap',
    }}>
      <span style={{
        fontSize: compact ? 6.5 : 9,
        fontWeight: 700,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: 'var(--fog)',
        opacity: 0.65,
      }}>
        {label}
      </span>
      <span style={{
        fontSize: compact ? 9.5 : 11,
        fontWeight: 600,
        color: textColor,
        minWidth: 0,
        whiteSpace: 'nowrap',
      }}>
        {value}
      </span>
    </div>
  )
}

function WorkspaceCard({
  title,
  icon,
  children,
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      padding: '14px 15px',
      borderRadius: 18,
      border: '1px solid rgba(212,118,78,0.08)',
      background: 'linear-gradient(180deg, rgba(255,255,255,0.82), rgba(255,252,249,0.74))',
      boxShadow: '0 16px 34px rgba(58,39,24,0.05)',
      minWidth: 0,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'var(--fog)',
        opacity: 0.75,
      }}>
        {icon}
        <span>{title}</span>
      </div>
      {children}
    </section>
  )
}

function WorkspaceMetricRow({
  label,
  mono = false,
  tone = 'neutral',
  value,
}: {
  label: string
  mono?: boolean
  tone?: 'neutral' | 'success' | 'warning'
  value: string
}) {
  const valueColor = tone === 'success'
    ? 'var(--malachite)'
    : tone === 'warning'
      ? 'var(--amber)'
      : 'var(--mist)'
  return (
    <div style={{ display: 'grid', gap: 3 }}>
      <div style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'var(--fog)',
        opacity: 0.6,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 12,
        fontWeight: 600,
        color: valueColor,
        fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
        lineHeight: 1.55,
        wordBreak: mono ? 'break-all' : 'break-word',
      }}>
        {value}
      </div>
    </div>
  )
}

function WorkspaceNote({
  children,
  label,
}: {
  children: React.ReactNode
  label: string
}) {
  return (
    <div style={{
      padding: '9px 10px',
      borderRadius: 12,
      background: 'rgba(255,252,249,0.72)',
      border: '1px solid rgba(212,118,78,0.08)',
    }}>
      <div style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'var(--fog)',
        opacity: 0.6,
        marginBottom: 4,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 11,
        color: 'var(--fog)',
        lineHeight: 1.6,
      }}>
        {children}
      </div>
    </div>
  )
}

function DebugDigestList({
  items,
  emptyLabel,
}: {
  items: string[]
  emptyLabel: string
}) {
  if (items.length === 0) {
    return <span>{emptyLabel}</span>
  }

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {items.map((item) => (
        <div
          key={item}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 7,
          }}
        >
          <span
            style={{
              marginTop: 6,
              height: 5,
              width: 5,
              flexShrink: 0,
              borderRadius: '50%',
              background: 'rgba(212,118,78,0.72)',
            }}
          />
          <span>{item}</span>
        </div>
      ))}
    </div>
  )
}

function ToneBadge({
  children,
  tone,
}: {
  children: React.ReactNode
  tone: 'neutral' | 'success' | 'warning'
}) {
  const colors = tone === 'success'
    ? {
        color: 'var(--malachite)',
        background: 'rgba(46,160,74,0.08)',
        border: '1px solid rgba(46,160,74,0.14)',
      }
    : tone === 'warning'
      ? {
          color: 'var(--amber)',
          background: 'rgba(212,145,46,0.08)',
          border: '1px solid rgba(212,145,46,0.16)',
        }
      : {
          color: 'var(--fog)',
          background: 'rgba(0,0,0,0.03)',
          border: '1px solid rgba(0,0,0,0.06)',
        }

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 8px',
      borderRadius: 999,
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      ...colors,
    }}>
      {children}
    </span>
  )
}

function SidebarSection({
  title, icon, count, maxHeight, flex, onCollapse, collapsed, children,
}: {
  title: string
  icon: React.ReactNode
  count?: number
  maxHeight?: number
  flex?: number
  onCollapse?: () => void
  collapsed?: boolean
  children: React.ReactNode
}) {
  return (
    <section style={{
      display: 'flex', flexDirection: 'column',
      borderBottom: '1px solid var(--border-subtle)',
      maxHeight, flex, minHeight: 0, overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '12px 16px 8px',
        fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
        letterSpacing: '0.08em', color: 'var(--fog)', opacity: 0.55,
        flexShrink: 0,
      }}>
        {icon}
        <span>{title}</span>
        {typeof count === 'number' && count > 0 && (
          <span style={{
            marginLeft: 4, fontSize: 9, fontWeight: 600,
            color: '#b87347',
            background: 'rgba(212,118,78,0.08)',
            padding: '1px 6px', borderRadius: 6,
            textTransform: 'none', letterSpacing: 0, opacity: 1,
          }}>
            {count}
          </span>
        )}
        {onCollapse && (
          <button
            onClick={onCollapse}
            style={{
              marginLeft: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 20, height: 20, borderRadius: 6,
              border: '1px solid var(--border-subtle)', background: 'rgba(255,255,255,0.6)',
              cursor: 'pointer', padding: 0, flexShrink: 0,
            }}
            title={collapsed ? 'Expand trace panel' : 'Collapse trace panel'}
          >
            {collapsed ? <ChevronLeft size={10} color="var(--fog)" /> : <ChevronRight size={10} color="var(--fog)" />}
          </button>
        )}
      </div>
      <div style={{
        flex: 1, minHeight: 0, overflowY: 'auto',
        padding: '0 12px 12px',
      }}>
        {children}
      </div>
    </section>
  )
}

function SidebarEmpty({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontSize: 11, color: 'var(--fog)', opacity: 0.4,
      margin: 0, textAlign: 'center', padding: '12px 4px',
      lineHeight: 1.5,
    }}>
      {children}
    </p>
  )
}

function PromptViewer({ systemPrompt, messages }: { systemPrompt: string; messages: unknown[] }) {
  return (
    <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {systemPrompt && (
        <details style={{ fontSize: 10 }}>
          <summary style={{
            fontWeight: 600, color: '#b87347',
            cursor: 'pointer', opacity: 0.8,
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            System prompt ({systemPrompt.length.toLocaleString()} chars)
            <CopyButton text={systemPrompt} label="Copy system prompt" />
          </summary>
          <pre style={{
            maxWidth: 280, maxHeight: 160, overflow: 'auto',
            fontSize: 9, color: 'var(--fog)',
            background: 'rgba(255,255,255,0.95)', border: '1px solid var(--border-subtle)',
            borderRadius: 8, padding: '6px 10px', marginTop: 4,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {systemPrompt}
          </pre>
        </details>
      )}
      {messages.length > 0 && (
        <details style={{ fontSize: 10 }}>
          <summary style={{
            fontWeight: 600, color: '#b87347',
            cursor: 'pointer', opacity: 0.8,
          }}>
            Messages ({messages.length})
          </summary>
          <div style={{
            maxWidth: 280, maxHeight: 200, overflow: 'auto',
            display: 'flex', flexDirection: 'column', gap: 4,
            background: 'rgba(255,255,255,0.95)', border: '1px solid var(--border-subtle)',
            borderRadius: 8, padding: '6px 8px', marginTop: 4,
          }}>
            {messages.map((m: any, idx: number) => (
              <div key={idx} style={{
                padding: '3px 6px', borderRadius: 6,
                background: m.role === 'user' ? 'rgba(212,118,78,0.06)' : 'rgba(0,0,0,0.03)',
                fontSize: 9,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                  <span style={{
                    fontWeight: 600, color: 'var(--fog)',
                    textTransform: 'uppercase', fontSize: 8,
                    opacity: 0.5,
                  }}>
                    {typeof m.role === 'string' ? m.role : 'unknown'}
                  </span>
                  <CopyButton text={typeof m.content === 'string' ? m.content : JSON.stringify(m.content)} label={`Copy ${typeof m.role === 'string' ? m.role : 'unknown'} message`} />
                </div>
                <span style={{ color: 'var(--mist)' }}>
                  {(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).slice(0, 160)}
                  {(typeof m.content === 'string' && m.content.length > 160) ? '...' : ''}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
