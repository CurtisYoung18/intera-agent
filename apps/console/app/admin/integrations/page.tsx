// apps/console/app/admin/integrations/page.tsx
'use client'

import { useState, useEffect } from 'react'
import { Plug, Eye, EyeOff, Save, CheckCircle2, AlertCircle, MessageCircle, ExternalLink } from 'lucide-react'
import { chatApiUrl } from '@/lib/chat-api'
import { useConsoleLocale } from '@/components/locale-provider'

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

interface ChannelInfo {
  id: string
  label: string
  icon: typeof Plug
  active: boolean
  comingSoon: boolean
}

const CHANNELS: ChannelInfo[] = [
  { id: 'livechat', label: 'LiveChat', icon: MessageCircle, active: true, comingSoon: false },
  { id: 'slack', label: 'Slack', icon: Plug, active: false, comingSoon: true },
  { id: 'discord', label: 'Discord', icon: Plug, active: false, comingSoon: true },
  { id: 'whatsapp', label: 'WhatsApp', icon: Plug, active: false, comingSoon: true },
]

export default function IntegrationsPage() {
  const { t } = useConsoleLocale()
  const [config, setConfig] = useState<IntegrationConfig>(EMPTY_CONFIG)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [showToken, setShowToken] = useState(false)
  const [customerId, setCustomerId] = useState('')
  const [selectedChannel, setSelectedChannel] = useState<string>('livechat')

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
      <div className="p-8 text-[13px] text-[var(--fog)]">{t('integrations.loading')}</div>
    )
  }

  return (
    <div className="p-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
          <Plug className="w-4 h-4 text-purple-600" />
        </div>
        <div>
          <h1 className="text-[18px] font-bold text-[var(--mist)]">{t('integrations.title')}</h1>
          <p className="text-[12px] text-[var(--fog)]">{t('integrations.subtitle')}</p>
        </div>
      </div>

      {/* Channel Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        {CHANNELS.map((ch) => {
          const isSelected = selectedChannel === ch.id
          const Icon = ch.icon
          return (
            <button
              key={ch.id}
              onClick={() => !ch.comingSoon && setSelectedChannel(ch.id)}
              disabled={ch.comingSoon}
              title={ch.comingSoon ? 'Available in a future release' : undefined}
              className={`relative text-left rounded-2xl p-5 transition-all duration-200 ${
                isSelected
                  ? 'bg-white/80 backdrop-blur-xl border border-indigo/20 shadow-sm ring-1 ring-indigo/10'
                  : ch.comingSoon
                    ? 'bg-white/30 border border-black/[0.03] opacity-50 cursor-not-allowed'
                    : 'bg-white/60 backdrop-blur-xl border border-black/[0.05] hover:border-black/[0.1] hover:bg-white/80'
              }`}
            >
              <div className="flex items-center gap-2.5 mb-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  isSelected ? 'bg-indigo/[0.08]' : 'bg-black/[0.03]'
                }`}>
                  <Icon className={`w-4 h-4 ${isSelected ? 'text-indigo' : 'text-[var(--fog)]'}`} />
                </div>
                <span className={`text-[13px] font-semibold ${ch.comingSoon ? 'text-[var(--fog)]' : 'text-[var(--mist)]'}`}>
                  {ch.label}
                </span>
              </div>
              <div>
                {ch.active ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-malachite/10 text-malachite border border-malachite/20">
                    <span className="w-1.5 h-1.5 rounded-full bg-malachite" />
                    Active
                  </span>
                ) : ch.comingSoon ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-black/[0.04] text-[var(--fog)] border border-black/[0.06]">
                    Coming soon
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber/10 text-amber border border-amber/20">
                    Inactive
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {/* LiveChat Detail Panel */}
      {selectedChannel === 'livechat' && (
        <div className="rounded-2xl border border-black/[0.06] bg-white/60 backdrop-blur-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-black/[0.05]">
            <div className="flex items-center gap-2">
              <MessageCircle className="w-4 h-4 text-indigo" />
              <h2 className="text-[14px] font-bold text-[var(--mist)]">LiveChat Configuration</h2>
              <a
                href="https://developers.livechat.com"
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto text-[11px] text-indigo hover:text-indigo/80 flex items-center gap-1"
              >
                Docs <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          <div className="p-5">
            {/* Two-column grid */}
            <div className="grid md:grid-cols-2 gap-6">
              {/* Left column: Connection */}
              <div className="space-y-5">
                <p className="text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--fog)]/50">Connection</p>

                {/* Enable toggle */}
                <div className="flex items-center justify-between p-4 bg-white border border-black/[0.06] rounded-xl">
                  <div>
                    <p className="text-[13px] font-semibold text-[var(--mist)]">{t('integrations.enableLabel')}</p>
                    <p className="text-[11px] text-[var(--fog)] mt-0.5">{t('integrations.enableDesc')}</p>
                  </div>
                  <button
                    onClick={() => setConfig(c => ({ ...c, enabled: !c.enabled }))}
                    className={`w-10 h-6 rounded-full transition-colors relative ${config.enabled ? 'bg-indigo' : 'bg-black/[0.08]'}`}
                  >
                    <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${config.enabled ? 'translate-x-5' : 'translate-x-1'}`} />
                  </button>
                </div>

                {/* License ID */}
                <div className="space-y-1.5">
                  <label className="block text-[12px] font-semibold text-[var(--mist)]">{t('integrations.licenseIdLabel')}</label>
                  <input
                    type="text"
                    value={config.licenseId}
                    onChange={e => setConfig(c => ({ ...c, licenseId: e.target.value }))}
                    placeholder="e.g. 12345678"
                    className="w-full px-3 py-2 text-[13px] border border-black/[0.08] rounded-xl bg-white outline-none focus:border-indigo/30"
                  />
                  <p className="text-[11px] text-[var(--fog)]">{t('integrations.licenseIdHint')}</p>
                </div>

                {/* Bot Access Token */}
                <div className="space-y-1.5">
                  <label className="block text-[12px] font-semibold text-[var(--mist)]">{t('integrations.tokenLabel')}</label>
                  <div className="relative">
                    <input
                      type={showToken ? 'text' : 'password'}
                      value={config.botAccessToken}
                      onChange={e => setConfig(c => ({ ...c, botAccessToken: e.target.value }))}
                      placeholder="Bearer token from LiveChat Bot settings"
                      className="w-full px-3 py-2 pr-10 text-[13px] border border-black/[0.08] rounded-xl bg-white outline-none focus:border-indigo/30"
                    />
                    <button
                      onClick={() => setShowToken(s => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--fog)] hover:text-[var(--mist)]"
                    >
                      {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-[11px] text-[var(--fog)]">{t('integrations.tokenHint')}</p>
                </div>
              </div>

              {/* Right column: Behavior */}
              <div className="space-y-5">
                <p className="text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--fog)]/50">Behavior</p>

                {/* Show skill status toggle */}
                <div className="flex items-center justify-between p-4 bg-white border border-black/[0.06] rounded-xl">
                  <div>
                    <p className="text-[13px] font-semibold text-[var(--mist)]">{t('integrations.skillStatusLabel')}</p>
                    <p className="text-[11px] text-[var(--fog)] mt-0.5">{t('integrations.skillStatusDesc')}</p>
                  </div>
                  <button
                    onClick={() => setConfig(c => ({ ...c, showSkillStatus: !c.showSkillStatus }))}
                    className={`w-10 h-6 rounded-full transition-colors relative ${config.showSkillStatus ? 'bg-indigo' : 'bg-black/[0.08]'}`}
                  >
                    <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${config.showSkillStatus ? 'translate-x-5' : 'translate-x-1'}`} />
                  </button>
                </div>

                {/* Webhook URL hint */}
                <div className="p-4 bg-white border border-black/[0.04] rounded-xl text-[12px] text-[var(--fog)] space-y-1">
                  <p className="font-semibold text-[var(--mist)]">{t('integrations.webhookTitle')}</p>
                  <code className="block text-indigo mt-1 break-all text-[11px]">
                    {`${process.env.NEXT_PUBLIC_CHAT_API_URL ?? ''}/api/livechat/webhook`}
                  </code>
                  <p className="mt-1">{t('integrations.webhookEvent')}</p>
                </div>

                {/* Future: channel skill binding slot */}
                <div className="p-4 bg-black/[0.01] border border-dashed border-black/[0.08] rounded-xl text-[11px] text-[var(--fog)]/60 italic">
                  Channel-to-skill binding &mdash; available in a future release
                </div>
              </div>
            </div>

            {/* Sticky Save Button */}
            <div className="mt-6 pt-4 border-t border-black/[0.05] flex items-center justify-end sticky bottom-0 bg-white/60 backdrop-blur-xl -mx-5 -mb-5 px-5 py-3">
              <button
                onClick={() => { void handleSave() }}
                disabled={saving}
                className="flex items-center gap-2 px-5 py-2.5 bg-indigo text-white text-[13px] font-semibold rounded-xl hover:bg-indigo/90 disabled:opacity-40 transition-colors"
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
                {saveStatus === 'saved' ? t('integrations.saved') : saveStatus === 'error' ? t('integrations.saveError') : t('integrations.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
