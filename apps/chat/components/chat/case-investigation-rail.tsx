'use client'

import { Activity, Cpu } from 'lucide-react'
import CaseCard from '@/components/chat/case-card'
import type { CaseCardData } from '@/components/chat/case-card'
import AgentProgressCard from '@/components/chat/agent-progress-card'
import type { DedicatedAgentState, ActiveCase } from '@/app/chat/use-intera-chat'

interface CaseInvestigationRailProps {
  casePayload: CaseCardData | null
  onDismissCase?: () => void
  dedicatedAgents: DedicatedAgentState[]
  cases: ActiveCase[]
  coreAgentProgress: {
    stage: string
    iteration: number
    task: string
    pendingSubAgents: string[]
  } | null
  executingToolName: string | null
}

/** Slim left strip: case capsule + live investigation ladder (stage, tools, sub-agents). */
export default function CaseInvestigationRail({
  casePayload,
  onDismissCase,
  dedicatedAgents,
  cases,
  coreAgentProgress,
  executingToolName,
}: CaseInvestigationRailProps) {
  const skillSteps = [...(casePayload?.skillsCalled || [])].filter(Boolean)

  const showTimeline = Boolean(
    coreAgentProgress?.task ||
      executingToolName ||
      skillSteps.length ||
      dedicatedAgents.length > 0,
  )

  const preferZh =
    typeof window !== 'undefined' && navigator.language.toLowerCase().startsWith('zh')

  return (
    <div className="flex w-full flex-col gap-3">
      {casePayload && (
        <CaseCard variant="rail" data={casePayload} onDismiss={onDismissCase} />
      )}

      {(casePayload || dedicatedAgents.length > 0) && (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[color-mix(in_oklch,var(--abyss)_92%,transparent)] px-3 py-2.5 shadow-sm backdrop-blur-sm">
          <div className="mb-2 flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-[0.06em] text-fog/40">
            <Activity className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
            {preferZh ? '调查进展' : 'Investigation'}
          </div>

          {coreAgentProgress ? (
            <div className="mb-2 border-l-2 border-indigo/25 pl-2.5">
              <p className="text-[10px] capitalize text-indigo/80">
                {(coreAgentProgress.stage || '').replace(/_/g, ' ')}
                {coreAgentProgress.iteration > 0
                  ? ` · ${preferZh ? '轮次' : 'iter'} ${coreAgentProgress.iteration}`
                  : ''}
              </p>
              {coreAgentProgress.task ? (
                <p className="mt-1 line-clamp-4 text-[10px] leading-relaxed text-fog/52">
                  {coreAgentProgress.task}
                </p>
              ) : null}
              {coreAgentProgress.pendingSubAgents?.length ? (
                <p className="mt-1 text-[9px] text-fog/35">
                  {preferZh ? '排队子任务' : 'Queued'} ·{' '}
                  {coreAgentProgress.pendingSubAgents.join(', ')}
                </p>
              ) : null}
            </div>
          ) : null}

          {executingToolName ? (
            <div className="mb-2 flex items-start gap-1.5 rounded-md bg-indigo/[0.06] px-2 py-1">
              <Cpu className="mt-0.5 h-3 w-3 shrink-0 animate-pulse text-indigo/60" aria-hidden />
              <span className="text-[10px] leading-snug text-indigo/80">
                <span className="font-medium">{preferZh ? '执行' : 'Running'}</span>{' '}
                <span className="font-mono">{executingToolName.replace(/_/g, ' ')}</span>
              </span>
            </div>
          ) : null}

          {skillSteps.length > 0 ? (
            <ul className="mb-2 space-y-1 border-l border-[var(--border-subtle)] pl-2.5">
              {skillSteps.slice(-10).map((slug) => (
                <li
                  key={slug}
                  className="flex gap-1.5 text-[9px] font-mono tracking-tight text-fog/42"
                >
                  <span className="font-sans text-malachite/70">✓</span>
                  <span className="min-w-0 truncate">{slug.replace(/_/g, ' ')}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {dedicatedAgents.length === 0 && !showTimeline && casePayload ? (
            <p className="text-[10px] leading-relaxed text-fog/38">
              {preferZh
                ? '工单已分拆 — Core 在主对话区应答；此处仅展示进度与并行协查（如有）。'
                : 'Core answers in chat; this rail shows investigation milestones and runners when active.'}
            </p>
          ) : null}

          {dedicatedAgents.length > 0 ? (
            <div className="space-y-2 pt-1">
              <p className="text-[9px] uppercase tracking-wide text-fog/30">
                {preferZh ? '并行协查' : 'Parallel'}
              </p>
              {dedicatedAgents.map((agent) => (
                <AgentProgressCard
                  key={agent.agentId}
                  agent={agent}
                  caseLabel={
                    agent.caseId
                      ? cases.find((c) => c.caseId === agent.caseId)?.displayName ??
                        `…${agent.caseId.slice(-6)}`
                      : undefined
                  }
                />
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
