'use client'

/**
 * DebugExportButton — downloads a full JSON snapshot of the current chat session.
 *
 * Captures: messages, cases, dedicated agents, core agent progress, session
 * metadata (chatId, userId, customerId), and a brief summary. Useful for
 * reproducing agent bugs without needing server-side logs.
 *
 * Hidden when no messages are present. Shown as a small icon button in the
 * chat header. Pressing it always triggers an immediate download.
 */

import { useState, useCallback } from 'react'
import { Download, Check } from 'lucide-react'
import type { ChatMessage, ActiveCase, DedicatedAgentState } from '@/app/chat/use-intera-chat'

interface DebugExportButtonProps {
  chatId: string
  userId: string
  customerId: string
  messages: ChatMessage[]
  cases: ActiveCase[]
  dedicatedAgents: DedicatedAgentState[]
  coreAgentProgress: { stage: string; iteration: number; task: string; pendingSubAgents: string[] } | null
  agentStatus: string
}

export default function DebugExportButton({
  chatId,
  userId,
  customerId,
  messages,
  cases,
  dedicatedAgents,
  coreAgentProgress,
  agentStatus,
}: DebugExportButtonProps) {
  const [done, setDone] = useState(false)

  const handleExport = useCallback(() => {
    const now = new Date()

    const payload = {
      _version: 'intera_debug_export_v1',
      exportedAt: now.toISOString(),
      session: {
        chatId,
        userId,
        customerId,
      },
      summary: {
        messageCount: messages.length,
        caseCount: cases.length,
        agentStatus,
        dedicatedAgentCount: dedicatedAgents.length,
        coreAgentStage: coreAgentProgress?.stage ?? null,
        coreAgentIteration: coreAgentProgress?.iteration ?? null,
      },
      cases,
      messages,
      dedicatedAgents,
      coreAgentProgress,
    }

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)

    const ts = now
      .toISOString()
      .replace('T', '_')
      .replace(/:/g, '-')
      .slice(0, 19) // YYYY-MM-DD_HH-MM-SS

    const a = document.createElement('a')
    a.href = url
    a.download = `intera-debug-${chatId.slice(0, 8)}-${ts}.json`
    a.click()
    URL.revokeObjectURL(url)

    // Brief "done" flash
    setDone(true)
    setTimeout(() => setDone(false), 1800)
  }, [chatId, userId, customerId, messages, cases, dedicatedAgents, coreAgentProgress, agentStatus])

  if (messages.length === 0) return null

  return (
    <button
      type="button"
      onClick={handleExport}
      title="Export debug snapshot"
      aria-label="Export debug snapshot as JSON"
      className={`flex h-8 w-8 items-center justify-center rounded-xl border transition-all duration-200
        ${done
          ? 'border-malachite/30 bg-malachite/10 text-malachite'
          : 'border-black/[0.07] bg-white/40 text-fog/60 hover:border-black/10 hover:bg-white/65 hover:text-fog/90'
        }
        backdrop-blur-md shadow-[0_1px_3px_rgba(0,0,0,0.06)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo/25`}
    >
      {done
        ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
        : <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
      }
    </button>
  )
}
