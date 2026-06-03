'use client'

import { useState, useEffect } from 'react'
import { MessageCircle, Eye, EyeOff, Save, CheckCircle2, ExternalLink, Globe, Monitor, UserCheck, Copy, RotateCcw, AlertCircle } from 'lucide-react'

import { useConsoleLocale } from '@/components/locale-provider'

// ── Types ──────────────────────────────────────────────────────────────

interface LiveChatConfig {
  botAccessToken: string; licenseId: string; showSkillStatus: boolean
  enabled: boolean; webhookSecret?: string
  region?: string; authType?: string; accountId?: string; agentAccountId?: string
  transferGroupId?: number; transferMessage?: string
}
interface LiveChatGroup { id: number; name: string; agents_count: number }

// ── Moment Presets ─────────────────────────────────────────────────────

interface MomentPreset { label: string; fields: Array<{ id: string; type: string; label: string; required?: boolean; options?: string[]; placeholder?: string }>; title: string }

const MOMENT_PRESETS: MomentPreset[] = [
  {
    label: 'Deposit Issue',
    title: 'Deposit Information',
    fields: [
      { id: 'txnId', type: 'text', label: 'Transaction ID', required: true, placeholder: 'e.g. TX20260514001' },
      { id: 'amount', type: 'number', label: 'Deposit Amount', required: true },
      { id: 'paymentMethod', type: 'select', label: 'Payment Method', required: true, options: ['WeChat Pay', 'Alipay', 'Bank Transfer', 'bKash', 'Nagad'] },
      { id: 'date', type: 'date', label: 'Deposit Date' },
      { id: 'notes', type: 'textarea', label: 'Additional Notes', placeholder: 'Any error messages or screenshots...' },
    ],
  },
  {
    label: 'Account Issue',
    title: 'Account Information',
    fields: [
      { id: 'memberId', type: 'text', label: 'Member ID', required: true, placeholder: 'e.g. JAYA113C88F' },
      { id: 'issueType', type: 'select', label: 'Issue Type', required: true, options: ['Login Failed', 'Account Locked', 'Balance Discrepancy', 'Profile Update', 'Other'] },
      { id: 'symptoms', type: 'textarea', label: 'Describe the Issue', required: true, placeholder: 'What happened? When did it start?' },
    ],
  },
  {
    label: 'KYC Form',
    title: 'KYC Verification',
    fields: [
      { id: 'fullName', type: 'text', label: 'Full Name', required: true },
      { id: 'idType', type: 'select', label: 'ID Type', required: true, options: ['NID', 'Passport', 'Driving License'] },
      { id: 'idNumber', type: 'text', label: 'ID Number', required: true },
      { id: 'document', type: 'file', label: 'Upload ID Document', required: true },
    ],
  },
]

type ConnectionState = 'unconfigured' | 'disabled' | 'connecting' | 'connected' | 'failed'

// ── Helpers ────────────────────────────────────────────────────────────

function getConnectionState(config: LiveChatConfig, testedOk?: boolean | null): ConnectionState {
  if (!config.licenseId && !config.botAccessToken) return 'unconfigured'
  if (!config.enabled) return 'disabled'
  if (testedOk === null) return 'connecting'
  if (testedOk === false) return 'failed'
  return 'connected'
}

function stateColor(s: ConnectionState) {
  return s === 'connected' ? 'bg-malachite' : s === 'unconfigured' ? 'bg-[var(--fog)]/30' : s === 'failed' ? 'bg-vermillion' : 'bg-amber/60'
}

// ── Component ──────────────────────────────────────────────────────────

export default function LiveChatDetailPage() {
  const { t, locale } = useConsoleLocale()
  const isZh = locale === 'zh'

  const [config, setConfig] = useState<LiveChatConfig>({ botAccessToken: '', licenseId: '', showSkillStatus: true, enabled: false, webhookSecret: '', region: 'dal', authType: 'auto', accountId: '', agentAccountId: '' })
  const [origConfig, setOrigConfig] = useState<LiveChatConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [showToken, setShowToken] = useState(false)
  const [orgId, setCustomerId] = useState('')
  const [activeTab, setActiveTab] = useState<string>('connection')
  const [selectedMomentLabel, setSelectedMomentLabel] = useState('')
  const [momentPreviewUrl, setMomentPreviewUrl] = useState('')
  const [groups, setGroups] = useState<LiveChatGroup[]>([])
  const [copied, setCopied] = useState(false)
  const [connectionTested, setConnectionTested] = useState<boolean | null>(null)
  const [testingConnection, setTestingConnection] = useState(false)
  const [connectionErrorCode, setConnectionErrorCode] = useState<string | null>(null)
  const [agentList, setAgentList] = useState<Array<{ id: string; name: string; isActive: boolean }>>([])
  const connState = getConnectionState(config, connectionTested)

  const hasChanges = JSON.stringify(config) !== JSON.stringify(origConfig)

  // beforeunload guard for unsaved changes
  useEffect(() => {
    if (!hasChanges) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [hasChanges])

  const testConnection = async () => {
    setTestingConnection(true)
    setConnectionTested(null)
    setConnectionErrorCode(null)
    try {
      const res = await fetch(`/api/livechat/groups?orgId=${encodeURIComponent(orgId)}`)
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setConnectionTested(true)
      } else {
        setConnectionTested(false)
        const code = data.code as string | undefined
        setConnectionErrorCode(code || 'unknown')
      }
    } catch {
      setConnectionTested(false)
      setConnectionErrorCode('network')
    } finally {
      setTestingConnection(false)
    }
  }

  useEffect(() => {
    fetch('/api/auth/session').then(r => r.json()).then((d: { orgId?: string }) => { if (d.orgId) setCustomerId(d.orgId) }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!orgId) return
    setLoading(true)
    fetch(`/api/livechat/config?orgId=${encodeURIComponent(orgId)}`)
      .then(r => r.json()).then((data: LiveChatConfig) => { setConfig(data); setOrigConfig(data) }).catch(() => {}).finally(() => setLoading(false))
    // Fetch available groups for escalation tab
    fetch(`/api/livechat/groups?orgId=${encodeURIComponent(orgId)}`)
      .then(r => r.json()).then((d: { groups?: LiveChatGroup[] }) => { if (d.groups) setGroups(d.groups) }).catch(() => {})
    // Fetch agent list for per-agent webhook URLs
    fetch('/api/admin/agent-configs')
      .then(r => r.json()).then((d: { configs?: Array<{ id: string; name: string; isActive: boolean }> }) => {
        if (d.configs) setAgentList(d.configs.filter(a => a.isActive))
      }).catch(() => {})
  }, [orgId])

  const handleSave = async () => {
    setSaving(true); setSaveStatus('idle')
    try {
      const res = await fetch('/api/livechat/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...config, orgId }) })
      if (!res.ok) throw new Error('save failed')
      setSaveStatus('saved'); setOrigConfig({ ...config })
      setTimeout(() => setSaveStatus('idle'), 3000)
    } catch { setSaveStatus('error') } finally { setSaving(false) }
  }

  const handleReset = () => { if (origConfig) setConfig({ ...origConfig }); setSaveStatus('idle') }

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  const loadMomentPreset = (preset: MomentPreset) => {
    setSelectedMomentLabel(preset.label)
    const params = new URLSearchParams({
      view: 'form',
      caseId: 'demo',
      title: preset.title,
      fields: JSON.stringify(preset.fields),
    })
    setMomentPreviewUrl(`?${params.toString()}`)
  }

  // Derive save status label from four-state logic
  const saveLabel = (() => {
    if (saving) return t('livechat.saveSaving')
    if (saveStatus === 'saved') return t('livechat.saveSaved')
    if (saveStatus === 'error') return t('livechat.saveFailed')
    if (hasChanges) return t('livechat.saveUnsaved')
    return t('livechat.saved')
  })()

  const TABS = [
    { id: 'connection', label: t('livechat.tab.connection'), icon: Globe },
    { id: 'rendering', label: t('livechat.tab.rendering'), icon: Monitor },
    { id: 'escalation', label: t('livechat.tab.escalation'), icon: UserCheck },
  ] as const

  const connectionStateLabels: Record<ConnectionState, string> = {
    unconfigured: t('livechat.stateUnconfigured'),
    disabled: t('livechat.stateDisabled'),
    connecting: t('livechat.stateConnecting'),
    connected: t('livechat.stateConnected'),
    failed: t('livechat.stateFailed'),
  }

  if (loading) return <div className="p-8 text-[13px] text-[var(--fog)]">{t('livechat.loading')}</div>

  const inputCls = 'w-full px-3 py-2 text-[13px] border border-black/[0.08] rounded-xl bg-white outline-none focus:border-indigo/30'
  const labelCls = 'block text-[12px] font-semibold text-[var(--mist)] mb-1'
  const webhookUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/livechat/webhook/${orgId}` : `/api/livechat/webhook/${orgId}`

  return (
    <div className="p-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <a href="/admin/channels" className="text-[11px] text-indigo hover:text-indigo/80">{t('livechat.back')}</a>
      </div>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center"><MessageCircle className="w-4 h-4 text-purple-600" /></div>
        <div>
          <h1 className="text-[18px] font-bold text-[var(--mist)]">LiveChat</h1>
          <p className="text-[12px] text-[var(--fog)]">{t('livechat.subtitle')}</p>
        </div>
        {/* Connection state badge */}
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border" style={{ borderColor: connState === 'connected' ? 'rgba(46,160,74,0.25)' : connState === 'unconfigured' ? 'rgba(0,0,0,0.08)' : 'rgba(212,145,46,0.25)', background: connState === 'connected' ? 'rgba(46,160,74,0.06)' : connState === 'unconfigured' ? 'rgba(0,0,0,0.02)' : 'rgba(212,145,46,0.06)' }}>
            <span className={`w-2 h-2 rounded-full ${stateColor(connState)}`} />
            <span className={`text-[11px] font-medium ${connState === 'connected' ? 'text-malachite' : connState === 'unconfigured' ? 'text-[var(--fog)]' : 'text-amber'}`}>
              {connectionStateLabels[connState]}
            </span>
          </div>
          <button
            onClick={testConnection}
            disabled={testingConnection || connState === 'unconfigured'}
            className="text-[10px] font-medium text-[var(--fog)] hover:text-[var(--mist)] px-2 py-1 rounded-md border border-[var(--border-subtle)] hover:bg-black/[0.03] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {testingConnection ? t('livechat.testing') : t('livechat.test')}
          </button>
        </div>
      </div>

      {/* Connection test error detail */}
      {connectionTested === false && connectionErrorCode && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-red-50 border border-red-100 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-vermillion flex-shrink-0 mt-0.5" />
          <p className="text-[12px] text-red-700">
            {t(`livechat.test.err${connectionErrorCode.charAt(0).toUpperCase() + connectionErrorCode.slice(1)}`)}
          </p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-black/[0.06]">
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-[12px] font-medium border-b-2 transition-colors -mb-[1px] ${activeTab === tab.id ? 'border-indigo text-indigo' : 'border-transparent text-[var(--fog)] hover:text-[var(--mist)]'}`}>
            <tab.icon className="w-3.5 h-3.5" /> {tab.label}
          </button>
        ))}
      </div>

      {/* ── Connection Tab ── */}
      {activeTab === 'connection' && (
        <div className="grid md:grid-cols-[3fr_2fr] gap-6">
          <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl p-5 space-y-4">
            <p className="text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--fog)]/50">{t('livechat.credentials')}</p>

            {/* Enable toggle */}
            <div className="flex items-center justify-between p-4 bg-white border border-black/[0.06] rounded-xl">
              <div><p className="text-[13px] font-semibold text-[var(--mist)]">{t('livechat.enabled')}</p></div>
              <button onClick={() => setConfig(c => ({ ...c, enabled: !c.enabled }))}
                className={`relative w-10 h-6 rounded-full transition-colors ${config.enabled ? 'bg-indigo' : 'bg-black/[0.08]'}`}>
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-all ${config.enabled ? 'left-[18px]' : 'left-0.5'}`} />
              </button>
            </div>

            {/* License ID */}
            <div>
              <label className={labelCls}>{t('livechat.licenseId')} <span className="text-vermillion">*</span></label>
              <input type="text" value={config.licenseId} onChange={e => setConfig(c => ({ ...c, licenseId: e.target.value }))} className={inputCls} placeholder="e.g. 12345678" />
              <p className="text-[10px] text-[var(--fog)] mt-1">{t('livechat.licenseIdHint')}</p>
            </div>

            {/* Bot Token */}
            <div>
              <label className={labelCls}>{t('livechat.botToken')} <span className="text-vermillion">*</span></label>
              <div className="relative">
                <input type={showToken ? 'text' : 'password'} value={config.botAccessToken} onChange={e => setConfig(c => ({ ...c, botAccessToken: e.target.value }))} className={`${inputCls} pr-10`} />
                <button onClick={() => setShowToken(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--fog)] hover:text-[var(--mist)]">{showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
              </div>
              <p className="text-[10px] text-[var(--fog)] mt-1">{t('livechat.botTokenHint')}</p>
            </div>

            {/* Webhook Secret */}
            <div>
              <label className={labelCls}>{t('livechat.webhookSecret')} <span className="text-vermillion">*</span></label>
              <input type="password" value={config.webhookSecret ?? ''} onChange={e => setConfig(c => ({ ...c, webhookSecret: e.target.value }))} className={inputCls} />
              <p className="text-[10px] text-[var(--fog)] mt-1">{t('livechat.webhookSecretHint')}</p>
            </div>

            {/* Region */}
            <div>
              <label className={labelCls}>{t('livechat.region')}</label>
              <select value={config.region ?? 'dal'} onChange={e => setConfig(c => ({ ...c, region: e.target.value }))} className={inputCls}>
                <option value="dal">dal (US — default)</option>
                <option value="fra">fra (Europe)</option>
              </select>
              <p className="text-[10px] text-[var(--fog)] mt-1">{t('livechat.regionHint')}</p>
            </div>

            {/* Auth Type */}
            <div>
              <label className={labelCls}>{t('livechat.authType')}</label>
              <select value={config.authType ?? 'auto'} onChange={e => setConfig(c => ({ ...c, authType: e.target.value }))} className={inputCls}>
                <option value="auto">auto</option>
                <option value="basic">basic (PAT)</option>
                <option value="bearer">bearer (Bot)</option>
              </select>
              <p className="text-[10px] text-[var(--fog)] mt-1">{t('livechat.authTypeHint')}</p>
            </div>

            {/* Account ID (PAT) */}
            <div>
              <label className={labelCls}>{t('livechat.accountId')}</label>
              <input type="text" value={config.accountId ?? ''} onChange={e => setConfig(c => ({ ...c, accountId: e.target.value }))} className={inputCls} placeholder="28e53566-..." />
              <p className="text-[10px] text-[var(--fog)] mt-1">{t('livechat.accountIdHint')}</p>
            </div>

            {/* Agent ID / Email */}
            <div>
              <label className={labelCls}>{t('livechat.agentAccountId')}</label>
              <input type="text" value={config.agentAccountId ?? ''} onChange={e => setConfig(c => ({ ...c, agentAccountId: e.target.value }))} className={inputCls} placeholder="agent@email.com" />
              <p className="text-[10px] text-[var(--fog)] mt-1">{t('livechat.agentAccountIdHint')}</p>
            </div>

            {/* Webhook URL with copy */}
            <div>
              <label className={labelCls}>{t('livechat.webhookUrl')}</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-[11px] text-indigo bg-indigo/[0.04] px-3 py-2 rounded-lg border border-indigo/10 break-all">{webhookUrl}</code>
                <button onClick={() => handleCopy(webhookUrl)} className="flex-shrink-0 p-2 rounded-lg hover:bg-indigo/[0.06] text-[var(--fog)] hover:text-indigo transition-colors" title="Copy">
                  {copied ? <CheckCircle2 className="w-4 h-4 text-malachite" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[10px] text-[var(--fog)] mt-1 opacity-60">{t('livechat.webhookRouteNote')}</p>
            </div>

            {/* Per-agent webhook URLs */}
            {agentList.length > 0 && (
              <div>
                <label className={labelCls}>{t('livechat.perAgentWebhooks')}</label>
                <p className="text-[10px] text-[var(--fog)] mb-2 opacity-60">{t('livechat.perAgentWebhooksHint')}</p>
                <div className="space-y-1.5">
                  {agentList.map(a => {
                    const url = typeof window !== 'undefined' ? `${window.location.origin}/api/livechat/webhook/${orgId}/${encodeURIComponent(a.name)}` : `/api/livechat/webhook/${orgId}/${encodeURIComponent(a.name)}`
                    return (
                      <div key={a.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/60 border border-black/[0.04]">
                        <span className="text-[11px] font-semibold text-[var(--mist)] flex-shrink-0">{a.name}</span>
                        {a.isActive && <span className="text-[9px] font-bold text-malachite bg-malachite/[0.08] px-1.5 py-0.5 rounded uppercase flex-shrink-0">Active</span>}
                        <code className="flex-1 text-[10px] text-[var(--fog)] truncate">{url}</code>
                        <button onClick={() => handleCopy(url)} className="flex-shrink-0 p-1.5 rounded-lg hover:bg-indigo/[0.06] text-[var(--fog)] hover:text-indigo transition-colors" title="Copy">
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Settings card */}
          <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl p-5 space-y-4">
            <p className="text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--fog)]/50">{t('livechat.settings')}</p>
            <div className="flex items-center justify-between p-4 bg-white border border-black/[0.06] rounded-xl">
              <div>
                <p className="text-[13px] font-semibold text-[var(--mist)]">{t('livechat.showSkillStatus')}</p>
                <p className="text-[10px] text-[var(--fog)] mt-0.5">{t('livechat.showSkillStatusHint')}</p>
              </div>
              <button onClick={() => setConfig(c => ({ ...c, showSkillStatus: !c.showSkillStatus }))}
                className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${config.showSkillStatus ? 'bg-indigo' : 'bg-black/[0.08]'}`}>
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${config.showSkillStatus ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
              </button>
            </div>
            {/* Required fields legend */}
            <div className="text-[10px] text-[var(--fog)]/60 pt-2 border-t border-black/[0.04]">
              <span className="text-vermillion">*</span> {t('livechat.required')}
            </div>
          </div>
        </div>
      )}

      {/* ── Rendering Tab ── */}
      {activeTab === 'rendering' && (
        <div className="space-y-6">
          {/* Skill Render Hints */}
          <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl p-5">
            <p className="text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--fog)]/50">{t('livechat.skillOverrides')}</p>
            <p className="text-[12px] text-[var(--fog)] mt-1">{t('livechat.skillOverridesDesc')}</p>
            <a href="/admin/tools" className="inline-flex items-center gap-1.5 text-[12px] font-medium text-indigo hover:text-indigo/80 mt-2">
              <ExternalLink className="w-3.5 h-3.5" /> {t('livechat.openTools')}
            </a>
          </div>

          {/* Moment Preview */}
          <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-black/[0.05] flex items-center justify-between">
              <p className="text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--fog)]/50">{t('livechat.momentPreview')}</p>
              <span className="text-[10px] text-[var(--fog)]/60">{t('livechat.momentPreviewHint')}</span>
            </div>
            <div className="p-4">
              <p className="text-[11px] text-[var(--fog)] mb-3">{t('livechat.momentPreviewDesc')}</p>
              <div className="flex gap-2 mb-3 flex-wrap">
                {MOMENT_PRESETS.map(p => (
                  <button key={p.label} onClick={() => loadMomentPreset(p)}
                    className={`text-[11px] px-2.5 py-1 rounded-lg border transition-colors ${selectedMomentLabel === p.label ? 'border-indigo/30 bg-indigo/[0.06] text-indigo' : 'border-black/[0.06] text-[var(--fog)] hover:border-black/[0.1]'}`}>{p.label}</button>
                ))}
              </div>
              <div className="bg-gray-50 border border-black/[0.06] rounded-xl overflow-hidden" style={{ height: 420 }}>
                {momentPreviewUrl ? (
                  <iframe key={momentPreviewUrl} src={momentPreviewUrl} className="w-full h-full border-0" title="Moment Preview" />
                ) : (
                  <div className="flex items-center justify-center h-full text-[12px] text-[var(--fog)]">{t('livechat.momentPreviewEmpty')}</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Escalation Tab ── */}
      {activeTab === 'escalation' && (
        <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl p-5 space-y-4 max-w-2xl">
          <p className="text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--fog)]/50">{t('livechat.escalationStrategy')}</p>
          <p className="text-[12px] text-[var(--fog)]">{t('livechat.escalationDesc')}</p>
          <div>
            <label className={labelCls}>{t('livechat.transferGroup')}</label>
            <select
              className={inputCls}
              value={config.transferGroupId ?? ''}
              onChange={e => setConfig({ ...config, transferGroupId: e.target.value ? Number(e.target.value) : undefined })}
            >
              <option value="">{groups.length === 0 ? t('livechat.loadingGroups') : t('livechat.defaultQueue')}</option>
              {groups.map(g => (
                <option key={g.id} value={g.id}>{g.name}{g.agents_count > 0 ? ` (${g.agents_count} agents)` : ''}</option>
              ))}
            </select>
            <p className="text-[10px] text-[var(--fog)] mt-1">{t('livechat.transferGroupHint')}</p>
          </div>
          <div>
            <label className={labelCls}>{t('livechat.transferMessage')}</label>
            <textarea
              className={inputCls} rows={3}
              value={config.transferMessage ?? ''}
              onChange={e => setConfig({ ...config, transferMessage: e.target.value || undefined })}
              placeholder={isZh ? '正在为您转接人工客服，请稍候...' : 'Transferring you to a human agent, please wait...'}
            />
            <p className="text-[10px] text-[var(--fog)] mt-1">{t('livechat.transferMessageHint')}</p>
          </div>
        </div>
      )}

      {/* Bottom action bar — four-state save semantics */}
      <div className="mt-8 pt-4 border-t border-black/[0.05] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={handleReset} disabled={!hasChanges}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[12px] font-medium text-[var(--fog)] border border-black/[0.08] hover:border-black/[0.15] disabled:opacity-30 transition-all">
            <RotateCcw className="w-3.5 h-3.5" /> {t('livechat.reset')}
          </button>
          <span className={`text-[11px] ${
            saveStatus === 'error' ? 'text-vermillion' :
            saveStatus === 'saved' ? 'text-malachite' :
            hasChanges ? 'text-amber' : 'text-[var(--fog)]/50'
          }`}>
            {saveStatus === 'saved' && <CheckCircle2 className="w-3.5 h-3.5 inline mr-1" />}
            {saveLabel}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { void handleSave() }} disabled={saving || !hasChanges}
            className="flex items-center gap-2 px-5 py-2.5 bg-indigo text-white text-[13px] font-semibold rounded-xl hover:bg-indigo/90 disabled:opacity-40 transition-colors">
            {saving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
            {t('livechat.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
