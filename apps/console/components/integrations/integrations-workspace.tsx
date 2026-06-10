'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  AlertCircle,
  ArrowRight,
  Check,
  Copy,
  Eye,
  EyeOff,
  Globe,
  Headset,
  Loader2,
  MessageCircle,
  Plug,
  Plus,
  Send,
  Trash2,
} from 'lucide-react'
import ConfirmDialog from '@/components/ui/confirm-dialog'
import VersionContextBar, { useSelectedAgentId } from '@/components/admin/version-context-bar'
import { useConsoleLocale } from '@/components/locale-provider'
import { apiClient } from '@/lib/api/client'
import LiveChatChannelWorkspace from './livechat-channel-workspace'
import WebChatChannelWorkspace from './web-chat-channel-workspace'

type ChannelInfo = {
  id: string
  label: string
  description: string
  icon: typeof Plug
  active: boolean
  comingSoon: boolean
}

type ApiKeyRow = {
  id: string
  name: string
  prefix: string
  agentConfigId: string | null
  lastUsedAt: string | null
  createdAt: string
}

type AgentOption = {
  id: string
  name: string
  version: number
  isActive: boolean
}

const CHANNELS: ChannelInfo[] = [
  {
    id: 'livechat',
    label: 'LiveChat',
    description: 'Connection · Routing · Rendering · Human Handoff',
    icon: MessageCircle,
    active: true,
    comingSoon: false,
  },
  {
    id: 'web-chat',
    label: 'Web Chat',
    description: 'Embedded widget · Session entry point',
    icon: Globe,
    active: true,
    comingSoon: false,
  },
  {
    id: 'telegram',
    label: 'Telegram',
    description: 'Customer messaging channel',
    icon: Send,
    active: false,
    comingSoon: true,
  },
  {
    id: 'livedesk',
    label: 'LiveDesk',
    description: 'Customer service platform integration',
    icon: Headset,
    active: false,
    comingSoon: true,
  },
]

function routeFor(basePath: string, tab: 'channels' | 'apiKeys', channel?: string | null) {
  const params = new URLSearchParams({ tab })
  if (channel) params.set('channel', channel)
  return `${basePath}?${params.toString()}`
}

function channelCardCls(ch: ChannelInfo) {
  return `relative text-left rounded-2xl p-6 transition-all duration-200 group block backdrop-blur-sm ${
    ch.comingSoon
      ? 'bg-white/30 border border-black/[0.03] opacity-50 cursor-not-allowed'
      : ch.active
        ? 'bg-white/60 backdrop-blur-xl border border-white/20 shadow-sm hover:shadow-md hover:-translate-y-0.5'
        : 'bg-white/40 backdrop-blur-xl border border-white/10 hover:border-black/[0.1]'
  }`
}

function ChannelsTab({
  basePath,
  selectedChannel,
}: {
  basePath: string
  selectedChannel: string | null
}) {
  const router = useRouter()
  const agentConfigId = useSelectedAgentId()

  if (selectedChannel === 'livechat') {
    return (
      <LiveChatChannelWorkspace
        agentConfigId={agentConfigId}
        onBack={() => router.push(routeFor(basePath, 'channels'))}
      />
    )
  }

  if (selectedChannel === 'web-chat') {
    return <WebChatChannelWorkspace onBack={() => router.push(routeFor(basePath, 'channels'))} />
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-black/[0.05] bg-white/64 px-5 py-4 text-[12px] leading-6 text-[var(--fog)] shadow-[var(--shadow-card)]">
        Channel setup belongs inside Build because delivery staff need to bind the active Agent version, human-handoff target, and rendering behavior without leaving the current workspace.
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {CHANNELS.map((channel) => {
          const Icon = channel.icon
          const badge = channel.active
            ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-malachite/20 bg-malachite/10 px-2 py-0.5 text-[10px] font-medium text-malachite">
                  <span className="h-1.5 w-1.5 rounded-full bg-malachite" />
                  Active
                </span>
              )
            : channel.comingSoon
              ? <span className="inline-flex rounded-full border border-black/[0.06] bg-black/[0.04] px-2 py-0.5 text-[10px] font-medium text-[var(--fog)]">Coming soon</span>
              : <span className="inline-flex rounded-full border border-amber/20 bg-amber/10 px-2 py-0.5 text-[10px] font-medium text-amber">Inactive</span>

          const inner = (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${channel.active ? 'bg-indigo/[0.08]' : 'bg-black/[0.03]'}`}>
                    <Icon className={`h-5 w-5 ${channel.active ? 'text-indigo' : 'text-[var(--fog)]'}`} />
                  </div>
                  <div>
                    <p className="text-[14px] font-semibold text-[var(--mist)]">{channel.label}</p>
                    <p className="mt-0.5 text-[11px] text-[var(--fog)]">{channel.description}</p>
                  </div>
                </div>
                {channel.active ? <ArrowRight className="h-4 w-4 text-[var(--fog)]/30 transition-all group-hover:translate-x-0.5 group-hover:text-indigo" /> : null}
              </div>
              <div className="mt-3">{badge}</div>
            </>
          )

          if (channel.comingSoon) {
            return (
              <div key={channel.id} className={channelCardCls(channel)}>
                {inner}
              </div>
            )
          }

          return (
            <button
              key={channel.id}
              type="button"
              onClick={() => router.push(routeFor(basePath, 'channels', channel.id))}
              className={channelCardCls(channel)}
            >
              {inner}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ApiKeysTab() {
  const { t, locale } = useConsoleLocale()
  const [keys, setKeys] = useState<ApiKeyRow[]>([])
  const [agents, setAgents] = useState<AgentOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newAgentConfigId, setNewAgentConfigId] = useState('')
  const [revealedKeys, setRevealedKeys] = useState<Array<{ name: string; plaintext: string }>>(() => {
    try {
      return JSON.parse(sessionStorage.getItem('intera-revealed-keys') || '[]')
    } catch {
      return []
    }
  })
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(() => new Set())
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const persistRevealed = (list: Array<{ name: string; plaintext: string }>) => {
    setRevealedKeys(list)
    try {
      sessionStorage.setItem('intera-revealed-keys', JSON.stringify(list))
    } catch {
      // ignore
    }
  }

  const addRevealed = (name: string, plaintext: string) => {
    const next = [...revealedKeys.filter((key) => key.plaintext !== plaintext), { name, plaintext }]
    persistRevealed(next)
  }

  const dismissRevealed = (plaintext: string) => {
    persistRevealed(revealedKeys.filter((key) => key.plaintext !== plaintext))
  }

  const toggleVisible = (plaintext: string) => {
    setVisibleKeys((prev) => {
      const next = new Set(prev)
      if (next.has(plaintext)) next.delete(plaintext)
      else next.add(plaintext)
      return next
    })
  }

  const handleCopy = async (plaintext: string) => {
    try {
      await navigator.clipboard.writeText(plaintext)
      setCopiedKey(plaintext)
      setTimeout(() => setCopiedKey(null), 3000)
    } catch {
      // ignore
    }
  }

  const fetchKeys = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await apiClient<{ keys: ApiKeyRow[] }>('/api/admin/api-keys')
      setKeys(result.data.keys || [])
    } catch {
      setError(t('common.failedLoad'))
    } finally {
      setLoading(false)
    }
  }, [t])

  const fetchAgents = useCallback(async () => {
    try {
      const result = await apiClient<{ configs: AgentOption[] }>('/api/admin/agent-configs')
      if (!result.data.configs) return
      const seen = new Set<string>()
      const next: AgentOption[] = []
      for (const config of result.data.configs) {
        if (seen.has(config.name)) continue
        seen.add(config.name)
        next.push(config)
      }
      setAgents(next)
    } catch {
      // non-critical
    }
  }, [])

  useEffect(() => {
    fetchKeys()
    fetchAgents()
  }, [fetchKeys, fetchAgents])

  const handleCreate = async () => {
    const name = newName.trim() || 'default'
    setBusyId('__new__')
    setError('')
    try {
      const body: Record<string, string> = { name }
      if (newAgentConfigId) body.agentConfigId = newAgentConfigId
      const result = await apiClient<{ plaintext: string }>('/api/admin/api-keys', {
        method: 'POST',
        body,
      })
      addRevealed(name, result.data.plaintext)
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

  const handleRevoke = (id: string) => setConfirmDeleteId(id)

  const confirmRevoke = async () => {
    const id = confirmDeleteId
    if (!id) return
    setConfirmDeleteId(null)
    setBusyId(id)
    setError('')
    try {
      await apiClient(`/api/admin/api-keys/${id}`, { method: 'DELETE' })
      await fetchKeys()
    } catch {
      setError(t('common.failedLoad'))
    } finally {
      setBusyId(null)
    }
  }

  function formatDate(iso: string | null): string {
    if (!iso) return '—'
    try {
      return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    } catch {
      return iso
    }
  }

  function agentLabel(agentConfigId: string | null): string {
    if (!agentConfigId) return t('common.active')
    const config = agents.find((agent) => agent.id === agentConfigId)
    return config ? `${config.name} v${config.version}` : `${agentConfigId.slice(0, 8)}…`
  }

  const chatsEndpointDesc =
    locale === 'zh'
      ? '按用户读取会话记录与状态（含组织解析）'
      : 'List conversation records for a user (with org resolution)'

  return (
    <>
      <div className="max-w-4xl">
        {error ? (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-[11px] text-red-600">
            <AlertCircle size={12} />
            {error}
            <button
              onClick={() => setError('')}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
            >
              <Trash2 size={11} className="opacity-0" />
            </button>
          </div>
        ) : null}

        {revealedKeys.map((revealed) => {
          const isVisible = visibleKeys.has(revealed.plaintext)
          const isCopied = copiedKey === revealed.plaintext
          return (
            <div key={revealed.plaintext} className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-5">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-[13px] font-bold text-amber-800">{revealed.name}</p>
                  <p className="mt-0.5 text-[11px] text-amber-600">{t('apiKeys.keyRevealHint')}</p>
                </div>
                <button
                  onClick={() => dismissRevealed(revealed.plaintext)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--amber)' }}
                >
                  <Trash2 size={14} className="opacity-0" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex flex-1 items-center gap-2 break-all rounded-lg border border-amber-200 bg-white px-3 py-2 font-mono text-[12px] text-[var(--mist)]">
                  {isVisible ? revealed.plaintext : '•'.repeat(40)}
                </div>
                <button
                  onClick={() => toggleVisible(revealed.plaintext)}
                  className="rounded-lg border border-amber-200 bg-white p-2 transition-colors hover:bg-amber-100"
                  title={isVisible ? t('apiKeys.hide') : t('apiKeys.show')}
                  style={{ cursor: 'pointer' }}
                >
                  {isVisible ? <EyeOff size={14} className="text-amber-600" /> : <Eye size={14} className="text-amber-600" />}
                </button>
                <button
                  onClick={() => handleCopy(revealed.plaintext)}
                  className="flex items-center gap-1 rounded-lg px-3 py-2 text-[12px] font-semibold transition-colors"
                  style={{ background: isCopied ? 'var(--malachite)' : 'var(--amber)', color: 'white', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  {isCopied ? <Check size={12} /> : <Copy size={12} />}
                  {isCopied ? t('apiKeys.copied') : t('apiKeys.copy')}
                </button>
              </div>
            </div>
          )
        })}

        {showForm ? (
          <div className="mb-6 rounded-2xl border border-black/[0.06] bg-white/80 p-5 backdrop-blur-xl">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-[13px] font-bold text-[var(--mist)]">{t('apiKeys.createKey')}</p>
              <button
                onClick={() => {
                  setShowForm(false)
                  setNewName('')
                  setNewAgentConfigId('')
                }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fog)' }}
              >
                <Trash2 size={14} className="opacity-0" />
              </button>
            </div>
            <div className="flex flex-col gap-3">
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-[var(--fog)]">{t('common.name')}</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  placeholder="production"
                  className="glass-input-console w-full rounded-xl bg-white/60 text-[13px] text-[var(--mist)] outline-none focus:border-indigo/30"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') handleCreate()
                  }}
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-[var(--fog)]">{t('apiKeys.bindAgentConfig')}</label>
                <select
                  value={newAgentConfigId}
                  onChange={(event) => setNewAgentConfigId(event.target.value)}
                  className="glass-input-console w-full rounded-xl bg-white/60 text-[13px] text-[var(--mist)] outline-none focus:border-indigo/30"
                >
                  <option value="">{t('apiKeys.orgDefault', { label: t('common.active') })}</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name} · v{agent.version}{agent.isActive ? ` (${t('common.active')})` : ''}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[10px] text-[var(--fog)] opacity-60">{t('apiKeys.bindAgentConfigHint')}</p>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => {
                    setShowForm(false)
                    setNewName('')
                    setNewAgentConfigId('')
                  }}
                  className="rounded-xl bg-black/[0.04] px-4 py-2 text-[12px] font-semibold text-[var(--fog)] transition-colors hover:bg-black/[0.08]"
                  style={{ border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleCreate}
                  disabled={busyId === '__new__'}
                  className="flex items-center gap-2 rounded-xl bg-[var(--indigo)] px-4 py-2 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ border: 'none', cursor: busyId === '__new__' ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
                >
                  {busyId === '__new__' ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                  {t('apiKeys.create')}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="mb-4 flex justify-end">
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 rounded-xl bg-[var(--indigo)] px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
            style={{ border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            <Plus size={14} />
            {t('apiKeys.newKey')}
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 size={16} className="animate-spin text-[var(--fog)]" />
          </div>
        ) : keys.length === 0 ? (
          <div className="py-16 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-black/[0.03]">
              <Plus size={18} className="text-[var(--fog)] opacity-30" />
            </div>
            <p className="text-[13px] text-[var(--fog)] opacity-50">{t('apiKeys.empty')}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {keys.map((key) => (
              <div
                key={key.id}
                className="flex items-center gap-4 rounded-2xl border border-black/[0.06] bg-white/80 px-4 py-3 backdrop-blur-xl transition-all hover:border-black/[0.12]"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-semibold text-[var(--mist)]">{key.name}</p>
                    <span className="rounded-md bg-black/[0.04] px-2 py-0.5 font-mono text-[10px] text-[var(--fog)]">{key.prefix}…</span>
                  </div>
                  <div className="mt-1 flex items-center gap-3">
                    <span className="text-[10px] text-[var(--fog)] opacity-60">{agentLabel(key.agentConfigId)}</span>
                    {key.lastUsedAt ? <span className="text-[10px] text-[var(--fog)] opacity-40">Last used {formatDate(key.lastUsedAt)}</span> : null}
                    <span className="text-[10px] text-[var(--fog)] opacity-40">Created {formatDate(key.createdAt)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {revealedKeys.some((revealed) => key.prefix && revealed.plaintext.startsWith(key.prefix)) ? (
                    <button
                      onClick={() => {
                        const revealed = revealedKeys.find((row) => key.prefix && row.plaintext.startsWith(key.prefix))
                        if (revealed) handleCopy(revealed.plaintext)
                      }}
                      className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-semibold text-[var(--indigo)] transition-colors hover:bg-indigo/[0.06]"
                      style={{ border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: 'transparent' }}
                    >
                      {copiedKey && revealedKeys.some((revealed) => key.prefix && revealed.plaintext.startsWith(key.prefix) && revealed.plaintext === copiedKey) ? <Check size={11} /> : <Copy size={11} />}
                      {t('apiKeys.copy')}
                    </button>
                  ) : null}
                  <button
                    onClick={() => handleRevoke(key.id)}
                    disabled={busyId === key.id}
                    className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-40"
                    style={{ border: 'none', cursor: busyId === key.id ? 'not-allowed' : 'pointer', fontFamily: 'inherit', background: 'transparent' }}
                  >
                    {busyId === key.id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                    {t('apiKeys.revoke')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-10">
          <h2 className="mb-4 text-[14px] font-bold text-[var(--mist)]">{t('apiKeys.howToUse')}</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-black/[0.06] bg-white/60 p-5 backdrop-blur-xl">
              <p className="mb-3 text-[12px] font-bold text-[var(--mist)]">{t('apiKeys.authTitle')}</p>
              <p className="mb-3 text-[11px] leading-relaxed text-[var(--fog)]">{t('apiKeys.authDesc')}</p>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-xl bg-black/[0.03] p-3 font-mono text-[10px] leading-relaxed text-[var(--mist)]">{`curl https://demo.anytrans.ai/api/messages \\
  -H "Authorization: Bearer intera_sk_live_…"
  -H "Content-Type: application/json"
  -d '{"message":"Hello","userId":"u_1"}'`}</pre>
            </div>

            <div className="rounded-2xl border border-black/[0.06] bg-white/60 p-5 backdrop-blur-xl">
              <p className="mb-3 text-[12px] font-bold text-[var(--mist)]">{t('apiKeys.endpointsTitle')}</p>
              <div className="flex flex-col gap-2">
                {[
                  { method: 'POST', path: '/api/messages', desc: t('apiKeys.mainEndpointDesc') },
                  { method: 'GET', path: '/api/chats?userId=…', desc: chatsEndpointDesc },
                ].map((endpoint) => (
                  <div key={endpoint.path} className="flex items-start gap-3 border-b border-black/[0.04] py-2 last:border-0">
                    <span className="w-[38px] shrink-0 rounded-md bg-indigo/[0.06] px-1.5 py-0.5 text-center font-mono text-[10px] font-bold text-[var(--indigo)]">{endpoint.method}</span>
                    <div>
                      <p className="font-mono text-[11px] font-semibold text-[var(--mist)]">{endpoint.path}</p>
                      <p className="mt-0.5 text-[10px] text-[var(--fog)] opacity-60">{endpoint.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {agents.length > 1 ? (
            <div className="mt-4 rounded-2xl border border-indigo/[0.08] bg-indigo/[0.03] p-4">
              <p className="text-[11px] leading-relaxed text-[var(--mist)]">
                <strong>{t('apiKeys.tip')}:</strong> {t('apiKeys.tipDesc')}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmDeleteId}
        title={t('common.deleteConfirm', { name: 'this API key' })}
        message={confirmDeleteId ? t('common.permanentlyDelete', { name: 'API key' }) : ''}
        onConfirm={confirmRevoke}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </>
  )
}

function IntegrationsWorkspaceInner({ basePath }: { basePath: string }) {
  const { t } = useConsoleLocale()
  const searchParams = useSearchParams()
  const router = useRouter()
  const tab = (searchParams.get('tab') || 'channels') as 'channels' | 'apiKeys'
  const selectedChannel = searchParams.get('channel')

  return (
    <div className="px-8 py-8">
      <VersionContextBar />
      <div className="mb-6 mt-6 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/20 bg-white/60 shadow-sm backdrop-blur-sm">
          <Plug className="h-4.5 w-4.5 text-purple-500" />
        </div>
        <div>
          <h1 className="text-[20px] font-semibold text-[var(--mist)]">{t('integrationsPage.title')}</h1>
          <p className="mt-1 text-[12px] text-[var(--fog)]">Connect delivery channels, API access, and handoff destinations without leaving the current Build workspace.</p>
        </div>
      </div>

      <div className="mb-8 flex gap-0 border-b border-black/5">
        {(['channels', 'apiKeys'] as const).map((tabKey) => (
          <button
            key={tabKey}
            type="button"
            onClick={() => router.push(routeFor(basePath, tabKey))}
            className={`relative -mb-px px-5 py-2.5 text-[13px] font-medium transition-colors ${
              tab === tabKey ? 'text-[var(--mist)]' : 'text-[var(--fog)]/60 hover:text-[var(--fog)]'
            }`}
          >
            {t(`integrationsPage.${tabKey}`)}
            {tab === tabKey ? <div className="absolute bottom-0 left-3 right-3 h-0.5 rounded-full bg-indigo" /> : null}
          </button>
        ))}
      </div>

      {tab === 'channels' ? <ChannelsTab basePath={basePath} selectedChannel={selectedChannel} /> : null}
      {tab === 'apiKeys' ? <ApiKeysTab /> : null}
    </div>
  )
}

export default function IntegrationsWorkspace({ basePath = '/build/components/integrations' }: { basePath?: string }) {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-[var(--fog)]">Loading…</div>}>
      <IntegrationsWorkspaceInner basePath={basePath} />
    </Suspense>
  )
}
