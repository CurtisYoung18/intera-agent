'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ClipboardList, ExternalLink } from 'lucide-react'

interface Task {
  id: string; caseId: string; queue: string; status: string
  question: string; createdAt: string
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

export default function EmbedHumanTasks() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/human-tasks')
      .then(r => r.json())
      .then(data => setTasks(data.tasks || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="p-4 text-[13px] text-gray-400">Loading...</div>

  return (
    <div className="p-3 space-y-2 font-sans">
      {tasks.length === 0 ? (
        <p className="text-[12px] text-gray-400 text-center py-8">No pending human tasks</p>
      ) : (
        tasks.map(task => (
          <Link key={task.id} href={`/ops/human-tasks/${task.id}`} target="_blank"
            className="flex items-center justify-between p-3 rounded-lg border border-gray-200 bg-white hover:border-indigo-300 transition-colors no-underline text-inherit">
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium text-gray-800 truncate">{task.question || task.caseId}</p>
              <p className="text-[10px] text-gray-400">{task.queue} · {timeAgo(task.createdAt)}</p>
            </div>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 ml-2 ${task.status === 'pending' ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'}`}>
              {task.status}
            </span>
            <ExternalLink className="w-3 h-3 text-gray-300 ml-1.5 flex-shrink-0" />
          </Link>
        ))
      )}
      <div className="text-center pt-2">
        <a href="/ops/human-tasks" target="_blank" className="text-[10px] text-indigo-500 hover:text-indigo-700 no-underline">
          Open full task list →
        </a>
      </div>
    </div>
  )
}
