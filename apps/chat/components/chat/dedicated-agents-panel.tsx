'use client'

import { motion, AnimatePresence } from 'motion/react'
import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import AgentProgressCard from './agent-progress-card'
import type { DedicatedAgentState } from '@/app/chat/use-intera-chat'

interface DedicatedAgentsPanelProps {
  agents: DedicatedAgentState[]
  collapsed: boolean
  onToggleCollapse: () => void
}

export default function DedicatedAgentsPanel({
  agents,
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
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/5 flex-shrink-0">
        <span className="text-[11px] font-medium text-fog/70 uppercase tracking-wider">
          Dedicated Agents
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
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        <AnimatePresence>
          {agents.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center justify-center h-full"
            >
              <p className="text-[11px] text-fog/40 text-center px-4">
                No dedicated agents running. Agents are dispatched when a case stage requires parallel investigation.
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
                <AgentProgressCard agent={agent} />
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
