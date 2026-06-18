'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  Globe,
  Loader2,
  MessageCircle,
  Monitor,
  Route,
  RotateCcw,
  Save,
  UserCheck,
} from 'lucide-react'
import { apiClient } from '@/lib/api/client'
import { useConsoleLocale } from '@/components/locale-provider'
import { useSession } from '@/lib/hooks/use-session'

type LiveChatConfig = {
  webhookAgentConfigId?: string
  botAccessToken: string
  licenseId: string
  showSkillStatus: boolean
  enabled: boolean
  webhookSecret?: string
  region?: string
  authType?: string
  accountId?: string
  agentAccountId?: string
  transferGroupId?: number
  transferMessage?: string
  failureMessages?: {
    engine_unreachable?: string
    stream_truncated?: string
    action_failed?: string
  }
}

type LiveChatGroup = {
  id: number
  name: string
  agents_count: number
}

type MomentPreset = {
  label: string
  title: string
  fields: Array<{
    id: string
    type: string
    label: string
    required?: boolean
    options?: string[]
    placeholder?: string
  }>
}

type ConnectionState = 'unconfigured' | 'disabled' | 'connecting' | 'connected' | 'failed'

const MOMENT_PRESETS: MomentPreset[] = [
  {
    label: 'Deposit Issue',
    title: 'Deposit Information',
    fields: [
      { id: 'txnId', type: 'text', label: 'Transaction ID', required: true, placeholder: 'e.g. TXN-123456' },
      { id: 'amount', type: 'number', label: 'Deposit Amount', required: true },
      { id: 'paymentMethod', type: 'select', label: 'Payment Method', required: true, options: ['Wallet', 'Bank Transfer', 'Card', 'Other'] },
      { id: 'date', type: 'date', label: 'Deposit Date' },
      { id: 'notes', type: 'textarea', label: 'Additional Notes', placeholder: 'Any error messages or screenshots...' },
    ],
  },
  {
    label: 'Account Issue',
    title: 'Account Information',
    fields: [
      { id: 'memberId', type: 'text', label: 'Member ID', required: true, placeholder: 'e.g. member-123' },
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

function getConnectionState(config: LiveChatConfig, testedOk?: boolean | null): ConnectionState {
  if (!config.licenseId && !config.botAccessToken) return 'unconfigured'
  if (!config.enabled) return 'disabled'
  if (testedOk === null) return 'connecting'
  if (testedOk === false) return 'failed'
  return 'connected'
}

function stateColor(state: ConnectionState) {
  if (state === 'connected') return 'bg-malachite'
  if (state === 'unconfigured') return 'bg-[var(--fog)]/30'
  if (state === 'failed') return 'bg-vermillion'
  return 'bg-amber/60'
}

function hasRequiredLiveChatCredentials(config: Pick<LiveChatConfig, 'licenseId' | 'botAccessToken'>) {
  return Boolean(config.licenseId.trim() && config.botAccessToken.trim())
}

export default function LiveChatChannelWorkspace({
  agentConfigId,
  onBack,
}: {
  agentConfigId: string | null
  onBack: () => void
}) {
  const { t, locale } = useConsoleLocale()
  const { orgId } = useSession()
  const isZh = locale === 'zh'
  const [config, setConfig] = useState<LiveChatConfig>({
    botAccessToken: '',
    licenseId: '',
    showSkillStatus: true,
    enabled: false,
    webhookSecret: '',
    region: 'dal',
    authType: 'auto',
    accountId: '',
    agentAccountId: '',
    failureMessages: {},
  })
  const [origConfig, setOrigConfig] = useState<LiveChatConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle')
  const [showToken, setShowToken] = useState(false)
  const [activeTab, setActiveTab] = useState<'connection' | 'rendering' | 'routing' | 'handoff'>('connection')
  const [selectedMomentLabel, setSelectedMomentLabel] = useState('')
  const [momentPreviewUrl, setMomentPreviewUrl] = useState('')
  const [groups, setGroups] = useState<LiveChatGroup[]>([])
  const [copied, setCopied] = useState(false)
  const [connectionTested, setConnectionTested] = useState<boolean | null>(null)
  const [testingConnection, setTestingConnection] = useState(false)
  const [connectionErrorCode, setConnectionErrorCode] = useState<string | null>(null)
  const [validationMessage, setValidationMessage] = useState<string | null>(null)
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(null)
  const loadedRef = useRef(false)
  const skipNextAutosaveRef = useRef(false)
  const configRef = useRef(config)

  const connectionStateLabels: Record<ConnectionState, string> = useMemo(
    () => ({
      unconfigured: t('livechat.stateUnconfigured'),
      disabled: t('livechat.stateDisabled'),
      connecting: t('livechat.stateConnecting'),
      connected: t('livechat.stateConnected'),
      failed: t('livechat.stateFailed'),
    }),
    [t],
  )

  const connectionState = getConnectionState(config, connectionTested)
  const persistedConfigHasCredentials = hasRequiredLiveChatCredentials(origConfig ?? config)
  const saveState = syncStatus === 'error'
    ? 'error'
    : syncStatus === 'syncing'
      ? 'syncing'
      : persistedConfigHasCredentials
        ? 'saved'
        : 'unconfigured'
  const inputCls = 'w-full rounded-xl border border-black/[0.08] bg-white px-3 py-2 text-[13px] outline-none focus:border-indigo/30'
  const labelCls = 'mb-1 block text-[12px] font-semibold text-[var(--mist)]'
  const cardCls = 'rounded-[26px] border border-black/[0.06] bg-white/72 p-5 shadow-[0_16px_36px_rgba(21,23,25,0.05)]'
  const webhookTargetId = config.webhookAgentConfigId ?? ''

  const webhookUrl =
    typeof window !== 'undefined' && orgId && webhookTargetId
      ? `${window.location.origin}/api/livechat/webhook/${orgId}/${webhookTargetId}`
      : orgId && webhookTargetId
        ? `/api/livechat/webhook/${orgId}/${webhookTargetId}`
        : ''

  const validateBeforePersist = useCallback((nextConfig: LiveChatConfig) => {
    if (!nextConfig.enabled || hasRequiredLiveChatCredentials(nextConfig)) {
      setValidationMessage(null)
      return true
    }
    setValidationMessage(t('livechat.enableRequiresCredentials'))
    setSyncStatus('error')
    return false
  }, [t])

  const persistConfig = useCallback(async (nextConfig: LiveChatConfig) => {
    if (!agentConfigId) return false
    try {
      await apiClient(`/api/admin/livechat/config?agentConfigId=${encodeURIComponent(agentConfigId)}`, {
        method: 'PUT',
        body: nextConfig,
      })
      setSyncStatus('synced')
      setOrigConfig({ ...nextConfig })
      return true
    } catch {
      setSyncStatus('error')
      return false
    }
  }, [agentConfigId])

  const fetchConfig = useCallback(async () => {
    if (!agentConfigId) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [configResult, groupsResult] = await Promise.all([
        apiClient<{ config: LiveChatConfig }>(`/api/admin/livechat/config?agentConfigId=${encodeURIComponent(agentConfigId)}`),
        apiClient<{ groups?: LiveChatGroup[] }>(`/api/admin/livechat/groups?agentConfigId=${encodeURIComponent(agentConfigId)}`),
      ])
      skipNextAutosaveRef.current = true
      setConfig(configResult.data.config)
      setOrigConfig(configResult.data.config)
      setValidationMessage(null)
      setGroups(groupsResult.data.groups || [])
      setConnectionTested(
        Boolean(
          configResult.data.config.enabled &&
          configResult.data.config.licenseId &&
          configResult.data.config.botAccessToken,
        ),
      )
      loadedRef.current = true
      setConnectionErrorCode(null)
    } catch {
      setConnectionErrorCode('network')
    } finally {
      setLoading(false)
    }
  }, [agentConfigId])

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  useEffect(() => {
    configRef.current = config
    if (!agentConfigId || !loadedRef.current || !origConfig) return
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    if (skipNextAutosaveRef.current) {
      skipNextAutosaveRef.current = false
      return
    }
    if (JSON.stringify(config) === JSON.stringify(origConfig)) return
    saveTimer.current = setTimeout(async () => {
      const nextConfig = configRef.current
      if (!validateBeforePersist(nextConfig)) {
        saveTimer.current = null
        return
      }
      setSyncStatus('syncing')
      await persistConfig(nextConfig)
      saveTimer.current = null
    }, 800)
  }, [agentConfigId, config, origConfig, persistConfig, validateBeforePersist])

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [])

  const testConnection = async () => {
    if (!agentConfigId) return
    setTestingConnection(true)
    setConnectionTested(null)
    setConnectionErrorCode(null)
    try {
      const result = await apiClient<{ groups?: LiveChatGroup[]; code?: string }>(`/api/admin/livechat/groups?agentConfigId=${encodeURIComponent(agentConfigId)}`)
      setGroups(result.data.groups || [])
      if (result.data.code) {
        setConnectionTested(false)
        setConnectionErrorCode(result.data.code)
      } else {
        setConnectionTested(true)
      }
    } catch {
      setConnectionTested(false)
      setConnectionErrorCode('network')
    } finally {
      setTestingConnection(false)
      setLastCheckedAt(new Date().toISOString())
    }
  }

  const saveNow = useCallback(async (nextConfig?: LiveChatConfig) => {
    if (!agentConfigId) return false
    if (saveTimer.current) clearTimeout(saveTimer.current)
    const payload = nextConfig ?? configRef.current
    if (!validateBeforePersist(payload)) return false
    setSyncStatus('syncing')
    return persistConfig(payload)
  }, [agentConfigId, persistConfig, validateBeforePersist])

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleReset = () => {
    if (!origConfig) return
    setConfig({ ...origConfig })
    setValidationMessage(null)
    setSyncStatus('idle')
  }

  const loadMomentPreset = (preset: MomentPreset) => {
    setSelectedMomentLabel(preset.label)
    const params = new URLSearchParams({
      view: 'form',
      caseId: 'demo',
      chatId: 'preview',
      preview: '1',
      title: preset.title,
      fields: JSON.stringify(preset.fields),
    })
    setMomentPreviewUrl(`/livechat-widget?${params.toString()}`)
  }

  const openPreview = () => {
    setActiveTab('rendering')
    if (!momentPreviewUrl) loadMomentPreset(MOMENT_PRESETS[0])
  }

  const toggleEnabled = async () => {
    const nextConfig = { ...config, enabled: !config.enabled }
    if (!validateBeforePersist(nextConfig)) return
    setConfig(nextConfig)
    await saveNow(nextConfig)
  }

  const updateFailureMessage = (
    key: keyof NonNullable<LiveChatConfig['failureMessages']>,
    value: string,
  ) => {
    setConfig((current) => ({
      ...current,
      failureMessages: {
        ...(current.failureMessages ?? {}),
        [key]: value || undefined,
      },
    }))
  }

  function formatLastChecked(value: string | null) {
    if (!value) return isZh ? '尚未检查' : 'Not checked yet'
    try {
      return new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    } catch {
      return value
    }
  }

  if (!agentConfigId) {
    return (
      <div className="rounded-2xl border border-dashed border-black/15 bg-white/65 px-6 py-10 text-[13px] text-[var(--fog)]">
        Select an Agent version above before configuring LiveChat.
      </div>
    )
  }

  if (loading) return <div className="p-8 text-[13px] text-[var(--fog)]">{t('livechat.loading')}</div>

  return (
    <div className="mx-auto max-w-[1180px] space-y-6">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onBack} className="text-[11px] text-indigo hover:text-indigo/80">
          {t('livechat.back')}
        </button>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-purple-100">
            <MessageCircle className="h-4 w-4 text-purple-600" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[34px] font-semibold tracking-tight text-[var(--mist)]">LiveChat</h2>
              <div
                className="flex items-center gap-2 rounded-full border px-3 py-1.5"
                style={{
                  borderColor:
                    connectionState === 'connected'
                      ? 'rgba(46,160,74,0.25)'
                      : connectionState === 'unconfigured'
                        ? 'rgba(0,0,0,0.08)'
                        : 'rgba(212,145,46,0.25)',
                  background:
                    connectionState === 'connected'
                      ? 'rgba(46,160,74,0.06)'
                      : connectionState === 'unconfigured'
                        ? 'rgba(0,0,0,0.02)'
                        : 'rgba(212,145,46,0.06)',
                }}
              >
                <span className={`h-2 w-2 rounded-full ${stateColor(connectionState)}`} />
                <span className={`text-[11px] font-medium ${connectionState === 'connected' ? 'text-malachite' : connectionState === 'unconfigured' ? 'text-[var(--fog)]' : 'text-amber'}`}>
                  {connectionStateLabels[connectionState]}
                </span>
              </div>
            </div>
            <p className="mt-1 text-[13px] text-[var(--fog)]">{t('livechat.subtitle')}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={openPreview}
            className="rounded-xl border border-[var(--color-border-subtle)] bg-white px-4 py-2 text-[12px] font-semibold text-[var(--mist)] transition-colors hover:bg-black/[0.02]"
          >
            {isZh ? '预览' : 'Preview'}
          </button>
          <button
            type="button"
            onClick={toggleEnabled}
            className="rounded-xl border border-[var(--color-border-subtle)] bg-white px-4 py-2 text-[12px] font-semibold text-[var(--mist)] transition-colors hover:bg-black/[0.02]"
          >
            {config.enabled ? (isZh ? '停用' : 'Stop') : (isZh ? '启用' : 'Enable')}
          </button>
          <button
            type="button"
            onClick={() => void saveNow()}
            disabled={syncStatus === 'syncing'}
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--indigo)] px-4 py-2 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {syncStatus === 'syncing' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {t('livechat.save')}
          </button>
          <button
            type="button"
            onClick={testConnection}
            disabled={testingConnection || connectionState === 'unconfigured'}
            className="rounded-xl border border-[var(--color-border-subtle)] bg-white px-4 py-2 text-[12px] font-semibold text-[var(--mist)] transition-colors hover:bg-black/[0.02] disabled:cursor-not-allowed disabled:opacity-30"
          >
            {testingConnection ? t('livechat.testing') : (isZh ? '刷新状态' : 'Refresh status')}
          </button>
        </div>
      </div>

      {connectionTested === false && connectionErrorCode ? (
        <div className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-vermillion" />
          <p className="text-[12px] text-red-700">
            {t(`livechat.test.err${connectionErrorCode.charAt(0).toUpperCase() + connectionErrorCode.slice(1)}`)}
          </p>
        </div>
      ) : null}

      {validationMessage ? (
        <div className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-vermillion" />
          <p className="text-[12px] text-red-700">{validationMessage}</p>
        </div>
      ) : null}

      <div className="mb-2 flex gap-1 border-b border-black/[0.06]">
        {[
          { id: 'connection', label: t('livechat.tab.connection'), icon: Globe },
          { id: 'rendering', label: t('livechat.tab.rendering'), icon: Monitor },
          { id: 'routing', label: isZh ? '路由' : 'Routing', icon: Route },
          { id: 'handoff', label: isZh ? '交接' : 'Handoff', icon: UserCheck },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as 'connection' | 'rendering' | 'routing' | 'handoff')}
            className={`-mb-[1px] flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-[12px] font-medium transition-colors ${
              activeTab === tab.id ? 'border-indigo text-indigo' : 'border-transparent text-[var(--fog)] hover:text-[var(--mist)]'
            }`}
          >
            <tab.icon className="h-3.5 w-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'connection' ? (
        <div className="grid gap-6">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_320px]">
            <section className={cardCls}>
              <div className="mb-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--fog)]/50">{isZh ? 'Webhook 订阅' : 'Webhook subscription'}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-xl border border-black/[0.05] bg-black/[0.02] px-3 py-3 text-[12px] text-[var(--fog)]">{webhookUrl}</code>
                <button onClick={() => handleCopy(webhookUrl)} className="rounded-xl border border-black/[0.05] bg-white p-3 text-[var(--fog)] transition-colors hover:bg-indigo/[0.06] hover:text-indigo" title="Copy">
                  {copied ? <CheckCircle2 className="h-4 w-4 text-malachite" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              <div className="mt-4 space-y-2 text-[12px]">
                <div className="inline-flex items-center gap-2 text-malachite">
                  <span className={`h-2 w-2 rounded-full ${stateColor(connectionState)}`} />
                  <span className="font-medium">{connectionStateLabels[connectionState]}</span>
                </div>
                <p className="text-[var(--fog)]">{t('livechat.webhookRouteNotePerAgent')}</p>
              </div>
            </section>

            <section className={cardCls}>
              <div className="mb-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--fog)]/50">{isZh ? '运行状态' : 'Run state'}</p>
              </div>
              <div className="grid gap-3 text-[12px]">
                <div className="flex items-center justify-between gap-3 border-b border-black/[0.05] pb-3">
                  <span className="text-[var(--fog)]">{isZh ? '连接状态' : 'Delivery status'}</span>
                  <span className="font-semibold text-[var(--mist)]">{connectionStateLabels[connectionState]}</span>
                </div>
                <div className="flex items-center justify-between gap-3 border-b border-black/[0.05] pb-3">
                  <span className="text-[var(--fog)]">{isZh ? '保存状态' : 'Save status'}</span>
                  <span className={`font-semibold ${
                    saveState === 'error'
                      ? 'text-vermillion'
                      : saveState === 'syncing'
                        ? 'text-amber'
                        : saveState === 'saved'
                          ? 'text-malachite'
                          : 'text-[var(--fog)]'
                  }`}>
                    {saveState === 'error'
                      ? t('livechat.saveFailed')
                      : saveState === 'syncing'
                        ? t('livechat.saveSaving')
                        : saveState === 'saved'
                          ? t('livechat.saved')
                          : t('livechat.stateUnconfigured')}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[var(--fog)]">{isZh ? '最近检查' : 'Last check'}</span>
                  <span className="font-semibold text-[var(--mist)]">{formatLastChecked(lastCheckedAt)}</span>
                </div>
              </div>
            </section>
          </div>

          <form
            className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]"
            onSubmit={(event) => event.preventDefault()}
          >
            <section className={cardCls}>
              <div className="mb-4 flex items-center justify-between gap-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--fog)]/50">{t('livechat.credentials')}</p>
                <div className="flex items-center gap-2 rounded-full border border-black/[0.06] bg-black/[0.02] px-3 py-1.5">
                  <span className="text-[11px] font-medium text-[var(--fog)]">{t('livechat.enabled')}</span>
                  <button
                    type="button"
                    onClick={() => { void toggleEnabled() }}
                    className={`relative h-5 w-9 rounded-full transition-colors ${config.enabled ? 'bg-indigo' : 'bg-black/[0.08]'}`}
                  >
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${config.enabled ? 'left-[18px]' : 'left-0.5'}`} />
                  </button>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className={labelCls}>{t('livechat.licenseId')} <span className="text-vermillion">*</span></label>
                  <input type="text" autoComplete="off" value={config.licenseId} onChange={(event) => {
                    setValidationMessage(null)
                    setConfig((current) => ({ ...current, licenseId: event.target.value }))
                  }} className={inputCls} placeholder="e.g. 12345678" />
                </div>
                <div className="md:col-span-2">
                  <label className={labelCls}>{t('livechat.botToken')} <span className="text-vermillion">*</span></label>
                  <div className="relative">
                    <input type={showToken ? 'text' : 'password'} autoComplete="new-password" value={config.botAccessToken} onChange={(event) => {
                      setValidationMessage(null)
                      setConfig((current) => ({ ...current, botAccessToken: event.target.value }))
                    }} className={`${inputCls} pr-10`} />
                    <button
                      type="button"
                      onClick={() => setShowToken((current) => !current)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--fog)] hover:text-[var(--mist)]"
                    >
                      {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="md:col-span-2">
                  <label className={labelCls}>{t('livechat.webhookSecret')}</label>
                  <input type="password" autoComplete="new-password" value={config.webhookSecret ?? ''} onChange={(event) => {
                    setValidationMessage(null)
                    setConfig((current) => ({ ...current, webhookSecret: event.target.value }))
                  }} className={inputCls} />
                </div>
              </div>
            </section>

            <section className={cardCls}>
              <div className="mb-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--fog)]/50">{isZh ? '账户与身份' : 'Account and identity'}</p>
              </div>
              <div className="grid gap-4">
                <div>
                  <label className={labelCls}>{t('livechat.accountId')}</label>
                  <input type="text" autoComplete="off" value={config.accountId ?? ''} onChange={(event) => setConfig((current) => ({ ...current, accountId: event.target.value }))} className={inputCls} placeholder="28e53566-..." />
                </div>
                <div>
                  <label className={labelCls}>{t('livechat.agentAccountId')}</label>
                  <input type="text" autoComplete="off" value={config.agentAccountId ?? ''} onChange={(event) => setConfig((current) => ({ ...current, agentAccountId: event.target.value }))} className={inputCls} placeholder="agent@email.com" />
                </div>
                <div>
                  <label className={labelCls}>{t('livechat.region')}</label>
                  <select value={config.region ?? 'dal'} onChange={(event) => setConfig((current) => ({ ...current, region: event.target.value }))} className={inputCls}>
                    <option value="dal">dal (US — default)</option>
                    <option value="fra">fra (Europe)</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>{t('livechat.authType')}</label>
                  <select value={config.authType ?? 'auto'} onChange={(event) => setConfig((current) => ({ ...current, authType: event.target.value }))} className={inputCls}>
                    <option value="auto">{isZh ? '自动检测' : 'Auto-detect'}</option>
                    <option value="basic">{isZh ? 'Basic（Account ID + Personal Access Token）' : 'Basic (Account ID + Personal Access Token)'}</option>
                    <option value="bearer">{isZh ? 'Bearer（Bot Access Token）' : 'Bearer (Bot Access Token)'}</option>
                  </select>
                </div>
              </div>
            </section>
          </form>
        </div>
      ) : null}

      {activeTab === 'rendering' ? (
        <div className="space-y-6">
          <div className={cardCls}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--fog)]/50">{t('livechat.skillOverrides')}</p>
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-[12px] text-[var(--fog)]">{t('livechat.showSkillStatus')}</p>
              <div className="flex items-center gap-2 rounded-full border border-black/[0.06] bg-black/[0.02] px-3 py-1.5">
                <span className="text-[11px] font-medium text-[var(--fog)]">{t('livechat.showSkillStatus')}</span>
                <button onClick={() => setConfig((current) => ({ ...current, showSkillStatus: !current.showSkillStatus }))} className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${config.showSkillStatus ? 'bg-indigo' : 'bg-black/[0.08]'}`}>
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${config.showSkillStatus ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                </button>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-[26px] border border-black/[0.06] bg-white/72 shadow-[0_16px_36px_rgba(21,23,25,0.05)]">
            <div className="flex items-center justify-between border-b border-black/[0.05] px-5 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--fog)]/50">{t('livechat.momentPreview')}</p>
              <span className="text-[10px] text-[var(--fog)]/60">{selectedMomentLabel || (isZh ? '选择预设' : 'Select a preset')}</span>
            </div>
            <div className="p-4">
              <div className="mb-3 flex flex-wrap gap-2">
                {MOMENT_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => loadMomentPreset(preset)}
                    className={`rounded-lg border px-2.5 py-1 text-[11px] transition-colors ${selectedMomentLabel === preset.label ? 'border-indigo/30 bg-indigo/[0.06] text-indigo' : 'border-black/[0.06] text-[var(--fog)] hover:border-black/[0.1]'}`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="h-[420px] overflow-hidden rounded-xl border border-black/[0.06] bg-gray-50">
                {momentPreviewUrl ? (
                  <iframe key={momentPreviewUrl} src={momentPreviewUrl} className="h-full w-full border-0" title="Moment Preview" />
                ) : (
                  <div className="flex h-full items-center justify-center text-[12px] text-[var(--fog)]">{t('livechat.momentPreviewEmpty')}</div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === 'routing' ? (
        <div className={`max-w-2xl space-y-4 ${cardCls}`}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--fog)]/50">{isZh ? '路由' : 'Routing'}</p>
          <div>
            <label className={labelCls}>{t('livechat.transferGroup')}</label>
            <select
              className={inputCls}
              value={config.transferGroupId ?? ''}
              onChange={(event) => setConfig((current) => ({ ...current, transferGroupId: event.target.value ? Number(event.target.value) : undefined }))}
            >
              <option value="">{groups.length === 0 ? t('livechat.loadingGroups') : t('livechat.defaultQueue')}</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}{group.agents_count > 0 ? ` (${group.agents_count} agents)` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      {activeTab === 'handoff' ? (
        <div className="max-w-3xl space-y-4">
          <section className={cardCls}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--fog)]/50">{t('livechat.escalationStrategy')}</p>
            <p className="mt-2 text-[12px] leading-relaxed text-[var(--fog)]">{t('livechat.escalationDesc')}</p>
            <div className="mt-4">
              <label className={labelCls}>{t('livechat.transferMessage')}</label>
              <textarea
                className={inputCls}
                rows={3}
                value={config.transferMessage ?? ''}
                onChange={(event) => setConfig((current) => ({ ...current, transferMessage: event.target.value || undefined }))}
                placeholder={isZh ? '正在为您转接人工客服，请稍候...' : 'Transferring you to a human agent, please wait...'}
              />
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--fog)]/70">{t('livechat.transferMessageHint')}</p>
            </div>
          </section>

          <section className={cardCls}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--fog)]/50">{t('livechat.failureMessages')}</p>
            <p className="mt-2 text-[12px] leading-relaxed text-[var(--fog)]">{t('livechat.failureMessagesHint')}</p>
            <div className="mt-4 grid gap-4">
              <div>
                <label className={labelCls}>{t('livechat.failureMessage.engineUnreachable')}</label>
                <textarea
                  className={inputCls}
                  rows={2}
                  value={config.failureMessages?.engine_unreachable ?? ''}
                  onChange={(event) => updateFailureMessage('engine_unreachable', event.target.value)}
                  placeholder={isZh ? '服务暂时不可用，请稍后重试。' : 'Service is temporarily unavailable. Please try again shortly.'}
                />
              </div>
              <div>
                <label className={labelCls}>{t('livechat.failureMessage.streamTruncated')}</label>
                <textarea
                  className={inputCls}
                  rows={2}
                  value={config.failureMessages?.stream_truncated ?? ''}
                  onChange={(event) => updateFailureMessage('stream_truncated', event.target.value)}
                  placeholder={isZh ? '回复被中断了，请重新发送一次。' : 'Sorry, the response was interrupted. Please resend your message.'}
                />
              </div>
              <div>
                <label className={labelCls}>{t('livechat.failureMessage.actionFailed')}</label>
                <textarea
                  className={inputCls}
                  rows={2}
                  value={config.failureMessages?.action_failed ?? ''}
                  onChange={(event) => updateFailureMessage('action_failed', event.target.value)}
                  placeholder={isZh ? '处理时遇到技术问题，请稍后重试或联系人工。' : 'A technical issue occurred. Please try again or contact support.'}
                />
              </div>
            </div>
          </section>
        </div>
      ) : null}

      <div className="mt-8 flex items-center justify-between border-t border-black/[0.05] pt-4">
        <button
          onClick={handleReset}
          className="flex items-center gap-1.5 rounded-xl border border-black/[0.08] px-4 py-2.5 text-[12px] font-medium text-[var(--fog)] transition-all hover:border-black/[0.15]"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {t('livechat.reset')}
        </button>
        <div className="flex items-center gap-2 rounded-xl border border-black/[0.06] bg-white/60 px-3 py-2">
          {saveState === 'syncing' ? (
            <>
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-amber/30 border-t-amber" />
              <span className="text-[11px] font-medium text-amber">{t('livechat.saveSaving')}</span>
            </>
          ) : saveState === 'error' ? (
            <>
              <AlertCircle className="h-3 w-3 text-vermillion" />
              <span className="text-[11px] font-medium text-vermillion">{t('livechat.saveFailed')}</span>
            </>
          ) : saveState === 'saved' ? (
            <>
              <CheckCircle2 className="h-3 w-3 text-malachite" />
              <span className="text-[11px] font-medium text-malachite">{t('livechat.saved')}</span>
            </>
          ) : (
            <>
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--fog)]/35" />
              <span className="text-[11px] font-medium text-[var(--fog)]">{t('livechat.stateUnconfigured')}</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
