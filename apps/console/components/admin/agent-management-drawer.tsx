'use client'

// Drawer for managing agent configurations.
//
// Layout:
//   - One card per (orgId, name). Each card represents a named agent with
//     multiple versions.
//   - The card header shows the name, the active version's model, and a
//     "N versions" pill.
//   - Clicking the body (not the action buttons) expands to show all versions.
//   - Per version: Activate (if draft) / Edit (navigates) / Fork / Delete.
//
// This pairs with AgentVersionPicker — the picker is the quick in-flow switcher
// in playground/editor; this drawer is the canonical "manage names + versions"
// surface.

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  Bot, Plus, Trash2, Check, Pencil, X, Loader2, AlertCircle, ChevronDown,
  ExternalLink, GitBranch, Play, Layers,
} from 'lucide-react'
import SlidePanel from '@/components/ui/slide-panel'
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
}

interface AgentManagementDrawerProps {
  open: boolean
  onClose: () => void
  activeAgentId: string | null
  onSelectAgent: (id: string) => void
  /** Called when the user wants the parent (sidebar) to refresh its list */
  onAgentsChanged?: () => void
}

function formatModel(model: string | null): string {
  if (!model) return '—'
  const m = model.match(/claude-([a-z]+)-?(\d+)?-?(\d+)?/i)
  if (m) {
    const family = m[1].charAt(0).toUpperCase() + m[1].slice(1)
    const ver = m[2] ? ` ${m[2]}` : ''
    return `${family}${ver}`.trim()
  }
  if (model.includes('MiniMax-M2.7-highspeed')) return 'M2.7'
  if (model.includes('MiniMax-M2.5-highspeed')) return 'M2.5'
  if (model.includes('deepseek-v4-pro')) return 'DeepSeek V4 Pro'
  if (model.includes('deepseek-v4-flash')) return 'DeepSeek V4 Flash'
  if (model.includes('deepseek')) return 'DeepSeek'
  return model
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    })
  } catch {
    return iso
  }
}

export default function AgentManagementDrawer({
  open,
  onClose,
  activeAgentId,
  onSelectAgent,
  onAgentsChanged,
}: AgentManagementDrawerProps) {
  const { t } = useConsoleLocale()
  const router = useRouter()
  const [allVersions, setAllVersions] = useState<AgentVersion[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [editingName, setEditingName] = useState<string | null>(null)
  const [editingNameValue, setEditingNameValue] = useState('')
  const [savingRename, setSavingRename] = useState(false)

  const [busyId, setBusyId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const r = await fetch('/api/admin/agent-configs')
      const d = await r.json()
      if (!r.ok) {
        setError(d.error || t('agentDrawer.loadError'))
        return
      }
      setAllVersions(d.configs || [])
    } catch {
      setError(t('agentDrawer.loadError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (open) refresh()
  }, [open, refresh])

  // Group by name; sort groups by name asc; within each group sort versions asc
  const groups = useMemo(() => {
    const map = new Map<string, AgentVersion[]>()
    for (const v of allVersions) {
      const arr = map.get(v.name) ?? []
      arr.push(v)
      map.set(v.name, arr)
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, vs]) => ({
        name,
        versions: vs.sort((a, b) => a.version - b.version),
        active: vs.find(v => v.isActive) ?? null,
      }))
  }, [allVersions])

  const toggleGroup = (name: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const handleCreate = async () => {
    setCreating(true)
    setError('')
    try {
      const r = await fetch('/api/admin/agent-configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `Agent ${groups.length + 1}` }),
      })
      const d = await r.json()
      if (!r.ok) {
        setError(d.error || t('agentDrawer.createError'))
        return
      }
      await refresh()
      onAgentsChanged?.()
      if (d.config?.id) {
        onSelectAgent(d.config.id)
        // Auto-expand the new group
        if (d.config.name) {
          setExpandedGroups(prev => new Set(prev).add(d.config.name))
        }
      }
    } catch {
      setError(t('agentDrawer.createError'))
    } finally {
      setCreating(false)
    }
  }

  const handleActivate = async (v: AgentVersion) => {
    setBusyId(v.id)
    setError('')
    try {
      const r = await fetch(`/api/admin/agent-configs/${v.id}/activate`, { method: 'PUT' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        setError(d.error || t('agentVersion.activateError'))
        return
      }
      await refresh()
      onAgentsChanged?.()
      onSelectAgent(v.id)
    } catch {
      setError(t('agentVersion.activateError'))
    } finally {
      setBusyId(null)
    }
  }

  const handleFork = async (v: AgentVersion) => {
    setBusyId(v.id)
    setError('')
    try {
      const r = await fetch(`/api/admin/agent-configs/${v.id}/fork`, { method: 'POST' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        setError(d.error || t('agentVersion.forkError'))
        return
      }
      await refresh()
      onAgentsChanged?.()
      // Auto-expand the group so the new version is visible
      setExpandedGroups(prev => new Set(prev).add(v.name))
    } catch {
      setError(t('agentVersion.forkError'))
    } finally {
      setBusyId(null)
    }
  }

  const handleDeleteAgent = async (name: string) => {
    setError('')
    try {
      const r = await fetch(`/api/admin/agent-configs?name=${encodeURIComponent(name)}`, { method: 'DELETE' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        setError(d.error || t('agentDrawer.deleteError'))
        return
      }
      // If the deleted agent was the active one, fall back to first remaining
      if (groups.find(g => g.name === name)?.active?.id === activeAgentId) {
        const list = await fetch('/api/admin/agent-configs').then(r => r.json())
        const all = (list.configs || []) as AgentVersion[]
        const fallback = all[0]
        if (fallback) onSelectAgent(fallback.id)
      }
      await refresh()
      onAgentsChanged?.()
    } catch {
      setError(t('agentDrawer.deleteError'))
    }
  }

  const handleDelete = async (v: AgentVersion) => {
    if (v.isActive && v.parentId) {
      // Allow deleting a draft that's an active? No — only drafts of the active.
      // The check is on the API side; here we just confirm.
    }
    if (!window.confirm(t('common.deleteConfirm', { name: `${v.name} v${v.version}` }))) return
    setBusyId(v.id)
    setError('')
    try {
      const r = await fetch(`/api/admin/agent-configs/${v.id}`, { method: 'DELETE' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        setError(d.error || t('agentVersion.deleteBlockedChildren'))
        return
      }
      // If we deleted the active one, fall back to the first remaining (the
      // server already auto-promoted a sibling inside the same transaction).
      if (v.id === activeAgentId) {
        const list = await fetch('/api/admin/agent-configs').then(r => r.json())
        const all = (list.configs || []) as AgentVersion[]
        const sameActive = all.find(x => x.name === v.name && x.isActive)
        const fallback = sameActive ?? all[0]
        if (fallback) onSelectAgent(fallback.id)
      }
      await refresh()
      onAgentsChanged?.()
    } catch {
      setError(t('agentDrawer.deleteError'))
    } finally {
      setBusyId(null)
    }
  }

  const handleEdit = (v: AgentVersion) => {
    router.push(`/admin/agent?agentId=${v.id}`)
    onClose()
  }

  const beginRename = (g: { name: string }) => {
    setEditingName(g.name)
    setEditingNameValue(g.name)
  }
  const cancelRename = () => {
    setEditingName(null)
    setEditingNameValue('')
  }
  const commitRename = async () => {
    if (!editingName) return
    const newName = editingNameValue.trim()
    if (!newName || newName === editingName) {
      cancelRename()
      return
    }
    setSavingRename(true)
    setError('')
    try {
      // The rename is per-version on the API, but propagates to the whole group.
      // We pick the active version to issue the rename against.
      const target = groups.find(g => g.name === editingName)?.active
        ?? groups.find(g => g.name === editingName)?.versions[0]
      if (!target) { cancelRename(); return }
      const r = await fetch(`/api/admin/agent-configs/${target.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        setError(d.error || t('agentDrawer.renameError'))
        return
      }
      await refresh()
      onAgentsChanged?.()
      cancelRename()
    } catch {
      setError(t('agentDrawer.renameError'))
    } finally {
      setSavingRename(false)
    }
  }

  return (
    <SlidePanel
      open={open}
      onClose={onClose}
      title={t('agentDrawer.title')}
    >
      <div className="space-y-5">
        {/* Header strip — count + new agent button */}
        <div className="flex items-center justify-between gap-3 -mt-1">
          <p className="text-[12px] text-[var(--fog)]">
            {t('agentDrawer.subtitle', { n: groups.length })}
          </p>
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo/10 px-3 py-1.5 text-[12px] font-semibold text-indigo hover:bg-indigo/15 disabled:opacity-50 transition-colors"
          >
            {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" strokeWidth={2.25} />}
            {t('agentDrawer.newAgent')}
          </button>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-vermillion/20 bg-vermillion/[0.06] px-3 py-2 text-[12px] text-vermillion">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError('')}
              className="ml-auto -mr-1 -mt-0.5 p-1 rounded hover:bg-vermillion/10"
              aria-label="Dismiss error"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Card grid — one card per (orgId, name) */}
        {loading && allVersions.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-12 text-[var(--fog)]">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-[12px]">{t('common.loading')}</span>
          </div>
        ) : groups.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-black/10 py-10 text-center">
            <p className="text-[13px] text-[var(--fog)]">{t('agentDrawer.empty')}</p>
            <p className="text-[11px] text-[var(--smoke)] mt-1">{t('agentDrawer.emptyDesc')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map(g => (
              <NameCard
                key={g.name}
                group={g}
                isExpanded={expandedGroups.has(g.name)}
                onToggle={() => toggleGroup(g.name)}
                isActiveGroup={g.active?.id === activeAgentId}
                isEditing={editingName === g.name}
                editingNameValue={editingNameValue}
                setEditingNameValue={setEditingNameValue}
                beginRename={() => beginRename(g)}
                cancelRename={cancelRename}
                commitRename={commitRename}
                savingRename={savingRename}
                onActivate={handleActivate}
                onFork={handleFork}
                onDelete={handleDelete}
                onDeleteAgent={handleDeleteAgent}
                onEdit={handleEdit}
                onSelectAgent={onSelectAgent}
                onClose={onClose}
                activeAgentId={activeAgentId}
                busyId={busyId}
                t={t}
              />
            ))}
          </div>
        )}
      </div>
    </SlidePanel>
  )
}

/* ── Name card (one per orgId+name) ── */

function NameCard({
  group,
  isExpanded,
  onToggle,
  isActiveGroup,
  isEditing,
  editingNameValue,
  setEditingNameValue,
  beginRename,
  cancelRename,
  commitRename,
  savingRename,
  onActivate,
  onFork,
  onDelete,
  onDeleteAgent,
  onEdit,
  onSelectAgent,
  onClose,
  activeAgentId,
  busyId,
  t,
}: {
  group: { name: string; versions: AgentVersion[]; active: AgentVersion | null }
  isExpanded: boolean
  onToggle: () => void
  isActiveGroup: boolean
  isEditing: boolean
  editingNameValue: string
  setEditingNameValue: (v: string) => void
  beginRename: () => void
  cancelRename: () => void
  commitRename: () => void
  savingRename: boolean
  onActivate: (v: AgentVersion) => void
  onFork: (v: AgentVersion) => void
  onDelete: (v: AgentVersion) => void
  onDeleteAgent: (name: string) => void
  onEdit: (v: AgentVersion) => void
  onSelectAgent: (id: string) => void
  onClose: () => void
  activeAgentId: string | null
  busyId: string | null
  t: (key: string, vars?: Record<string, string | number>) => string
}) {
  const n = group.versions.length
  return (
    <article
      className={`relative flex flex-col rounded-2xl border transition-all duration-200 overflow-hidden
        ${isActiveGroup
          ? 'border-indigo/40 bg-gradient-to-br from-indigo/[0.08] to-white shadow-[0_8px_24px_-12px_rgba(91,138,247,0.4)]'
          : 'border-black/[0.07] bg-white/60 hover:border-black/[0.12] hover:shadow-[0_4px_18px_-8px_rgba(15,23,42,0.18)]'
        }`}
    >
      {/* Accent strip on active card */}
      <div
        aria-hidden
        className={`absolute inset-x-0 top-0 h-[2px] transition-opacity ${
          isActiveGroup ? 'opacity-100' : 'opacity-0 group-hover:opacity-40'
        }`}
        style={{ background: 'linear-gradient(90deg, transparent, #5b8af7 30%, #8b6ff5 70%, transparent)' }}
      />

      <button
        type="button"
        onClick={() => { const v = group.active ?? group.versions[group.versions.length - 1]; if (v) onEdit(v) }}
        className="w-full text-left p-4 flex items-start gap-2.5 cursor-pointer"
      >
        <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border ${
          isActiveGroup
            ? 'border-indigo/30 bg-indigo/10'
            : 'border-black/[0.07] bg-black/[0.03]'
        }`}>
          <Bot className={`w-4 h-4 ${isActiveGroup ? 'text-indigo' : 'text-[var(--fog)]'}`} strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          {isEditing ? (
            <input
              autoFocus
              value={editingNameValue}
              onChange={(e) => setEditingNameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename()
                else if (e.key === 'Escape') cancelRename()
              }}
              onClick={(e) => e.stopPropagation()}
              disabled={savingRename}
              className="w-full rounded-md border border-indigo/30 bg-white px-2 py-1 text-[14px] font-semibold text-[var(--mist)] focus:outline-none focus:ring-2 focus:ring-indigo/25"
            />
          ) : (
            <h3 className="text-[14px] font-semibold text-[var(--mist)] truncate" title={group.name}>
              {group.name}
            </h3>
          )}
          <p className="text-[10.5px] text-[var(--smoke)] mt-0.5 truncate">
            {group.active ? formatModel(group.active.model) : '—'}
          </p>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span
            title={t('agentVersion.versionsCount', { n, n2: n !== 1 ? 's' : '' })}
            className="inline-flex items-center gap-1 rounded-full border border-black/[0.07] bg-black/[0.03] px-2 py-0.5 text-[10px] font-semibold text-[var(--fog)]"
          >
            <Layers className="w-2.5 h-2.5" />
            {n}
          </span>
          {isActiveGroup && (
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo/10 px-2 py-0.5 text-[10px] font-semibold text-indigo">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo animate-pulse" />
              {t('agentDrawer.active')}
            </span>
          )}
          <ChevronDown
            className={`w-3.5 h-3.5 text-[var(--fog)] transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            onClick={(e) => { e.stopPropagation(); onToggle() }}
          />
        </div>
      </button>

      {/* Header actions (rename + delete) — only when expanded & not editing */}
      {isExpanded && !isEditing && (
        <div className="flex items-center justify-end gap-1 border-t border-black/[0.04] bg-black/[0.012] px-3 py-1.5">
          <button
            type="button"
            onClick={beginRename}
            disabled={savingRename}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] text-[var(--fog)] hover:text-[var(--mist)] hover:bg-black/[0.04] transition-colors"
            title={t('common.edit')}
          >
            <Pencil className="w-3 h-3" />
            <span>Rename</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (!window.confirm(t('common.deleteConfirm', { name: group.name }))) return
              onDeleteAgent(group.name)
            }}
            disabled={savingRename}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] text-vermillion/70 hover:text-vermillion hover:bg-vermillion/[0.06] transition-colors"
            title={t('common.delete')}
          >
            <Trash2 className="w-3 h-3" />
            <span>{t('common.delete')}</span>
          </button>
        </div>
      )}

      {/* Editing state actions */}
      {isExpanded && isEditing && (
        <div className="flex items-stretch border-t border-black/[0.06] divide-x divide-black/[0.06] bg-black/[0.015]">
          <button
            type="button"
            onClick={commitRename}
            disabled={savingRename}
            className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 text-[11.5px] font-semibold text-indigo hover:bg-indigo/5 disabled:opacity-50 transition-colors"
          >
            {savingRename ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" strokeWidth={2.5} />}
            {t('common.save')}
          </button>
          <button
            type="button"
            onClick={cancelRename}
            disabled={savingRename}
            className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 text-[11.5px] font-semibold text-[var(--fog)] hover:bg-black/5 transition-colors"
          >
            <X className="w-3 h-3" strokeWidth={2.5} />
            {t('common.cancel')}
          </button>
        </div>
      )}

      {/* Version list */}
      {isExpanded && (
        <div className="border-t border-black/[0.06] bg-black/[0.012] divide-y divide-black/[0.04]">
          {group.versions.map(v => {
            const isCurrentRow = v.id === activeAgentId
            const isBusy = busyId === v.id
            return (
              <div
                key={v.id}
                className={`flex items-center gap-2 px-3 py-2 ${
                  isCurrentRow ? 'bg-indigo/[0.04]' : 'hover:bg-black/[0.015]'
                } transition-colors`}
              >
                {/* Version label + status */}
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <span className="text-[11.5px] font-bold text-[var(--mist)] font-mono tabular-nums">
                    v{v.version}
                  </span>
                  {v.isActive ? (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-malachite/10 px-1.5 py-0 text-[9px] font-bold text-malachite uppercase tracking-wider">
                      <span className="h-1 w-1 rounded-full bg-malachite" />
                      {t('agentVersion.active')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-black/[0.05] px-1.5 py-0 text-[9px] font-bold text-[var(--fog)] uppercase tracking-wider">
                      {t('agentVersion.draft')}
                    </span>
                  )}
                  <span className="text-[10px] text-[var(--smoke)] truncate">
                    {formatModel(v.model)} · {formatDate(v.createdAt)}
                  </span>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  {!v.isActive && (
                    <DrawerIconBtn
                      icon={Play}
                      title={t('agentVersion.activate')}
                      onClick={() => onActivate(v)}
                      disabled={isBusy}
                    />
                  )}
                  <DrawerIconBtn
                    icon={ExternalLink}
                    title={t('agentVersion.openEditor')}
                    onClick={() => onEdit(v)}
                    disabled={isBusy}
                  />
                  <DrawerIconBtn
                    icon={GitBranch}
                    title={t('agentVersion.fork')}
                    onClick={() => onFork(v)}
                    disabled={isBusy}
                  />
                  {group.versions.length > 1 && (
                    <DrawerIconBtn
                      icon={Trash2}
                      title={t('common.delete')}
                      onClick={() => onDelete(v)}
                      disabled={isBusy}
                      danger
                    />
                  )}
                  {!v.isActive && (
                    <DrawerIconBtn
                      icon={Check}
                      title={t('agentDrawer.setActive')}
                      onClick={() => { onSelectAgent(v.id); onClose() }}
                      disabled={isBusy}
                    />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </article>
  )
}

/* ── Tiny icon button used in version rows ── */

function DrawerIconBtn({
  icon: Icon,
  onClick,
  title,
  disabled,
  danger,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>
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
      className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors
        ${disabled
          ? 'opacity-30 cursor-not-allowed'
          : danger
            ? 'text-[var(--fog)] hover:text-vermillion hover:bg-vermillion/[0.08]'
            : 'text-[var(--fog)] hover:text-[var(--mist)] hover:bg-black/[0.05]'
        }`}
    >
      <Icon size={12} />
    </button>
  )
}
