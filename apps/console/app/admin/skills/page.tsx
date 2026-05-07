'use client'

import { useState, useEffect, useCallback } from 'react'
import { Puzzle, Plus, Pencil, Trash2, Search, Wand2, Zap } from 'lucide-react'
import GlassCard from '@/components/ui/glass-card'
import { ListSkeleton } from '@/components/ui/skeleton'
import EmptyState from '@/components/ui/empty-state'

interface SkillItem {
  id: string; name: string; description: string; mode: string
  inputSchema: string; outputSchema: string; headers: string; mockFixture: string
  endpoint: string | null; httpMethod: string; timeoutMs: number; guardPhase: string
  isConcurrencySafe: boolean; enabled: boolean
}

const EMPTY: Partial<SkillItem> = { name: '', description: '', mode: 'mock', inputSchema: '{}', outputSchema: '{}', headers: '{}', mockFixture: '{}', endpoint: '', httpMethod: 'POST', timeoutMs: 8000, guardPhase: 'post', isConcurrencySafe: true, enabled: true }

function formatJson(text: string): string {
  try { return JSON.stringify(JSON.parse(text), null, 2) } catch { return text }
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<SkillItem[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Partial<SkillItem> | null>(null)
  const [originalName, setOriginalName] = useState('')
  const [isNew, setIsNew] = useState(false)
  const [search, setSearch] = useState('')
  const [testing, setTesting] = useState(false)

  const load = useCallback(() => { fetch('/api/admin/skills').then(r => r.json()).then(d => setSkills(d.skills || [])).finally(() => setLoading(false)) }, [])
  useEffect(() => { load() }, [load])

  const handleSave = useCallback(async () => {
    if (!editing?.name) return
    const urlName = isNew ? editing.name : originalName
    const url = isNew ? '/api/admin/skills' : `/api/admin/skills/${encodeURIComponent(urlName)}`
    const res = await fetch(url, { method: isNew ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editing) })
    if (!res.ok) return alert(`Failed to save: ${res.status}`)
    // Invalidate agent config cache in case skills are cached in the future
    fetch('/api/admin/config-changed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerId: 'default' }) }).catch(() => {})
    setEditing(null); load()
  }, [editing, isNew, load])

  const handleDelete = useCallback(async (name: string) => {
    if (!confirm(`Delete "${name}"?`)) return
    await fetch(`/api/admin/skills/${encodeURIComponent(name)}`, { method: 'DELETE' })
    fetch('/api/admin/config-changed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerId: 'default' }) }).catch(() => {})
    load()
  }, [load])

  const handleTestEndpoint = useCallback(async () => {
    if (!editing) return
    setTesting(true)
    try {
      const res = await fetch('/api/admin/skills/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: editing.endpoint, httpMethod: editing.httpMethod, headers: editing.headers, timeoutMs: editing.timeoutMs }),
      })
      const data = await res.json()
      alert(res.ok ? `Test OK (${data.latencyMs}ms):\n${JSON.stringify(data.body, null, 2)}` : `Test failed: ${data.error}`)
    } catch (e: any) { alert(`Test error: ${e.message}`) }
    finally { setTesting(false) }
  }, [editing])

  const filtered = skills.filter(s => !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.description.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="max-w-4xl mx-auto px-8 py-8 animate-fade-up space-y-5">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-[18px] font-semibold text-primary tracking-[-0.01em]">Skills</h1>
          <p className="text-[13px] text-secondary mt-1">Agent tool registry — mock and HTTP endpoints</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted/40" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" className="glass-input-console text-[12px] pl-8 pr-3 py-2 w-40" />
          </div>
          <button onClick={() => { setEditing({ ...EMPTY }); setOriginalName(''); setIsNew(true) }}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[13px] font-medium bg-indigo/[0.08] border border-indigo/20 text-indigo hover:bg-indigo/[0.15] transition-all duration-200">
            <Plus className="w-4 h-4" /> New
          </button>
        </div>
      </div>

      {loading && <ListSkeleton count={4} />}

      {!loading && skills.length === 0 && (
        <EmptyState icon={Puzzle} title="No skills configured" description="Built-in skills are always available as fallback. Add custom skills here to override or extend." />
      )}

      {!loading && skills.length > 0 && filtered.length === 0 && search && (
        <p className="text-[13px] text-muted text-center py-8">No skills matching "{search}"</p>
      )}

      {filtered.map(s => (
        <GlassCard key={s.id} className="p-5 flex items-center gap-5">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5 mb-1.5">
              <span className="text-[14px] font-semibold text-primary font-mono">{s.name}</span>
              <span className={`text-[9px] font-sans uppercase tracking-[0.05em] px-1.5 py-0.5 rounded-full border ${s.mode === 'mock' ? 'text-muted/50 border-muted/10' : 'text-indigo/70 border-indigo/15'}`}>{s.mode}</span>
              {s.enabled ? <span className="text-[9px] text-malachite/70 font-sans uppercase tracking-[0.05em]">on</span> : <span className="text-[9px] text-muted/30">off</span>}
            </div>
            <p className="text-[12px] text-secondary truncate">{s.description}</p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button onClick={() => { setEditing(s); setOriginalName(s.name); setIsNew(false) }} className="p-2 rounded-lg text-muted hover:text-primary hover:bg-[var(--surface-hover)] transition-all"><Pencil className="w-3.5 h-3.5" /></button>
            <button onClick={() => handleDelete(s.name)} className="p-2 rounded-lg text-muted/40 hover:text-vermillion hover:bg-[var(--surface-hover)] transition-all"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        </GlassCard>
      ))}

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-start justify-center pt-20 overflow-y-auto animate-fade-up" onClick={() => setEditing(null)}>
          <GlassCard className="p-6 w-full max-w-lg space-y-4 max-h-[80vh] overflow-y-auto" onClick={undefined}>
            <h3 className="text-[15px] font-semibold text-primary">{isNew ? 'New Skill' : 'Edit Skill'}</h3>

            <div className="grid grid-cols-2 gap-4">
              <label className="block space-y-1"><span className="text-[10px] text-muted uppercase tracking-[0.05em]">name</span>
                <input value={editing.name || ''} onChange={e => setEditing({ ...editing, name: e.target.value })} className="glass-input-console text-[13px] font-mono" placeholder="query_order_status" />
              </label>
              <label className="block space-y-1"><span className="text-[10px] text-muted uppercase tracking-[0.05em]">mode</span>
                <select value={editing.mode || 'mock'} onChange={e => setEditing({ ...editing, mode: e.target.value })} className="glass-input-console text-[13px]">
                  <option value="mock">mock</option><option value="http">http</option>
                </select>
              </label>
            </div>

            <label className="block space-y-1"><span className="text-[10px] text-muted uppercase tracking-[0.05em]">description</span>
              <input value={editing.description || ''} onChange={e => setEditing({ ...editing, description: e.target.value })} className="glass-input-console text-[13px]" placeholder="What this skill does, when the agent should call it" />
            </label>

            {/* HTTP-only fields */}
            <div className={`space-y-4 rounded-xl border p-4 transition-all ${editing.mode === 'http' ? 'border-indigo/20 bg-indigo/[0.02]' : 'border-[var(--border-subtle)] opacity-50 pointer-events-none'}`}>
              <p className="text-[9px] font-sans uppercase tracking-[0.08em] text-indigo/60 mb-1">HTTP Configuration</p>
              <div className="grid grid-cols-2 gap-4">
                <label className="block space-y-1"><span className="text-[10px] text-muted uppercase tracking-[0.05em]">endpoint</span>
                  <input value={editing.endpoint || ''} onChange={e => setEditing({ ...editing, endpoint: e.target.value })} className="glass-input-console text-[13px] font-mono" placeholder="https://api.example.com/order/status" />
                </label>
                <label className="block space-y-1"><span className="text-[10px] text-muted uppercase tracking-[0.05em]">httpMethod</span>
                  <select value={editing.httpMethod || 'POST'} onChange={e => setEditing({ ...editing, httpMethod: e.target.value })} className="glass-input-console text-[13px]">
                    <option value="POST">POST</option><option value="GET">GET</option>
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <label className="block space-y-1"><span className="text-[10px] text-muted uppercase tracking-[0.05em]">timeoutMs</span>
                  <input type="number" value={editing.timeoutMs || 8000} onChange={e => setEditing({ ...editing, timeoutMs: parseInt(e.target.value) || 8000 })} className="glass-input-console text-[13px] font-mono" />
                </label>
                <label className="block space-y-1"><span className="text-[10px] text-muted uppercase tracking-[0.05em]">guardPhase</span>
                  <select value={editing.guardPhase || 'post'} onChange={e => setEditing({ ...editing, guardPhase: e.target.value })} className="glass-input-console text-[13px]">
                    <option value="pre">pre</option><option value="post">post</option>
                  </select>
                </label>
              </div>
              <button onClick={handleTestEndpoint} disabled={testing || !editing.endpoint}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border border-indigo/20 text-indigo/70 hover:bg-indigo/[0.08] transition-all disabled:opacity-30 disabled:cursor-not-allowed">
                <Zap className="w-3 h-3" />{testing ? 'Testing…' : 'Test Endpoint'}
              </button>
            </div>

            {/* JSON fields with format buttons */}
            {(['inputSchema', 'outputSchema', 'headers', 'mockFixture'] as const).map(f => (
              <label key={f} className="block space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted uppercase tracking-[0.05em]">{f}</span>
                  <button onClick={() => setEditing({ ...editing, [f]: formatJson(String(editing[f] || '{}')) })}
                    className="flex items-center gap-1 text-[9px] text-muted/50 hover:text-indigo/70 transition-colors">
                    <Wand2 className="w-3 h-3" /> Format
                  </button>
                </div>
                <textarea value={editing[f] || '{}'} onChange={e => setEditing({ ...editing, [f]: e.target.value })}
                  rows={f === 'mockFixture' ? 4 : f === 'headers' ? 2 : 3}
                  className="glass-input-console text-[12px] font-mono resize-y" />
              </label>
            ))}

            <div className="flex gap-3">
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={editing.isConcurrencySafe ?? true} onChange={e => setEditing({ ...editing, isConcurrencySafe: e.target.checked })} className="accent-indigo" /><span className="text-[11px] text-secondary">Concurrency Safe</span></label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={editing.enabled ?? true} onChange={e => setEditing({ ...editing, enabled: e.target.checked })} className="accent-indigo" /><span className="text-[11px] text-secondary">Enabled</span></label>
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={handleSave} className="px-5 py-2.5 rounded-xl text-[12px] font-medium bg-indigo/[0.08] border border-indigo/20 text-indigo hover:bg-indigo/[0.15] transition-all">Save</button>
              <button onClick={() => setEditing(null)} className="px-4 py-2.5 rounded-xl text-[12px] text-secondary hover:text-primary transition-all">Cancel</button>
            </div>
          </GlassCard>
        </div>
      )}
    </div>
  )
}
