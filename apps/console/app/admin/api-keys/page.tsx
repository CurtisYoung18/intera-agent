'use client'

import { useState, useEffect, useCallback } from 'react'
import { Key, Plus, Trash2, Copy, Check, Eye, EyeOff, Loader2, AlertCircle, X } from 'lucide-react'
import { useConsoleLocale } from '@/components/locale-provider'

interface ApiKeyRow {
  id: string
  name: string
  prefix: string
  agentConfigId: string | null
  lastUsedAt: string | null
  createdAt: string
}

interface AgentOption {
  id: string
  name: string
  version: number
  isActive: boolean
}

export default function ApiKeysPage() {
  const { t } = useConsoleLocale()
  const [keys, setKeys] = useState<ApiKeyRow[]>([])
  const [agents, setAgents] = useState<AgentOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  // New key form
  const [showForm, setShowForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newAgentConfigId, setNewAgentConfigId] = useState('')

  // Revealed plaintexts — persisted in sessionStorage so keys can be copied
  // repeatedly within the same browser session. Keys are only stored client-side;
  // the server only keeps the SHA256 hash.
  const [revealedKeys, setRevealedKeys] = useState<Array<{ name: string; plaintext: string }>>(() => {
    try { return JSON.parse(sessionStorage.getItem('intera-revealed-keys') || '[]') } catch { return [] }
  })
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(() => new Set())
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const persistRevealed = (list: Array<{ name: string; plaintext: string }>) => {
    setRevealedKeys(list)
    try { sessionStorage.setItem('intera-revealed-keys', JSON.stringify(list)) } catch { /* */ }
  }

  const addRevealed = (name: string, plaintext: string) => {
    const next = [...revealedKeys.filter(k => k.plaintext !== plaintext), { name, plaintext }]
    persistRevealed(next)
  }

  const dismissRevealed = (plaintext: string) => {
    persistRevealed(revealedKeys.filter(k => k.plaintext !== plaintext))
  }

  const toggleVisible = (plaintext: string) => {
    setVisibleKeys(prev => {
      const next = new Set(prev)
      if (next.has(plaintext)) {
        next.delete(plaintext)
      } else {
        next.add(plaintext)
      }
      return next
    })
  }

  const handleCopy = async (plaintext: string) => {
    try {
      await navigator.clipboard.writeText(plaintext)
      setCopiedKey(plaintext)
      setTimeout(() => setCopiedKey(null), 3000)
    } catch { /* */ }
  }

  const fetchKeys = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const r = await fetch('/api/admin/api-keys')
      const d = await r.json()
      if (!r.ok) { setError(d.error || t('common.failedLoad')); return }
      setKeys(d.keys || [])
    } catch {
      setError(t('common.failedLoad'))
    } finally {
      setLoading(false)
    }
  }, [t])

  const fetchAgents = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/agent-configs')
      const d = await r.json()
      if (r.ok && d.configs) {
        // Group by name, pick one row per name for the dropdown
        const seen = new Set<string>()
        const opts: AgentOption[] = []
        for (const a of d.configs) {
          if (!seen.has(a.name)) {
            seen.add(a.name)
            opts.push(a)
          }
        }
        setAgents(opts)
      }
    } catch { /* non-critical */ }
  }, [])

  useEffect(() => { fetchKeys(); fetchAgents() }, [fetchKeys, fetchAgents])

  const handleCreate = async () => {
    const name = newName.trim() || 'default'
    setBusyId('__new__')
    setError('')
    try {
      const body: Record<string, string> = { name }
      if (newAgentConfigId) body.agentConfigId = newAgentConfigId
      const r = await fetch('/api/admin/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await r.json()
      if (!r.ok) { setError(d.error || t('common.failedSave', { status: String(r.status) })); return }
      addRevealed(name, d.plaintext)
      setShowForm(false)
      setNewName('')
      setNewAgentConfigId('')
      await fetchKeys()
    } catch {
      setError(t('common.failedSave', { status: '' }))
    } finally {
      setBusyId(null)
    }
  }

  const handleRevoke = async (id: string) => {
    if (!window.confirm(t('common.deleteConfirm', { name: 'this API key' }))) return
    setBusyId(id)
    setError('')
    try {
      const r = await fetch(`/api/admin/api-keys/${id}`, { method: 'DELETE' })
      if (!r.ok) { const d = await r.json().catch(() => ({})); setError(d.error || t('common.failedLoad')); return }
      await fetchKeys()
    } catch {
      setError(t('common.failedLoad'))
    } finally {
      setBusyId(null)
    }
  }

  function formatDate(iso: string | null): string {
    if (!iso) return '—'
    try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) } catch { return iso }
  }

  function agentLabel(agentConfigId: string | null): string {
    if (!agentConfigId) return t('common.active')
    const a = agents.find(x => x.id === agentConfigId)
    return a ? `${a.name} v${a.version}` : agentConfigId.slice(0, 8) + '…'
  }

  return (
    <div className="p-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
            <Key className="w-4 h-4 text-amber-600" />
          </div>
          <div>
            <h1 className="text-[18px] font-bold text-[var(--mist)]">{t('apiKeys.title')}</h1>
            <p className="text-[12px] text-[var(--fog)]">{t('apiKeys.subtitle')}</p>
          </div>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold text-white bg-[var(--indigo)] hover:opacity-90 transition-opacity"
          style={{ border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          <Plus size={14} />
          {t('apiKeys.newKey')}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-red-50 border border-red-100 text-[11px] text-red-600">
          <AlertCircle size={12} />
          {error}
          <button onClick={() => setError('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}><X size={11} /></button>
        </div>
      )}

      {/* Revealed keys (persisted in sessionStorage) */}
      {revealedKeys.map(rk => {
        const isVisible = visibleKeys.has(rk.plaintext)
        const isCopied = copiedKey === rk.plaintext
        return (
          <div key={rk.plaintext} className="mb-4 p-5 rounded-2xl bg-amber-50 border border-amber-200">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-[13px] font-bold text-amber-800">{rk.name}</p>
                <p className="text-[11px] text-amber-600 mt-0.5">{t('apiKeys.keyRevealHint')}</p>
              </div>
              <button onClick={() => dismissRevealed(rk.plaintext)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--amber)' }}><X size={14} /></button>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-amber-200 font-mono text-[12px] text-[var(--mist)] break-all">
                {isVisible ? rk.plaintext : '•'.repeat(40)}
              </div>
              <button
                onClick={() => toggleVisible(rk.plaintext)}
                className="p-2 rounded-lg bg-white border border-amber-200 hover:bg-amber-100 transition-colors"
                title={isVisible ? t('apiKeys.hide') : t('apiKeys.show')}
                style={{ cursor: 'pointer' }}
              >
                {isVisible ? <EyeOff size={14} className="text-amber-600" /> : <Eye size={14} className="text-amber-600" />}
              </button>
              <button
                onClick={() => handleCopy(rk.plaintext)}
                className="flex items-center gap-1 px-3 py-2 rounded-lg text-[12px] font-semibold transition-colors"
                style={{
                  background: isCopied ? 'var(--malachite)' : 'var(--amber)',
                  color: 'white',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {isCopied ? <Check size={12} /> : <Copy size={12} />}
                {isCopied ? t('apiKeys.copied') : t('apiKeys.copy')}
              </button>
            </div>
          </div>
        )
      })}

      {/* Create form */}
      {showForm && (
        <div className="mb-6 p-5 rounded-2xl bg-white/80 backdrop-blur-xl border border-black/[0.06]">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[13px] font-bold text-[var(--mist)]">{t('apiKeys.createKey')}</p>
            <button onClick={() => { setShowForm(false); setNewName(''); setNewAgentConfigId('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fog)' }}><X size={14} /></button>
          </div>
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-[11px] font-semibold text-[var(--fog)] mb-1 block">{t('common.name')}</label>
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="production"
                className="w-full px-3 py-2 rounded-xl border border-black/[0.08] text-[13px] text-[var(--mist)] bg-white/60 outline-none focus:border-indigo/30 font-[inherit]"
                onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-[var(--fog)] mb-1 block">{t('apiKeys.bindAgentConfig')}</label>
              <select
                value={newAgentConfigId}
                onChange={e => setNewAgentConfigId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-black/[0.08] text-[13px] text-[var(--mist)] bg-white/60 outline-none focus:border-indigo/30 font-[inherit] appearance-none"
                style={{ WebkitAppearance: 'none' }}
              >
                <option value="">{t('apiKeys.orgDefault', { label: t('common.active') })}</option>
                {agents.map(a => (
                  <option key={a.id} value={a.id}>{a.name} · v{a.version}{a.isActive ? ` (${t('common.active')})` : ''}</option>
                ))}
              </select>
              <p className="text-[10px] text-[var(--fog)] mt-1 opacity-60">
                {t('apiKeys.bindAgentConfigHint')}
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setShowForm(false); setNewName(''); setNewAgentConfigId('') }}
                className="px-4 py-2 rounded-xl text-[12px] font-semibold text-[var(--fog)] bg-black/[0.04] hover:bg-black/[0.08] transition-colors"
                style={{ border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleCreate}
                disabled={busyId === '__new__'}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-semibold text-white bg-[var(--indigo)] hover:opacity-90 transition-opacity disabled:opacity-50"
                style={{ border: 'none', cursor: busyId === '__new__' ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
              >
                {busyId === '__new__' ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                {t('apiKeys.create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Key list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 size={16} className="animate-spin text-[var(--fog)]" />
        </div>
      ) : keys.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-12 h-12 rounded-2xl bg-black/[0.03] flex items-center justify-center mx-auto mb-3">
            <Key size={18} className="text-[var(--fog)] opacity-30" />
          </div>
          <p className="text-[13px] text-[var(--fog)] opacity-50">{t('apiKeys.empty')}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {keys.map(k => (
            <div
              key={k.id}
              className="flex items-center gap-4 px-4 py-3 rounded-2xl bg-white/80 backdrop-blur-xl border border-black/[0.06] transition-all hover:border-black/[0.12]"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-[13px] font-semibold text-[var(--mist)]">{k.name}</p>
                  <span className="text-[10px] font-mono text-[var(--fog)] bg-black/[0.04] px-2 py-0.5 rounded-md">{k.prefix}…</span>
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-[10px] text-[var(--fog)] opacity-60">{agentLabel(k.agentConfigId)}</span>
                  {k.lastUsedAt && (
                    <span className="text-[10px] text-[var(--fog)] opacity-40">Last used {formatDate(k.lastUsedAt)}</span>
                  )}
                  <span className="text-[10px] text-[var(--fog)] opacity-40">Created {formatDate(k.createdAt)}</span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {revealedKeys.some(rk => k.prefix && rk.plaintext.startsWith(k.prefix)) && (
                  <button
                    onClick={() => {
                      const rk = revealedKeys.find(r => k.prefix && r.plaintext.startsWith(k.prefix))
                      if (rk) handleCopy(rk.plaintext)
                    }}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-[var(--indigo)] hover:bg-indigo/[0.06] transition-colors"
                    style={{ border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: 'transparent' }}
                  >
                    {copiedKey && revealedKeys.some(rk => k.prefix && rk.plaintext.startsWith(k.prefix) && rk.plaintext === copiedKey) ? <Check size={11} /> : <Copy size={11} />}
                    {t('apiKeys.copy')}
                  </button>
                )}
                <button
                  onClick={() => handleRevoke(k.id)}
                  disabled={busyId === k.id}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40"
                  style={{ border: 'none', cursor: busyId === k.id ? 'not-allowed' : 'pointer', fontFamily: 'inherit', background: 'transparent' }}
                >
                  {busyId === k.id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                  {t('apiKeys.revoke')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Usage tutorial */}
      <div className="mt-10">
        <h2 className="text-[14px] font-bold text-[var(--mist)] mb-4">{t('apiKeys.howToUse')}</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Auth card */}
          <div className="p-5 rounded-2xl bg-white/60 backdrop-blur-xl border border-black/[0.06]">
            <p className="text-[12px] font-bold text-[var(--mist)] mb-3">{t('apiKeys.authTitle')}</p>
            <p className="text-[11px] text-[var(--fog)] mb-3 leading-relaxed">
              {t('apiKeys.authDesc')}
            </p>
            <pre className="text-[10px] font-mono text-[var(--mist)] bg-black/[0.03] p-3 rounded-xl overflow-x-auto leading-relaxed whitespace-pre-wrap break-all">{`curl https://demo.anytrans.ai/api/messages \\
  -H "Authorization: Bearer intera_sk_live_…"
  -H "Content-Type: application/json"
  -d '{"message":"Hello","userId":"u_1"}'`}</pre>
          </div>

          {/* Endpoints card */}
          <div className="p-5 rounded-2xl bg-white/60 backdrop-blur-xl border border-black/[0.06]">
            <p className="text-[12px] font-bold text-[var(--mist)] mb-3">{t('apiKeys.endpointsTitle')}</p>
            <div className="flex flex-col gap-2">
              {[
                { method: 'POST', path: '/api/messages', desc: t('apiKeys.mainEndpointDesc') },
                { method: 'GET', path: '/api/cases?userId=…', desc: t('apiKeys.casesEndpointDesc') },
              ].map(ep => (
                <div key={ep.path} className="flex items-start gap-3 py-2 border-b border-black/[0.04] last:border-0">
                  <span className="text-[10px] font-bold font-mono text-[var(--indigo)] bg-indigo/[0.06] px-1.5 py-0.5 rounded-md flex-shrink-0 w-[38px] text-center">{ep.method}</span>
                  <div>
                    <p className="text-[11px] font-mono font-semibold text-[var(--mist)]">{ep.path}</p>
                    <p className="text-[10px] text-[var(--fog)] opacity-60 mt-0.5">{ep.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Agent routing note */}
        {agents.length > 1 && (
          <div className="mt-4 p-4 rounded-2xl bg-indigo/[0.03] border border-indigo/[0.08]">
            <p className="text-[11px] text-[var(--mist)] leading-relaxed">
              <strong>{t('apiKeys.tip')}:</strong> {t('apiKeys.tipDesc')}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
