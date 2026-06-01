'use client'

import { useState, useEffect, useCallback } from 'react'
import { HandPlatter, Save, CheckCircle2, AlertCircle, Plus, GitBranch, Clock, Pencil, Trash2 } from 'lucide-react'
import AgentHumanInteractionPanel from '@/components/admin/agent-human-interaction-panel'
import ImmersiveModal from '@/components/ui/immersive-modal'
import { DEFAULT_CONSULTATION_PROMPT } from '@intera/shared/defaults'
import { useConsoleLocale } from '@/components/locale-provider'


interface AgentConfig {
  consultationPrompt: string
  humanSkills: string
}

interface RoutingItem {
  id: string
  queue: string
  description: string
  priority: number
  maxWaitingTime: number
  skillsAllowed: string
  autoAssign: boolean
}

function emptyRoute(): RoutingItem {
  return { id: '', queue: '', description: '', priority: 0, maxWaitingTime: 300, skillsAllowed: '[]', autoAssign: true }
}

function parseSkills(raw: string): string[] {
  try { return JSON.parse(raw) } catch { return [] }
}

export default function HumanOpsPage() {
  const { t } = useConsoleLocale()
  const [config, setConfig] = useState<AgentConfig>({
    consultationPrompt: DEFAULT_CONSULTATION_PROMPT,
    humanSkills: '',
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')

  // Routing state
  const [routes, setRoutes] = useState<RoutingItem[]>([])
  const [editingRoute, setEditingRoute] = useState<RoutingItem | null>(null)
  const [isNewRoute, setIsNewRoute] = useState(false)

  const loadRoutes = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/routing')
      const data = await res.json()
      setRoutes(data.routes || [])
    } catch { /* routing API may be unavailable */ }
  }, [])

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/agent').then((r) => r.ok ? r.json() : Promise.reject(new Error(`Config: ${r.status}`))),
      loadRoutes(),
    ])
      .then(([agentData]) => {
        const raw = agentData.config || {}
        setConfig({
          consultationPrompt: raw.consultationPrompt || DEFAULT_CONSULTATION_PROMPT,
          humanSkills: raw.humanSkills || '',
        })
        setError(null)
      })
      .catch((err: Error) => setError(err.message || 'Failed to load config'))
      .finally(() => setLoading(false))
  }, [loadRoutes])

  const updateConsultationPrompt = useCallback((v: string) => setConfig((prev) => ({ ...prev, consultationPrompt: v })), [])
  const updateHumanSkills = useCallback((v: string) => setConfig((prev) => ({ ...prev, humanSkills: v })), [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setSaveStatus('idle')
    try {
      const res = await fetch('/api/admin/agent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (!res.ok) throw new Error(`Save: ${res.status}`)

      const cacheBody = JSON.stringify({ orgId: 'default' })
      Promise.allSettled([
        fetch('/api/admin/config-changed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: cacheBody }),
        fetch('/api/admin/config-changed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: cacheBody }),
      ]).catch(() => {})
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2500)
    } catch { setSaveStatus('error') }
    finally { setSaving(false) }
  }, [config])

  // Route CRUD
  const handleSaveRoute = useCallback(async () => {
    if (!editingRoute) return
    const url = isNewRoute ? '/api/admin/routing' : `/api/admin/routing/${encodeURIComponent(editingRoute.queue)}`
    const res = await fetch(url, {
      method: isNewRoute ? 'POST' : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editingRoute),
    })
    if (!res.ok) return alert('Failed to save route')
    setEditingRoute(null)
    loadRoutes()
  }, [editingRoute, isNewRoute, loadRoutes])

  const handleDeleteRoute = useCallback(async (queue: string) => {
    if (!confirm(`Delete queue "${queue}"?`)) return
    await fetch(`/api/admin/routing/${encodeURIComponent(queue)}`, { method: 'DELETE' })
    loadRoutes()
  }, [loadRoutes])

  if (loading) return <div className="p-8 text-[13px] text-[var(--fog)]">{t('common.loading')}</div>
  if (error) return <div className="p-8 text-[13px] text-red-500">{error}</div>

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(91,184,247,0.12)' }}>
          <HandPlatter className="w-4 h-4" style={{ color: '#5bb8f7' }} />
        </div>
        <div>
          <h1 className="text-[18px] font-bold text-[var(--mist)]">{t('sidebar.humanOps')}</h1>
          <p className="text-[12px] text-[var(--fog)]">Consultation settings and operator queues</p>
        </div>
      </div>

      {/* ── Consultation ── */}
      <div className="mb-8">
        <h2 className="text-[14px] font-semibold text-[var(--mist)] mb-4">Consultation</h2>
        <AgentHumanInteractionPanel
          consultationPrompt={config.consultationPrompt}
          humanSkills={config.humanSkills}
          onConsultationPromptChange={updateConsultationPrompt}
          onHumanSkillsChange={updateHumanSkills}
        />
        <div className="mt-4 flex items-center justify-end">
          <button
            onClick={() => { void handleSave() }}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-indigo text-white text-[13px] font-semibold rounded-xl hover:bg-indigo/90 disabled:opacity-40 transition-colors"
          >
            {saving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              : saveStatus === 'saved' ? <CheckCircle2 className="w-4 h-4" />
              : saveStatus === 'error' ? <AlertCircle className="w-4 h-4" />
              : <Save className="w-4 h-4" />}
            {saveStatus === 'saved' ? t('integrations.saved') : saveStatus === 'error' ? t('integrations.saveError') : t('common.save')}
          </button>
        </div>
      </div>

      {/* ── Operator Queues ── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[14px] font-semibold text-[var(--mist)]">Operator Queues</h2>
          <button
            type="button"
            onClick={() => { setEditingRoute(emptyRoute()); setIsNewRoute(true) }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border border-[var(--border-subtle)] text-[var(--fog)] hover:text-[var(--mist)] hover:bg-black/[0.03] transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add Queue
          </button>
        </div>

        {routes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--border-subtle)] bg-white/20 p-10 text-center">
            <GitBranch className="w-8 h-8 text-[var(--smoke)]/30 mx-auto mb-3" />
            <p className="text-[13px] text-[var(--fog)]">No operator queues defined</p>
            <p className="text-[11px] text-[var(--fog)]/70 mt-1">Queues determine where human tasks are routed</p>
          </div>
        ) : (
          <div className="space-y-2">
            {routes.map((r) => (
              <div key={r.id || r.queue} className="flex items-center gap-4 p-4 rounded-xl border border-[var(--border-subtle)] bg-white/30">
                <GitBranch className="w-4 h-4 text-[var(--fog)]/50 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[13px] font-semibold text-[var(--mist)]">{r.queue}</span>
                    <span className="text-[10px] text-[var(--smoke)] px-1.5 py-0.5 rounded bg-black/[0.04]">priority {r.priority}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--fog)]">
                    {r.description && <span>{r.description}</span>}
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{r.maxWaitingTime}s</span>
                    {parseSkills(r.skillsAllowed).length > 0 && (
                      <span>{parseSkills(r.skillsAllowed).join(', ')}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => { setEditingRoute({ ...r }); setIsNewRoute(false) }}
                    className="p-1.5 rounded-lg hover:bg-black/[0.04] text-[var(--fog)] transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteRoute(r.queue)}
                    className="p-1.5 rounded-lg hover:bg-vermillion/[0.06] text-[var(--fog)] hover:text-vermillion transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Route edit modal */}
      <ImmersiveModal
        open={!!editingRoute}
        onClose={() => setEditingRoute(null)}
        title={isNewRoute ? 'Add Queue' : 'Edit Queue'}
      >
        {editingRoute && (
          <div className="space-y-4">
            <label className="space-y-1.5 block">
              <span className="text-[11px] text-[var(--fog)]">Queue Name</span>
              <input value={editingRoute.queue} disabled={!isNewRoute} onChange={(e) => setEditingRoute({ ...editingRoute, queue: e.target.value })}
                className="glass-input-console text-[13px] font-mono" />
            </label>
            <label className="space-y-1.5 block">
              <span className="text-[11px] text-[var(--fog)]">Description</span>
              <input value={editingRoute.description} onChange={(e) => setEditingRoute({ ...editingRoute, description: e.target.value })}
                className="glass-input-console text-[13px]" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1.5 block">
                <span className="text-[11px] text-[var(--fog)]">Priority</span>
                <input type="number" value={editingRoute.priority} onChange={(e) => setEditingRoute({ ...editingRoute, priority: parseInt(e.target.value) || 0 })}
                  className="glass-input-console text-[13px]" />
              </label>
              <label className="space-y-1.5 block">
                <span className="text-[11px] text-[var(--fog)]">Max Wait (s)</span>
                <input type="number" value={editingRoute.maxWaitingTime} onChange={(e) => setEditingRoute({ ...editingRoute, maxWaitingTime: parseInt(e.target.value) || 300 })}
                  className="glass-input-console text-[13px]" />
              </label>
            </div>
            <label className="space-y-1.5 block">
              <span className="text-[11px] text-[var(--fog)]">Skills Allowed (JSON array)</span>
              <input value={editingRoute.skillsAllowed} onChange={(e) => setEditingRoute({ ...editingRoute, skillsAllowed: e.target.value })}
                className="glass-input-console text-[13px] font-mono" placeholder='["skill1","skill2"]' />
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={editingRoute.autoAssign} onChange={(e) => setEditingRoute({ ...editingRoute, autoAssign: e.target.checked })}
                className="w-3.5 h-3.5 rounded accent-indigo" />
              <span className="text-[12px] text-[var(--fog)]">Auto-assign tasks</span>
            </label>
            <div className="flex gap-3 pt-2">
              <button onClick={handleSaveRoute} className="flex-1 py-2.5 rounded-xl text-[13px] font-medium bg-indigo text-white hover:bg-indigo/90 transition-all">
                {isNewRoute ? 'Create' : 'Save'}
              </button>
              <button onClick={() => setEditingRoute(null)} className="flex-1 py-2.5 rounded-xl text-[13px] text-[var(--fog)] border border-[var(--border-subtle)] hover:border-[var(--border-hover)] transition-all">
                Cancel
              </button>
            </div>
          </div>
        )}
      </ImmersiveModal>
    </div>
  )
}
