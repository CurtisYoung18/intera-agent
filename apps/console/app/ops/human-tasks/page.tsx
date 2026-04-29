'use client'

// Human Tasks — task queue
// Void + Fluid Glass design, matching Chat aesthetic

import { useState, useEffect } from 'react'
import Link from 'next/link'
import FluidBackground from '@intera/shared/ui/fluid-background'

interface Task {
  id: string
  caseId: string
  queue: string
  status: string
  question: string
  verdict: string | null
  createdAt: string
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber',
  in_progress: 'bg-indigo',
  resolved: 'bg-malachite',
}

export default function HumanTasksPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/human-tasks')
      .then((r) => r.json())
      .then((data) => {
        setTasks(data.tasks || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  return (
    <div className="relative min-h-screen bg-void">
      <FluidBackground intensity="subtle" />

      {/* Header */}
      {/* Header — frosted glass */}
      <div className="relative z-10 border-b border-white/[0.04]">
        <div className="absolute inset-0 bg-abyss/80 backdrop-blur-2xl border-b border-white/[0.04]" />
        <div className="relative max-w-4xl mx-auto px-6 py-5 flex items-center justify-between">
          <div>
            <h1 className="text-[16px] font-medium text-mist tracking-[-0.01em]">
              Human Tasks
            </h1>
            <p className="text-[13px] text-fog/60 mt-0.5">Pending operator actions</p>
          </div>
          <span className="text-[13px] font-mono text-fog/50 tabular-nums">
            {tasks.length} pending
          </span>
        </div>
      </div>

      {/* Task list */}
      <main className="relative z-10 max-w-4xl mx-auto px-6 py-8 space-y-3">
        {loading && (
          <p className="text-center py-16 text-fog/40 text-[14px] animate-breathe">
            Loading…
          </p>
        )}

        {!loading && tasks.length === 0 && (
          <div className="glass-admin p-16 text-center">
            <p className="text-mist text-[16px] font-medium mb-2">
              No pending tasks
            </p>
            <p className="text-fog/50 text-[14px] max-w-[320px] mx-auto leading-relaxed">
              When the agent creates a human task, it will appear here
            </p>
          </div>
        )}

        {tasks.map((task) => (
          <Link
            key={task.id}
            href={`/ops/human-tasks/${task.id}`}
            className="glass-admin glass-card-hover block p-5 group"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                {/* Meta row */}
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-[10px] font-sans tracking-[0.06em] uppercase text-amber bg-amber/[0.08] border border-amber/[0.12] px-2.5 py-1 rounded-full">
                    {task.queue.replace(/_/g, ' ')}
                  </span>
                  <span className={`inline-block w-[6px] h-[6px] rounded-full ${STATUS_COLORS[task.status] || 'bg-smoke'} ${task.status === 'pending' ? 'animate-breathe' : ''}`} />
                  <span className="text-[12px] text-fog/40">{timeAgo(task.createdAt)}</span>
                </div>

                {/* Question */}
                <p className="text-[15px] text-mist leading-relaxed line-clamp-2 group-hover:text-mist/90 transition-colors">
                  {task.question}
                </p>

                {/* Case ID */}
                <p className="text-[12px] text-fog/30 mt-3 font-mono tabular-nums">
                  {task.caseId.slice(0, 12)}…
                </p>
              </div>

              {/* Arrow */}
              <span className="text-fog/20 text-lg flex-shrink-0 group-hover:text-fog/50 group-hover:translate-x-0.5 transition-all duration-200">
                →
              </span>
            </div>
          </Link>
        ))}
      </main>
    </div>
  )
}
