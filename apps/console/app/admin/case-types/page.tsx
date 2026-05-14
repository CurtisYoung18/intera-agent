'use client'

import { useState, useEffect, useCallback } from 'react'
import { Layers, Plus, Search, Wand2, ArrowRight, Settings2, Pencil, Trash2, ToggleLeft, ToggleRight } from 'lucide-react'
import { chatApiUrl } from '@/lib/chat-api'
import { ListSkeleton } from '@/components/ui/skeleton'
import EmptyState from '@/components/ui/empty-state'
import ImmersiveModal from '@/components/ui/immersive-modal'
import TiltCard from '@/components/ui/tilt-card'
import StageConfigEditor from '@/components/admin/stage-config-editor'
import { useConsoleLocale } from '@/components/locale-provider'

interface CaseTypeItem {
  id: string
  type: string
  displayName: string
  description: string
  icon: string
  defaultGoal: string
  stages: string
  requiredFacts: string
  escalateOn: string
  autoCloseConditions: string
  stageConfigs: string
  orchestratorConfig: string
  enabled: boolean
}

type ModalTab = 'basic' | 'stages'

const CT_JSON_FIELDS = ['stages', 'requiredFacts', 'escalateOn', 'autoCloseConditions'] as const

const ctFieldKey: Record<(typeof CT_JSON_FIELDS)[number], string> = {
  stages: 'caseTypes.f.stages',
  requiredFacts: 'caseTypes.f.requiredFacts',
  escalateOn: 'caseTypes.f.escalateOn',
  autoCloseConditions: 'caseTypes.f.autoCloseConditions',
}

export default function CaseTypesPage() {
  const { t } = useConsoleLocale()
  const [items, setItems] = useState<CaseTypeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<CaseTypeItem | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [activeTab, setActiveTab] = useState<ModalTab>('basic')
  const [allSkills, setAllSkills] = useState<string[]>([])
  const [availableModels, setAvailableModels] = useState<string[]>([])

  const notifyConfigChanged = useCallback(() => {
    const body = JSON.stringify({ customerId: 'default' })
    Promise.allSettled([
      fetch('/api/admin/config-changed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }),
      fetch(chatApiUrl('/api/admin/config-changed'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }),
    ]).catch(() => {})
  }, [])

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/case-types')
    const data = await res.json()
    const raw = (data.types || []) as CaseTypeItem[]
    setItems(raw.map((ct) => ({ ...ct, enabled: ct.enabled !== false })))
    setLoading(false)
  }, [])
  useEffect(() => {
    load()
  }, [load])

  // Fetch available skills and models for the stage config editor
  useEffect(() => {
    fetch('/api/admin/skills')
      .then((r) => r.json())
      .then((d) => setAllSkills((d.skills || []).map((s: { name: string }) => s.name)))
      .catch(() => {})
    fetch('/api/admin/models')
      .then((r) => r.json())
      .then((d) => setAvailableModels((d.models || []).map((m: { id: string }) => m.id)))
      .catch(() => {})
  }, [])

  const emptyItem = (): CaseTypeItem => ({
    id: '',
    type: '',
    displayName: '',
    description: '',
    icon: '📋',
    defaultGoal: '',
    stages: '[]',
    requiredFacts: '[]',
    escalateOn: '[]',
    autoCloseConditions: '[]',
    stageConfigs: '{}',
    orchestratorConfig: '{"enabled":false,"maxParallelAgents":3}',
    enabled: true,
  })

  const openEdit = (ct: CaseTypeItem) => {
    setEditing({ ...ct })
    setIsNew(false)
    setActiveTab('basic')
  }
  const openNew = () => {
    setEditing(emptyItem())
    setIsNew(true)
    setActiveTab('basic')
  }
  const formatField = (f: keyof CaseTypeItem) => {
    if (!editing) return
    try {
      setEditing({
        ...editing,
        [f]: JSON.stringify(JSON.parse(String(editing[f] || '[]')), null, 2),
      })
    } catch {
      /* ignore */
    }
  }

  const handleSave = useCallback(async () => {
    if (!editing) return
    const url = isNew ? '/api/admin/case-types' : `/api/admin/case-types/${encodeURIComponent(editing.type)}`
    const res = await fetch(url, {
      method: isNew ? 'POST' : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editing),
    })
    if (!res.ok) return alert(t('common.failedSave', { status: res.status }))
    notifyConfigChanged()
    setEditing(null)
    load()
  }, [editing, isNew, load, notifyConfigChanged, t])

  const toggleEnabled = useCallback(
    async (ct: CaseTypeItem) => {
      const updated = { ...ct, enabled: !ct.enabled }
      const res = await fetch(`/api/admin/case-types/${encodeURIComponent(ct.type)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      })
      if (!res.ok) return alert(t('common.failedSave', { status: res.status }))
      notifyConfigChanged()
      load()
    },
    [load, notifyConfigChanged, t],
  )

  const handleDelete = useCallback(
    async (type: string) => {
      if (!confirm(t('common.deleteConfirm', { name: type }))) return
      const res = await fetch(`/api/admin/case-types/${encodeURIComponent(type)}`, { method: 'DELETE' })
      if (!res.ok) return alert(t('common.failedSave', { status: res.status }))
      notifyConfigChanged()
      load()
    },
    [load, notifyConfigChanged, t],
  )

  const filtered = items.filter(
    (ct) =>
      !search ||
      ct.type.toLowerCase().includes(search.toLowerCase()) ||
      (ct.displayName || '').toLowerCase().includes(search.toLowerCase()),
  )
  const stageNames = (s: string) => {
    try {
      return JSON.parse(s || '[]').join(' → ')
    } catch {
      return s
    }
  }

  // Parse stage configs for the editor
  const parsedStages = (): string[] => {
    try {
      return JSON.parse(editing?.stages || '[]') as string[]
    } catch {
      return []
    }
  }
  const parsedStageConfigs = (): Record<string, unknown> => {
    try {
      return JSON.parse(editing?.stageConfigs || '{}') as Record<string, unknown>
    } catch {
      return {}
    }
  }

  if (loading)
    return (
      <div className="p-8">
        <ListSkeleton />
      </div>
    )

  return (
    <div className="px-8 py-8 animate-fade-up">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[20px] font-semibold text-[var(--mist)]">{t('caseTypes.title')}</h1>
          <p className="text-[13px] text-[var(--fog)] mt-0.5">{t('caseTypes.subtitle', { n: items.length })}</p>
        </div>
        <button
          type="button"
          onClick={openNew}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-medium bg-indigo/[0.08] border border-indigo/20 text-indigo hover:bg-indigo/[0.15] transition-all"
        >
          <Plus className="w-4 h-4" /> {t('caseTypes.new')}
        </button>
      </div>
      <div className="relative mb-6 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--smoke)]" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('caseTypes.searchPh')}
          className="glass-input-console pl-10 text-[13px]"
        />
      </div>
      {filtered.length === 0 ? (
        <EmptyState
          icon={Layers}
          title={t('caseTypes.emptyTitle')}
          description={search ? t('common.noMatches') : t('caseTypes.emptyDesc')}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((ct) => {
            const hasStageConfig = (() => {
              try {
                const cfg = JSON.parse(ct.stageConfigs || '{}')
                return Object.keys(cfg).length > 0
              } catch {
                return false
              }
            })()
            return (
              <TiltCard key={ct.id || ct.type} accentColor="#b8944c" onClick={() => openEdit(ct)}>
                <div className={`p-5 ${!ct.enabled ? 'opacity-70' : ''}`}>
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-gold/[0.08] text-lg flex-shrink-0">
                      {ct.icon || '📋'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="text-[13px] font-semibold text-[var(--mist)]">{ct.displayName || ct.type}</div>
                        {hasStageConfig && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-lavender/[0.08] text-lavender font-medium flex items-center gap-1">
                            <Settings2 className="w-2.5 h-2.5" />
                            Staged
                          </span>
                        )}
                        {!ct.enabled && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--smoke)]/10 text-[var(--fog)] font-medium">
                            {t('common.disabled')}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[var(--fog)] font-mono">{ct.type}</div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleEnabled(ct)
                      }}
                      className="flex-shrink-0 transition-colors"
                      title={ct.enabled ? t('common.active') : t('common.disabled')}
                    >
                      {ct.enabled ? (
                        <ToggleRight className="w-7 h-7 text-malachite" />
                      ) : (
                        <ToggleLeft className="w-7 h-7 text-[var(--smoke)]/30" />
                      )}
                    </button>
                  </div>
                  <p className="text-[12px] text-[var(--fog)] line-clamp-2 mb-3">
                    {ct.description || t('common.noDescription')}
                  </p>
                  <div className="text-[11px] text-[var(--smoke)] flex items-center gap-1 flex-wrap mb-2">
                    {stageNames(ct.stages)
                      .split(' → ')
                      .map((s: string, i: number, arr: string[]) => (
                        <span key={i} className="flex items-center gap-1">
                          <span className="px-1.5 py-0.5 rounded bg-lavender/[0.06] text-lavender">{s}</span>
                          {i < arr.length - 1 && <ArrowRight className="w-3 h-3 text-[var(--smoke)]/40" />}
                        </span>
                      ))}
                  </div>
                  <div className="flex items-center justify-between translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-200 ease-out">
                    <span className="text-[10px] text-[var(--smoke)]">
                      {ct.enabled ? t('common.active') : t('common.disabled')}
                    </span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          openEdit(ct)
                        }}
                        className="p-1.5 rounded-lg hover:bg-black/5 transition-colors"
                        title={t('common.edit')}
                      >
                        <Pencil className="w-3.5 h-3.5 text-[var(--fog)]" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDelete(ct.type)
                        }}
                        className="p-1.5 rounded-lg hover:bg-vermillion/5 transition-colors"
                        title={t('common.delete')}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-vermillion/60" />
                      </button>
                    </div>
                  </div>
                </div>
              </TiltCard>
            )
          })}
        </div>
      )}

      {/* ── Edit / Create Modal with Tabs ──────────────────────── */}
      <ImmersiveModal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={isNew ? t('caseTypes.newModal') : t('caseTypes.editModal')}
      >
        {editing && (
          <div className="space-y-0">
            {/* Tab switcher */}
            <div className="flex gap-1 p-1 rounded-xl bg-[var(--abyss)]/50 border border-[var(--border-subtle)] mb-4">
              <button
                type="button"
                onClick={() => setActiveTab('basic')}
                className={`flex-1 py-2 rounded-lg text-[12px] font-medium transition-all duration-200 ${
                  activeTab === 'basic'
                    ? 'bg-white/80 text-[var(--mist)] shadow-sm'
                    : 'text-[var(--fog)] hover:text-[var(--mist)]'
                }`}
              >
                {t('caseTypes.tab.basic')}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('stages')}
                className={`flex-1 py-2 rounded-lg text-[12px] font-medium transition-all duration-200 flex items-center justify-center gap-1.5 ${
                  activeTab === 'stages'
                    ? 'bg-white/80 text-[var(--mist)] shadow-sm'
                    : 'text-[var(--fog)] hover:text-[var(--mist)]'
                }`}
              >
                <Settings2 className="w-3.5 h-3.5" />
                {t('caseTypes.tab.stages')}
              </button>
            </div>

            {/* ── Basic Tab ─────────────────────────────────── */}
            {activeTab === 'basic' && (
              <div className="space-y-4 animate-fade-up">
                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-1.5">
                    <span className="text-[11px] text-[var(--fog)]">{t('common.type')}</span>
                    <input
                      value={editing.type}
                      onChange={(e) => setEditing({ ...editing, type: e.target.value })}
                      className="glass-input-console text-[13px] font-mono"
                      disabled={!isNew}
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[11px] text-[var(--fog)]">{t('caseTypes.displayName')}</span>
                    <input
                      value={editing.displayName || ''}
                      onChange={(e) => setEditing({ ...editing, displayName: e.target.value })}
                      className="glass-input-console text-[13px]"
                    />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-1.5">
                    <span className="text-[11px] text-[var(--fog)]">{t('caseTypes.icon')}</span>
                    <input
                      value={editing.icon || ''}
                      onChange={(e) => setEditing({ ...editing, icon: e.target.value })}
                      className="glass-input-console text-[13px]"
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[11px] text-[var(--fog)]">{t('caseTypes.defaultGoal')}</span>
                    <input
                      value={editing.defaultGoal || ''}
                      onChange={(e) => setEditing({ ...editing, defaultGoal: e.target.value })}
                      className="glass-input-console text-[13px]"
                    />
                  </label>
                </div>
                <label className="space-y-1.5 block">
                  <span className="text-[11px] text-[var(--fog)]">{t('common.description')}</span>
                  <input
                    value={editing.description || ''}
                    onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                    className="glass-input-console text-[13px]"
                  />
                </label>
                <label className="flex items-center gap-2 cursor-pointer py-1">
                  <input
                    type="checkbox"
                    checked={editing.enabled}
                    onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
                    className="accent-indigo rounded"
                  />
                  <span className="text-[12px] text-[var(--fog)]">{t('caseTypes.enabledForRouting')}</span>
                </label>
                {CT_JSON_FIELDS.map((f) => (
                  <label key={f} className="space-y-1.5 block">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-[var(--fog)]">{t(ctFieldKey[f])}</span>
                      <button
                        type="button"
                        onClick={() => formatField(f)}
                        className="text-[10px] text-indigo/70 hover:text-indigo"
                      >
                        <Wand2 className="w-3 h-3 inline mr-1" />
                        {t('common.format')}
                      </button>
                    </div>
                    <textarea
                      value={editing[f] || ''}
                      onChange={(e) => setEditing({ ...editing, [f]: e.target.value })}
                      rows={4}
                      className="glass-input-console text-[12px] font-mono resize-y"
                    />
                  </label>
                ))}
              </div>
            )}

            {/* ── Stage Config Tab ──────────────────────────── */}
            {activeTab === 'stages' && (
              <div className="animate-fade-up">
                <StageConfigEditor
                  stages={parsedStages()}
                  stageConfigs={parsedStageConfigs() as Record<string, any>}
                  allSkills={allSkills}
                  availableModels={availableModels.length > 0 ? availableModels : ['claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001', 'MiniMax-M2.70-highspeed', 'MiniMax-M2.5-highspeed']}
                  onChange={(configs) => {
                    setEditing({ ...editing, stageConfigs: JSON.stringify(configs, null, 2) })
                  }}
                />
              </div>
            )}

            {/* ── Footer ────────────────────────────────────── */}
            <div className="flex gap-3 pt-4 mt-4 border-t border-[var(--border-subtle)]">
              <button
                type="button"
                onClick={handleSave}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-medium bg-indigo/[0.08] border border-indigo/20 text-indigo hover:bg-indigo/[0.15] transition-all"
              >
                {t('common.save')}
              </button>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="flex-1 py-2.5 rounded-xl text-[13px] text-[var(--fog)] border border-[var(--border-subtle)] hover:border-[var(--border-hover)] transition-all"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}
      </ImmersiveModal>
    </div>
  )
}
