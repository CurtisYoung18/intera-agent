'use client'

import { useState, useEffect, useCallback } from 'react'
import { HandPlatter, Save, CheckCircle2, AlertCircle } from 'lucide-react'
import AgentHumanInteractionPanel from '@/components/admin/agent-human-interaction-panel'
import { DEFAULT_CONSULTATION_PROMPT } from '@intera/shared/defaults'
import { useConsoleLocale } from '@/components/locale-provider'
import { chatApiUrl } from '@/lib/chat-api'

interface AgentConfig {
  consultationPrompt: string
  humanSkills: string
}

export default function HumanOpsPage() {
  const { t } = useConsoleLocale()
  const [config, setConfig] = useState<AgentConfig>({
    consultationPrompt: DEFAULT_CONSULTATION_PROMPT,
    humanSkills: '',
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')

  useEffect(() => {
    fetch('/api/admin/agent')
      .then((r) => {
        if (!r.ok) throw new Error(`Config: ${r.status}`)
        return r.json()
      })
      .then((data) => {
        const raw = data.config || {}
        setConfig({
          consultationPrompt: raw.consultationPrompt || DEFAULT_CONSULTATION_PROMPT,
          humanSkills: raw.humanSkills || '',
        })
        setError(null)
      })
      .catch((err: Error) => setError(err.message || 'Failed to load config'))
      .finally(() => setLoading(false))
  }, [])

  const updateConsultationPrompt = useCallback((v: string) => {
    setConfig((prev) => ({ ...prev, consultationPrompt: v }))
  }, [])

  const updateHumanSkills = useCallback((v: string) => {
    setConfig((prev) => ({ ...prev, humanSkills: v }))
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setSaveStatus('idle')
    try {
      const res = await fetch('/api/admin/agent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (!res.ok) throw new Error(`Save: ${res.status}`)

      const cacheBody = JSON.stringify({ customerId: 'default' })
      Promise.allSettled([
        fetch('/api/admin/config-changed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: cacheBody,
        }),
        fetch(chatApiUrl('/api/admin/config-changed'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: cacheBody,
        }),
      ]).catch(() => {})

      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2500)
    } catch {
      setSaveStatus('error')
    } finally {
      setSaving(false)
    }
  }, [config])

  if (loading) {
    return (
      <div className="p-8 text-[13px] text-[var(--fog)]">{t('common.loading')}</div>
    )
  }

  if (error) {
    return (
      <div className="p-8 text-[13px] text-red-500">{error}</div>
    )
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: 'rgba(91,184,247,0.12)' }}
        >
          <HandPlatter className="w-4 h-4" style={{ color: '#5bb8f7' }} />
        </div>
        <div>
          <h1 className="text-[18px] font-bold text-[var(--mist)]">{t('sidebar.humanOps')}</h1>
          <p className="text-[12px] text-[var(--fog)]">{t('agent.section.humanOpsLead')}</p>
        </div>
      </div>

      <AgentHumanInteractionPanel
        consultationPrompt={config.consultationPrompt}
        humanSkills={config.humanSkills}
        onConsultationPromptChange={updateConsultationPrompt}
        onHumanSkillsChange={updateHumanSkills}
      />

      <div className="mt-6 flex items-center justify-end">
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
          {saveStatus === 'saved' ? t('integrations.saved') : saveStatus === 'error' ? t('integrations.saveError') : t('common.save')}
        </button>
      </div>
    </div>
  )
}
