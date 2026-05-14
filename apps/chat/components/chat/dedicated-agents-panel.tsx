'use client'

import { motion, AnimatePresence } from 'motion/react'
import { Bot, PanelRightClose, PanelRightOpen } from 'lucide-react'
import AgentProgressCard from './agent-progress-card'
import type { DedicatedAgentState, ActiveCase } from '@/app/chat/use-intera-chat'

interface DedicatedAgentsPanelProps {
  agents: DedicatedAgentState[]
  cases: ActiveCase[]
  collapsed: boolean
  onToggleCollapse: () => void
}

export default function DedicatedAgentsPanel({
  agents,
  cases,
  collapsed,
  onToggleCollapse,
}: DedicatedAgentsPanelProps) {
  if (collapsed) {
    return (
      <div className="h-full flex flex-col items-center py-3 gap-2">
        <button
          onClick={onToggleCollapse}
          className="p-1.5 rounded-lg hover:bg-white/5 text-fog/60 hover:text-fog/80 transition-colors"
          title="Expand agents panel"
        >
          <PanelRightOpen className="w-4 h-4" />
        </button>
        {/* Stacked agent status dots */}
        {agents.map((agent) => (
          <div
            key={agent.agentId}
            className={`w-2.5 h-2.5 rounded-full ${
              agent.status === 'completed' ? 'bg-emerald' : agent.status === 'error' ? 'bg-red' : 'bg-indigo animate-pulse'
            }`}
            title={`${agent.agentName}: ${agent.status}`}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2.5">
        <span className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-fog/75">
          <Bot className="h-3.5 w-3.5 opacity-55" aria-hidden />
          Side agents
        </span>
        <button
          onClick={onToggleCollapse}
          className="p-1 rounded-md hover:bg-white/5 text-fog/50 hover:text-fog/70 transition-colors"
          title="Collapse agents panel"
        >
          <PanelRightClose className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Agent cards */}
      <div className="flex-1 space-y-2 overflow-y-auto p-2.5 pb-8">
        <AnimatePresence>
          {agents.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex h-full flex-col items-center justify-center gap-3 px-4 py-10"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--surface)] ring-1 ring-[var(--border-subtle)]">
                <Bot className="h-4 w-4 text-fog/35" aria-hidden />
              </div>
              <p className="text-center text-[12px] leading-relaxed text-fog/42">
                No parallel agents yet. When a stage needs background checks, runners show up here with live progress.
              </p>
            </motion.div>
          ) : (
            agents.map((agent) => (
              <motion.div
                key={agent.agentId}
                initial={{ height: 0, opacity: 0, y: -10 }}
                animate={{ height: 'auto', opacity: 1, y: 0 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25 }}
              >
                <AgentProgressCard
                  agent={agent}
                  caseLabel={
                    agent.caseId
                      ? cases.find((c) => c.caseId === agent.caseId)?.displayName ??
                        `…${agent.caseId.slice(-6)}`
                      : undefined
                  }
                />
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
