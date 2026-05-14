'use client'

import { useState } from 'react'
import { motion } from 'motion/react'
import { ChevronDown, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import AgentFindingsView from './agent-findings-view'
import type { DedicatedAgentState } from '@/app/chat/use-intera-chat'

interface AgentProgressCardProps {
  agent: DedicatedAgentState
}

export default function AgentProgressCard({ agent }: AgentProgressCardProps) {
  const [expanded, setExpanded] = useState(false)

  const isComplete = agent.status === 'completed'
  const isError = agent.status === 'error'
  const isExecuting = agent.status === 'executing'

  return (
    <div
      className={`rounded-lg border transition-colors duration-500 ${
        isComplete
          ? 'border-emerald/20 bg-emerald/[0.03]'
          : isError
            ? 'border-red/20 bg-red/[0.03]'
            : 'border-indigo/20 bg-indigo/[0.03]'
      }`}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
      >
        {/* Status icon */}
        {isComplete ? (
          <CheckCircle className="w-3.5 h-3.5 text-emerald flex-shrink-0" />
        ) : isError ? (
          <AlertCircle className="w-3.5 h-3.5 text-red flex-shrink-0" />
        ) : (
          <Loader2 className="w-3.5 h-3.5 text-indigo animate-spin flex-shrink-0" />
        )}

        {/* Name + detail */}
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-medium text-fog/90 truncate">
            {agent.agentName}
          </div>
          {isExecuting && agent.taskDescription && (
            <div className="text-[10px] text-fog/50 truncate mt-0.5">
              {agent.taskDescription.slice(0, 80)}
            </div>
          )}
          {isComplete && (
            <div className="text-[10px] text-emerald/70 mt-0.5">
              {(agent.durationMs ?? 0) > 0 ? `${(agent.durationMs! / 1000).toFixed(1)}s` : 'Done'}
            </div>
          )}
        </div>

        {/* Expand toggle */}
        {(isComplete || isError) && (
          <motion.div
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <ChevronDown className="w-3 h-3 text-fog/40" />
          </motion.div>
        )}

        {/* Pulse animation for executing */}
        {isExecuting && (
          <div className="w-2 h-2 rounded-full bg-indigo animate-pulse flex-shrink-0" />
        )}
      </button>

      {/* Expanded findings */}
      {expanded && (isComplete || isError) && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="px-3 pb-3 border-t border-white/5"
        >
          {isError ? (
            <p className="text-[11px] text-red/70 mt-2">Agent encountered an error. Results may be partial.</p>
          ) : (
            <AgentFindingsView
              findings={agent.findings}
              recommendation={agent.recommendation}
            />
          )}
        </motion.div>
      )}
    </div>
  )
}
