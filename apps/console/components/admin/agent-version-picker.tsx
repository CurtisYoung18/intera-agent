'use client'

// Custom version-switcher dropdown. Replaces native <select> in the playground top-bar
// and the editor page. Scoped to versions of the same (orgId, name) — to switch
// between names, use the Agent Management drawer.
//
// Behavior:
//  - Trigger button: "name · vN · ACTIVE/DRAFT" (compact frosted pill)
//  - Popover: list of versions of the current name, each with Switch / Activate /
//    Open-in-editor / Delete actions. Footer: "+ Fork this version" + "Open editor"
//  - Closes on outside click + Escape
//  - When the parent doesn't pass an `agentId`, the trigger renders a "Select agent"
//    placeholder; the popover shows the full flat list as a fallback.

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronDown, GitBranch, Loader2, AlertCircle, Trash2, Play, X, Bot,
} from 'lucide-react'
import { useConsoleLocale } from '@/components/locale-provider'

interface AgentVersion {
  id: string
  name: string
  version: number
  isActive: boolean
  parentId: string | null
  model: string | null
  createdAt: string
  updatedAt: string
  releaseNote?: string | null
  publishedAt?: string | null
  publishedBy?: string | null
}

interface AgentVersionPickerProps {
  agentId: string | null
  onChange: (newAgentId: string) => void
  /** Fires after any operation that mutates the version list (fork/activate/delete) */
  onAgentsChanged?: () => void
}

function formatModelShort(model: string | null): string {
  if (!model) return '—'
  if (model.includes('MiniMax-M3')) return 'M3'
  if (model.includes('MiniMax-M2.7-highspeed')) return 'M2.7'
  if (model.includes('MiniMax-M2.5-highspeed')) return 'M2.5'
  if (model.includes('claude-haiku-4-5')) return 'Haiku 4.5'
  if (model.includes('claude-sonnet-4')) return 'Sonnet 4'
  if (model.includes('claude-opus-4')) return 'Opus 4'
  if (model.includes('deepseek-v4-pro')) return 'DeepSeek V4 Pro'
  if (model.includes('deepseek-v4-flash')) return 'DeepSeek V4 Flash'
  if (model.includes('deepseek')) return 'DeepSeek'
  return model
}

function formatDateShort(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}

export default function AgentVersionPicker({
  agentId,
  onChange,
  onAgentsChanged,
}: AgentVersionPickerProps) {
  const { t } = useConsoleLocale()
  const [open, setOpen] = useState(false)
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number; minWidth: number } | null>(null)
  const [allVersions, setAllVersions] = useState<AgentVersion[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [activateTarget, setActivateTarget] = useState<string | null>(null)
  const [activateNote, setActivateNote] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Find current row in the last-fetched list
  const current = allVersions.find(v => v.id === agentId)
  const currentName = current?.name
  const currentVersion = current?.version
  const currentIsActive = current?.isActive ?? false

  // Versions of the same name as the current, sorted ascending
  const sameName = currentName
    ? allVersions.filter(v => v.name === currentName).sort((a, b) => a.version - b.version)
    : []

  // Close on outside click + Escape. Checks both the trigger container and the
  // portal-rendered popover so clicks inside either are ignored.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (containerRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [open])

  // Compute popover position when opening — uses position: fixed so the popover
  // escapes any z-index stacking context its container might create.
  useEffect(() => {
    if (!open) {
      setPopoverPos(null)
      return
    }
    const compute = () => {
      const btn = buttonRef.current
      if (!btn) return
      const rect = btn.getBoundingClientRect()
      setPopoverPos({
        top: rect.bottom + 6,
        left: rect.left,
        minWidth: Math.max(340, rect.width),
      })
    }
    compute()
    // Reposition on scroll/resize so the popover stays anchored
    window.addEventListener('scroll', compute, true)
    window.addEventListener('resize', compute)
    return () => {
      window.removeEventListener('scroll', compute, true)
      window.removeEventListener('resize', compute)
    }
  }, [open])

  // Re-fetch when opening, and whenever the parent changes agentId (in case the
  // server-side list has shifted — e.g. someone activated a different version).
  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const r = await fetch('/api/admin/agent-configs')
      const d = await r.json()
      if (!r.ok) {
        setError((typeof d.error === 'string' ? d.error : d.error?.message) || t('agentDrawer.loadError'))
        return
      }
      setAllVersions(d.data?.configs || d.configs || [])
    } catch {
      setError(t('agentDrawer.loadError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (open) fetchAll()
  }, [open, fetchAll])

  // If the parent changes agentId and the cached list doesn't include it (cold
  // load, or a stale localStorage value), fetch once so we know the name.
  useEffect(() => {
    if (agentId && allVersions.length === 0) {
      fetchAll()
    }
  }, [agentId, allVersions.length, fetchAll])

  const handleSwitch = (id: string) => {
    if (id === agentId) { setOpen(false); return }
    onChange(id)
    setOpen(false)
  }

  const handleActivate = (id: string) => {
    setActivateTarget(id)
    setActivateNote('')
  }

  const confirmActivate = async () => {
    const id = activateTarget
    if (!id) return
    setActivateTarget(null)
    setBusyId(id)
    setError('')
    try {
      const r = await fetch(`/api/admin/agent-configs/${id}/activate`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ releaseNote: activateNote.trim() || undefined }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        setError((typeof d.error === 'string' ? d.error : d.error?.message) || t('agentVersion.activateError'))
        return
      }
      await fetchAll()
      onAgentsChanged?.()
      onChange(id)
      setOpen(false)
    } catch {
      setError(t('agentVersion.activateError'))
    } finally {
      setBusyId(null)
    }
  }

  const handleFork = async () => {
    if (!agentId) return
    setBusyId(agentId)
    setError('')
    try {
      const r = await fetch(`/api/admin/agent-configs/${agentId}/fork`, { method: 'POST' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        setError((typeof d.error === 'string' ? d.error : d.error?.message) || t('agentVersion.forkError'))
        return
      }
      const cfg = d.data?.config ?? d.config
      if (cfg?.id) {
        await fetchAll()
        onAgentsChanged?.()
        onChange(cfg.id)
        setOpen(false)
      }
    } catch {
      setError(t('agentVersion.forkError'))
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm(t('common.deleteConfirm', { name: currentName ?? '' }))) return
    setBusyId(id)
    setError('')
    try {
      const r = await fetch(`/api/admin/agent-configs/${id}`, { method: 'DELETE' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        setError((typeof d.error === 'string' ? d.error : d.error?.message) || t('agentVersion.deleteBlockedChildren'))
        return
      }
      // If we deleted the one currently selected, fall back to the active sibling
      // of the same name (or any other row).
      if (id === agentId) {
        const resp = await fetch('/api/admin/agent-configs').then(r => r.json()); const list = resp.data || resp
        const all: AgentVersion[] = list.configs || []
        const fallback =
          (currentName ? all.find(v => v.name === currentName && v.isActive) : null) ??
          all.find(v => v.id !== id)
        if (fallback) onChange(fallback.id)
      }
      await fetchAll()
      onAgentsChanged?.()
    } catch {
      setError(t('agentDrawer.deleteError'))
    } finally {
      setBusyId(null)
    }
  }

  const hasCurrent = !!current
  const showFullList = !hasCurrent && allVersions.length > 0

  return (
    <>
      <div ref={containerRef} style={{ display: 'inline-block' }}>
      {/* ── Trigger button ── */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 10px 6px 10px',
          borderRadius: 10,
          background: open ? 'rgba(91,138,247,0.10)' : 'rgba(255,255,255,0.55)',
          border: open ? '1px solid rgba(91,138,247,0.25)' : '1px solid var(--border-subtle)',
          cursor: 'pointer',
          fontFamily: 'inherit',
          transition: 'all 0.15s',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        }}
        onMouseEnter={e => {
          if (!open) e.currentTarget.style.background = 'rgba(91,138,247,0.06)'
        }}
        onMouseLeave={e => {
          if (!open) e.currentTarget.style.background = 'rgba(255,255,255,0.55)'
        }}
      >
        {hasCurrent ? (
          <span
            aria-hidden
            style={{
              width: 6, height: 6, borderRadius: '50%',
              background: currentIsActive ? 'var(--malachite)' : 'var(--fog)',
              opacity: currentIsActive ? 1 : 0.4,
              boxShadow: currentIsActive ? '0 0 0 2px rgba(46,160,74,0.18)' : 'none',
              flexShrink: 0,
            }}
          />
        ) : (
          <Bot size={12} color="var(--fog)" style={{ opacity: 0.5, flexShrink: 0 }} />
        )}
        <span style={{
          fontSize: 13, fontWeight: 600, color: 'var(--mist)',
          maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {hasCurrent ? currentName : (agentId ? '…' : t('common.loading'))}
        </span>
        {currentVersion !== undefined && (
          <span style={{
            fontSize: 10, fontWeight: 600, color: 'var(--fog)',
            padding: '1px 6px', borderRadius: 5,
            background: 'rgba(0,0,0,0.05)',
            fontVariantNumeric: 'tabular-nums',
            flexShrink: 0,
          }}>
            v{currentVersion}
          </span>
        )}
        {hasCurrent && (
          <span style={{
            fontSize: 9, fontWeight: 700,
            color: currentIsActive ? 'var(--malachite)' : 'var(--fog)',
            padding: '1px 5px', borderRadius: 4,
            background: currentIsActive ? 'rgba(46,160,74,0.10)' : 'rgba(0,0,0,0.05)',
            textTransform: 'uppercase', letterSpacing: '0.04em',
            flexShrink: 0,
          }}>
            {currentIsActive ? t('agentVersion.active') : t('agentVersion.draft')}
          </span>
        )}
        <ChevronDown
          size={12}
          color="var(--fog)"
          style={{
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.15s',
            opacity: 0.6,
            flexShrink: 0,
          }}
        />
      </button>

      </div>

      {/* ── Popover rendered via portal to document.body ── */}
      {open && popoverPos && createPortal(
        <div
          ref={popoverRef}
          role="dialog"
          style={{
            position: 'fixed',
            top: popoverPos.top,
            left: popoverPos.left,
            minWidth: popoverPos.minWidth,
            width: 340,
            maxWidth: 'calc(100vw - 16px)',
            zIndex: 9999,
            background: 'rgba(255,255,255,0.96)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 14,
            boxShadow: '0 16px 48px -12px rgba(15,23,42,0.28), 0 0 0 1px rgba(0,0,0,0.02)',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div style={{
            padding: '10px 12px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          }}>
            <span style={{
              fontSize: 11, fontWeight: 700, color: 'var(--mist)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {currentName ?? (showFullList ? t('agentDrawer.title') : '…')}
            </span>
            {hasCurrent && (
              <span style={{ fontSize: 10, color: 'var(--fog)', opacity: 0.6, flexShrink: 0 }}>
                {t('agentVersion.versionsCount', { n: sameName.length, n2: sameName.length !== 1 ? 's' : '' })}
              </span>
            )}
          </div>

          {/* Error banner */}
          {error && (
            <div style={{
              margin: '8px 10px 0', padding: '7px 10px', borderRadius: 8,
              background: 'rgba(230,69,57,0.06)', border: '1px solid rgba(230,69,57,0.14)',
              fontSize: 11, color: 'var(--vermillion)', lineHeight: 1.4,
              display: 'flex', alignItems: 'flex-start', gap: 6,
            }}>
              <AlertCircle size={12} color="var(--vermillion)" style={{ flexShrink: 0, marginTop: 1 }} />
              <span style={{ flex: 1 }}>{error}</span>
              <button
                type="button"
                onClick={() => setError('')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--vermillion)', padding: 0, lineHeight: 1 }}
                aria-label="Dismiss error"
              >
                <X size={11} />
              </button>
            </div>
          )}

          {/* Body */}
          <div style={{ padding: '6px 6px', maxHeight: 320, overflowY: 'auto' }}>
            {loading && allVersions.length === 0 ? (
              <div style={{ padding: '24px 12px', display: 'flex', justifyContent: 'center' }}>
                <Loader2 size={16} className="animate-spin" color="var(--fog)" />
              </div>
            ) : hasCurrent && sameName.length === 0 ? (
              <div style={{ padding: '20px 12px', textAlign: 'center' }}>
                <p style={{ fontSize: 11, color: 'var(--fog)', opacity: 0.55, margin: 0 }}>
                  {t('common.noMatches')}
                </p>
              </div>
            ) : showFullList ? (
              <FullList
                allVersions={allVersions}
                currentId={agentId}
                onSwitch={handleSwitch}
                onActivate={handleActivate}
                onDelete={handleDelete}
                busyId={busyId}
                t={t}
              />
            ) : (
              sameName.map(v => (
                <VersionRow
                  key={v.id}
                  v={v}
                  isCurrent={v.id === agentId}
                  canDelete={sameName.length > 1}
                  onSwitch={handleSwitch}
                  onActivate={handleActivate}
                  onDelete={handleDelete}
                  busy={busyId === v.id}
                  t={t}
                />
              ))
            )}
          </div>

          {/* Footer */}
          <div style={{
            display: 'flex', borderTop: '1px solid var(--border-subtle)',
            background: 'rgba(0,0,0,0.015)',
          }}>
            <button
              type="button"
              onClick={handleFork}
              disabled={!agentId || busyId === agentId}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                padding: '9px 8px',
                fontSize: 11, fontWeight: 600, color: 'var(--indigo)',
                background: 'transparent', border: 'none',
                borderRight: '1px solid var(--border-subtle)',
                cursor: !agentId || busyId === agentId ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
                opacity: !agentId ? 0.4 : 1,
                transition: 'background 0.12s',
              }}
              onMouseEnter={e => { if (agentId && busyId !== agentId) e.currentTarget.style.background = 'rgba(91,138,247,0.06)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              {busyId === agentId ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <GitBranch size={11} />
              )}
              {t('agentVersion.forkAsNew')}
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* ── Activate release note dialog ── */}
      {activateTarget && createPortal(
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 10000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.2)', backdropFilter: 'blur(4px)',
          }}
          onClick={() => setActivateTarget(null)}
        >
          <div
            style={{
              background: '#fff', borderRadius: 16,
              border: '1px solid var(--border-subtle)',
              boxShadow: '0 20px 60px -12px rgba(15,23,42,0.35)',
              padding: 20, width: 380, maxWidth: 'calc(100vw - 32px)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--mist)', margin: '0 0 4px' }}>
              {t('agentVersion.activateTitle')}
            </h3>
            <p style={{ fontSize: 11, color: 'var(--fog)', margin: '0 0 14px', lineHeight: 1.5 }}>
              {t('agentVersion.activateDesc')}
            </p>
            <textarea
              value={activateNote}
              onChange={e => setActivateNote(e.target.value)}
              placeholder={t('agentVersion.releaseNotePlaceholder')}
              rows={3}
              style={{
                width: '100%', padding: '8px 10px', borderRadius: 10,
                border: '1px solid var(--border-subtle)', outline: 'none',
                fontSize: 12, color: 'var(--mist)', resize: 'vertical',
                fontFamily: 'inherit',
              }}
              onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) confirmActivate() }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setActivateTarget(null)}
                style={{
                  padding: '7px 16px', borderRadius: 10, fontSize: 12, fontWeight: 500,
                  color: 'var(--fog)', border: '1px solid var(--border-subtle)',
                  background: 'transparent', cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={confirmActivate}
                style={{
                  padding: '7px 20px', borderRadius: 10, fontSize: 12, fontWeight: 600,
                  color: '#fff', background: 'var(--malachite)', border: 'none',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {t('agentVersion.activate')}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

/* ── Version row (one of same-name) ── */

function VersionRow({
  v,
  isCurrent,
  canDelete,
  onSwitch,
  onActivate,
  onDelete,
  busy,
  t,
}: {
  v: AgentVersion
  isCurrent: boolean
  canDelete: boolean
  onSwitch: (id: string) => void
  onActivate: (id: string) => void
  onDelete: (id: string) => void
  busy: boolean
  t: (key: string, vars?: Record<string, string | number>) => string
}) {
  return (
    <div
      style={{
        padding: '7px 8px', borderRadius: 8,
        background: isCurrent ? 'rgba(91,138,247,0.06)' : 'transparent',
        border: isCurrent ? '1px solid rgba(91,138,247,0.18)' : '1px solid transparent',
        marginBottom: 2,
        transition: 'background 0.12s',
      }}
      onMouseEnter={e => { if (!isCurrent) e.currentTarget.style.background = 'rgba(0,0,0,0.025)' }}
      onMouseLeave={e => { if (!isCurrent) e.currentTarget.style.background = 'transparent' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          onClick={() => onSwitch(v.id)}
          disabled={busy}
          style={{
            flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8,
            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            textAlign: 'left', fontFamily: 'inherit',
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--mist)', fontVariantNumeric: 'tabular-nums' }}>
            v{v.version}
          </span>
          {v.isActive ? (
            <span style={{
              fontSize: 9, fontWeight: 700, color: '#fff',
              padding: '2px 6px', borderRadius: 4,
              background: 'var(--malachite)',
              textTransform: 'uppercase', letterSpacing: '0.04em',
              boxShadow: '0 0 0 2px rgba(46,160,74,0.20)',
            }}>
              {t('agentVersion.active')}
            </span>
          ) : (
            <span style={{
              fontSize: 9, fontWeight: 600, color: 'var(--fog)',
              padding: '2px 6px', borderRadius: 4,
              background: 'rgba(0,0,0,0.06)', textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>
              {t('agentVersion.draft')}
            </span>
          )}
          <span style={{ fontSize: 10, color: 'var(--fog)', opacity: 0.6, marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
            {formatModelShort(v.model)} · {formatDateShort(v.updatedAt)}
          </span>
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
          {!v.isActive && (
            <IconBtn
              icon={Play}
              title={t('agentVersion.activate')}
              onClick={() => onActivate(v.id)}
              disabled={busy}
            />
          )}
          {canDelete && (
            <IconBtn
              icon={Trash2}
              title={t('common.delete')}
              onClick={() => onDelete(v.id)}
              disabled={busy}
              danger
            />
          )}
        </div>
      </div>
      {/* Release note + publish info */}
      {v.releaseNote && (
        <div style={{ marginTop: 3, paddingLeft: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, color: 'var(--fog)', lineHeight: 1.3, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {v.releaseNote}
          </span>
          {v.publishedAt && (
            <span style={{ fontSize: 9, color: 'var(--fog)', opacity: 0.45, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
              {formatDateShort(v.publishedAt)}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Full list (when no current name) — grouped by name ── */

function FullList({
  allVersions,
  currentId,
  onSwitch,
  onActivate,
  onDelete,
  busyId,
  t,
}: {
  allVersions: AgentVersion[]
  currentId: string | null
  onSwitch: (id: string) => void
  onActivate: (id: string) => void
  onDelete: (id: string) => void
  busyId: string | null
  t: (key: string, vars?: Record<string, string | number>) => string
}) {
  // Group by name; sort names alphabetically, versions ascending within each
  const grouped = new Map<string, AgentVersion[]>()
  for (const v of allVersions) {
    const arr = grouped.get(v.name) ?? []
    arr.push(v)
    grouped.set(v.name, arr)
  }
  const groups = Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, vs]) => ({ name, vs: vs.sort((a, b) => a.version - b.version) }))

  return (
    <>
      {groups.map((g, gi) => (
        <div key={g.name} style={{ marginBottom: gi < groups.length - 1 ? 6 : 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '6px 8px 4px',
          }}>
            <span style={{
              fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em',
              color: 'var(--fog)', opacity: 0.55,
            }}>
              {g.name}
            </span>
            <span style={{ fontSize: 9, color: 'var(--fog)', opacity: 0.4, fontVariantNumeric: 'tabular-nums' }}>
              {t('agentVersion.versionsCount', { n: g.vs.length, n2: g.vs.length !== 1 ? 's' : '' })}
            </span>
          </div>
          {g.vs.map(v => (
            <VersionRow
              key={v.id}
              v={v}
              isCurrent={v.id === currentId}
              canDelete={g.vs.length > 1}
              onSwitch={onSwitch}
              onActivate={onActivate}
              onDelete={onDelete}
              busy={busyId === v.id}
              t={t}
            />
          ))}
        </div>
      ))}
    </>
  )
}

/* ── Tiny icon button ── */

function IconBtn({
  icon: Icon,
  onClick,
  title,
  disabled,
  danger,
}: {
  icon: React.ComponentType<{ size?: number; color?: string; className?: string }>
  onClick: () => void
  title: string
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={{
        width: 24, height: 24, borderRadius: 6,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'transparent', border: 'none',
        color: 'var(--fog)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.35 : 0.7,
        transition: 'all 0.12s',
      }}
      onMouseEnter={e => {
        if (disabled) return
        e.currentTarget.style.background = danger ? 'rgba(230,69,57,0.08)' : 'rgba(0,0,0,0.05)'
        e.currentTarget.style.opacity = '1'
        e.currentTarget.style.color = danger ? 'var(--vermillion)' : 'var(--mist)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.opacity = disabled ? '0.35' : '0.7'
        e.currentTarget.style.color = 'var(--fog)'
      }}
    >
      <Icon size={11} />
    </button>
  )
}
