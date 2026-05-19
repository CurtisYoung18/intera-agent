'use client'

// CasePanel — left panel displaying all active cases as stacked compact cards.
// Active case is expanded showing facts/skills/investigation; others are collapsed.
// Replaces the old floating CaseCard + CaseTabBar pattern.

import { useState, useMemo, useEffect } from 'react'
import { ChevronDown, ChevronRight, X, Layers } from 'lucide-react'
import type { CaseCardData } from '@/components/chat/case-card'
import type { DedicatedAgentState, ActiveCase } from '@/app/chat/use-intera-chat'
import AgentProgressCard from '@/components/chat/agent-progress-card'

type CaseStatus = 'created' | 'investigating' | 'collecting' | 'waiting_human' | 'resolved' | 'escalated'

const STATUS_META: Record<CaseStatus, { label: string; dot: string }> = {
  created:        { label: 'New',         dot: 'bg-slate-400' },
  investigating:  { label: 'Processing',  dot: 'bg-indigo-500 animate-pulse' },
  collecting:     { label: 'Need Info',   dot: 'bg-amber-500 animate-pulse' },
  escalated:      { label: 'Escalated',   dot: 'bg-red-500 animate-pulse' },
  waiting_human:  { label: 'Pending Review', dot: 'bg-amber-500 animate-pulse' },
  resolved:       { label: 'Resolved',    dot: 'bg-emerald-500' },
}

interface CasePanelCase {
  caseId: string
  displayName: string
  caseType: string
  status: CaseStatus
  confirmedFacts?: Record<string, unknown>
  skillsCalled?: string[]
  missingFacts?: string[]
  stage?: string
  subAgentCount?: number
  subAgentsRunning?: boolean
}

interface CasePanelProps {
  cases: ActiveCase[]
  activeCaseId: string | null
  onDismiss: (caseId: string) => void
  dedicatedAgents: DedicatedAgentState[]
  coreAgentProgress: {
    stage: string
    iteration: number
    task: string
    pendingSubAgents: string[]
  } | null
  executingToolName: string | null
}

export default function CasePanel({
  cases,
  activeCaseId,
  onDismiss,
  dedicatedAgents,
  coreAgentProgress,
  executingToolName,
}: CasePanelProps) {
  const preferZh =
    typeof window !== 'undefined' && navigator.language.toLowerCase().startsWith('zh')

  if (cases.length === 0) {
    return (
      <aside className="flex shrink-0 flex-col lg:w-[280px] gap-2">
        <div className="flex items-center gap-1.5 px-1 pt-1 text-[10px] font-medium uppercase tracking-[0.06em] text-fog/35">
          <Layers className="h-3 w-3 shrink-0 opacity-50" />
          {preferZh ? '活跃工单' : 'Active Cases'}
        </div>
        <p className="text-[10px] text-fog/20 italic px-1">
          {preferZh ? '暂无活跃工单' : 'No active cases'}
        </p>
      </aside>
    )
  }

  return (
    <aside className="flex shrink-0 flex-col lg:w-[280px] gap-2">
      {/* Panel header */}
      <div className="flex items-center justify-between px-1 pt-1">
        <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.06em] text-fog/35">
          <Layers className="h-3 w-3 shrink-0 opacity-50" />
          {preferZh ? '活跃工单' : 'Active Cases'}
          <span className="text-fog/20 ml-0.5">{cases.length}</span>
        </div>
      </div>

      {/* Stacked case cards */}
      <div className="flex flex-col gap-2 overflow-y-auto">
        {cases.map((c, index) => {
          const isActive = c.caseId === activeCaseId
          const meta = STATUS_META[c.status as CaseStatus] || STATUS_META.created
          const typeLabel = c.displayName || c.caseType || 'Case'
          const facts = Object.entries(c.confirmedFacts || {})
          const skills = c.skillsCalled || []
          const missing = c.missingFacts || []

          // Dedicated agents for this case
          const caseAgents = dedicatedAgents.filter(
            (a) => a.caseId === c.caseId,
          )

          return (
            <CasePanelCard
              key={c.caseId}
              caseId={c.caseId}
              displayName={c.displayName || typeLabel}
              caseType={c.caseType}
              status={c.status as CaseStatus}
              stage={isActive ? coreAgentProgress?.stage : undefined}
              isActive={isActive}
              meta={meta}
              typeLabel={typeLabel}
              facts={facts}
              skills={skills}
              missing={missing}
              caseAgents={caseAgents}
              coreAgentProgress={isActive ? coreAgentProgress : null}
              executingToolName={isActive ? executingToolName : null}
              preferZh={preferZh}
              onDismiss={c.status === 'resolved' ? () => onDismiss(c.caseId) : undefined}
            />
          )
        })}
      </div>
    </aside>
  )
}

// ── Individual case card inside the panel ──────────────────────────────

function CasePanelCard({
  caseId,
  displayName,
  status,
  stage,
  isActive,
  meta,
  typeLabel,
  facts,
  skills,
  missing,
  caseAgents,
  coreAgentProgress,
  executingToolName,
  preferZh,
  onDismiss,
}: {
  caseId: string
  displayName: string
  caseType: string
  status: CaseStatus
  stage?: string
  isActive: boolean
  meta: { label: string; dot: string }
  typeLabel: string
  facts: [string, unknown][]
  skills: string[]
  missing: string[]
  caseAgents: DedicatedAgentState[]
  coreAgentProgress: {
    stage: string
    iteration: number
    task: string
    pendingSubAgents: string[]
  } | null
  executingToolName: string | null
  preferZh: boolean
  onDismiss?: () => void
}) {
  const [open, setOpen] = useState(isActive)
  const [userToggled, setUserToggled] = useState(false)

  // Auto-open when a case becomes newly active (streaming or tab switch),
  // but respect manual user toggle — don't force-close or re-open once the user interacts.
  useEffect(() => {
    if (isActive) {
      setOpen(true)
      setUserToggled(false)
    } else if (!userToggled) {
      setOpen(false)
    }
  }, [isActive, userToggled])

  const handleToggle = () => { setOpen((prev) => !prev); setUserToggled(true) }
  const handleCardClick = () => handleToggle()

  return (
    <div
      className={`
        rounded-xl border transition-all duration-200 cursor-pointer
        ${isActive
          ? 'border-indigo/30 bg-abyss/95 shadow-[0_0_20px_rgba(91,110,245,0.06)]'
          : 'border-[var(--border-subtle)] bg-abyss/70 hover:border-[var(--border-hover)]'
        }
      `}
      onClick={handleCardClick}
    >
      {/* ── Card header (always visible) ── */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        {/* Status dot */}
        <span className={`inline-block w-[6px] h-[6px] rounded-full shrink-0 ${meta.dot}`} />

        {/* Case info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium text-mist truncate">
              {displayName}
            </span>
            {stage && (
              <span className="text-[9px] text-fog/35 capitalize shrink-0">
                {stage.replace(/_/g, ' ')}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[9px] text-fog/40">{typeLabel}</span>
            <span className="text-[9px] text-fog/25">·</span>
            <span className="text-[9px] text-fog/40">{meta.label}</span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-0.5 shrink-0">
          {onDismiss && (
            <button
              onClick={(e) => { e.stopPropagation(); onDismiss() }}
              className="p-1 rounded text-fog/20 hover:text-red-400 hover:bg-red-400/5 transition-colors"
              aria-label="Dismiss case"
            >
              <X className="w-3 h-3" />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); handleToggle() }}
            className="p-1 rounded text-fog/25 hover:text-fog/60 transition-colors"
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            {open ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </button>
        </div>
      </div>

      {/* ── Expanded body ── */}
      {open && (
        <div className="px-3 pb-3 border-t border-[var(--border-subtle)] pt-2.5 space-y-2.5">
          {/* Facts */}
          {facts.length > 0 && (
            <div>
              <p className="text-[8px] font-medium uppercase tracking-[0.06em] text-fog/25 mb-1.5">
                {preferZh ? '已确认' : 'Facts'}
              </p>
              <div className="space-y-0.5">
                {facts.slice(0, 5).map(([key, value]) => (
                  <div key={key} className="flex items-center gap-1.5">
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="rgba(46,160,74,0.5)" strokeWidth="2" className="shrink-0">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span className="text-[10px] text-fog/55 truncate">{String(value)}</span>
                  </div>
                ))}
                {facts.length > 5 && (
                  <span className="text-[9px] text-fog/25 pl-3.5">
                    +{facts.length - 5} {preferZh ? '更多' : 'more'}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Skills */}
          {skills.length > 0 && (
            <div>
              <p className="text-[8px] font-medium uppercase tracking-[0.06em] text-fog/25 mb-1.5">
                {preferZh ? '已执行' : 'Actions'}
              </p>
              <div className="flex flex-wrap gap-1">
                {skills.map((s) => (
                  <span
                    key={s}
                    className="text-[9px] font-mono text-fog/45 bg-[var(--surface)] px-1.5 py-0.5 rounded"
                  >
                    {s.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Missing */}
          {missing.length > 0 && (
            <div>
              <p className="text-[8px] font-medium uppercase tracking-[0.06em] text-fog/25 mb-1.5">
                {preferZh ? '待收集' : 'Needs'}
              </p>
              <div className="space-y-0.5">
                {missing.slice(0, 3).map((f) => (
                  <div key={f} className="flex items-center gap-1.5">
                    <span className="inline-block w-[9px] h-[9px] rounded-full border border-fog/15 shrink-0" />
                    <span className="text-[10px] text-fog/35">{f}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Core agent progress (active case only) */}
          {isActive && coreAgentProgress && (
            <div>
              <p className="text-[8px] font-medium uppercase tracking-[0.06em] text-fog/25 mb-1.5">
                {preferZh ? '进度' : 'Progress'}
              </p>
              <div className="border-l-2 border-indigo/25 pl-2">
                <p className="text-[10px] text-indigo/70">
                  {(coreAgentProgress.stage || '').replace(/_/g, ' ')}
                  {coreAgentProgress.iteration > 0 && ` · iter ${coreAgentProgress.iteration}`}
                </p>
                {coreAgentProgress.task && (
                  <p className="text-[9px] text-fog/45 mt-0.5 line-clamp-2">
                    {coreAgentProgress.task}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Executing tool */}
          {isActive && executingToolName && (
            <div className="flex items-center gap-1.5 rounded bg-indigo/[0.06] px-2 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse shrink-0" />
              <span className="text-[9px] font-mono text-indigo/70">
                {executingToolName.replace(/_/g, ' ')}
              </span>
            </div>
          )}

          {/* Sub-agents */}
          {caseAgents.length > 0 && (
            <div>
              <p className="text-[8px] font-medium uppercase tracking-[0.06em] text-fog/25 mb-1.5">
                {preferZh ? '协查' : 'Sub-agents'}
              </p>
              <div className="space-y-1.5">
                {caseAgents.map((agent) => (
                  <AgentProgressCard
                    key={agent.agentId}
                    agent={agent}
                    caseLabel={displayName}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {facts.length === 0 && skills.length === 0 && missing.length === 0 && (
            <p className="text-[10px] text-fog/25 italic">
              {preferZh ? '正在收集信息…' : 'Gathering information…'}
            </p>
          )}

        </div>
      )}
    </div>
  )
}
