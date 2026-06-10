'use client'

import { useMemo, useState, type ReactNode } from 'react'
import type { TranslateFn } from '@/lib/i18n/types'
import { ACCENTS } from '@/components/chat/status-accents'
import { classifyOperateTrace } from '@/lib/operate/runtime-truth'
import {
  ChevronDown,
  MessageSquare,
  Zap,
  Clock,
} from 'lucide-react'

export interface TraceRow {
  id: string
  actionType: string
  title: string
  detail: string | null
  payload: string | null
  createdAt: string
}


function parsePayload(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

function parseTracePayload(trace: TraceRow): Record<string, unknown> | null {
  return parsePayload(trace.payload) ?? parsePayload(trace.detail)
}

function normalizeTraceActionType(actionType: string): string {
  return actionType
}

function formatClock(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatStatusLabel(status: string): string {
  return status === 'block' ? 'blocked' : status === 'warn' ? 'warning' : status
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

function humanizeKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^\w/, (c) => c.toUpperCase())
}

function JsonValuePreview({
  value,
  depth,
  maxDepth,
  moreItemsLabel,
}: {
  value: unknown
  depth: number
  maxDepth: number
  moreItemsLabel: (n: number) => string
}): ReactNode {
  if (value === null) return <span className="text-[var(--smoke)]/70">null</span>
  if (typeof value === 'boolean') return <span className="tabular-nums text-[var(--mist)]">{String(value)}</span>
  if (typeof value === 'number')
    return <span className="tabular-nums text-[var(--mist)]">{value.toLocaleString()}</span>
  if (typeof value === 'string') {
    const trimmed = value.length > 280 ? `${value.slice(0, 280)}…` : value
    return (
      <span className="whitespace-pre-wrap break-words text-[13px] leading-snug text-[var(--mist)]/85">{trimmed}</span>
    )
  }
  if (Array.isArray(value)) {
    if (depth >= maxDepth)
      return <span className="text-[11px] text-[var(--fog)]">[{value.length} items]</span>
    if (value.length === 0) return <span className="text-[var(--smoke)]/60">[]</span>
    return (
      <ul className="mt-1 space-y-1 border-l border-black/[0.06] pl-3">
        {value.slice(0, 12).map((item, i) => (
          <li key={i} className="text-[12px]">
            <JsonValuePreview value={item} depth={depth + 1} maxDepth={maxDepth} moreItemsLabel={moreItemsLabel} />
          </li>
        ))}
        {value.length > 12 && (
          <li className="text-[11px] text-[var(--fog)]">{moreItemsLabel(value.length - 12)}</li>
        )}
      </ul>
    )
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
    if (depth >= maxDepth)
      return <span className="text-[11px] text-[var(--fog)]">{`{${entries.length} fields}`}</span>
    return (
      <dl className="mt-1 space-y-2 border-l border-black/[0.06] pl-3">
        {entries.map(([k, v]) => (
          <div key={k}>
            <dt className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--fog)]">{humanizeKey(k)}</dt>
                <dd className="mt-0.5">
                  <JsonValuePreview value={v} depth={depth + 1} maxDepth={maxDepth} moreItemsLabel={moreItemsLabel} />
                </dd>
          </div>
        ))}
      </dl>
    )
  }
  return <span className="text-[var(--smoke)]">—</span>
}

export function StructuredDataPanel({
  data,
  label,
  defaultOpen,
  fieldCountLabel,
  moreItemsLabel,
  embedded,
}: {
  data: Record<string, unknown>
  label: string
  defaultOpen: boolean
  fieldCountLabel: (n: number) => string
  moreItemsLabel: (n: number) => string
  embedded?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const keys = Object.keys(data)

  return (
    <div
      className={`${embedded ? 'mt-0' : 'mt-3'} overflow-hidden rounded-xl border border-black/[0.06] bg-white/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]`}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-black/[0.02]"
      >
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--fog)]">{label}</span>
        <span className="flex items-center gap-1.5 text-[10px] text-[var(--smoke)]">
          {fieldCountLabel(keys.length)}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
        </span>
      </button>
      {open && (
        <div className="border-t border-black/[0.05] px-3 py-3">
          <dl className="space-y-3">
            {keys.map((k) => (
              <div key={k} className="rounded-lg bg-black/[0.02] px-2.5 py-2">
                <dt className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--fog)]">
                  {humanizeKey(k)}
                </dt>
                <dd className="mt-1.5">
                  <JsonValuePreview value={data[k]} depth={0} maxDepth={4} moreItemsLabel={moreItemsLabel} />
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  )
}

function LlmSummary({ payload }: { payload: Record<string, unknown> }) {
  const model = typeof payload.model === 'string' ? payload.model : null
  const stop = typeof payload.stop_reason === 'string' ? payload.stop_reason : null
  const u = payload.usage as Record<string, number | undefined> | undefined
  const inTok = u?.input_tokens ?? u?.inputTokens
  const outTok = u?.output_tokens ?? u?.outputTokens

  if (!model && !stop && (inTok == null && outTok == null)) return null

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {model && (
        <span className="inline-flex items-center rounded-lg border border-indigo/15 bg-indigo/[0.06] px-2.5 py-1 text-[11px] font-medium text-[var(--mist)]/90">
          {model}
        </span>
      )}
      {stop && (
        <span className="inline-flex items-center rounded-lg border border-black/[0.06] bg-white/50 px-2.5 py-1 text-[11px] text-[var(--fog)]">
          {humanizeKey(stop)}
        </span>
      )}
      {(inTok != null || outTok != null) && (
        <span className="inline-flex items-center gap-2 rounded-lg border border-indigo/12 bg-white/55 px-2.5 py-1 text-[11px] tabular-nums text-indigo/90">
          {inTok != null && (
            <span className="inline-flex items-center gap-1">
              <Zap className="h-3 w-3 opacity-70" aria-hidden />
              in {fmtNum(inTok)}
            </span>
          )}
          {outTok != null && (
            <span className="inline-flex items-center gap-1">
              <Zap className="h-3 w-3 opacity-70" aria-hidden />
              out {fmtNum(outTok)}
            </span>
          )}
        </span>
      )}
    </div>
  )
}

function fmtLatency(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(1)}s`
  return `${ms}ms`
}

export function CaseTraceTimeline({
  traces,
  t,
  groupByIteration = true,
}: {
  traces: TraceRow[]
  t: TranslateFn
  groupByIteration?: boolean
}) {
  const lineStyle = useMemo(
    () => ({
      background: 'linear-gradient(180deg, rgba(91,138,247,0.2) 0%, rgba(139,111,245,0.08) 45%, rgba(160,152,136,0.12) 100%)',
    }),
    [],
  )

  const fieldCountLabel = (n: number) => t('caseDetail.fieldCount', { n })
  const moreItemsLabel = (n: number) => t('caseDetail.moreItems', { n })

  // ── Iteration grouping ──
  const iterationGroups = useMemo(() => {
    if (!groupByIteration) return null

    const groups = new Map<number, { traces: TraceRow[]; snapshot: Record<string, unknown> | null }>()
    const unassigned: TraceRow[] = []

    // Find iteration snapshots and build groups
    for (const trace of traces) {
      const payload = parseTracePayload(trace)
      if (trace.actionType === 'loop_decision' && trace.title === 'Iteration Snapshot' && payload && typeof payload.iteration === 'number') {
        const iter = payload.iteration as number
        if (!groups.has(iter)) {
          groups.set(iter, { traces: [], snapshot: payload })
        } else {
          groups.get(iter)!.snapshot = payload
        }
      }
    }

    // Assign traces to iterations (indexed scan — avoids O(n²) indexOf per row)
    for (let i = 0; i < traces.length; i++) {
      const trace = traces[i]
      const payload = parseTracePayload(trace)
      let iter: number | null = null

      if (payload && typeof payload.iteration === 'number') {
        iter = payload.iteration as number
      } else if (trace.actionType === 'llm_request_start') {
        for (let j = i + 1; j < traces.length; j++) {
          const rp = parseTracePayload(traces[j])
          if (traces[j].actionType === 'llm_response' && rp && typeof rp.iteration === 'number') {
            iter = rp.iteration as number
            break
          }
        }
      }

      if (iter != null && groups.has(iter)) {
        groups.get(iter)!.traces.push(trace)
      } else if (trace.actionType === 'loop_decision' && trace.title === 'Iteration Snapshot') {
        // Already accounted for via snapshot
      } else {
        unassigned.push(trace)
      }
    }

    return { groups, unassigned }
  }, [traces, groupByIteration])

  if (traces.length === 0) {
    return <p className="py-12 text-center text-[13px] text-[var(--smoke)]/50">{t('caseDetail.noTraces')}</p>
  }

  // ── Single trace card (shared between flat and grouped views) ──
  const renderTraceCard = (trace: TraceRow) => {
    const truth = classifyOperateTrace(trace)
    const actionType = normalizeTraceActionType(trace.actionType)
    const accent = ACCENTS[actionType] ?? {
      stroke: '#a09888',
      fill: 'rgba(160, 152, 136, 0.06)',
      icon: MessageSquare,
    }
    const Icon = accent.icon
    const payload = truth.payload ?? parseTracePayload(trace)
    const isUser = actionType === 'user_message'
    const isLlm = actionType === 'llm_response'
    const isToolResult = actionType === 'tool_result'
    const isNoisy =
      actionType === 'stream_event' ||
      actionType === 'loop_decision' ||
      actionType === 'llm_request_start'

    const userBody =
      isUser && payload && typeof payload.content === 'string'
        ? (payload.content as string)
        : isUser && typeof trace.detail === 'string'
          ? trace.detail
          : null

    const toolLatency =
      truth.latencyMs ?? (isToolResult && payload && typeof payload.latencyMs === 'number' ? payload.latencyMs : null)

    const showStructuredPayload =
      payload &&
      Object.keys(payload).length > 0 &&
      !(isUser && userBody && Object.keys(payload).length <= 2)

    const payloadDefaultOpen = !isNoisy && !isLlm
    const showDetailText = truth.detailText && (!showStructuredPayload || truth.kind !== 'tool_call')
    const statusTone =
      truth.status === 'block'
        ? 'border-vermillion/20 bg-vermillion/[0.06] text-vermillion'
        : truth.status === 'warn'
          ? 'border-amber/20 bg-amber/[0.06] text-amber'
          : truth.status === 'info'
            ? 'border-indigo/16 bg-indigo/[0.06] text-indigo'
            : 'border-black/[0.06] bg-white/60 text-[var(--fog)]'

    return (
      <li key={trace.id} className="relative pl-11">
        <div
          className="absolute left-[13px] top-5 z-[1] h-2.5 w-2.5 rounded-full ring-[3px] ring-[var(--void)]"
          style={{ backgroundColor: accent.stroke }}
        />

        <article
          className="overflow-hidden rounded-2xl border border-black/[0.06] border-l-[3px] bg-gradient-to-br from-white/70 via-white/45 to-[var(--void)]/30 shadow-[var(--shadow-card)] backdrop-blur-md transition-[box-shadow,transform] duration-200 hover:shadow-[var(--shadow-card-hover)]"
          style={{ borderLeftColor: accent.stroke }}
        >
          <div className="flex flex-col gap-1 border-b border-black/[0.04] bg-white/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl"
                style={{ backgroundColor: accent.fill }}
              >
                <Icon className="h-[18px] w-[18px]" style={{ color: accent.stroke }} strokeWidth={2} aria-hidden />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--fog)]">
                    {truth.semanticLabel}
                  </p>
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em] ${statusTone}`}>
                    {formatStatusLabel(truth.status)}
                  </span>
                  {truth.executionLabel ? (
                    <span className="inline-flex items-center rounded-full border border-indigo/14 bg-indigo/[0.05] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em] text-indigo">
                      {truth.executionLabel}
                    </span>
                  ) : null}
                  {truth.isExportedReviewStage ? (
                    <span className="inline-flex items-center rounded-full border border-amber/18 bg-amber/[0.06] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em] text-amber">
                      Review only
                    </span>
                  ) : null}
                </div>
                <p className="truncate text-[13px] font-medium text-[var(--mist)]">{truth.title}</p>
              </div>
            </div>
            <time
              className="flex flex-shrink-0 items-center gap-1 text-[12px] tabular-nums text-[var(--smoke)] sm:pl-2"
              dateTime={trace.createdAt}
            >
              <Clock className="h-3.5 w-3.5 opacity-50" aria-hidden />
              {formatClock(trace.createdAt)}
            </time>
          </div>

          <div className="px-4 pb-4 pt-3">
            {isLlm && payload && <LlmSummary payload={payload} />}

            {isUser && userBody ? (
              <div className="rounded-2xl rounded-tl-md border border-indigo/[0.12] bg-gradient-to-br from-indigo/[0.08] to-indigo/[0.02] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                <p className="text-[13px] leading-relaxed text-[var(--mist)]/90 whitespace-pre-wrap">{userBody}</p>
              </div>
            ) : (
              <>
                {showDetailText && (
                  <p className="text-[13px] leading-relaxed text-[var(--mist)]/75 whitespace-pre-wrap">{truth.detailText}</p>
                )}
              </>
            )}

            {toolLatency != null && (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-amber/15 bg-amber/[0.06] px-2.5 py-1 text-[11px] font-medium tabular-nums text-amber/90">
                <Clock className="h-3.5 w-3.5" aria-hidden />
                {t('caseDetail.ms', { n: toolLatency })}
              </p>
            )}

            {truth.executionNote ? (
              <p className="mt-2 text-[11px] leading-5 text-[var(--fog)]">{truth.executionNote}</p>
            ) : null}

            {showStructuredPayload && (
              <StructuredDataPanel
                data={payload}
                label={t('caseDetail.structuredData')}
                defaultOpen={payloadDefaultOpen}
                fieldCountLabel={fieldCountLabel}
                moreItemsLabel={moreItemsLabel}
              />
            )}
          </div>
        </article>
      </li>
    )
  }

  // ── Flat timeline (no grouping) ──
  if (!groupByIteration || !iterationGroups) {
    return (
      <section className="relative">
        <div className="absolute bottom-4 left-[17px] top-4 w-px rounded-full opacity-90" style={lineStyle} aria-hidden />
        <ul className="relative space-y-4">
          {traces.map(renderTraceCard)}
        </ul>
      </section>
    )
  }

  // ── Grouped by iteration ──
  const { groups, unassigned } = iterationGroups
  const sortedIterations = Array.from(groups.keys()).sort((a, b) => a - b)

  return (
    <section className="relative space-y-6">
      <div className="absolute bottom-4 left-[17px] top-4 w-px rounded-full opacity-90" style={lineStyle} aria-hidden />

      {/* Unassigned traces first (user_message, case_created, etc.) */}
      {unassigned.length > 0 && (
        <ul className="relative space-y-4">
          {unassigned.map(renderTraceCard)}
        </ul>
      )}

      {/* Iteration groups */}
      {sortedIterations.map((iter) => {
        const group = groups.get(iter)!
        const snap = group.snapshot
        const iterationWallMs =
          snap && typeof snap.iterationWallMs === 'number'
            ? snap.iterationWallMs
            : snap && typeof snap.wallMs === 'number'
              ? snap.wallMs
              : 0
        const llmWallMs = snap && typeof snap.llmWallMs === 'number' ? snap.llmWallMs : null
        const toolsWallMs = snap && typeof snap.toolsWallMs === 'number' ? snap.toolsWallMs : null
        const inTokens = snap && typeof snap.inputTokens === 'number' ? snap.inputTokens : 0
        const outTokens = snap && typeof snap.outputTokens === 'number' ? snap.outputTokens : 0
        const toolTraces = group.traces.filter((t) => normalizeTraceActionType(t.actionType) === 'tool_result')

        return (
          <IterationGroupCard
            key={iter}
            iteration={iter}
            iterationWallMs={iterationWallMs}
            llmWallMs={llmWallMs}
            toolsWallMs={toolsWallMs}
            inputTokens={inTokens}
            outputTokens={outTokens}
            toolCount={toolTraces.length}
            traces={group.traces}
            renderTraceCard={renderTraceCard}
            t={t}
          />
        )
      })}
    </section>
  )
}

function IterationGroupCard({
  iteration,
  iterationWallMs,
  llmWallMs,
  toolsWallMs,
  inputTokens,
  outputTokens,
  toolCount,
  traces,
  renderTraceCard,
  t,
}: {
  iteration: number
  iterationWallMs: number
  llmWallMs: number | null
  toolsWallMs: number | null
  inputTokens: number
  outputTokens: number
  toolCount: number
  traces: TraceRow[]
  renderTraceCard: (trace: TraceRow) => ReactNode
  t: TranslateFn
}) {
  const [expanded, setExpanded] = useState(true)
  const showPhaseBreakdown = llmWallMs != null && toolsWallMs != null && (llmWallMs > 0 || toolsWallMs > 0)

  return (
    <div className="rounded-2xl border border-indigo/10 bg-indigo/[0.02] overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((o) => !o)}
        className="w-full flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-indigo/[0.03] transition-colors"
      >
        <span className="text-[13px] font-semibold text-indigo/80">
          {t('caseDetail.iterationRound', { n: iteration })}
        </span>
        {(inputTokens > 0 || outputTokens > 0) && (
          <span className="text-[11px] tabular-nums text-fog/60">
            in {fmtNum(inputTokens)} / out {fmtNum(outputTokens)} tokens
          </span>
        )}
        <span className="text-[11px] tabular-nums text-amber/70" title={t('caseDetail.iterationWallHint')}>
          {fmtLatency(iterationWallMs)}
        </span>
        {showPhaseBreakdown && (
          <span className="text-[10px] tabular-nums text-fog/45 w-full sm:w-auto sm:ml-0 basis-full sm:basis-auto">
            {t('caseDetail.iterationPhaseBreakdown', {
              llm: fmtLatency(llmWallMs!),
              tools: fmtLatency(toolsWallMs!),
            })}
          </span>
        )}
        <span className="text-[11px] text-fog/50">{t('caseDetail.iterationSkillsLabel', { n: toolCount })}</span>
        <ChevronDown className={`h-3.5 w-3.5 ml-auto text-fog/40 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {expanded && (
        <div className="border-t border-indigo/[0.06] px-2 pb-2">
          <ul className="relative space-y-3 pt-3">
            {traces.map(renderTraceCard)}
          </ul>
        </div>
      )}
    </div>
  )
}
