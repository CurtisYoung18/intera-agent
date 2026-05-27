'use client'

// Human Tasks — task queue with neumorphic glass styling

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ClipboardList } from 'lucide-react'
import { ListSkeleton } from '@/components/ui/skeleton'
import EmptyState from '@/components/ui/empty-state'
import { useConsoleLocale } from '@/components/locale-provider'

interface Task {
  id: string; caseId: string; queue: string; status: string
  question: string; verdict: string | null; createdAt: string
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber',
  in_progress: 'bg-indigo',
  resolved: 'bg-malachite',
}

export default function HumanTasksPage() {
  const { t } = useConsoleLocale()
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)

  const timeAgo = (iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return t('time.justNow')
    if (mins < 60) return t('time.minsAgo', { n: mins })
    const hours = Math.floor(mins / 60)
    if (hours < 24) return t('time.hoursAgo', { n: hours })
    return t('time.daysAgo', { n: Math.floor(hours / 24) })
  }

  useEffect(() => {
    fetch('/api/human-tasks')
      .then((r) => r.json())
      .then((data) => setTasks(data.tasks || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const isEmbed = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('embed')
  if (loading) return <div className="p-8 text-[13px] text-[var(--fog)]">{isEmbed ? 'Loading...' : <ListSkeleton />}</div>
  if (!isEmbed && tasks.length === 0) return <div className="max-w-4xl mx-auto px-8 py-8"><EmptyState icon={ClipboardList} title={t('humanTasks.noTasks')} description={t('humanTasks.noTasksDesc')} /></div>

  if (isEmbed) return (
    <div className="p-4 space-y-2">
      {tasks.length === 0 ? (
        <p className="text-[12px] text-[var(--fog)] text-center py-8">{t('humanTasks.noTasks')}</p>
      ) : (
        tasks.map(task => (
          <Link key={task.id} href={`/ops/human-tasks/${task.id}`}
            className="flex items-center justify-between p-3 rounded-xl border border-black/[0.06] bg-white hover:border-indigo/20 transition-colors">
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-[var(--mist)] truncate">{task.question || task.caseId}</p>
              <p className="text-[10px] text-[var(--fog)]">{task.queue} · {timeAgo(task.createdAt)}</p>
            </div>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${task.status === 'pending' ? 'bg-amber/[0.08] text-amber' : 'bg-malachite/[0.08] text-malachite'}`}>{task.status}</span>
          </Link>
        ))
      )}
    </div>
  )

  return (
    <div className="max-w-4xl mx-auto px-8 py-8 animate-fade-up flex flex-col min-h-[calc(100dvh-2rem)]">
      <div className="flex items-center justify-between mb-6 flex-shrink-0">
        <div>
          <h1 className="text-[18px] font-semibold text-primary tracking-[-0.01em]">{t('humanTasks.title')}</h1>
          <p className="text-[13px] text-secondary mt-1">{t('humanTasks.subtitle')}</p>
        </div>
        {!loading && (
          <span className="glass-pill text-[12px] font-mono text-secondary tabular-nums">
            {t('humanTasks.pendingBadge', { n: tasks.length })}
          </span>
        )}
      </div>

      {loading && <ListSkeleton count={3} />}

      {!loading && tasks.length === 0 && (
        <div className="flex-1 flex items-center justify-center py-8 sm:py-12">
          <EmptyState
            size="large"
            icon={ClipboardList}
            title={t('humanTasks.emptyTitle')}
            description={t('humanTasks.emptyDesc')}
          />
        </div>
      )}

      {tasks.map((task) => (
        <Link
          key={task.id}
          href={`/ops/human-tasks/${task.id}`}
          className="glass-card block p-5 mb-3 group"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-[10px] font-sans tracking-[0.06em] uppercase text-amber/90 bg-amber/[0.06] border border-amber/[0.1] px-2.5 py-1 rounded-full">
                  {task.queue.replace(/_/g, ' ')}
                </span>
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${STATUS_COLORS[task.status] || 'bg-muted'} ${task.status === 'pending' ? 'animate-breathe' : ''}`} />
                <span className="text-[11px] text-muted">{timeAgo(task.createdAt)}</span>
              </div>
              <p className="text-[15px] text-primary leading-relaxed line-clamp-2">
                {task.question}
              </p>
              <p className="text-[11px] text-muted mt-3 font-mono tabular-nums">
                {task.caseId.slice(0, 12)}…
              </p>
            </div>
            <span className="text-muted/30 text-lg flex-shrink-0 group-hover:text-indigo group-hover:translate-x-0.5 transition-all duration-300">
              →
            </span>
          </div>
        </Link>
      ))}
    </div>
  )
}
