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
  orgId,
  userId,
  chatId,
  onSelectCase,
  activeCaseId,
}: {
  orgId: string
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
      const res = await fetch(`/api/cases?userId=${encodeURIComponent(userId)}&orgId=${encodeURIComponent(orgId)}&chatId=${encodeURIComponent(chatId)}&limit=20`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setCases(data.cases || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [orgId, userId, chatId])

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
          <>
            {/* Scrim */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40"
              style={{ background: 'rgba(26,24,20,0.06)', backdropFilter: 'blur(1px)', WebkitBackdropFilter: 'blur(1px)' }}
            />

            {/* Glass panel */}
            <motion.div
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="fixed right-0 top-0 bottom-0 w-[300px] z-50 flex flex-col"
              style={{
                background: 'rgba(255, 255, 255, 0.58)',
                backdropFilter: 'blur(32px) saturate(180%)',
                WebkitBackdropFilter: 'blur(32px) saturate(180%)',
                borderLeft: '1px solid rgba(255, 255, 255, 0.70)',
                boxShadow: '-2px 0 0 rgba(0,0,0,0.03), -8px 0 32px rgba(0,0,0,0.07)',
              }}
            >
              {/* Header */}
              <div
                className="flex items-center justify-between px-4 py-3.5"
                style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}
              >
                <div className="flex items-center gap-2">
                  <History className="w-3.5 h-3.5 text-fog/50" strokeWidth={1.75} />
                  <h3 className="text-[13px] font-semibold text-[var(--mist)] tracking-[-0.01em]">History Cases</h3>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="p-1.5 rounded-xl text-fog/50 hover:text-fog hover:bg-black/[0.04] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo/25"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* List */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2 scroll-thin">
                {loading && (
                  <div className="flex items-center justify-center py-8">
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
                    className={`w-full text-left rounded-xl px-3 py-2.5 transition-all duration-200 ${
                      c.id === activeCaseId
                        ? 'shadow-[0_1px_4px_rgba(91,138,247,0.10)]'
                        : 'hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)]'
                    }`}
                    style={
                      c.id === activeCaseId
                        ? {
                            background: 'rgba(91,138,247,0.07)',
                            border: '1px solid rgba(91,138,247,0.18)',
                          }
                        : {
                            background: 'rgba(255,255,255,0.45)',
                            border: '1px solid rgba(0,0,0,0.055)',
                          }
                    }
                    onMouseEnter={(e) => {
                      if (c.id !== activeCaseId) {
                        ;(e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.72)'
                        ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(0,0,0,0.09)'
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (c.id !== activeCaseId) {
                        ;(e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.45)'
                        ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(0,0,0,0.055)'
                      }
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_COLORS[c.status] || 'bg-smoke/40'}`} />
                      <span className="text-[12px] font-medium text-[var(--mist)] truncate">
                        {TYPE_LABELS[c.type] || c.type}
                      </span>
                      <span className="text-[10px] text-fog/50 flex-shrink-0 ml-auto flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDate(c.createdAt)}
                      </span>
                    </div>
                    {c.summary && (
                      <p className="mt-1 text-[11px] text-fog/60 line-clamp-2">{c.summary}</p>
                    )}
                    <div className="mt-1.5 flex items-center gap-3 text-[10px] text-fog/50">
                      <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" />{c.messageCount}</span>
                      <span>{c.status}</span>
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
