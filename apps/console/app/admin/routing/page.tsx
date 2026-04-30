'use client'

// Routing — human task queue definitions

import { useState, useEffect, useCallback } from 'react'

interface RouteItem {
  id: string
  queue: string
  description: string | null
  skillsAllowed: string
  priority: number
  autoAssign: boolean
  maxWaitingTime: number
}

const EMPTY: Partial<RouteItem> = {
  queue: '', description: '', skillsAllowed: '[]', priority: 0, autoAssign: true, maxWaitingTime: 300,
}

export default function RoutingPage() {
  const [routes, setRoutes] = useState<RouteItem[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Partial<RouteItem> | null>(null)
  const [isNew, setIsNew] = useState(false)

  const load = useCallback(() => {
    fetch('/api/admin/routing')
      .then((r) => r.json())
      .then((d) => setRoutes(d.routes || []))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const handleSave = useCallback(async () => {
    if (!editing?.queue) return
    const body: Record<string, unknown> = { ...editing }
    body.skillsAllowed = typeof body.skillsAllowed === 'string' ? body.skillsAllowed : JSON.stringify(body.skillsAllowed)
    if (isNew) {
      await fetch('/api/admin/routing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    } else {
      await fetch(`/api/admin/routing/${encodeURIComponent(editing.queue)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    }
    setEditing(null)
    load()
  }, [editing, isNew, load])

  const handleDelete = useCallback(async (queue: string) => {
    if (!confirm(`Delete queue "${queue}"?`)) return
    await fetch(`/api/admin/routing/${encodeURIComponent(queue)}`, { method: 'DELETE' })
    load()
  }, [load])

  const parseSkills = (raw: string) => {
    try { return JSON.parse(raw) as string[] } catch { return [] }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-full"><p className="text-fog/40 animate-breathe">Loading…</p></div>
  }

  return (
    <div className="p-6 max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[16px] font-medium text-mist">Routing</h2>
          <p className="text-[12px] text-fog/40 mt-0.5">Human task queue definitions with skill permissions</p>
        </div>
        <button onClick={() => { setEditing({ ...EMPTY }); setIsNew(true) }}
          className="px-4 py-2 rounded-lg text-[13px] bg-indigo/20 border border-indigo/30 text-indigo hover:bg-indigo/30 transition-all">
          + New Queue
        </button>
      </div>

      <div className="grid gap-2">
        {routes.map((r) => {
          const skills = parseSkills(r.skillsAllowed)
          return (
            <div key={r.id} className="glass-admin rounded-lg p-4 flex items-center gap-4 hover:bg-white/[0.02] transition-all">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[14px] font-medium text-mist font-mono">{r.queue}</span>
                  <span className="text-[9px] font-sans uppercase tracking-[0.04em] px-1.5 py-0.5 rounded-full border text-fog/50 border-fog/20">
                    priority {r.priority}
                  </span>
                  {r.autoAssign && <span className="text-[9px] text-malachite/50 font-sans">auto</span>}
                  <span className="text-[9px] text-fog/30 font-mono">{r.maxWaitingTime}s</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {skills.map((s) => <span key={s} className="text-[9px] font-mono text-fog/40 bg-white/[0.03] px-1 py-0.5 rounded">{s}</span>)}
                  {skills.length === 0 && <span className="text-[10px] text-fog/30 italic">all skills allowed</span>}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => { setEditing(r); setIsNew(false) }} className="text-[11px] text-fog/40 hover:text-fog px-2 py-1 transition-colors">Edit</button>
                <button onClick={() => handleDelete(r.queue)} className="text-[11px] text-fog/30 hover:text-vermillion px-2 py-1 transition-colors">Del</button>
              </div>
            </div>
          )
        })}
        {routes.length === 0 && <p className="text-[13px] text-fog/30 py-8 text-center">No routing queues defined.</p>}
      </div>

      {/* Edit Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center pt-20" onClick={() => setEditing(null)}>
          <div className="glass-admin rounded-xl p-6 w-full max-w-lg space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[14px] font-medium text-mist">{isNew ? 'New Queue' : 'Edit Queue'}</h3>
            {(['queue', 'description'] as const).map((f) => (
              <label key={f} className="block space-y-1">
                <span className="text-[10px] text-fog/40 uppercase">{f}</span>
                <input value={String(editing[f] || '')} onChange={(e) => setEditing({ ...editing, [f]: e.target.value })}
                  className="w-full bg-white/[0.03] border border-white/[0.06] rounded text-[13px] text-mist py-1.5 px-2 outline-none focus:border-indigo/30 font-mono" />
              </label>
            ))}
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-[10px] text-fog/40 uppercase">Priority</span>
                <input type="number" value={editing.priority ?? 0} onChange={(e) => setEditing({ ...editing, priority: parseInt(e.target.value) })}
                  className="w-full bg-white/[0.03] border border-white/[0.06] rounded text-[13px] text-mist py-1.5 px-2 outline-none focus:border-indigo/30 font-mono" />
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] text-fog/40 uppercase">Max Wait (s)</span>
                <input type="number" value={editing.maxWaitingTime ?? 300} onChange={(e) => setEditing({ ...editing, maxWaitingTime: parseInt(e.target.value) })}
                  className="w-full bg-white/[0.03] border border-white/[0.06] rounded text-[13px] text-mist py-1.5 px-2 outline-none focus:border-indigo/30 font-mono" />
              </label>
            </div>
            <label className="block space-y-1">
              <span className="text-[10px] text-fog/40 uppercase">skillsAllowed (JSON array)</span>
              <textarea value={editing.skillsAllowed || '[]'} onChange={(e) => setEditing({ ...editing, skillsAllowed: e.target.value })}
                rows={4} className="w-full bg-white/[0.03] border border-white/[0.06] rounded text-[12px] text-mist py-1.5 px-2 outline-none focus:border-indigo/30 font-mono resize-y" />
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={editing.autoAssign ?? true} onChange={(e) => setEditing({ ...editing, autoAssign: e.target.checked })}
                className="accent-indigo" /><span className="text-[11px] text-fog/50">Auto Assign</span>
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
