'use client'

import { useState, useEffect } from 'react'
import { MessageCircle, Eye, EyeOff, Save, CheckCircle2, ExternalLink, Globe, Monitor, UserCheck, Copy, RotateCcw } from 'lucide-react'

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

const TABS = [
  { id: 'connection', label: 'Connection', labelZh: '连接', icon: Globe },
  { id: 'rendering', label: 'Rendering', labelZh: '渲染', icon: Monitor },
  { id: 'escalation', label: 'Escalation', labelZh: '人工升级', icon: UserCheck },
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
  authType: { en: 'Auth Type', zh: '认证类型' },
  authTypeHint: { en: 'PAT → Basic; Bot token → Bearer; auto detects from token format', zh: 'PAT → Basic；Bot 令牌 → Bearer；auto 自动检测' },
  accountId: { en: 'Account ID (PAT)', zh: 'Account ID (PAT)' },
  accountIdHint: { en: 'LiveChat Account ID from Developer Console. Required for PAT Basic auth.', zh: 'LiveChat 开发者后台的 Account ID。PAT Basic 认证必填。' },
  agentAccountId: { en: 'Agent ID / Email', zh: 'Agent ID / 邮箱' },
  agentAccountIdHint: { en: 'The agent whose identity Intera takes over. Used for self-filtering and presence detection.', zh: '被 Intera 接管的人工 agent。用于自过滤和在场检测。' },
  region: { en: 'Data Region', zh: '数据区域' },
  regionHint: { en: 'Match your LiveChat account region (dal=default US, fra=Europe). Token prefix dal:/fra: is also a hint.', zh: '需与 LiveChat 账号数据区一致（dal=默认美国，fra=欧洲）。Token 前缀 dal:/fra: 可作为参考。' },
  copied: { en: 'Copied!', zh: '已复制！' },
  settings: { en: 'Settings', zh: '设置' },
  showSkillStatus: { en: 'Show Skill Status', zh: '显示工具状态' },
  showSkillStatusHint: { en: 'Display skill execution progress in chat', zh: '在对话中显示工具执行进度' },
  save: { en: 'Save Configuration', zh: '保存配置' },
  reset: { en: 'Reset', zh: '重置' },
  saved: { en: 'Saved', zh: '已保存' },
  saveError: { en: 'Save failed — please retry', zh: '保存失败 — 请重试' },
  required: { en: 'Required', zh: '必填' },
  // Escalation tab
  escalationStrategy: { en: 'Human Escalation', zh: '人工升级' },
  escalationDesc: { en: 'When the agent calls create_human_task, the LiveChat conversation is transferred to a human group via the transfer_chat API. Select which group below.', zh: '当 Agent 调用 create_human_task 时，LiveChat 会话将通过 transfer_chat API 转接给人工分组。请在下方选择目标分组。' },
  transferGroup: { en: 'Transfer Target Group', zh: '转接目标分组' },
  transferGroupHint: { en: 'Select a group from your LiveChat account. If empty or "Default queue", the chat is transferred to the default agent queue.', zh: '从 LiveChat 账号中选择一个分组。留空或选择"默认队列"时，会话转接到默认人工队列。' },
  defaultQueue: { en: '— Default agent queue —', zh: '— 默认人工队列 —' },
  loadingGroups: { en: 'Loading groups...', zh: '加载分组中...' },
  transferMessage: { en: 'Transfer Message (optional)', zh: '转接消息（可选）' },
  transferMessageHint: { en: 'Sent to the customer before transferring. Leave empty for default system message.', zh: '转接前发送给客户的消息。留空则使用系统默认消息。' },
  // Rendering tab
  skillOverrides: { en: 'Skill Render Overrides', zh: '工具渲染覆盖' },
  skillOverridesDesc: { en: 'Configure render hints per skill on the Tools page. Each tool can set card, carousel, quick_replies, or plain rendering for LiveChat.', zh: '在工具页面为每个工具配置 LiveChat 渲染方式（卡片、轮播、快捷回复、纯文本）。' },
  openTools: { en: 'Open Tools page', zh: '打开工具页面' },
} as const

function useL() {
  const { locale } = useConsoleLocale()
  return (key: keyof typeof L) => L[key][locale as 'en' | 'zh'] ?? L[key].en
}

// ── Helpers ────────────────────────────────────────────────────────────

function getConnectionState(config: LiveChatConfig, saveStatus: string): ConnectionState {
  if (!config.licenseId && !config.botAccessToken) return 'unconfigured'
  if (!config.enabled) return 'disabled'
  return 'connected'
}

function stateColor(s: ConnectionState) {
  return s === 'connected' ? 'bg-malachite' : s === 'unconfigured' ? 'bg-[var(--fog)]/30' : s === 'failed' ? 'bg-vermillion' : 'bg-amber/60'
}

// ── Component ──────────────────────────────────────────────────────────

export default function LiveChatDetailPage() {
  const { locale } = useConsoleLocale()
  const l = useL()
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
  const connState = getConnectionState(config, saveStatus)

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
    const baseUrl = ''
    const params = new URLSearchParams({
      view: 'form',
      caseId: 'demo',
      title: preset.title,
      fields: JSON.stringify(preset.fields),
    })
    setMomentPreviewUrl(`${baseUrl}?${params.toString()}`)
  }

  const hasChanges = JSON.stringify(config) !== JSON.stringify(origConfig)

  if (loading) return <div className="p-8 text-[13px] text-[var(--fog)]">{l('loading')}</div>

  const inputCls = 'w-full px-3 py-2 text-[13px] border border-black/[0.08] rounded-xl bg-white outline-none focus:border-indigo/30'
  const labelCls = 'block text-[12px] font-semibold text-[var(--mist)] mb-1'
  const webhookUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/livechat/webhook/${orgId}` : `/api/livechat/webhook/${orgId}`

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
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-all ${config.enabled ? 'left-[18px]' : 'left-0.5'}`} />
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

            {/* Region */}
            <div>
              <label className={labelCls}>{l('region')}</label>
              <select value={config.region ?? 'dal'} onChange={e => setConfig(c => ({ ...c, region: e.target.value }))} className={inputCls}>
                <option value="dal">dal (US — default)</option>
                <option value="fra">fra (Europe)</option>
              </select>
              <p className="text-[10px] text-[var(--fog)] mt-1">{l('regionHint')}</p>
            </div>

            {/* Auth Type */}
            <div>
              <label className={labelCls}>{l('authType')}</label>
              <select value={config.authType ?? 'auto'} onChange={e => setConfig(c => ({ ...c, authType: e.target.value }))} className={inputCls}>
                <option value="auto">auto</option>
                <option value="basic">basic (PAT)</option>
                <option value="bearer">bearer (Bot)</option>
              </select>
              <p className="text-[10px] text-[var(--fog)] mt-1">{l('authTypeHint')}</p>
            </div>

            {/* Account ID (PAT) */}
            <div>
              <label className={labelCls}>{l('accountId')}</label>
              <input type="text" value={config.accountId ?? ''} onChange={e => setConfig(c => ({ ...c, accountId: e.target.value }))} className={inputCls} placeholder="28e53566-..." />
              <p className="text-[10px] text-[var(--fog)] mt-1">{l('accountIdHint')}</p>
            </div>

            {/* Agent ID / Email */}
            <div>
              <label className={labelCls}>{l('agentAccountId')}</label>
              <input type="text" value={config.agentAccountId ?? ''} onChange={e => setConfig(c => ({ ...c, agentAccountId: e.target.value }))} className={inputCls} placeholder="agent@email.com" />
              <p className="text-[10px] text-[var(--fog)] mt-1">{l('agentAccountIdHint')}</p>
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

{/* ── Rendering Tab ── */}
      {activeTab === 'rendering' && (
        <div className="space-y-6">
          {/* Skill Render Hints */}
          <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl p-5">
            <p className="text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--fog)]/50">{l('skillOverrides')}</p>
            <p className="text-[12px] text-[var(--fog)] mt-1">{l('skillOverridesDesc')}</p>
            <a href="/admin/tools" className="inline-flex items-center gap-1.5 text-[12px] font-medium text-indigo hover:text-indigo/80 mt-2">
              <ExternalLink className="w-3.5 h-3.5" /> {l('openTools')}
            </a>
          </div>

          {/* Moment Preview */}
          <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-black/[0.05] flex items-center justify-between">
              <p className="text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--fog)]/50">Moment Preview</p>
              <span className="text-[10px] text-[var(--fog)]/60">Form fields via URL params — same as webview button opens</span>
            </div>
            <div className="p-4">
              <p className="text-[11px] text-[var(--fog)] mb-3">Click a preset to load the form Moment. Fields are passed as URL query params, matching how the renderer builds the webview button URL.</p>
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
                  <div className="flex items-center justify-center h-full text-[12px] text-[var(--fog)]">Select a preset above to preview the form Moment</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Escalation Tab ── */}
      {activeTab === 'escalation' && (
        <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl p-5 space-y-4 max-w-2xl">
          <p className="text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--fog)]/50">{l('escalationStrategy')}</p>
          <p className="text-[12px] text-[var(--fog)]">{l('escalationDesc')}</p>
          <div>
            <label className={labelCls}>{l('transferGroup')}</label>
            <select
              className={inputCls}
              value={config.transferGroupId ?? ''}
              onChange={e => setConfig({ ...config, transferGroupId: e.target.value ? Number(e.target.value) : undefined })}
            >
              <option value="">{groups.length === 0 ? l('loadingGroups') : l('defaultQueue')}</option>
              {groups.map(g => (
                <option key={g.id} value={g.id}>{g.name}{g.agents_count > 0 ? ` (${g.agents_count} agents)` : ''}</option>
              ))}
            </select>
            <p className="text-[10px] text-[var(--fog)] mt-1">{l('transferGroupHint')}</p>
          </div>
          <div>
            <label className={labelCls}>{l('transferMessage')}</label>
            <textarea
              className={inputCls} rows={3}
              value={config.transferMessage ?? ''}
              onChange={e => setConfig({ ...config, transferMessage: e.target.value || undefined })}
              placeholder={isZh ? '正在为您转接人工客服，请稍候...' : 'Transferring you to a human agent, please wait...'}
            />
            <p className="text-[10px] text-[var(--fog)] mt-1">{l('transferMessageHint')}</p>
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
