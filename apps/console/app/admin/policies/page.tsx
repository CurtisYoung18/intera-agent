'use client'

// Policies — guardrail rules: preTool, postTool, preFinalize

import { useState, useEffect, useCallback } from 'react'

interface PolicyItem {
  id: string
  name: string
  description: string | null
  hook: string
  rule: string
  enabled: boolean
}

const EMPTY_POLICY: Partial<PolicyItem> = {
  name: '', description: '', hook: 'preTool', rule: '{}', enabled: true,
}

const HOOKS = ['preTool', 'postTool', 'preFinalize']

export default function PoliciesPage() {
  const [policies, setPolicies] = useState<PolicyItem[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Partial<PolicyItem> | null>(null)
  const [isNew, setIsNew] = useState(false)

  const load = useCallback(() => {
    fetch('/api/admin/policies')
      .then((r) => r.json())
      .then((d) => setPolicies(d.policies || []))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const handleSave = useCallback(async () => {
    if (!editing?.name) return
    const body: Record<string, unknown> = { ...editing }
    body.rule = editing.rule || '{}'
    if (isNew) {
      await fetch('/api/admin/policies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    } else {
      await fetch(`/api/admin/policies/${encodeURIComponent(editing.name)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    }
    setEditing(null)
    load()
  }, [editing, isNew, load])

  const handleDelete = useCallback(async (name: string) => {
    if (!confirm(`Delete policy "${name}"?`)) return
    await fetch(`/api/admin/policies/${encodeURIComponent(name)}`, { method: 'DELETE' })
    load()
  }, [load])

  if (loading) {
    return <div className="flex items-center justify-center h-full"><p className="text-fog/40 animate-breathe">Loading…</p></div>
  }

  return (
    <div className="p-6 max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[16px] font-medium text-mist">Policies</h2>
          <p className="text-[12px] text-fog/40 mt-0.5">Guardrail rules evaluated at preTool / postTool / preFinalize</p>
        </div>
        <button onClick={() => { setEditing({ ...EMPTY_POLICY }); setIsNew(true) }}
          className="px-4 py-2 rounded-lg text-[13px] bg-indigo/20 border border-indigo/30 text-indigo hover:bg-indigo/30 transition-all">
          + New Policy
        </button>
      </div>

      <div className="grid gap-2">
        {policies.map((p) => (
          <div key={p.id} className="glass-admin rounded-lg p-4 flex items-center gap-4 hover:bg-white/[0.02] transition-all">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[14px] font-medium text-mist font-mono">{p.name}</span>
                <span className={`text-[9px] font-sans uppercase tracking-[0.04em] px-1.5 py-0.5 rounded-full border ${
                  p.hook === 'preTool' ? 'text-amber/60 border-amber/20' :
                  p.hook === 'postTool' ? 'text-indigo/60 border-indigo/20' :
                  'text-malachite/60 border-malachite/20'
                }`}>{p.hook}</span>
                {p.enabled ? null : <span className="text-[9px] text-fog/30 border border-fog/10 rounded-full px-1.5 py-0.5 uppercase">disabled</span>}
              </div>
              {p.description && <p className="text-[12px] text-fog/50 truncate">{p.description}</p>}
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => { setEditing(p); setIsNew(false) }} className="text-[11px] text-fog/40 hover:text-fog px-2 py-1 transition-colors">Edit</button>
              <button onClick={() => handleDelete(p.name)} className="text-[11px] text-fog/30 hover:text-vermillion px-2 py-1 transition-colors">Del</button>
            </div>
          </div>
        ))}
        {policies.length === 0 && <p className="text-[13px] text-fog/30 py-8 text-center">No policies configured. Built-in policies are always available as fallback.</p>}
      </div>

      {/* Edit Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center pt-20" onClick={() => setEditing(null)}>
          <div className="glass-admin rounded-xl p-6 w-full max-w-lg space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[14px] font-medium text-mist">{isNew ? 'New Policy' : 'Edit Policy'}</h3>
            <label className="block space-y-1">
              <span className="text-[10px] text-fog/40 uppercase">Name</span>
              <input value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                className="w-full bg-white/[0.03] border border-white/[0.06] rounded text-[13px] text-mist py-1.5 px-2 outline-none focus:border-indigo/30 font-mono" />
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] text-fog/40 uppercase">Description</span>
              <input value={editing.description || ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                className="w-full bg-white/[0.03] border border-white/[0.06] rounded text-[13px] text-mist py-1.5 px-2 outline-none focus:border-indigo/30" />
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] text-fog/40 uppercase">Hook</span>
              <select value={editing.hook || 'preTool'} onChange={(e) => setEditing({ ...editing, hook: e.target.value })}
                className="w-full bg-white/[0.03] border border-white/[0.06] rounded text-[13px] text-mist py-1.5 px-2 outline-none focus:border-indigo/30">
                {HOOKS.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] text-fog/40 uppercase">Rule (JSON)</span>
              <textarea value={editing.rule || '{}'} onChange={(e) => setEditing({ ...editing, rule: e.target.value })}
                rows={8} className="w-full bg-white/[0.03] border border-white/[0.06] rounded text-[12px] text-mist py-1.5 px-2 outline-none focus:border-indigo/30 font-mono resize-y" />
              <p className="text-[10px] text-fog/30">{"{ deny_skills: string[], require_skills: string[], deny_keywords: string[] }"}</p>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={editing.enabled ?? true} onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
                className="accent-indigo" /><span className="text-[11px] text-fog/50">Enabled</span>
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
