'use client'

// CaseCard — floating case dashboard
// Appears when agent identifies a case, slides in from left edge
// Auto-collapses after 30s inactivity, dismissable when resolved

import { useState, useEffect, useRef } from 'react'
import { X } from 'lucide-react'

export type CaseStatus = 'created' | 'investigating' | 'collecting' | 'waiting_human' | 'resolved' | 'escalated'

export interface CaseCardData {
  caseId: string
  title?: string
  type?: string
  status: CaseStatus
  confirmedFacts?: Record<string, unknown>
  skillsCalled?: string[]
  missingFacts?: string[]
  stage?: string
  subAgentCount?: number
  subAgentsRunning?: boolean
}

interface CaseCardProps {
  data: CaseCardData | null
  onDismiss?: () => void
  /** rail = dock in split-layout left column; floating = overlay (narrow mode) */
  variant?: 'floating' | 'rail'
}

const STATUS_META: Record<CaseStatus, { label: string; dot: string; ring: string }> = {
  created:        { label: 'New',       dot: 'bg-smoke',                          ring: '' },
  investigating:  { label: 'Processing', dot: 'bg-indigo animate-breathe',         ring: 'shadow-[0_0_16px_rgba(91,110,245,0.12)]' },
  collecting:     { label: 'Need Info',  dot: 'bg-amber animate-breathe',          ring: 'shadow-[0_0_16px_rgba(212,145,46,0.1)]' },
  escalated:      { label: 'Escalated',  dot: 'bg-red animate-breathe',            ring: 'shadow-[0_0_16px_rgba(239,68,68,0.12)]' },
  waiting_human:  { label: 'Escalated',  dot: 'bg-vermillion animate-breathe',     ring: 'shadow-[0_0_16px_rgba(230,69,57,0.12)]' },
  resolved:       { label: 'Resolved',   dot: 'bg-malachite',                      ring: 'shadow-[0_0_16px_rgba(46,160,74,0.1)]' },
}

const AUTO_COLLAPSE_MS = 30000

export default function CaseCard({ data, onDismiss, variant = 'floating' }: CaseCardProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [visible, setVisible] = useState(false)
  const [exiting, setExiting] = useState(false)
  const autoCollapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset auto-collapse timer on data change (floating only — rail stays open)
  const resetAutoCollapse = () => {
    if (variant === 'rail') return
    if (autoCollapseTimer.current) clearTimeout(autoCollapseTimer.current)
    autoCollapseTimer.current = setTimeout(() => setCollapsed(true), AUTO_COLLAPSE_MS)
  }

  useEffect(() => {
    if (variant === 'rail') {
      setCollapsed(false)
      if (autoCollapseTimer.current) clearTimeout(autoCollapseTimer.current)
    }
  }, [variant])

  useEffect(() => {
    if (data) {
      setExiting(false)
      const t = setTimeout(() => setVisible(true), 150)
      resetAutoCollapse()
      return () => clearTimeout(t)
    }
    setVisible(false)
    return () => {
      if (autoCollapseTimer.current) clearTimeout(autoCollapseTimer.current)
    }
  }, [data?.caseId, variant])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (autoCollapseTimer.current) clearTimeout(autoCollapseTimer.current)
      if (exitTimer.current) clearTimeout(exitTimer.current)
    }
  }, [])

  const handleDismiss = () => {
    setExiting(true)
    setVisible(false)
    exitTimer.current = setTimeout(() => {
      onDismiss?.()
      setExiting(false)
    }, 350)
  }

  const handleExpand = () => {
    setCollapsed(false)
    resetAutoCollapse()
  }

  if (!data && !exiting) return null

  const { title, type, status, confirmedFacts, skillsCalled, missingFacts, stage, subAgentCount, subAgentsRunning } = data || {}
  const facts = Object.entries(confirmedFacts || {})
  const meta = (status && STATUS_META[status]) || STATUS_META.created
  const displayTitle = title || type || 'Case'
  const showDismiss = onDismiss && status === 'resolved'
  const shownMissing = (missingFacts || []).slice(0, 3)
  const remainingMissing = (missingFacts || []).length - 3

  const isRail = variant === 'rail'

  return (
    <div
      onMouseEnter={resetAutoCollapse}
      onFocus={resetAutoCollapse}
      className={
        isRail
          ? visible && !exiting
            ? 'w-full translate-y-0 opacity-100 transition-all duration-300 ease-out'
            : 'w-full -translate-y-1 opacity-0 transition-all duration-300 ease-out'
          : `fixed left-4 top-20 z-40 transition-all duration-500 ease-out max-sm:right-4 max-sm:left-auto max-sm:top-16
        ${visible && !exiting ? 'translate-x-0 opacity-100' : '-translate-x-6 opacity-0'}
      `
      }
    >
      {collapsed && !exiting ? (
        <button
          onClick={handleExpand}
          aria-expanded="false"
          aria-label={`Expand case: ${displayTitle}`}
          className={`flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-abyss/90 px-3 py-1.5 backdrop-blur-xl transition-all duration-300 hover:border-[var(--border-hover)] hover:shadow-[0_0_20px_rgba(91,110,245,0.06)] ${
            isRail ? 'w-full justify-center' : ''
          }`}
        >
          <span className={`inline-block w-[6px] h-[6px] rounded-full flex-shrink-0 ${meta.dot}`} />
          <span className="text-[11px] font-sans tracking-[0.03em] uppercase text-fog/70 truncate max-w-[140px]">
            {displayTitle}
          </span>
        </button>
      ) : (
        <div
          className={`w-full rounded-2xl border border-[var(--border-subtle)] bg-abyss/90 backdrop-blur-xl transition-shadow duration-500 ${
            isRail ? 'max-w-none shadow-sm' : 'w-64'
          } ${meta.ring}`}
        >
          {/* Header */}
          <div className="flex items-start justify-between px-4 pt-4 pb-1">
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
              {stage && (
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-[10px] font-sans text-fog/40 capitalize">
                    {stage.replace(/_/g, ' ')}
                  </span>
                  {subAgentsRunning && subAgentCount ? (
                    <span className="text-[10px] font-mono text-indigo/60">
                      +{subAgentCount} agent{subAgentCount !== 1 ? 's' : ''}
                    </span>
                  ) : null}
                </div>
              )}
            </div>
            <div className="flex items-center gap-0.5 flex-shrink-0 ml-2">
              {showDismiss && (
                <button
                  onClick={handleDismiss}
                  aria-label="Dismiss case"
                  className="p-1 rounded-md text-fog/20 hover:text-vermillion/60 hover:bg-vermillion/[0.06] transition-all"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
              <button
                onClick={() => setCollapsed(true)}
                aria-expanded="true"
                aria-label="Collapse case card"
                className="p-1 rounded-md text-fog/20 hover:text-fog/50 transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <polyline points="15 18 9 12 15 6"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Confirmed Facts */}
          {facts.length > 0 && (
            <div className="px-4 pt-2.5">
              <p className="text-[9px] font-sans tracking-[0.05em] uppercase text-fog/25 mb-1.5">Facts</p>
              <div className="space-y-1">
                {facts.map(([key, value]) => (
                  <div key={key} className="flex items-center gap-1.5">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(46,160,74,0.6)" strokeWidth="2" className="flex-shrink-0">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    <span className="text-[11px] text-fog/60 truncate">{String(value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Missing Facts */}
          {(missingFacts && missingFacts.length > 0) && (
            <div className="px-4 pt-2">
              <p className="text-[9px] font-sans tracking-[0.05em] uppercase text-fog/25 mb-1.5">Needs</p>
              <div className="space-y-1">
                {shownMissing.map((f) => (
                  <div key={f} className="flex items-center gap-1.5">
                    <span className="inline-block w-[10px] h-[10px] rounded-full border border-fog/15 flex-shrink-0" />
                    <span className="text-[11px] text-fog/35">{f}</span>
                  </div>
                ))}
                {remainingMissing > 0 && (
                  <span className="text-[10px] text-fog/20 pl-4">+{remainingMissing} more</span>
                )}
              </div>
            </div>
          )}

          {/* Skills Called */}
          {skillsCalled && skillsCalled.length > 0 && (
            <div className="px-4 pt-2.5 pb-4">
              <div className="border-t border-[var(--border-subtle)] pt-2.5">
                <p className="text-[9px] font-sans tracking-[0.05em] uppercase text-fog/25 mb-1.5">Actions</p>
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

          {/* Empty state — no facts, no skills, no missing */}
          {facts.length === 0 && (!skillsCalled || skillsCalled.length === 0) && (!missingFacts || missingFacts.length === 0) && (
            <div className="px-4 pb-4 pt-1">
              <p className="text-[10px] text-fog/20 italic">Gathering information…</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
