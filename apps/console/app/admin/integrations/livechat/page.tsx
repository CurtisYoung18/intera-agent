'use client'

import { useState, useEffect, useRef } from 'react'
import { MessageCircle, Eye, EyeOff, Save, CheckCircle2, AlertCircle, ExternalLink, Globe, Monitor, UserCheck, GitBranch } from 'lucide-react'
import { chatApiUrl } from '@/lib/chat-api'
import { useConsoleLocale } from '@/components/locale-provider'
import Link from 'next/link'

interface LiveChatConfig {
  botAccessToken: string; licenseId: string; showSkillStatus: boolean
  enabled: boolean; webhookSecret?: string
}

interface WidgetPayload {
  kind: 'status_track' | 'propose_interaction' | 'request_user_input'; caseId: string
  step?: { id: string; label: string; state: 'running' | 'done'; durationMs?: number }
  options?: Array<{ id: string; label: string; description?: string; inputType?: 'none' | 'text'; inputPlaceholder?: string }>
  fields?: Array<{ id: string; type: string; label: string; required?: boolean; options?: string[]; placeholder?: string }>
}

const WIDGET_VIEWS: Array<{ label: string; payload: WidgetPayload }> = [
  { label: 'Status Track', payload: { kind: 'status_track', caseId: 'demo-1', step: { id: 'verify', label: 'Verifying', state: 'running' } } },
  { label: 'Propose', payload: { kind: 'propose_interaction', caseId: 'demo-2', options: [{ id: '1', label: 'Check order' }, { id: '2', label: 'Report issue' }] } },
  { label: 'Form', payload: { kind: 'request_user_input', caseId: 'demo-3', fields: [{ id: 'name', type: 'text', label: 'Name', required: true }] } },
]

const TABS = [
  { id: 'connection', label: 'Connection', icon: Globe },
  { id: 'rendering', label: 'Rendering', icon: Monitor },
  { id: 'humanOps', label: 'Human Ops', icon: UserCheck },
] as const

export default function LiveChatDetailPage() {
  const { t } = useConsoleLocale()
  const [config, setConfig] = useState<LiveChatConfig>({ botAccessToken: '', licenseId: '', showSkillStatus: true, enabled: false, webhookSecret: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [showToken, setShowToken] = useState(false)
  const [customerId, setCustomerId] = useState('')
  const [activeTab, setActiveTab] = useState<string>('connection')
  const [selectedView, setSelectedView] = useState('')
  const widgetRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    fetch('/api/auth/session').then(r => r.json()).then((d: { customerId?: string }) => { if (d.customerId) setCustomerId(d.customerId) }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!customerId) return
    setLoading(true)
    fetch(chatApiUrl(`/api/livechat/config?customerId=${encodeURIComponent(customerId)}`))
      .then(r => r.json()).then((data: LiveChatConfig) => setConfig(data)).catch(() => {}).finally(() => setLoading(false))
  }, [customerId])

  const handleSave = async () => {
    setSaving(true); setSaveStatus('idle')
    try {
      const res = await fetch(chatApiUrl('/api/livechat/config'), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...config, customerId }) })
      if (!res.ok) throw new Error('save failed')
      setSaveStatus('saved'); setTimeout(() => setSaveStatus('idle'), 2500)
    } catch { setSaveStatus('error') } finally { setSaving(false) }
  }

  const previewWidget = (viewName: string) => {
    setSelectedView(viewName)
    const payload = WIDGET_VIEWS.find(v => v.label === viewName)?.payload
    if (payload && widgetRef.current) widgetRef.current.contentWindow?.postMessage({ type: 'intera_widget_preview', payload }, '*')
  }

  if (loading) return <div className="p-8 text-[13px] text-[var(--fog)]">Loading...</div>

  const inputCls = 'w-full px-3 py-2 text-[13px] border border-black/[0.08] rounded-xl bg-white outline-none focus:border-indigo/30'
  const labelCls = 'block text-[12px] font-semibold text-[var(--mist)] mb-1'
  const webhookUrl = `${process.env.NEXT_PUBLIC_CHAT_API_URL ?? ''}/api/livechat/webhook/${customerId}`

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center gap-2 mb-2">
        <a href="/admin/integrations" className="text-[11px] text-indigo hover:text-indigo/80">&larr; Channels</a>
      </div>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center"><MessageCircle className="w-4 h-4 text-purple-600" /></div>
        <div>
          <h1 className="text-[18px] font-bold text-[var(--mist)]">LiveChat</h1>
          <p className="text-[12px] text-[var(--fog)]">Connection · Rendering · Human escalation</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${config.enabled ? 'bg-malachite' : 'bg-[var(--fog)]/30'}`} />
          <span className={`text-[11px] ${config.enabled ? 'text-malachite' : 'text-[var(--fog)]'}`}>{config.enabled ? 'Connected' : 'Disabled'}</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-black/[0.06]">
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-[12px] font-medium border-b-2 transition-colors -mb-[1px] ${
              activeTab === tab.id ? 'border-indigo text-indigo' : 'border-transparent text-[var(--fog)] hover:text-[var(--mist)]'
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" /> {tab.label}
          </button>
        ))}
      </div>

      {/* ── Connection Tab ── */}
      {activeTab === 'connection' && (
        <div className="grid md:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl p-5 space-y-4">
            <p className="text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--fog)]/50">Credentials</p>
            <div className="flex items-center justify-between p-4 bg-white border border-black/[0.06] rounded-xl">
              <div><p className="text-[13px] font-semibold text-[var(--mist)]">Enabled</p></div>
              <button onClick={() => setConfig(c => ({ ...c, enabled: !c.enabled }))}
                className={`w-10 h-6 rounded-full transition-colors relative ${config.enabled ? 'bg-indigo' : 'bg-black/[0.08]'}`}>
                <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${config.enabled ? 'translate-x-5' : 'translate-x-1'}`} />
              </button>
            </div>
            <div><label className={labelCls}>License ID</label><input type="text" value={config.licenseId} onChange={e => setConfig(c => ({ ...c, licenseId: e.target.value }))} className={inputCls} /></div>
            <div><label className={labelCls}>Bot Access Token</label>
              <div className="relative">
                <input type={showToken ? 'text' : 'password'} value={config.botAccessToken} onChange={e => setConfig(c => ({ ...c, botAccessToken: e.target.value }))} className={`${inputCls} pr-10`} />
                <button onClick={() => setShowToken(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--fog)]">{showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
              </div>
            </div>
            <div><label className={labelCls}>Webhook Secret</label><input type="password" value={config.webhookSecret ?? ''} onChange={e => setConfig(c => ({ ...c, webhookSecret: e.target.value }))} className={inputCls} /></div>
            <div className="p-3 bg-black/[0.02] rounded-xl border border-black/[0.04]">
              <p className="text-[11px] font-semibold text-[var(--mist)] mb-1">Webhook URL</p>
              <code className="text-[11px] text-indigo break-all">{webhookUrl}</code>
            </div>
          </div>
          <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl p-5 space-y-4">
            <p className="text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--fog)]/50">Settings</p>
            <div className="flex items-center justify-between p-4 bg-white border border-black/[0.06] rounded-xl">
              <div><p className="text-[13px] font-semibold text-[var(--mist)]">Show Skill Status</p></div>
              <button onClick={() => setConfig(c => ({ ...c, showSkillStatus: !c.showSkillStatus }))}
                className={`w-10 h-6 rounded-full transition-colors relative ${config.showSkillStatus ? 'bg-indigo' : 'bg-black/[0.08]'}`}>
                <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${config.showSkillStatus ? 'translate-x-5' : 'translate-x-1'}`} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Rendering Tab ── */}
      {activeTab === 'rendering' && (
        <div className="grid md:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl p-5 space-y-4">
            <p className="text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--fog)]/50">Channel Defaults</p>
            <div className="p-4 bg-amber/[0.04] border border-amber/15 rounded-xl text-[12px] text-[var(--fog)]">
              Per-skill render overrides are configured on the{' '}
              <Link href="/admin/skills" className="text-indigo hover:text-indigo/80 underline">Tools page</Link>
              {' '}under each skill&apos;s LiveChat Rendering tab. Channel-level defaults coming in next release.
            </div>
          </div>
          <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-black/[0.05]">
              <p className="text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--fog)]/50">Widget Preview</p>
            </div>
            <div className="p-4">
              <div className="flex gap-2 mb-3">
                {WIDGET_VIEWS.map(v => (
                  <button key={v.label} onClick={() => previewWidget(v.label)}
                    className={`text-[11px] px-2.5 py-1 rounded-lg border transition-colors ${selectedView === v.label ? 'border-indigo/30 bg-indigo/[0.06] text-indigo' : 'border-black/[0.06] text-[var(--fog)] hover:border-black/[0.1]'}`}>
                    {v.label}
                  </button>
                ))}
              </div>
              <div className="bg-gray-50 border border-black/[0.06] rounded-xl overflow-hidden" style={{ height: 320 }}>
                <iframe ref={widgetRef} src={chatApiUrl('/livechat-widget?preview=1')} className="w-full h-full border-0" title="Widget Preview" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Human Ops Tab ── */}
      {activeTab === 'humanOps' && (
        <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl p-5 space-y-4 max-w-2xl">
          <p className="text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--fog)]/50">Escalation Strategy</p>
          <div className="p-4 bg-amber/[0.04] border border-amber/15 rounded-xl text-[12px] text-[var(--fog)]">
            Human Ops configuration per channel is coming in the next release. Currently, LiveChat escalates via{' '}
            <code className="text-[11px] bg-amber/[0.08] px-1 rounded">transfer_chat</code> to the default agent queue.
            Per-channel <code className="text-[11px] bg-amber/[0.08] px-1 rounded">consultationPrompt</code> and routing rules will be configurable here.
          </div>
        </div>
      )}

      {/* Sticky Save */}
      <div className="mt-6 pt-4 border-t border-black/[0.05] flex items-center justify-end sticky bottom-0 bg-white/60 backdrop-blur-xl py-3">
        <button onClick={() => { void handleSave() }} disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 bg-indigo text-white text-[13px] font-semibold rounded-xl hover:bg-indigo/90 disabled:opacity-40 transition-colors">
          {saving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            : saveStatus === 'saved' ? <><CheckCircle2 className="w-4 h-4" /> Saved</>
            : saveStatus === 'error' ? <><AlertCircle className="w-4 h-4" /> Error</>
            : <><Save className="w-4 h-4" /> Save</>}
        </button>
      </div>
    </div>
  )
}
