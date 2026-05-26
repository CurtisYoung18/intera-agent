// apps/console/app/admin/integrations/page.tsx
'use client'

import { useState, useEffect } from 'react'
import { Plug, Eye, EyeOff, Save, CheckCircle2, AlertCircle } from 'lucide-react'
import { chatApiUrl } from '@/lib/chat-api'

interface IntegrationConfig {
  botAccessToken: string
  licenseId: string
  showSkillStatus: boolean
  enabled: boolean
}

const EMPTY_CONFIG: IntegrationConfig = {
  botAccessToken: '',
  licenseId: '',
  showSkillStatus: true,
  enabled: false,
}

export default function IntegrationsPage() {
  const [config, setConfig] = useState<IntegrationConfig>(EMPTY_CONFIG)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [showToken, setShowToken] = useState(false)
  const [customerId, setCustomerId] = useState('')

  // Load current customer from session
  useEffect(() => {
    fetch('/api/auth/session')
      .then(r => r.json())
      .then((d: { customerId?: string }) => { if (d.customerId) setCustomerId(d.customerId) })
      .catch(() => {})
  }, [])

  // Load config from apps/chat API
  useEffect(() => {
    if (!customerId) return
    setLoading(true)
    fetch(chatApiUrl(`/api/livechat/config?customerId=${encodeURIComponent(customerId)}`))
      .then(r => r.json())
      .then((data: IntegrationConfig) => setConfig(data))
      .catch(() => setConfig(EMPTY_CONFIG))
      .finally(() => setLoading(false))
  }, [customerId])

  const handleSave = async () => {
    setSaving(true)
    setSaveStatus('idle')
    try {
      const res = await fetch(chatApiUrl('/api/livechat/config'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...config, customerId }),
      })
      if (!res.ok) throw new Error('save failed')
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2500)
    } catch {
      setSaveStatus('error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="p-8 text-[13px] text-[var(--fog)]">Loading…</div>
    )
  }

  return (
    <div className="p-8 max-w-xl">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
          <Plug className="w-4 h-4 text-purple-600" />
        </div>
        <div>
          <h1 className="text-[18px] font-bold text-[var(--mist)]">集成</h1>
          <p className="text-[12px] text-[var(--fog)]">配置 LiveChat Bot Agent 接入</p>
        </div>
      </div>

      <div className="space-y-6">
        {/* Enable toggle */}
        <div className="flex items-center justify-between p-4 bg-white border border-black/[0.06] rounded-xl">
          <div>
            <p className="text-[13px] font-semibold text-[var(--mist)]">启用 LiveChat 集成</p>
            <p className="text-[11px] text-[var(--fog)] mt-0.5">开启后 Bridge 将处理 LiveChat 对话</p>
          </div>
          <button
            onClick={() => setConfig(c => ({ ...c, enabled: !c.enabled }))}
            className={`w-10 h-6 rounded-full transition-colors relative ${config.enabled ? 'bg-indigo-500' : 'bg-gray-200'}`}
          >
            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${config.enabled ? 'translate-x-5' : 'translate-x-1'}`} />
          </button>
        </div>

        {/* License ID */}
        <div className="space-y-1.5">
          <label className="block text-[12px] font-semibold text-[var(--mist)]">LiveChat License ID</label>
          <input
            type="text"
            value={config.licenseId}
            onChange={e => setConfig(c => ({ ...c, licenseId: e.target.value }))}
            placeholder="e.g. 12345678"
            className="w-full px-3 py-2 text-[13px] border border-black/[0.08] rounded-xl bg-white outline-none focus:border-indigo-300"
          />
          <p className="text-[11px] text-[var(--fog)]">在 LiveChat Developer Console → Apps → 你的 Bot 里找到</p>
        </div>

        {/* Bot Access Token */}
        <div className="space-y-1.5">
          <label className="block text-[12px] font-semibold text-[var(--mist)]">Bot Access Token</label>
          <div className="relative">
            <input
              type={showToken ? 'text' : 'password'}
              value={config.botAccessToken}
              onChange={e => setConfig(c => ({ ...c, botAccessToken: e.target.value }))}
              placeholder="Bearer token from LiveChat Bot settings"
              className="w-full px-3 py-2 pr-10 text-[13px] border border-black/[0.08] rounded-xl bg-white outline-none focus:border-indigo-300"
            />
            <button
              onClick={() => setShowToken(s => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--fog)] hover:text-[var(--mist)]"
            >
              {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-[11px] text-[var(--fog)]">在部署时于此填写，加密存入数据库</p>
        </div>

        {/* Show skill status toggle */}
        <div className="flex items-center justify-between p-4 bg-white border border-black/[0.06] rounded-xl">
          <div>
            <p className="text-[13px] font-semibold text-[var(--mist)]">对用户显示 Skill 执行状态</p>
            <p className="text-[11px] text-[var(--fog)] mt-0.5">开启后用户可在 widget 内看到 Intera 的处理步骤</p>
          </div>
          <button
            onClick={() => setConfig(c => ({ ...c, showSkillStatus: !c.showSkillStatus }))}
            className={`w-10 h-6 rounded-full transition-colors relative ${config.showSkillStatus ? 'bg-indigo-500' : 'bg-gray-200'}`}
          >
            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${config.showSkillStatus ? 'translate-x-5' : 'translate-x-1'}`} />
          </button>
        </div>

        {/* Webhook URL hint */}
        <div className="p-4 bg-gray-50 border border-black/[0.04] rounded-xl text-[12px] text-[var(--fog)] space-y-1">
          <p className="font-semibold text-[var(--mist)]">在 LiveChat 填写的 Webhook URL</p>
          <code className="block text-indigo-600 mt-1 break-all">
            {`${process.env.NEXT_PUBLIC_CHAT_API_URL ?? ''}/api/livechat/webhook`}
          </code>
          <p className="mt-1">Event: <code>incoming_event</code></p>
        </div>

        {/* Save button */}
        <button
          onClick={() => { void handleSave() }}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 bg-indigo-500 text-white text-[13px] font-semibold rounded-xl hover:bg-indigo-600 disabled:opacity-40 transition-colors"
        >
          {saving ? (
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : saveStatus === 'saved' ? (
            <CheckCircle2 className="w-4 h-4" />
          ) : saveStatus === 'error' ? (
            <AlertCircle className="w-4 h-4" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          {saveStatus === 'saved' ? '已保存' : saveStatus === 'error' ? '保存失败' : '保存配置'}
        </button>
      </div>
    </div>
  )
}
