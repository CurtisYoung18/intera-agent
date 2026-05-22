'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Clock, MessageSquare, ChevronRight, History, X } from 'lucide-react'
import OrganicLoader from '@intera/shared/ui/organic-loader'

interface CaseSummary {
  id: string
  type: string
  status: string
  goal: string | null
  createdAt: string
  updatedAt: string
  summary: string | null
  skillsCalled: string[]
  messageCount: number
}

const TYPE_LABELS: Record<string, string> = {
  deposit_issue: '存款问题',
  account_issue: '账号问题',
  order_issue: '订单问题',
  refund_request: '退款申请',
}

const STATUS_COLORS: Record<string, string> = {
  created: 'bg-indigo',
  collecting: 'bg-sky',
  investigating: 'bg-amber',
  waiting_human: 'bg-lavender',
  resolved: 'bg-malachite',
  escalated: 'bg-vermillion',
}

export default function CaseHistoryPanel({
  customerId,
  userId,
  chatId,
  onSelectCase,
  activeCaseId,
}: {
  customerId: string
  userId: string
  chatId: string
  onSelectCase: (caseId: string) => void
  activeCaseId: string | null
}) {
  const [open, setOpen] = useState(false)
  const [cases, setCases] = useState<CaseSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchCases = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/cases?userId=${encodeURIComponent(userId)}&customerId=${encodeURIComponent(customerId)}&chatId=${encodeURIComponent(chatId)}&limit=20`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setCases(data.cases || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [customerId, userId, chatId])

  useEffect(() => {
    if (open) fetchCases()
  }, [open, fetchCases])

  const formatDate = (d: string) => {
    const date = new Date(d)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    if (diff < 86400000) return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
  }

  return (
    <>
      {/* Toggle button — matches DebugExportButton glass style */}
      <button
        onClick={() => setOpen(!open)}
        title="Case history"
        aria-label="View case history"
        className="flex h-8 w-8 items-center justify-center rounded-xl border border-black/[0.07] bg-white/40 text-fog/60 backdrop-blur-md shadow-[0_1px_3px_rgba(0,0,0,0.06)] hover:border-black/10 hover:bg-white/65 hover:text-fog/90 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo/25"
      >
        <History className="h-4 w-4" strokeWidth={1.75} />
      </button>

      {/* Panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.2 }}
            className="fixed right-0 top-0 bottom-0 w-[320px] bg-[var(--abyss)]/95 backdrop-blur-xl border-l border-white/[0.06] shadow-2xl z-50 flex flex-col"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
              <h3 className="text-[13px] font-semibold text-[var(--mist)]">History Cases</h3>
              <button onClick={() => setOpen(false)} className="p-1 rounded-lg hover:bg-white/[0.06]">
                <X className="w-4 h-4 text-fog/60" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {loading && (
                <div className="flex items-center justify-center py-8 text-fog/40">
                  <OrganicLoader icon="spin" size={20} className="text-fog/40" />
                </div>
              )}
              {error && <p className="text-[12px] text-vermillion/80 text-center py-4">{error}</p>}
              {!loading && cases.length === 0 && (
                <p className="text-[12px] text-fog/40 text-center py-8">暂无历史 Case</p>
              )}
              {cases.map((c) => (
                <button
                  key={c.id}
                  onClick={() => { onSelectCase(c.id); setOpen(false) }}
                  className={`w-full text-left rounded-xl border px-3 py-2.5 transition-colors ${
                    c.id === activeCaseId
                      ? 'border-indigo/20 bg-indigo/[0.06]'
                      : 'border-white/[0.04] hover:border-white/[0.08] hover:bg-white/[0.03]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_COLORS[c.status] || 'bg-fog/40'}`} />
                    <span className="text-[12px] font-medium text-[var(--mist)] truncate">
                      {TYPE_LABELS[c.type] || c.type}
                    </span>
                    <span className="text-[10px] text-fog/40 flex-shrink-0 ml-auto flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDate(c.createdAt)}
                    </span>
                  </div>
                  {c.summary && (
                    <p className="mt-1 text-[11px] text-fog/50 line-clamp-2">{c.summary}</p>
                  )}
                  <div className="mt-1.5 flex items-center gap-3 text-[10px] text-fog/40">
                    <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" />{c.messageCount}</span>
                    <span>{c.status}</span>
                  </div>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
