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
  GitBranch, Play, Layers, Search, ArrowRight, SlidersHorizontal,
} from 'lucide-react'
import SlidePanel from '@/components/ui/slide-panel'
import { useConsoleLocale } from '@/components/locale-provider'
import { useAgentContext } from '@/lib/agent/agent-context'

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
  if (model.includes('MiniMax-M3')) return 'M3'
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
  const { selectAgent } = useAgentContext()
  const router = useRouter()
  const [allVersions, setAllVersions] = useState<AgentVersion[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')

  const [editingName, setEditingName] = useState<string | null>(null)
  const [editingNameValue, setEditingNameValue] = useState('')
  const [savingRename, setSavingRename] = useState(false)

  const [busyId, setBusyId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [creatingName, setCreatingName] = useState('')

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  const refresh = useCallback(async () => {
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

  const filteredGroups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return groups
    return groups.filter((group) => {
      if (group.name.toLowerCase().includes(needle)) return true
      return group.versions.some((version) => formatModel(version.model).toLowerCase().includes(needle))
    })
  }, [groups, query])

  const toggleGroup = (name: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const suggestNextAgentName = useCallback(() => {
    const existingNames = new Set(groups.map(g => g.name))
    let n = 1
    while (existingNames.has(`Agent ${n}`)) n++
    return `Agent ${n}`
  }, [groups])

  const beginCreate = () => {
    setCreatingName(suggestNextAgentName())
    setIsCreating(true)
    setError('')
  }

  const cancelCreate = () => {
    setIsCreating(false)
    setCreatingName('')
  }

  const handleCreate = async () => {
    const name = creatingName.trim()
    if (!name) {
      setError(t('agentDrawer.createError'))
      return
    }
    if (groups.some(g => g.name === name)) {
      setError(`An agent named "${name}" already exists`)
      return
    }
    setCreating(true)
    setError('')
    try {
      const r = await fetch('/api/admin/agent-configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const d = await r.json()
      if (!r.ok) {
        setError((typeof d.error === 'string' ? d.error : d.error?.message) || t('agentDrawer.createError'))
        return
      }
      await refresh()
      onAgentsChanged?.()
      const config = d.data?.config ?? d.config
      if (config?.id) {
        onSelectAgent(config.id)
        if (config.name) {
          setExpandedGroups(prev => new Set(prev).add(config.name))
        }
      }
      setIsCreating(false)
      setCreatingName('')
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
        setError((typeof d.error === 'string' ? d.error : d.error?.message) || t('agentVersion.activateError'))
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
        setError((typeof d.error === 'string' ? d.error : d.error?.message) || t('agentVersion.forkError'))
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
        setError((typeof d.error === 'string' ? d.error : d.error?.message) || t('agentDrawer.deleteError'))
        return
      }
      // If the deleted agent was the active one, fall back to first remaining
      if (groups.find(g => g.name === name)?.active?.id === activeAgentId) {
        const resp = await fetch('/api/admin/agent-configs').then(r => r.json()); const list = resp.data || resp
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
        setError((typeof d.error === 'string' ? d.error : d.error?.message) || t('agentVersion.deleteBlockedChildren'))
        return
      }
      // If we deleted the active one, fall back to the first remaining (the
      // server already auto-promoted a sibling inside the same transaction).
      if (v.id === activeAgentId) {
        const resp = await fetch('/api/admin/agent-configs').then(r => r.json()); const list = resp.data || resp
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
    selectAgent(v.id)
    router.push(`/admin/model?agentId=${v.id}`)
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
        setError((typeof d.error === 'string' ? d.error : d.error?.message) || t('agentDrawer.renameError'))
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
      size="wide"
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="-mx-5 -mt-4 border-b border-[var(--color-border-subtle)] bg-white/72 px-5 pb-5 pt-1">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-primary)]">
            {t('agentDrawer.orgEyebrow')}
          </p>
          <h2 className="mt-2 text-[34px] font-semibold leading-none tracking-[-0.04em] text-[var(--color-text-primary)]">
            {t('agentDrawer.switchTitle')}
          </h2>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="relative min-w-0 flex-1" htmlFor="agent-drawer-search">
              <span className="sr-only">{t('agentDrawer.searchLabel')}</span>
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
              <input
                id="agent-drawer-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('agentDrawer.searchPlaceholder')}
                className="h-12 w-full rounded-[14px] border border-[var(--color-border-subtle)] bg-white/86 pl-10 pr-3 text-[14px] font-medium text-[var(--color-text-primary)] shadow-[0_8px_20px_rgba(21,23,25,0.04),inset_0_1px_0_rgba(255,255,255,0.7)] outline-none transition focus:border-[rgba(53,127,124,0.34)] focus:ring-4 focus:ring-[rgba(53,127,124,0.08)]"
              />
            </label>
            {!isCreating ? (
              <button
                type="button"
                onClick={beginCreate}
                disabled={creating}
                className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-[14px] bg-[linear-gradient(135deg,#1f575d_0%,#2f7b78_56%,#469892_100%)] px-5 text-[15px] font-semibold text-white shadow-[0_18px_30px_-18px_rgba(24,83,88,0.78)] transition hover:brightness-[1.03] disabled:opacity-50"
              >
                <Plus className="h-4 w-4" strokeWidth={2.4} />
                {t('agentDrawer.newAgent')}
              </button>
            ) : (
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                <input
                  autoFocus
                  value={creatingName}
                  onChange={(e) => setCreatingName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreate()
                    else if (e.key === 'Escape') cancelCreate()
                  }}
                  disabled={creating}
                  placeholder={t('agentDrawer.newAgent')}
                  className="h-12 w-40 rounded-[14px] border border-[rgba(53,127,124,0.28)] bg-white px-3 text-[13px] font-semibold text-[var(--color-text-primary)] focus:outline-none focus:ring-4 focus:ring-[rgba(53,127,124,0.1)]"
                />
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={creating || !creatingName.trim()}
                  className="inline-flex h-12 items-center gap-1 rounded-[14px] bg-[rgba(53,127,124,0.1)] px-3 text-[12px] font-semibold text-[var(--color-accent-primary)] hover:bg-[rgba(53,127,124,0.14)] disabled:opacity-50"
                >
                  {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" strokeWidth={2.5} />}
                  {t('common.save')}
                </button>
                <button
                  type="button"
                  onClick={cancelCreate}
                  disabled={creating}
                  className="inline-flex h-12 w-10 items-center justify-center rounded-[14px] text-[var(--color-text-tertiary)] hover:bg-black/5"
                  aria-label={t('common.cancel')}
                >
                  <X className="h-4 w-4" strokeWidth={2.5} />
                </button>
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-[14px] border border-[rgba(201,99,91,0.22)] bg-[rgba(201,99,91,0.07)] px-3 py-2 text-[12px] text-[var(--color-signal-danger)]">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError('')}
              className="ml-auto -mr-1 -mt-0.5 p-1 rounded hover:bg-vermillion/10"
              aria-label={t('common.dismiss')}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        <div className="mt-4 flex items-center gap-3 text-[13px] text-[var(--color-text-secondary)]">
          <span>{t('agentDrawer.subtitle', { n: filteredGroups.length, n2: filteredGroups.length === 1 ? '' : 's' })}</span>
          <span className="h-px flex-1 bg-[var(--color-border-subtle)]" />
        </div>

        {/* Card grid — one card per (orgId, name) */}
        {loading && allVersions.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-12 text-[var(--color-text-tertiary)]">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-[12px]">{t('common.loading')}</span>
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="mt-4 rounded-[18px] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-bg-surface-muted)] py-10 text-center">
            <p className="text-[13px] text-[var(--color-text-secondary)]">{query ? t('common.noMatches') : t('agentDrawer.empty')}</p>
            <p className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">{query ? t('agentDrawer.searchEmpty') : t('agentDrawer.emptyDesc')}</p>
          </div>
        ) : (
          <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pb-4 pr-1 scroll-thin">
            {filteredGroups.map(g => (
              <NameCard
                key={g.name}
                group={g}
                isExpanded={expandedGroups.has(g.name)}
                onToggle={() => toggleGroup(g.name)}
                isSelectedGroup={g.versions.some((version) => version.id === activeAgentId)}
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

        <div className="-mx-5 mt-auto border-t border-[var(--color-border-subtle)] bg-white/74 px-5 py-4">
          <button
            type="button"
            onClick={() => { router.push('/settings/organization'); onClose() }}
            className="inline-flex min-h-10 w-full items-center gap-2 rounded-[12px] px-3 text-left text-[14px] font-semibold text-[var(--color-text-secondary)] transition hover:bg-[var(--color-bg-surface-muted)] hover:text-[var(--color-text-primary)]"
          >
            <SlidersHorizontal className="h-4 w-4 text-[var(--color-accent-primary)]" />
            <span>{t('agentDrawer.manageFooter')}</span>
          </button>
        </div>
      </div>
    </SlidePanel>
  )
}

/* ── Name card (one per orgId+name) ── */

function NameCard({
  group,
  isExpanded,
  onToggle,
  isSelectedGroup,
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
  isSelectedGroup: boolean
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
  const selectedVersion = group.versions.find((version) => version.id === activeAgentId) ?? null
  const latestVersion = group.versions[group.versions.length - 1] ?? null
  const primaryVersion = selectedVersion ?? group.active ?? latestVersion
  const primaryIsLive = Boolean(primaryVersion?.isActive)
  return (
    <article
      className={`relative flex flex-col overflow-hidden rounded-[18px] border transition-all duration-200
        ${isSelectedGroup
          ? 'border-[rgba(53,127,124,0.32)] bg-[linear-gradient(135deg,rgba(53,127,124,0.09),rgba(255,255,255,0.9))] shadow-[0_16px_34px_-20px_rgba(24,83,88,0.62)]'
          : 'border-[var(--color-border-subtle)] bg-white/72 hover:border-[rgba(53,127,124,0.18)] hover:shadow-[0_10px_28px_-18px_rgba(15,23,42,0.2)]'
        }`}
    >
      {/* Accent strip on active card */}
      <div
        aria-hidden
        className={`absolute inset-x-0 top-0 h-[2px] transition-opacity ${
          isSelectedGroup ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ background: 'linear-gradient(90deg, transparent, #357f7c 28%, #72aaa6 70%, transparent)' }}
      />

      <button
        type="button"
        onClick={() => { if (primaryVersion) { onSelectAgent(primaryVersion.id); onClose() } }}
        className="grid w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 px-5 py-4 text-left"
      >
        <div className={`relative flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-[17px] border ${
          isSelectedGroup
            ? 'border-[rgba(53,127,124,0.28)] bg-[rgba(53,127,124,0.1)]'
            : 'border-[var(--color-border-subtle)] bg-[var(--color-bg-surface-muted)]'
        }`}>
          <Bot className={`h-6 w-6 ${isSelectedGroup ? 'text-[var(--color-accent-primary)]' : 'text-[var(--color-text-secondary)]'}`} strokeWidth={1.75} />
          <span
            aria-hidden
            className={`absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-2 border-white ${
              primaryIsLive ? 'bg-[var(--color-signal-success)]' : 'bg-[var(--color-signal-warning)]'
            }`}
          />
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
              className="w-full rounded-[10px] border border-[rgba(53,127,124,0.28)] bg-white px-2 py-1 text-[18px] font-semibold text-[var(--color-text-primary)] focus:outline-none focus:ring-4 focus:ring-[rgba(53,127,124,0.1)]"
            />
          ) : (
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="truncate text-[21px] font-semibold leading-6 text-[var(--color-text-primary)]" title={group.name}>
                {group.name}
              </h3>
              {isSelectedGroup ? (
                <span className="shrink-0 rounded-full border border-[rgba(53,127,124,0.2)] bg-[rgba(53,127,124,0.09)] px-2 py-0.5 text-[12px] font-semibold text-[var(--color-accent-primary)]">
                  {t('agentDrawer.current')}
                </span>
              ) : null}
            </div>
          )}
          <p className="mt-1 truncate font-mono text-[14px] text-[var(--color-text-tertiary)]">
            {primaryVersion ? formatModel(primaryVersion.model) : '—'}
          </p>
          {primaryVersion ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[13px] font-semibold ${
                primaryIsLive
                  ? 'border-[rgba(111,158,114,0.26)] bg-[rgba(111,158,114,0.12)] text-[var(--color-signal-success)]'
                  : 'border-[rgba(213,150,61,0.28)] bg-[rgba(213,150,61,0.13)] text-[var(--color-signal-warning)]'
              }`}>
                <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
                v{primaryVersion.version} · {primaryIsLive ? t('agentVersion.live') : t('agentVersion.draft')}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[13px] font-medium text-[var(--color-text-secondary)]">
                <Layers className="h-3.5 w-3.5" />
                {t('agentVersion.versionsCount', { n, n2: n !== 1 ? 's' : '' })}
              </span>
            </div>
          ) : null}
        </div>

        <div className="flex flex-shrink-0 items-center gap-2">
          <ArrowRight className={`h-5 w-5 ${isSelectedGroup ? 'text-[var(--color-accent-primary)]' : 'text-[var(--color-text-tertiary)]'}`} />
          <ChevronDown
            className={`h-4 w-4 rounded-full text-[var(--color-text-tertiary)] transition-transform hover:text-[var(--color-accent-primary)] ${isExpanded ? 'rotate-180' : ''}`}
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
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] text-[var(--color-text-tertiary)] transition-colors hover:bg-black/[0.04] hover:text-[var(--color-text-primary)]"
            title={t('common.edit')}
          >
            <Pencil className="w-3 h-3" />
            <span>{t('common.edit')}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (!window.confirm(t('common.deleteConfirm', { name: group.name }))) return
              onDeleteAgent(group.name)
            }}
            disabled={savingRename}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] text-[var(--color-signal-danger)]/75 transition-colors hover:bg-[rgba(201,99,91,0.08)] hover:text-[var(--color-signal-danger)]"
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
            className="inline-flex flex-1 items-center justify-center gap-1.5 py-2 text-[11.5px] font-semibold text-[var(--color-accent-primary)] transition-colors hover:bg-[rgba(53,127,124,0.07)] disabled:opacity-50"
          >
            {savingRename ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" strokeWidth={2.5} />}
            {t('common.save')}
          </button>
          <button
            type="button"
            onClick={cancelRename}
            disabled={savingRename}
            className="inline-flex flex-1 items-center justify-center gap-1.5 py-2 text-[11.5px] font-semibold text-[var(--color-text-tertiary)] transition-colors hover:bg-black/5"
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
                  isCurrentRow ? 'bg-[rgba(53,127,124,0.06)]' : 'hover:bg-black/[0.015]'
                } transition-colors`}
              >
                {/* Version label + status */}
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <span className="font-mono text-[11.5px] font-bold text-[var(--color-text-primary)] tabular-nums">
                    v{v.version}
                  </span>
                  {v.isActive ? (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-[rgba(111,158,114,0.12)] px-1.5 py-0 text-[9px] font-bold uppercase tracking-wider text-[var(--color-signal-success)]">
                      <span className="h-1 w-1 rounded-full bg-[var(--color-signal-success)]" />
                      {t('agentVersion.active')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-black/[0.05] px-1.5 py-0 text-[9px] font-bold uppercase tracking-wider text-[var(--color-text-tertiary)]">
                      {t('agentVersion.draft')}
                    </span>
                  )}
                  <span className="truncate text-[10px] text-[var(--color-text-tertiary)]">
                    {formatModel(v.model)} · {formatDate(v.createdAt)}
                  </span>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <DrawerIconBtn
                    icon={Pencil}
                    title={t('agentVersion.editVersion')}
                    onClick={() => onEdit(v)}
                    disabled={isBusy}
                  />
                  {!v.isActive && (
                    <DrawerIconBtn
                      icon={Play}
                      title={t('agentVersion.activate')}
                      onClick={() => onActivate(v)}
                      disabled={isBusy}
                    />
                  )}
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
            ? 'text-[var(--color-text-tertiary)] hover:bg-[rgba(201,99,91,0.08)] hover:text-[var(--color-signal-danger)]'
            : 'text-[var(--color-text-tertiary)] hover:bg-black/[0.05] hover:text-[var(--color-text-primary)]'
        }`}
    >
      <Icon size={12} />
    </button>
  )
}
