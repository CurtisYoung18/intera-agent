'use client'

import { useState, useEffect, useRef } from 'react'
import { MessageCircle, Eye, EyeOff, Save, CheckCircle2, AlertCircle, ExternalLink, Globe, Monitor, UserCheck, GitBranch, Copy, RotateCcw } from 'lucide-react'
import { chatApiUrl } from '@/lib/chat-api'
import { useConsoleLocale } from '@/components/locale-provider'
import Link from 'next/link'

// ── Types ──────────────────────────────────────────────────────────────

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

// ── Constants ──────────────────────────────────────────────────────────

const WIDGET_VIEWS: Array<{ label: string; payload: WidgetPayload }> = [
  { label: 'Status Track', payload: { kind: 'status_track', caseId: 'demo-1', step: { id: 'verify', label: 'Verifying', state: 'running' } } },
  { label: 'Propose', payload: { kind: 'propose_interaction', caseId: 'demo-2', options: [{ id: '1', label: 'Check order' }, { id: '2', label: 'Report issue' }] } },
  { label: 'Form', payload: { kind: 'request_user_input', caseId: 'demo-3', fields: [{ id: 'name', type: 'text', label: 'Name', required: true }] } },
]

const TABS = [
  { id: 'connection', label: 'Connection', labelZh: '连接', icon: Globe },
  { id: 'routing', label: 'Routing', labelZh: '路由', icon: GitBranch },
  { id: 'rendering', label: 'Rendering', labelZh: '渲染', icon: Monitor },
  { id: 'humanOps', label: 'Human Ops', labelZh: '人工配置', icon: UserCheck },
] as const

type ConnectionState = 'unconfigured' | 'disabled' | 'connecting' | 'connected' | 'failed'

// ── Labels ─────────────────────────────────────────────────────────────

const L = {
  back: { en: '← Channels', zh: '← 渠道' },
  subtitle: { en: 'Connection · Routing · Rendering · Human escalation', zh: '连接 · 路由 · 渲染 · 人工升级' },
  loading: { en: 'Loading...', zh: '加载中...' },
  // Connection state
  stateUnconfigured: { en: 'Not configured', zh: '未配置' },
  stateDisabled: { en: 'Disabled', zh: '已禁用' },
  stateConnecting: { en: 'Connecting...', zh: '配置中...' },
  stateConnected: { en: 'Connected', zh: '已连接' },
  stateFailed: { en: 'Connection failed', zh: '连接失败' },
  // Connection tab
  credentials: { en: 'Credentials', zh: '凭证' },
  enabled: { en: 'Enabled', zh: '启用' },
  licenseId: { en: 'License ID', zh: '许可证 ID' },
  licenseIdHint: { en: 'Obtained from LiveChat Developer Console', zh: '从 LiveChat 开发者后台获取' },
  botToken: { en: 'Bot Access Token', zh: 'Bot 访问令牌' },
  botTokenHint: { en: 'Bearer token from LiveChat Bot settings', zh: 'LiveChat Bot 设置中的 Bearer 令牌' },
  webhookSecret: { en: 'Webhook Secret', zh: 'Webhook 密钥' },
  webhookSecretHint: { en: 'Used to verify incoming webhook requests', zh: '用于验证传入 Webhook 请求' },
  webhookUrl: { en: 'Webhook URL', zh: 'Webhook 地址' },
  copied: { en: 'Copied!', zh: '已复制！' },
  settings: { en: 'Settings', zh: '设置' },
  showSkillStatus: { en: 'Show Skill Status', zh: '显示工具状态' },
  showSkillStatusHint: { en: 'Display skill execution progress in chat', zh: '在对话中显示工具执行进度' },
  save: { en: 'Save Configuration', zh: '保存配置' },
  reset: { en: 'Reset', zh: '重置' },
  saved: { en: 'Saved', zh: '已保存' },
  saveError: { en: 'Save failed — please retry', zh: '保存失败 — 请重试' },
  required: { en: 'Required', zh: '必填' },
  // Routing tab
  caseTypeRouting: { en: 'Case Type Routing', zh: '案例类型路由' },
  autoTransfer: { en: 'Auto-transfer to human', zh: '自动转人工' },
  autoTransferDesc: { en: 'When enabled, all incoming chats are transferred to the default agent queue.', zh: '启用后，所有新会话将直接转接到默认人工队列。' },
  routingNote: { en: 'Case-type-level routing rules are managed on the Case Types page.', zh: '案例类型级别的路由规则在案例类型页面管理。' },
  // Rendering tab
  skillOverrides: { en: 'Skill Render Overrides', zh: '工具渲染覆盖' },
  skillOverridesDesc: { en: 'Configure how each skill result appears in LiveChat. Open the Tools page and use the LiveChat Rendering tab per skill.', zh: '配置每个工具结果在 LiveChat 中的呈现方式。打开工具页面，每个工具可独立配置。' },
  openTools: { en: 'Open Tools page', zh: '打开工具页面' },
  channelDefaults: { en: 'Channel Defaults', zh: '渠道默认值' },
  defaultRenderHint: { en: 'Default render style when a skill has no explicit renderHints.', zh: '工具未配置 renderHints 时的默认渲染样式。' },
  card: { en: 'Card', zh: '卡片' },
  quickReplies: { en: 'Quick Replies', zh: '快捷回复' },
  plain: { en: 'Plain', zh: '纯文本' },
  widgetPreview: { en: 'Widget Preview', zh: '组件预览' },
  // HumanOps tab
  escalationStrategy: { en: 'Escalation Strategy', zh: '升级策略' },
  whenEscalation: { en: 'When escalation needed', zh: '需要升级时' },
  transferChat: { en: 'Transfer chat to human queue', zh: '转接到人工队列' },
  consultLlm: { en: 'Consult LLM while waiting', zh: '等待时咨询 LLM' },
  silentTask: { en: 'Create silent human task', zh: '创建静默人工任务' },
  transferTarget: { en: 'Transfer target', zh: '转接目标' },
  defaultQueue: { en: 'Default agent queue', zh: '默认人工队列' },
  specificGroup: { en: 'Specific group', zh: '指定组' },
  consultationPrompt: { en: 'Consultation prompt (consult mode)', zh: '咨询提示词（咨询模式）' },
  skillsDuringConsult: { en: 'Skills during consultation', zh: '咨询期间可用工具' },
  skillsHint: { en: 'Comma-separated skill names. Empty = allow all.', zh: '逗号分隔的工具名称。留空 = 全部允许。' },
} as const

function useL() {
  const { locale } = useConsoleLocale()
  return (key: keyof typeof L) => L[key][locale as 'en' | 'zh'] ?? L[key].en
}

// ── Helpers ────────────────────────────────────────────────────────────

function getConnectionState(config: LiveChatConfig, saveStatus: string): ConnectionState {
  if (!config.licenseId && !config.botAccessToken) return 'unconfigured'
  if (!config.enabled) return 'disabled'
  if (saveStatus === 'saved') return 'connected'
  return 'disabled'
}

function stateColor(s: ConnectionState) {
  return s === 'connected' ? 'bg-malachite' : s === 'unconfigured' ? 'bg-[var(--fog)]/30' : s === 'failed' ? 'bg-vermillion' : 'bg-amber/60'
}

// ── Component ──────────────────────────────────────────────────────────

export default function LiveChatDetailPage() {
  const { locale } = useConsoleLocale()
  const l = useL()
  const isZh = locale === 'zh'

  const [config, setConfig] = useState<LiveChatConfig>({ botAccessToken: '', licenseId: '', showSkillStatus: true, enabled: false, webhookSecret: '' })
  const [origConfig, setOrigConfig] = useState<LiveChatConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [showToken, setShowToken] = useState(false)
  const [customerId, setCustomerId] = useState('')
  const [activeTab, setActiveTab] = useState<string>('connection')
  const [selectedView, setSelectedView] = useState('')
  const [copied, setCopied] = useState(false)
  const widgetRef = useRef<HTMLIFrameElement>(null)
  const connState = getConnectionState(config, saveStatus)

  useEffect(() => {
    fetch('/api/auth/session').then(r => r.json()).then((d: { customerId?: string }) => { if (d.customerId) setCustomerId(d.customerId) }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!customerId) return
    setLoading(true)
    fetch(chatApiUrl(`/api/livechat/config?customerId=${encodeURIComponent(customerId)}`))
      .then(r => r.json()).then((data: LiveChatConfig) => { setConfig(data); setOrigConfig(data) }).catch(() => {}).finally(() => setLoading(false))
  }, [customerId])

  const handleSave = async () => {
    setSaving(true); setSaveStatus('idle')
    try {
      const res = await fetch(chatApiUrl('/api/livechat/config'), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...config, customerId }) })
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

  const previewWidget = (viewName: string) => {
    setSelectedView(viewName)
    const payload = WIDGET_VIEWS.find(v => v.label === viewName)?.payload
    if (payload && widgetRef.current) widgetRef.current.contentWindow?.postMessage({ type: 'intera_widget_preview', payload }, '*')
  }

  const hasChanges = JSON.stringify(config) !== JSON.stringify(origConfig)

  if (loading) return <div className="p-8 text-[13px] text-[var(--fog)]">{l('loading')}</div>

  const inputCls = 'w-full px-3 py-2 text-[13px] border border-black/[0.08] rounded-xl bg-white outline-none focus:border-indigo/30'
  const labelCls = 'block text-[12px] font-semibold text-[var(--mist)] mb-1'
  const webhookUrl = `${process.env.NEXT_PUBLIC_CHAT_API_URL ?? ''}/api/livechat/webhook/${customerId}`

  return (
    <div className="p-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <a href="/admin/channels" className="text-[11px] text-indigo hover:text-indigo/80">{l('back')}</a>
      </div>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center"><MessageCircle className="w-4 h-4 text-purple-600" /></div>
        <div>
          <h1 className="text-[18px] font-bold text-[var(--mist)]">LiveChat</h1>
          <p className="text-[12px] text-[var(--fog)]">{l('subtitle')}</p>
        </div>
        {/* Connection state badge */}
        <div className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-full border" style={{ borderColor: connState === 'connected' ? 'rgba(46,160,74,0.25)' : connState === 'unconfigured' ? 'rgba(0,0,0,0.08)' : 'rgba(212,145,46,0.25)', background: connState === 'connected' ? 'rgba(46,160,74,0.06)' : connState === 'unconfigured' ? 'rgba(0,0,0,0.02)' : 'rgba(212,145,46,0.06)' }}>
          <span className={`w-2 h-2 rounded-full ${stateColor(connState)}`} />
          <span className={`text-[11px] font-medium ${connState === 'connected' ? 'text-malachite' : connState === 'unconfigured' ? 'text-[var(--fog)]' : 'text-amber'}`}>
            {l(`state${connState.charAt(0).toUpperCase() + connState.slice(1)}` as keyof typeof L)}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-black/[0.06]">
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-[12px] font-medium border-b-2 transition-colors -mb-[1px] ${activeTab === tab.id ? 'border-indigo text-indigo' : 'border-transparent text-[var(--fog)] hover:text-[var(--mist)]'}`}>
            <tab.icon className="w-3.5 h-3.5" /> {isZh ? tab.labelZh : tab.label}
          </button>
        ))}
      </div>

      {/* ── Connection Tab ── */}
      {activeTab === 'connection' && (
        <div className="grid md:grid-cols-[3fr_2fr] gap-6">
          <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl p-5 space-y-4">
            <p className="text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--fog)]/50">{l('credentials')}</p>

            {/* Enable toggle */}
            <div className="flex items-center justify-between p-4 bg-white border border-black/[0.06] rounded-xl">
              <div><p className="text-[13px] font-semibold text-[var(--mist)]">{l('enabled')}</p></div>
              <button onClick={() => setConfig(c => ({ ...c, enabled: !c.enabled }))}
                className={`relative w-10 h-6 rounded-full transition-colors ${config.enabled ? 'bg-indigo' : 'bg-black/[0.08]'}`}>
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${config.enabled ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
              </button>
            </div>

            {/* License ID */}
            <div>
              <label className={labelCls}>{l('licenseId')} <span className="text-vermillion">*</span></label>
              <input type="text" value={config.licenseId} onChange={e => setConfig(c => ({ ...c, licenseId: e.target.value }))} className={inputCls} placeholder="e.g. 12345678" />
              <p className="text-[10px] text-[var(--fog)] mt-1">{l('licenseIdHint')}</p>
            </div>

            {/* Bot Token */}
            <div>
              <label className={labelCls}>{l('botToken')} <span className="text-vermillion">*</span></label>
              <div className="relative">
                <input type={showToken ? 'text' : 'password'} value={config.botAccessToken} onChange={e => setConfig(c => ({ ...c, botAccessToken: e.target.value }))} className={`${inputCls} pr-10`} />
                <button onClick={() => setShowToken(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--fog)] hover:text-[var(--mist)]">{showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
              </div>
              <p className="text-[10px] text-[var(--fog)] mt-1">{l('botTokenHint')}</p>
            </div>

            {/* Webhook Secret */}
            <div>
              <label className={labelCls}>{l('webhookSecret')} <span className="text-vermillion">*</span></label>
              <input type="password" value={config.webhookSecret ?? ''} onChange={e => setConfig(c => ({ ...c, webhookSecret: e.target.value }))} className={inputCls} />
              <p className="text-[10px] text-[var(--fog)] mt-1">{l('webhookSecretHint')}</p>
            </div>

            {/* Webhook URL with copy */}
            <div>
              <label className={labelCls}>{l('webhookUrl')}</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-[11px] text-indigo bg-indigo/[0.04] px-3 py-2 rounded-lg border border-indigo/10 break-all">{webhookUrl}</code>
                <button onClick={() => handleCopy(webhookUrl)} className="flex-shrink-0 p-2 rounded-lg hover:bg-indigo/[0.06] text-[var(--fog)] hover:text-indigo transition-colors" title="Copy">
                  {copied ? <CheckCircle2 className="w-4 h-4 text-malachite" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>

          {/* Settings card */}
          <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl p-5 space-y-4">
            <p className="text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--fog)]/50">{l('settings')}</p>
            <div className="flex items-center justify-between p-4 bg-white border border-black/[0.06] rounded-xl">
              <div>
                <p className="text-[13px] font-semibold text-[var(--mist)]">{l('showSkillStatus')}</p>
                <p className="text-[10px] text-[var(--fog)] mt-0.5">{l('showSkillStatusHint')}</p>
              </div>
              <button onClick={() => setConfig(c => ({ ...c, showSkillStatus: !c.showSkillStatus }))}
                className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${config.showSkillStatus ? 'bg-indigo' : 'bg-black/[0.08]'}`}>
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${config.showSkillStatus ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
              </button>
            </div>
            {/* Required fields legend */}
            <div className="text-[10px] text-[var(--fog)]/60 pt-2 border-t border-black/[0.04]">
              <span className="text-vermillion">*</span> {l('required')}
            </div>
          </div>
        </div>
      )}

      {/* ── Routing Tab ── */}
      {activeTab === 'routing' && (
        <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl p-5 space-y-4 max-w-2xl">
          <p className="text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--fog)]/50">{l('caseTypeRouting')}</p>
          <div className="flex items-center justify-between p-4 bg-white border border-black/[0.06] rounded-xl">
            <div>
              <p className="text-[13px] font-semibold text-[var(--mist)]">{l('autoTransfer')}</p>
              <p className="text-[11px] text-[var(--fog)] mt-0.5">{l('autoTransferDesc')}</p>
            </div>
            <button className="relative w-10 h-6 rounded-full bg-black/[0.08] flex-shrink-0">
              <span className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm" />
            </button>
          </div>
          <div className="p-4 bg-amber/[0.04] border border-amber/15 rounded-xl text-[12px] text-[var(--fog)]">
            {l('routingNote')}{' '}
            <Link href="/admin/case-types" className="text-indigo hover:text-indigo/80 underline">{l('caseTypeRouting')}</Link>
          </div>
        </div>
      )}

      {/* ── Rendering Tab ── */}
      {activeTab === 'rendering' && (
        <div className="grid md:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl p-5 space-y-4">
            <p className="text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--fog)]/50">{l('skillOverrides')}</p>
            <p className="text-[12px] text-[var(--fog)]">{l('skillOverridesDesc')}</p>
            <Link href="/admin/tools" className="inline-flex items-center gap-1.5 text-[12px] font-medium text-indigo hover:text-indigo/80 mt-1">
              <ExternalLink className="w-3.5 h-3.5" /> {l('openTools')}
            </Link>
            <div className="border-t border-black/[0.05] pt-4 mt-2">
              <p className="text-[11px] font-semibold text-[var(--mist)] mb-2">{l('channelDefaults')}</p>
              <div className="grid grid-cols-3 gap-2">
                {(['card', 'quick_replies', 'plain'] as const).map(kind => (
                  <label key={kind} className="flex items-center gap-2 p-2 rounded-lg border border-black/[0.06] text-[11px] text-[var(--mist)] cursor-pointer hover:border-indigo/20">
                    <input type="radio" name="defaultKind" defaultChecked={kind === 'quick_replies'} className="accent-indigo" />
                    {kind === 'card' ? l('card') : kind === 'quick_replies' ? l('quickReplies') : l('plain')}
                  </label>
                ))}
              </div>
              <p className="text-[10px] text-[var(--fog)] mt-1.5">{l('defaultRenderHint')}</p>
            </div>
          </div>
          <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-black/[0.05]">
              <p className="text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--fog)]/50">{l('widgetPreview')}</p>
            </div>
            <div className="p-4">
              <div className="flex gap-2 mb-3">
                {WIDGET_VIEWS.map(v => (
                  <button key={v.label} onClick={() => previewWidget(v.label)}
                    className={`text-[11px] px-2.5 py-1 rounded-lg border transition-colors ${selectedView === v.label ? 'border-indigo/30 bg-indigo/[0.06] text-indigo' : 'border-black/[0.06] text-[var(--fog)] hover:border-black/[0.1]'}`}>{v.label}</button>
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
          <p className="text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--fog)]/50">{l('escalationStrategy')}</p>
          <div><label className={labelCls}>{l('whenEscalation')}</label>
            <select className={inputCls} defaultValue="transfer_chat">
              <option value="transfer_chat">{l('transferChat')}</option>
              <option value="consult">{l('consultLlm')}</option>
              <option value="silent_task">{l('silentTask')}</option>
            </select>
          </div>
          <div><label className={labelCls}>{l('transferTarget')}</label>
            <select className={inputCls} defaultValue="queue">
              <option value="queue">{l('defaultQueue')}</option>
              <option value="group">{l('specificGroup')}</option>
            </select>
          </div>
          <div><label className={labelCls}>{l('consultationPrompt')}</label>
            <textarea className={inputCls} rows={4} placeholder="You are consulting on a LiveChat case. The customer is waiting..." /></div>
          <div><label className={labelCls}>{l('skillsDuringConsult')}</label>
            <input className={inputCls} placeholder="read_case_history, kb_search_General" defaultValue="read_case_history" />
            <p className="text-[10px] text-[var(--fog)] mt-1">{l('skillsHint')}</p>
          </div>
        </div>
      )}

      {/* Bottom action bar */}
      <div className="mt-8 pt-4 border-t border-black/[0.05] flex items-center justify-between">
        <button onClick={handleReset} disabled={!hasChanges}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[12px] font-medium text-[var(--fog)] border border-black/[0.08] hover:border-black/[0.15] disabled:opacity-30 transition-all">
          <RotateCcw className="w-3.5 h-3.5" /> {l('reset')}
        </button>
        <div className="flex items-center gap-2">
          {saveStatus === 'error' && <span className="text-[11px] text-vermillion">{l('saveError')}</span>}
          {saveStatus === 'saved' && <span className="text-[11px] text-malachite flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" />{l('saved')}</span>}
          <button onClick={() => { void handleSave() }} disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-indigo text-white text-[13px] font-semibold rounded-xl hover:bg-indigo/90 disabled:opacity-40 transition-colors">
            {saving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
            {l('save')}
          </button>
        </div>
      </div>
    </div>
  )
}
