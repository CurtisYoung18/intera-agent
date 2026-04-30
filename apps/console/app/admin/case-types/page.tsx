'use client'

// Case Types — dynamic state machine definitions

import { useState, useEffect, useCallback } from 'react'

interface CaseTypeItem {
  id: string
  type: string
  displayName: string
  description: string | null
  icon: string
  requiredFacts: string
  stages: string
  defaultGoal: string
  escalateOn: string
}

const EMPTY: Partial<CaseTypeItem> = {
  type: '', displayName: '', icon: '📋', requiredFacts: '[]', stages: '["created","investigating","resolved"]',
  defaultGoal: '', escalateOn: '[]',
}

export default function CaseTypesPage() {
  const [types, setTypes] = useState<CaseTypeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Partial<CaseTypeItem> | null>(null)
  const [isNew, setIsNew] = useState(false)

  const load = useCallback(() => {
    fetch('/api/admin/case-types')
      .then((r) => r.json())
      .then((d) => setTypes(d.types || []))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const handleSave = useCallback(async () => {
    if (!editing?.type) return
    const body: Record<string, unknown> = { ...editing }
    if (isNew) {
      await fetch('/api/admin/case-types', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    } else {
      await fetch(`/api/admin/case-types/${encodeURIComponent(editing.type)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    }
    setEditing(null)
    load()
  }, [editing, isNew, load])

  const handleDelete = useCallback(async (type: string) => {
    if (!confirm(`Delete case type "${type}"?`)) return
    await fetch(`/api/admin/case-types/${encodeURIComponent(type)}`, { method: 'DELETE' })
    load()
  }, [load])

  const renderStages = (raw: string) => {
    try { return (JSON.parse(raw) as string[]).join(' → ') } catch { return raw }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-full"><p className="text-fog/40 animate-breathe">Loading…</p></div>
  }

  return (
    <div className="p-6 max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[16px] font-medium text-mist">Case Types</h2>
          <p className="text-[12px] text-fog/40 mt-0.5">Dynamic state machines — each type defines its own stages</p>
        </div>
        <button onClick={() => { setEditing({ ...EMPTY }); setIsNew(true) }}
          className="px-4 py-2 rounded-lg text-[13px] bg-indigo/20 border border-indigo/30 text-indigo hover:bg-indigo/30 transition-all">
          + New Case Type
        </button>
      </div>

      <div className="grid gap-2">
        {types.map((t) => (
          <div key={t.id} className="glass-admin rounded-lg p-4 flex items-center gap-4 hover:bg-white/[0.02] transition-all">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[16px]">{t.icon || '📋'}</span>
                <span className="text-[14px] font-medium text-mist font-mono">{t.type}</span>
                <span className="text-[12px] text-fog/40">{t.displayName}</span>
              </div>
              <p className="text-[11px] text-fog/40 font-mono">{renderStages(t.stages)}</p>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => { setEditing(t); setIsNew(false) }} className="text-[11px] text-fog/40 hover:text-fog px-2 py-1 transition-colors">Edit</button>
              <button onClick={() => handleDelete(t.type)} className="text-[11px] text-fog/30 hover:text-vermillion px-2 py-1 transition-colors">Del</button>
            </div>
          </div>
        ))}
        {types.length === 0 && <p className="text-[13px] text-fog/30 py-8 text-center">No case types defined. The default "general" type is used as fallback.</p>}
      </div>

      {/* Edit Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center pt-20 overflow-y-auto" onClick={() => setEditing(null)}>
          <div className="glass-admin rounded-xl p-6 w-full max-w-lg space-y-4 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[14px] font-medium text-mist">{isNew ? 'New Case Type' : 'Edit Case Type'}</h3>
            {(['type', 'displayName', 'icon', 'defaultGoal'] as const).map((f) => (
              <label key={f} className="block space-y-1">
                <span className="text-[10px] text-fog/40 uppercase">{f}</span>
                <input value={String(editing[f] || '')} onChange={(e) => setEditing({ ...editing, [f]: e.target.value })}
                  className="w-full bg-white/[0.03] border border-white/[0.06] rounded text-[13px] text-mist py-1.5 px-2 outline-none focus:border-indigo/30 font-mono" />
              </label>
            ))}
            <label className="block space-y-1">
              <span className="text-[10px] text-fog/40 uppercase">stages (JSON array)</span>
              <textarea value={editing.stages || '[]'} onChange={(e) => setEditing({ ...editing, stages: e.target.value })}
                rows={3} className="w-full bg-white/[0.03] border border-white/[0.06] rounded text-[12px] text-mist py-1.5 px-2 outline-none focus:border-indigo/30 font-mono resize-y" />
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] text-fog/40 uppercase">requiredFacts (JSON array)</span>
              <textarea value={editing.requiredFacts || '[]'} onChange={(e) => setEditing({ ...editing, requiredFacts: e.target.value })}
                rows={3} className="w-full bg-white/[0.03] border border-white/[0.06] rounded text-[12px] text-mist py-1.5 px-2 outline-none focus:border-indigo/30 font-mono resize-y" />
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] text-fog/40 uppercase">escalateOn (JSON array)</span>
              <textarea value={editing.escalateOn || '[]'} onChange={(e) => setEditing({ ...editing, escalateOn: e.target.value })}
                rows={3} className="w-full bg-white/[0.03] border border-white/[0.06] rounded text-[12px] text-mist py-1.5 px-2 outline-none focus:border-indigo/30 font-mono resize-y" />
            </label>
            <div className="flex gap-2 pt-2">
              <button onClick={handleSave} className="px-4 py-2 rounded-lg text-[12px] bg-indigo/20 border border-indigo/30 text-indigo hover:bg-indigo/30">Save</button>
              <button onClick={() => setEditing(null)} className="px-4 py-2 rounded-lg text-[12px] text-fog/40 hover:text-fog">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
