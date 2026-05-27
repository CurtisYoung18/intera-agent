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
  { id: 'routing', label: 'Routing', icon: GitBranch },
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

      {/* ── Routing Tab ── */}
      {activeTab === 'routing' && (
        <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl p-5 space-y-4 max-w-2xl">
          <p className="text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--fog)]/50">Case Type Routing</p>
          <div className="p-4 bg-white border border-black/[0.06] rounded-xl">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[13px] font-semibold text-[var(--mist)]">Auto-transfer to human</p>
              <button className={`w-10 h-6 rounded-full transition-colors relative bg-black/[0.08]`}>
                <span className="absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow" />
              </button>
            </div>
            <p className="text-[11px] text-[var(--fog)]">When enabled, all incoming chats are transferred to the default agent queue instead of being handled by Intera.</p>
          </div>
          <div className="p-4 bg-amber/[0.04] border border-amber/15 rounded-xl text-[12px] text-[var(--fog)]">
            Case-type-level routing rules are managed on the{' '}
            <Link href="/admin/case-types" className="text-indigo hover:text-indigo/80 underline">Case Types page</Link>.
            Per-channel routing overrides coming in next release.
          </div>
        </div>
      )}

      {/* ── Rendering Tab ── */}
      {activeTab === 'rendering' && (
        <div className="grid md:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl p-5 space-y-4">
            <p className="text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--fog)]/50">Skill Render Overrides</p>
            <p className="text-[12px] text-[var(--fog)]">
              Configure how each skill&apos;s result appears in LiveChat. For each business skill, open the Tools page editor and use the &quot;LiveChat Rendering&quot; tab to set card/carousel/quick_replies/plain rendering with JSONPath field mappings.
            </p>
            <Link href="/admin/skills"
              className="inline-flex items-center gap-1.5 text-[12px] font-medium text-indigo hover:text-indigo/80 mt-1">
              <ExternalLink className="w-3.5 h-3.5" /> Open Tools page
            </Link>

            <div className="border-t border-black/[0.05] pt-4 mt-2">
              <p className="text-[11px] font-semibold text-[var(--mist)] mb-2">Channel Defaults</p>
              <div className="grid grid-cols-3 gap-2">
                {(['card', 'quick_replies', 'plain'] as const).map(kind => (
                  <label key={kind} className="flex items-center gap-2 p-2 rounded-lg border border-black/[0.06] text-[11px] text-[var(--mist)] cursor-pointer hover:border-indigo/20">
                    <input type="radio" name="defaultKind" defaultChecked={kind === 'quick_replies'} className="accent-indigo" />
                    {kind === 'card' ? 'Card' : kind === 'quick_replies' ? 'Quick Replies' : 'Plain'}
                  </label>
                ))}
              </div>
              <p className="text-[10px] text-[var(--fog)] mt-1.5">Default render style when a skill has no explicit renderHints configured.</p>
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

          <div>
            <label className={labelCls}>When escalation needed</label>
            <select className={inputCls} defaultValue="transfer_chat">
              <option value="transfer_chat">Transfer chat to human queue</option>
              <option value="consult">Consult LLM while waiting</option>
              <option value="silent_task">Create silent human task</option>
            </select>
          </div>

          <div>
            <label className={labelCls}>Transfer target</label>
            <select className={inputCls} defaultValue="queue">
              <option value="queue">Default agent queue</option>
              <option value="group">Specific group</option>
            </select>
          </div>

          <div>
            <label className={labelCls}>Consultation prompt (when consult mode)</label>
            <textarea
              className={inputCls}
              rows={4}
              placeholder={`You are consulting on a LiveChat case. The customer is waiting for a response...
Review the case context and provide guidance to the operator.`}
            />
          </div>

          <div>
            <label className={labelCls}>Skills available during consultation</label>
            <input
              className={inputCls}
              placeholder="read_case_history, kb_search_General"
              defaultValue="read_case_history"
            />
            <p className="text-[10px] text-[var(--fog)] mt-1">Comma-separated skill names. Leave empty to allow all.</p>
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
