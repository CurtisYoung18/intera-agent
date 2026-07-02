'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BarChart3, ChevronDown, Clock, Cpu, MessageSquare, User, Wrench, Zap } from 'lucide-react'
import OrganicLoader from '@intera/shared/ui/organic-loader'
import MessageContent from '@/components/chat/message-content'
import { CaseTraceTimeline, type TraceRow } from '@/components/ops/case-trace-view'
import SourceTruthPill from '@/components/operate/source-truth-pill'
import { useConsoleLocale } from '@/components/locale-provider'
import { ConsoleBackButton } from '@/components/ui/console-chrome'
import { apiClient } from '@/lib/api/client'
import { useAgentContext } from '@/lib/agent/agent-context'
import { summarizeConversationSourceTruth, summarizeToolPairing } from '@/lib/operate/runtime-truth'
import {
  hasRecognizedTokenUsage,
  readCacheReadTokens,
  readCacheWriteTokens,
  readInputTokens,
  readOutputTokens,
} from '@/lib/agent/usage-accounting'
import type { ContentBlock } from '@intera/shared/types'

interface CaseSummary {
  id: string
  runId?: string | null
  type: string
  status: string
  source: string
  goal: string | null
  createdAt: string
  updatedAt: string
  _count?: { messages: number }
}

interface ChatSession {
  chatId: string
  userId: string
  cases: CaseSummary[]
  messageCount: number
  lastActivity: string
  hasHumanTask: boolean
  externalChatId?: string | null
}

interface MsgItem {
  id: string
  role: string
  content: string
  createdAt: string
  contentBlocks?: ContentBlock[]
  runId?: string | null
  procedureType?: string
  procedureStatus?: string
}

interface ToolCall {
  name: string
  input: Record<string, unknown> | null
  output: Record<string, unknown> | null
  latencyMs: number | null
  createdAt: string
  iteration?: number | null
}

interface IterationMetrics {
  iteration: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  llmWallMs: number
  toolsWallMs: number
  toolCount: number
  model?: string
}

function fmtTime(iso: string, locale: 'zh' | 'en'): string {
  return new Date(iso).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}

function parseJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

function buildConversationAnalysis(traces: TraceRow[]) {
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let llmCalls = 0
  let totalWallMs = 0
  let firstTs: number | null = null
  let lastTs: number | null = null
  const toolCalls: ToolCall[] = []
  const iterMetrics = new Map<number, IterationMetrics>()

  for (const trace of traces) {
    const ts = new Date(trace.createdAt).getTime()
    if (firstTs == null || ts < firstTs) firstTs = ts
    if (lastTs == null || ts > lastTs) lastTs = ts

    const payload = parseJson(trace.payload)

    if (
      trace.actionType === 'llm_response' &&
      hasRecognizedTokenUsage((payload?.usage ?? null) as Record<string, unknown> | null) &&
      typeof payload?.iteration === 'number'
    ) {
      const usage = payload.usage as Record<string, unknown>
      const iteration = payload.iteration as number
      inputTokens += readInputTokens(usage)
      outputTokens += readOutputTokens(usage)
      cacheReadTokens += readCacheReadTokens(usage)
      cacheWriteTokens += readCacheWriteTokens(usage)
      llmCalls++

      const current = iterMetrics.get(iteration) ?? {
        iteration,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        llmWallMs: 0,
        toolsWallMs: 0,
        toolCount: 0,
      }
      current.inputTokens += readInputTokens(usage)
      current.outputTokens += readOutputTokens(usage)
      current.cacheReadTokens += readCacheReadTokens(usage)
      current.model = (payload.model as string) || current.model
      iterMetrics.set(iteration, current)
    }

    if (trace.actionType === 'tool_result' && payload) {
      const detail = parseJson(trace.detail)
      const iteration = typeof payload.iteration === 'number' ? (payload.iteration as number) : null
      toolCalls.push({
        name: (payload.toolName as string) || trace.title,
        input: (payload.input ?? detail) as Record<string, unknown> | null,
        output: (payload.output ?? payload.result) as Record<string, unknown> | null,
        latencyMs: typeof payload.latencyMs === 'number' ? payload.latencyMs : null,
        createdAt: trace.createdAt,
        iteration,
      })

      if (iteration != null) {
        const current = iterMetrics.get(iteration) ?? {
          iteration,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          llmWallMs: 0,
          toolsWallMs: 0,
          toolCount: 0,
        }
        current.toolCount++
        if (typeof payload.latencyMs === 'number') current.toolsWallMs += payload.latencyMs
        iterMetrics.set(iteration, current)
      }
    }

    if (trace.actionType === 'loop_decision' && payload && typeof payload.iteration === 'number') {
      const iteration = payload.iteration as number
      const current = iterMetrics.get(iteration) ?? {
        iteration,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        llmWallMs: 0,
        toolsWallMs: 0,
        toolCount: 0,
      }
      current.llmWallMs = (payload.llmWallMs as number) || current.llmWallMs
      if (typeof payload.toolsWallMs === 'number' && current.toolsWallMs === 0) {
        current.toolsWallMs = payload.toolsWallMs
      }
      iterMetrics.set(iteration, current)
    }
  }

  if (firstTs != null && lastTs != null) totalWallMs = lastTs - firstTs

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    llmCalls,
    totalWallMs,
    totalTokens: inputTokens + outputTokens,
    toolCalls,
    iterMetrics: Array.from(iterMetrics.values()).sort((a, b) => a.iteration - b.iteration),
  }
}

export default function ConversationAnalysisWorkspace({ chatId }: { chatId: string }) {
  const decodedChatId = decodeURIComponent(chatId)
  const router = useRouter()
  const { t, locale } = useConsoleLocale()
  const { selectedAgentId, loading: agentLoading } = useAgentContext()
  const isZh = locale === 'zh'

  const [session, setSession] = useState<ChatSession | null>(null)
  const [resolvedChatId, setResolvedChatId] = useState(decodedChatId)
  const [traces, setTraces] = useState<TraceRow[]>([])
  const [messages, setMessages] = useState<MsgItem[]>([])
  const [loading, setLoading] = useState(true)
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [messagesLoaded, setMessagesLoaded] = useState(false)
  const [showMessages, setShowMessages] = useState(false)
  const [showTraces, setShowTraces] = useState(true)

  const activeChatId = resolvedChatId || decodedChatId
  const withAgent = useCallback((path: string) => {
    if (!selectedAgentId) return path
    return `${path}${path.includes('?') ? '&' : '?'}agentId=${encodeURIComponent(selectedAgentId)}`
  }, [selectedAgentId])

  useEffect(() => {
    if (agentLoading) return
    if (!selectedAgentId) {
      setSession(null)
      setMessages([])
      setTraces([])
      setLoading(false)
      return
    }

    async function load() {
      setLoading(true)
      try {
        const detail = await apiClient<{
          session: ChatSession
          requestedChatId: string
          resolvedChatId: string
          externalChatId?: string | null
        }>(withAgent(`/api/chats/${encodeURIComponent(decodedChatId)}`))
        const found = detail.data.session
        const canonicalChatId = detail.data.resolvedChatId || found.chatId
        setSession(found)
        setResolvedChatId(canonicalChatId)
        setMessages([])
        setMessagesLoaded(false)
        setShowMessages(false)

        const tracesResult = await apiClient<{ traces: TraceRow[] }>(
          withAgent(`/api/chats/${encodeURIComponent(canonicalChatId)}/traces?limit=500&payloadMode=summary`),
        )
        setTraces(tracesResult.data.traces ?? [])
      } catch (error) {
        console.error('Conversation analysis load failed:', error)
        setSession(null)
        setMessages([])
        setTraces([])
        setMessagesLoaded(false)
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [agentLoading, decodedChatId, selectedAgentId, withAgent])

  useEffect(() => {
    if (!showMessages || messagesLoaded || messagesLoading || !selectedAgentId || !activeChatId) return

    async function loadMessages() {
      setMessagesLoading(true)
      try {
        const messagesResult = await apiClient<{ messages: MsgItem[] }>(
          withAgent(`/api/chats/${encodeURIComponent(activeChatId)}/messages?limit=500`),
        )
        setMessages((messagesResult.data.messages ?? []).sort((a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        ))
        setMessagesLoaded(true)
      } catch (error) {
        console.error('Conversation analysis messages load failed:', error)
        setMessages([])
      } finally {
        setMessagesLoading(false)
      }
    }

    void loadMessages()
  }, [activeChatId, messagesLoaded, messagesLoading, selectedAgentId, showMessages, withAgent])

  const analysis = useMemo(() => buildConversationAnalysis(traces), [traces])
  const conversationTruth = useMemo(
    () =>
      summarizeConversationSourceTruth(
        (session?.cases ?? []).map((caseItem) => ({ source: caseItem.source, userId: session?.userId })),
      ),
    [session],
  )
  const toolPairing = useMemo(
    () =>
      summarizeToolPairing(
        traces.map((trace) => ({
          actionType: trace.actionType,
          title: trace.title,
          detail: trace.detail,
          payload: trace.payload,
        })),
      ),
    [traces],
  )

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <OrganicLoader icon="spin" size={28} className="text-indigo/60" />
      </div>
    )
  }

  if (!session) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <p className="text-[var(--fog)]">{isZh ? '未找到会话分析' : 'Conversation analysis not found'}</p>
        <button onClick={() => router.back()} className="text-sm text-indigo hover:underline">
          {isZh ? '返回' : 'Go back'}
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-[1320px] flex-col gap-4 px-4 py-5 sm:px-6 lg:px-8">
      <header className="sticky top-0 z-30 rounded-[26px] border border-black/[0.06] bg-white/[0.68] px-4 py-4 shadow-[var(--shadow-card)] backdrop-blur-xl sm:px-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <ConsoleBackButton
              label={isZh ? '会话' : 'Conversation'}
              ariaLabel={isZh ? '返回会话' : 'Back to conversation'}
              onClick={() => router.push(withAgent(`/operate/conversations/${encodeURIComponent(activeChatId)}`))}
            />
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#357f7c]">
                {isZh ? '会话运行分析' : 'Chat Run Analysis'}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <h1 className="truncate text-[16px] font-semibold tracking-tight text-[var(--mist)]">
                  {isZh ? '整个 Chat 的调用与证据' : 'Whole-chat calls and evidence'}
                </h1>
                <SourceTruthPill truth={conversationTruth} />
              </div>
              <p className="mt-1 text-[12px] text-[var(--fog)]/78">
                {session.cases.length} {isZh ? '个流程记录' : 'flow records'} · {session.messageCount} {isZh ? '条消息' : 'messages'} · {traces.length} {isZh ? '个事件' : 'events'} · {analysis.toolCalls.length} {isZh ? '次工具调用' : 'tool calls'}
              </p>
            </div>
          </div>
        </div>
      </header>

      {analysis.llmCalls > 0 || analysis.toolCalls.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard icon={<Cpu className="h-3.5 w-3.5" />} label={isZh ? 'LLM 调用' : 'LLM Calls'} value={String(analysis.llmCalls)} />
          <MetricCard icon={<Zap className="h-3.5 w-3.5" />} label={isZh ? 'Token' : 'Tokens'} value={fmtTokens(analysis.totalTokens)} />
          <MetricCard icon={<Clock className="h-3.5 w-3.5" />} label={isZh ? '总跨度' : 'Wall Span'} value={fmtMs(analysis.totalWallMs)} />
          <MetricCard icon={<Wrench className="h-3.5 w-3.5" />} label={isZh ? '工具调用' : 'Tool Calls'} value={String(analysis.toolCalls.length)} />
        </div>
      ) : null}

      {analysis.llmCalls > 0 ? (
        <section className="rounded-2xl border border-indigo/[0.08] bg-white/70 p-5">
          <h2 className="text-[13px] font-bold text-[var(--mist)]">{isZh ? 'Token 与耗时' : 'Token and timing'}</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={isZh ? '输入 Token' : 'Input Tokens'} value={analysis.inputTokens.toLocaleString()} />
            <Stat label={isZh ? '输出 Token' : 'Output Tokens'} value={analysis.outputTokens.toLocaleString()} />
            <Stat label={isZh ? '缓存命中' : 'Cache Read'} value={analysis.cacheReadTokens.toLocaleString()} />
            <Stat label={isZh ? '缓存写入' : 'Cache Write'} value={analysis.cacheWriteTokens.toLocaleString()} />
            <Stat label={isZh ? '每次平均 Token' : 'Avg Tokens/Call'} value={analysis.llmCalls > 0 ? (analysis.totalTokens / analysis.llmCalls).toFixed(0) : '0'} />
            <Stat label={isZh ? '每次平均输出' : 'Avg Output/Call'} value={analysis.llmCalls > 0 ? (analysis.outputTokens / analysis.llmCalls).toFixed(0) : '0'} />
            <Stat label={isZh ? '每秒 Token' : 'Tokens/sec'} value={analysis.totalWallMs > 0 ? (analysis.outputTokens / (analysis.totalWallMs / 1000)).toFixed(0) : '0'} />
          </div>
        </section>
      ) : null}

      {analysis.iterMetrics.length > 0 ? (
        <section className="rounded-2xl border border-black/[0.06] bg-white/60 p-4">
          <h2 className="mb-3 text-[13px] font-bold text-[var(--mist)]">{isZh ? '按轮次明细' : 'Per-turn detail'}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-black/[0.06] text-left text-[var(--fog)]/60">
                  <th className="pb-2 pr-3 font-medium">{isZh ? '轮次' : 'Turn'}</th>
                  <th className="pb-2 pr-3 font-medium">{isZh ? '模型' : 'Model'}</th>
                  <th className="pb-2 pr-3 text-right font-medium">{isZh ? '输入' : 'Input'}</th>
                  <th className="pb-2 pr-3 text-right font-medium">{isZh ? '输出' : 'Output'}</th>
                  <th className="pb-2 pr-3 text-right font-medium">{isZh ? '缓存' : 'Cache'}</th>
                  <th className="pb-2 pr-3 text-right font-medium">{isZh ? 'LLM' : 'LLM'}</th>
                  <th className="pb-2 pr-3 text-right font-medium">{isZh ? '工具' : 'Tools'}</th>
                  <th className="pb-2 pr-3 text-right font-medium">{isZh ? '次数' : 'Calls'}</th>
                </tr>
              </thead>
              <tbody>
                {analysis.iterMetrics.map((item) => (
                  <tr key={item.iteration} className="border-b border-black/[0.03] hover:bg-black/[0.01]">
                    <td className="py-2 pr-3 font-mono text-indigo">{`#${item.iteration}`}</td>
                    <td className="max-w-[160px] truncate py-2 pr-3 text-[var(--fog)]/70">{item.model || '-'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{item.inputTokens.toLocaleString()}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{item.outputTokens.toLocaleString()}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{item.cacheReadTokens > 0 ? item.cacheReadTokens.toLocaleString() : '-'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{item.llmWallMs > 0 ? fmtMs(item.llmWallMs) : '-'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{item.toolsWallMs > 0 ? fmtMs(item.toolsWallMs) : '-'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{item.toolCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {analysis.toolCalls.length > 0 ? (
        <section className="rounded-2xl border border-black/[0.06] bg-white/60 p-4">
          <p className={`mb-3 rounded-xl border px-3 py-2 text-[11px] ${
            toolPairing.tone === 'warning'
              ? 'border-amber/18 bg-amber/[0.06] text-amber'
              : 'border-black/[0.05] bg-white/50 text-[var(--fog)]'
          }`}>
            {locale === 'zh' ? toolPairing.labelZh : toolPairing.label}
          </p>
          <h2 className="mb-3 text-[13px] font-bold text-[var(--mist)]">
            {isZh ? `工具调用 (${analysis.toolCalls.length})` : `Tool calls (${analysis.toolCalls.length})`}
          </h2>
          <div className="space-y-2">
            {analysis.toolCalls.map((toolCall, index) => (
              <ToolCallCard key={`${toolCall.name}-${toolCall.createdAt}-${index}`} toolCall={toolCall} locale={locale} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-black/[0.06] bg-white/60 p-4">
        <button
          onClick={() => setShowTraces((open) => !open)}
          className="mb-2 flex w-full items-center gap-2 text-left"
          type="button"
        >
          <ChevronDown className={`h-4 w-4 text-[var(--fog)]/60 transition-transform ${showTraces ? '' : '-rotate-90'}`} />
          <h2 className="text-[13px] font-bold text-[var(--mist)]">
            {isZh ? `完整时间线与证据 (${traces.length})` : `Full timeline and evidence (${traces.length})`}
          </h2>
        </button>
        {showTraces ? (
          traces.length > 0 ? (
            <div className="max-h-[560px] overflow-auto">
              <CaseTraceTimeline traces={traces} t={t as any} />
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-black/[0.08] px-4 py-8 text-center text-[12px] text-[var(--fog)]">
              {isZh ? '这个会话还没有 trace 事件。' : 'This chat has no trace events yet.'}
            </p>
          )
        ) : null}
      </section>

      <section className="rounded-2xl border border-black/[0.06] bg-white/60 p-4">
        <button
          onClick={() => setShowMessages((open) => !open)}
          className="mb-2 flex w-full items-center gap-2 text-left"
          type="button"
        >
          <ChevronDown className={`h-4 w-4 text-[var(--fog)]/60 transition-transform ${showMessages ? '' : '-rotate-90'}`} />
          <h2 className="text-[13px] font-bold text-[var(--mist)]">
            {isZh ? `会话消息 (${messagesLoaded ? messages.length : session.messageCount})` : `Conversation messages (${messagesLoaded ? messages.length : session.messageCount})`}
          </h2>
        </button>
        {showMessages ? (
          messagesLoading ? (
            <div className="flex items-center justify-center rounded-xl border border-dashed border-black/[0.08] px-4 py-8">
              <OrganicLoader icon="spin" size={18} className="text-indigo/60" />
            </div>
          ) : (
            <div className="max-h-[420px] space-y-3 overflow-auto">
              {messages.map((message) => (
                <div key={message.id} className={`flex gap-2 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] ${
                    message.role === 'user' ? 'bg-indigo/20 text-indigo' : 'bg-black/[0.04] text-[var(--fog)]'
                  }`}>
                    {message.role === 'user' ? <User className="h-3 w-3" /> : <MessageSquare className="h-3 w-3" />}
                  </div>
                  <div className={`min-w-0 max-w-[80%] rounded-xl px-3 py-2 text-[12px] leading-relaxed ${
                    message.role === 'user' ? 'bg-indigo/[0.06]' : 'border border-black/[0.05] bg-white/80'
                  }`}>
                    <MessageContent content={message.content} contentBlocks={message.contentBlocks} imagePreviewMode="auto" />
                    <span className="mt-1 block text-[9px] text-[var(--fog)]/50">{fmtTime(message.createdAt, locale)}</span>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : null}
      </section>
    </div>
  )
}

function ToolCallCard({ toolCall, locale }: { toolCall: ToolCall; locale: 'zh' | 'en' }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="overflow-hidden rounded-lg border border-black/[0.04] bg-white/40">
      <button
        onClick={() => setExpanded((open) => !open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-black/[0.01]"
        type="button"
      >
        <Wrench className="h-3 w-3 text-[var(--fog)]/60" />
        <span className="text-[12px] font-medium text-[var(--mist)]">{toolCall.name}</span>
        {toolCall.iteration != null ? <span className="rounded-md bg-black/[0.04] px-1.5 py-0.5 text-[10px] text-[var(--fog)]">#{toolCall.iteration}</span> : null}
        {toolCall.latencyMs != null ? (
          <span className="ml-auto text-[10px] text-[var(--fog)]/50">{fmtMs(toolCall.latencyMs)}</span>
        ) : null}
        <ChevronDown className={`h-3 w-3 text-[var(--fog)]/40 transition-transform ${expanded ? '' : '-rotate-90'}`} />
      </button>
      {expanded ? (
        <div className="space-y-2 border-t border-black/[0.04] px-3 py-2 text-[11px]">
          {toolCall.input ? <JsonBlock label={locale === 'zh' ? 'Input' : 'Input'} value={toolCall.input} /> : null}
          {toolCall.output ? <JsonBlock label={locale === 'zh' ? 'Output' : 'Output'} value={toolCall.output} /> : null}
          <span className="text-[9px] text-[var(--fog)]/40">{fmtTime(toolCall.createdAt, locale)}</span>
        </div>
      ) : null}
    </div>
  )
}

function JsonBlock({ label, value }: { label: string; value: Record<string, unknown> }) {
  return (
    <div>
      <span className="font-medium text-[var(--fog)]/60">{label}:</span>
      <pre className="mt-0.5 max-h-[220px] overflow-auto whitespace-pre-wrap break-words rounded bg-black/[0.02] p-2 font-mono text-[10px]">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}

function MetricCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-black/[0.05] bg-white/60 px-3 py-2.5">
      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo/[0.08] text-indigo">{icon}</div>
      <div>
        <p className="text-[10px] text-[var(--fog)]">{label}</p>
        <p className="text-[13px] font-semibold text-[var(--mist)]">{value}</p>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-black/[0.04] bg-white/40 px-3 py-2">
      <p className="text-[10px] text-[var(--fog)]">{label}</p>
      <p className="text-[14px] font-semibold text-[var(--mist)]">{value}</p>
    </div>
  )
}
