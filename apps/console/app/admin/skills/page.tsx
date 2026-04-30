'use client'

// Skills Registry — list, create, edit, delete skills

import { useState, useEffect, useCallback } from 'react'

interface SkillItem {
  id: string
  name: string
  description: string
  mode: string
  inputSchema: string
  outputSchema: string
  endpoint: string | null
  httpMethod: string
  timeoutMs: number
  guardPhase: string
  isConcurrencySafe: boolean
  enabled: boolean
}

const EMPTY_SKILL: Partial<SkillItem> = {
  name: '', description: '', mode: 'mock', inputSchema: '{}', outputSchema: '{}',
  httpMethod: 'POST', timeoutMs: 8000, guardPhase: 'post', isConcurrencySafe: true, enabled: true,
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<SkillItem[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Partial<SkillItem> | null>(null)
  const [isNew, setIsNew] = useState(false)

  const loadSkills = useCallback(() => {
    fetch('/api/admin/skills')
      .then((r) => r.json())
      .then((d) => setSkills(d.skills || []))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadSkills() }, [loadSkills])

  const handleSave = useCallback(async () => {
    if (!editing?.name) return
    const body: Record<string, unknown> = { ...editing }
    body.inputSchema = editing.inputSchema || '{}'
    body.outputSchema = editing.outputSchema || '{}'

    const method = isNew ? 'POST' : 'PUT'
    const url = isNew ? '/api/admin/skills' : `/api/admin/skills/${encodeURIComponent(editing.name)}`
    await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    setEditing(null)
    loadSkills()
  }, [editing, isNew, loadSkills])

  const handleDelete = useCallback(async (name: string) => {
    if (!confirm(`Delete skill "${name}"?`)) return
    await fetch(`/api/admin/skills/${encodeURIComponent(name)}`, { method: 'DELETE' })
    loadSkills()
  }, [loadSkills])

  if (loading) {
    return <div className="flex items-center justify-center h-full"><p className="text-fog/40 animate-breathe">Loading…</p></div>
  }

  return (
    <div className="p-6 max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[16px] font-medium text-mist">Skills</h2>
          <p className="text-[12px] text-fog/40 mt-0.5">Agent tool registry — mock and HTTP endpoints</p>
        </div>
        <button
          onClick={() => { setEditing({ ...EMPTY_SKILL }); setIsNew(true) }}
          className="px-4 py-2 rounded-lg text-[13px] bg-indigo/20 border border-indigo/30 text-indigo hover:bg-indigo/30 transition-all"
        >
          + New Skill
        </button>
      </div>

      <div className="grid gap-2">
        {skills.map((s) => (
          <div key={s.id} className="glass-admin rounded-lg p-4 flex items-center gap-4 hover:bg-white/[0.02] transition-all">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[14px] font-medium text-mist font-mono">{s.name}</span>
                <span className={`text-[9px] font-sans uppercase tracking-[0.04em] px-1.5 py-0.5 rounded-full border ${
                  s.mode === 'mock' ? 'text-fog/50 border-fog/20' : 'text-indigo/60 border-indigo/20'
                }`}>{s.mode}</span>
                <span className={`text-[9px] font-sans uppercase tracking-[0.04em] px-1.5 py-0.5 rounded-full border ${
                  s.enabled ? 'text-malachite/60 border-malachite/20' : 'text-fog/30 border-fog/10'
                }`}>{s.enabled ? 'enabled' : 'disabled'}</span>
                {s.isConcurrencySafe && <span className="text-[9px] text-fog/30 font-mono">∥</span>}
              </div>
              <p className="text-[12px] text-fog/50 truncate">{s.description}</p>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button onClick={() => { setEditing(s); setIsNew(false) }}
                className="text-[11px] text-fog/40 hover:text-fog px-2 py-1 transition-colors">Edit</button>
              <button onClick={() => handleDelete(s.name)}
                className="text-[11px] text-fog/30 hover:text-vermillion px-2 py-1 transition-colors">Del</button>
            </div>
          </div>
        ))}
        {skills.length === 0 && <p className="text-[13px] text-fog/30 py-8 text-center">No skills configured. Built-in skills are always available as fallback.</p>}
      </div>

      {/* Edit Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center pt-20 overflow-y-auto" onClick={() => setEditing(null)}>
          <div className="glass-admin rounded-xl p-6 w-full max-w-lg space-y-4 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[14px] font-medium text-mist">{isNew ? 'New Skill' : 'Edit Skill'}</h3>
            {(['name', 'description', 'mode', 'endpoint', 'httpMethod', 'timeoutMs', 'guardPhase'] as const).map((f) => (
              <label key={f} className="block space-y-1">
                <span className="text-[10px] text-fog/40 uppercase tracking-[0.04em]">{f}</span>
                {f === 'mode' ? (
                  <select value={editing.mode || 'mock'} onChange={(e) => setEditing({ ...editing, mode: e.target.value })}
                    className="w-full bg-white/[0.03] border border-white/[0.06] rounded text-[13px] text-mist py-1.5 px-2 outline-none focus:border-indigo/30 transition-all">
                    <option value="mock">mock</option>
                    <option value="http">http</option>
                  </select>
                ) : f === 'timeoutMs' ? (
                  <input type="number" value={editing.timeoutMs ?? 8000}
                    onChange={(e) => setEditing({ ...editing, timeoutMs: parseInt(e.target.value) })}
                    className="w-full bg-white/[0.03] border border-white/[0.06] rounded text-[13px] text-mist py-1.5 px-2 outline-none focus:border-indigo/30 transition-all font-mono" />
                ) : (
                  <input value={String(editing[f] || '')} onChange={(e) => setEditing({ ...editing, [f]: e.target.value })}
                    className="w-full bg-white/[0.03] border border-white/[0.06] rounded text-[13px] text-mist py-1.5 px-2 outline-none focus:border-indigo/30 transition-all" />
                )}
              </label>
            ))}
            <label className="block space-y-1">
              <span className="text-[10px] text-fog/40 uppercase tracking-[0.04em]">inputSchema (JSON)</span>
              <textarea value={editing.inputSchema || '{}'} onChange={(e) => setEditing({ ...editing, inputSchema: e.target.value })}
                rows={4} className="w-full bg-white/[0.03] border border-white/[0.06] rounded text-[12px] text-mist py-1.5 px-2 outline-none focus:border-indigo/30 transition-all font-mono resize-y" />
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] text-fog/40 uppercase tracking-[0.04em]">outputSchema (JSON)</span>
              <textarea value={editing.outputSchema || '{}'} onChange={(e) => setEditing({ ...editing, outputSchema: e.target.value })}
                rows={4} className="w-full bg-white/[0.03] border border-white/[0.06] rounded text-[12px] text-mist py-1.5 px-2 outline-none focus:border-indigo/30 transition-all font-mono resize-y" />
            </label>
            <div className="flex gap-3">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={editing.isConcurrencySafe ?? true} onChange={(e) => setEditing({ ...editing, isConcurrencySafe: e.target.checked })}
                  className="accent-indigo" /><span className="text-[11px] text-fog/50">Concurrency Safe</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={editing.enabled ?? true} onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
                  className="accent-indigo" /><span className="text-[11px] text-fog/50">Enabled</span>
              </label>
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={handleSave} className="px-4 py-2 rounded-lg text-[12px] bg-indigo/20 border border-indigo/30 text-indigo hover:bg-indigo/30 transition-all">Save</button>
              <button onClick={() => setEditing(null)} className="px-4 py-2 rounded-lg text-[12px] text-fog/40 hover:text-fog transition-colors">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
