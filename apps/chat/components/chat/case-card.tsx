'use client'

// CaseCard — customer case dashboard
// Position: top-left, slides in from edge
// Auto-names the case from first user message (ChatGPT-style)

import { useState, useEffect } from 'react'

export type CaseStatus = 'created' | 'investigating' | 'collecting' | 'waiting_human' | 'resolved'

interface CaseCardData {
  caseId: string
  title?: string
  type?: string
  status: CaseStatus
  confirmedFacts?: Record<string, unknown>
  skillsCalled?: string[]
  missingFacts?: string[]
}

interface CaseCardProps {
  data: CaseCardData | null
  onDismiss?: () => void
}

const STATUS_META: Record<CaseStatus, { label: string; dot: string; ring: string }> = {
  created:        { label: 'New',       dot: 'bg-smoke',                          ring: '' },
  investigating:  { label: 'Processing', dot: 'bg-indigo animate-breathe',         ring: 'shadow-[0_0_12px_rgba(91,110,245,0.08)]' },
  collecting:     { label: 'Need Info',  dot: 'bg-amber animate-breathe',          ring: 'shadow-[0_0_12px_rgba(212,145,46,0.08)]' },
  waiting_human:  { label: 'Escalated',  dot: 'bg-vermillion animate-breathe',     ring: 'shadow-[0_0_12px_rgba(230,69,57,0.1)]' },
  resolved:       { label: 'Resolved',   dot: 'bg-malachite',                      ring: 'shadow-[0_0_12px_rgba(46,160,74,0.06)]' },
}

export default function CaseCard({ data, onDismiss }: CaseCardProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (data) {
      const t = setTimeout(() => setVisible(true), 150)
      return () => clearTimeout(t)
    }
    setVisible(false)
  }, [data?.caseId])

  if (!data) return null

  const { title, type, status, confirmedFacts, skillsCalled, missingFacts } = data
  const facts = Object.entries(confirmedFacts || {})
  const meta = STATUS_META[status]
  const displayTitle = title || type || 'Case'

  return (
    <div
      className={`fixed top-20 left-4 z-40 transition-all duration-700 ease-out ${
        visible ? 'translate-x-0 opacity-100' : '-translate-x-6 opacity-0'
      }`}
    >
      {collapsed ? (
        <button
          onClick={() => setCollapsed(false)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-abyss/90 backdrop-blur-sm border border-[var(--border-subtle)] hover:border-[var(--border-hover)] transition-all duration-300"
        >
          <span className={`inline-block w-[6px] h-[6px] rounded-full flex-shrink-0 ${meta.dot}`} />
          <span className="text-[11px] font-sans tracking-[0.03em] uppercase text-fog/70 truncate max-w-[120px]">
            {displayTitle}
          </span>
        </button>
      ) : (
        <div className={`w-60 rounded-xl bg-abyss/95 backdrop-blur-sm border border-[var(--border-subtle)] ${meta.ring} transition-shadow duration-500`}>
          {/* ── Header: title + collapse ── */}
          <div className="flex items-start justify-between px-3 pt-3 pb-1">
            <div className="min-w-0 flex-1">
              <h4 className="text-[13px] font-sans font-medium text-mist leading-snug truncate">
                {displayTitle}
              </h4>
              <div className="flex items-center gap-1.5 mt-1">
                <span className={`inline-block w-[5px] h-[5px] rounded-full flex-shrink-0 ${meta.dot}`} />
                <span className="text-[10px] font-sans tracking-[0.04em] uppercase text-fog/50">
                  {meta.label}
                </span>
              </div>
            </div>
            <button
              onClick={() => setCollapsed(true)}
              className="text-fog/20 hover:text-fog/50 transition-colors flex-shrink-0 ml-2"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
          </div>

          {/* ── Facts — green check = confirmed, hollow = missing ── */}
          {facts.length > 0 && (
            <div className="px-3 pt-2">
              <div className="space-y-1">
                {facts.map(([key, value]) => (
                  <div key={key} className="flex items-center gap-1.5">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(46,160,74,0.6)" strokeWidth="2" className="flex-shrink-0"><polyline points="20 6 9 17 4 12"/></svg>
                    <span className="text-[11px] text-fog/60 truncate">{String(value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(missingFacts && missingFacts.length > 0) && (
            <div className="px-3 pt-1.5">
              <div className="space-y-1">
                {missingFacts.slice(0, 3).map((f) => (
                  <div key={f} className="flex items-center gap-1.5">
                    <span className="inline-block w-[10px] h-[10px] rounded-full border border-fog/15 flex-shrink-0" />
                    <span className="text-[11px] text-fog/30">{f}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Skills ── */}
          {skillsCalled && skillsCalled.length > 0 && (
            <div className="px-3 pt-2 pb-3">
              <div className="border-t border-[var(--border-subtle)] pt-2">
                <p className="text-[9px] font-sans tracking-[0.05em] uppercase text-fog/30 mb-1.5">Actions</p>
                <div className="flex flex-wrap gap-1">
                  {skillsCalled.map((s) => (
                    <span key={s} className="text-[10px] font-mono text-fog/50 bg-[var(--surface)] px-1.5 py-0.5 rounded">
                      {s.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Footer: dismiss (resolved only) ── */}
          {onDismiss && status === 'resolved' && (
            <div className="px-3 pb-3">
              <button onClick={onDismiss} className="text-[10px] text-fog/30 hover:text-fog/60 transition-colors">
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
