'use client'

// Agent Config — edit system prompt, model, policy hooks

import { useState, useEffect, useCallback } from 'react'

interface AgentConfigData {
  model: string
  temperature: number
  thinkingBudget: number
  maxIterations: number
  systemPrompt: string
  toolParallelism: boolean
  isConcurrencySafe: boolean
  memoryStrategy: string
  policyHooks: string
}

const MODELS = [
  'claude-sonnet-4-20250514',
  'claude-opus-4-20250514',
  'claude-haiku-4-5-20251001',
  'MiniMax-M2.70-highspeed',
]

export default function AgentConfigPage() {
  const [config, setConfig] = useState<AgentConfigData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/admin/agent')
      .then((r) => r.json())
      .then((d) => {
        if (d.config) setConfig(d.config)
        else {
          // Use defaults
          setConfig({
            model: 'claude-sonnet-4-20250514',
            temperature: 0.5,
            thinkingBudget: 4096,
            maxIterations: 20,
            systemPrompt: '',
            toolParallelism: true,
            isConcurrencySafe: true,
            memoryStrategy: '{}',
            policyHooks: '{}',
          })
        }
      })
      .finally(() => setLoading(false))
  }, [])

  const handleSave = useCallback(async () => {
    if (!config) return
    setSaving(true)
    setSaved(false)
    try {
      await fetch('/api/admin/agent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      setSaved(true)
    } catch { /* ignore */ } finally {
      setSaving(false)
    }
  }, [config])

  const update = useCallback((field: string, value: unknown) => {
    setConfig((prev) => prev ? { ...prev, [field]: value } : null)
    setSaved(false)
  }, [])

  if (loading || !config) {
    return <div className="flex items-center justify-center h-full"><p className="text-fog/40 animate-breathe">Loading…</p></div>
  }

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[16px] font-medium text-mist">Agent Config</h2>
          <p className="text-[12px] text-fog/40 mt-0.5">System prompt, model, and loop parameters</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className={`px-5 py-2 rounded-lg text-[13px] font-medium transition-all duration-200 ${
            saved ? 'bg-malachite/20 border border-malachite/30 text-malachite'
            : 'bg-indigo/20 border border-indigo/30 text-indigo hover:bg-indigo/30'
          } disabled:opacity-50`}
        >
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
        </button>
      </div>

      {/* Model & params */}
      <section className="glass-admin rounded-lg p-4 space-y-4">
        <h3 className="text-[11px] font-sans tracking-[0.05em] uppercase text-fog/40">Model &amp; Parameters</h3>
        <div className="grid grid-cols-2 gap-4">
          <label className="space-y-1">
            <span className="text-[11px] text-fog/50">Model</span>
            <select value={config.model} onChange={(e) => update('model', e.target.value)}
              className="w-full bg-white/[0.03] border border-white/[0.06] rounded text-[13px] text-mist py-2 px-2 outline-none focus:border-indigo/30 transition-all">
              {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-fog/50">Temperature ({config.temperature})</span>
            <input type="range" min="0" max="1" step="0.1" value={config.temperature}
              onChange={(e) => update('temperature', parseFloat(e.target.value))}
              className="w-full accent-indigo" />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-fog/50">Thinking Budget (tokens)</span>
            <input type="number" value={config.thinkingBudget}
              onChange={(e) => update('thinkingBudget', parseInt(e.target.value) || 0)}
              className="w-full bg-white/[0.03] border border-white/[0.06] rounded text-[13px] text-mist py-2 px-2 outline-none focus:border-indigo/30 transition-all font-mono" />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-fog/50">Max Iterations</span>
            <input type="number" value={config.maxIterations}
              onChange={(e) => update('maxIterations', parseInt(e.target.value) || 1)}
              className="w-full bg-white/[0.03] border border-white/[0.06] rounded text-[13px] text-mist py-2 px-2 outline-none focus:border-indigo/30 transition-all font-mono" />
          </label>
        </div>
        <div className="flex gap-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={config.toolParallelism} onChange={(e) => update('toolParallelism', e.target.checked)}
              className="accent-indigo" />
            <span className="text-[12px] text-fog/60">Tool Parallelism</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={config.isConcurrencySafe} onChange={(e) => update('isConcurrencySafe', e.target.checked)}
              className="accent-indigo" />
            <span className="text-[12px] text-fog/60">Concurrency Safe (default)</span>
          </label>
        </div>
      </section>

      {/* System Prompt */}
      <section className="glass-admin rounded-lg p-4 space-y-3">
        <h3 className="text-[11px] font-sans tracking-[0.05em] uppercase text-fog/40">System Prompt</h3>
        <textarea
          value={config.systemPrompt}
          onChange={(e) => update('systemPrompt', e.target.value)}
          rows={20}
          className="w-full bg-white/[0.03] border border-white/[0.06] rounded-lg text-[13px] text-mist/90 py-2.5 px-3 outline-none focus:border-indigo/30 transition-all font-mono resize-y leading-relaxed"
          placeholder="Enter system prompt..."
        />
      </section>

      {/* Memory Strategy */}
      <section className="glass-admin rounded-lg p-4 space-y-3">
        <h3 className="text-[11px] font-sans tracking-[0.05em] uppercase text-fog/40">Memory Strategy</h3>
        <textarea
          value={config.memoryStrategy}
          onChange={(e) => update('memoryStrategy', e.target.value)}
          rows={10}
          className="w-full bg-white/[0.03] border border-white/[0.06] rounded-lg text-[12px] text-mist/80 py-2 px-3 outline-none focus:border-indigo/30 transition-all font-mono resize-y"
        />
        <p className="text-[10px] text-fog/30">JSON: l1MaxMessages, autocompactThresholdTokens, enableSnip, enableMicrocompact, etc.</p>
      </section>

      {/* Policy Hooks */}
      <section className="glass-admin rounded-lg p-4 space-y-3">
        <h3 className="text-[11px] font-sans tracking-[0.05em] uppercase text-fog/40">Policy Hooks</h3>
        <textarea
          value={config.policyHooks}
          onChange={(e) => update('policyHooks', e.target.value)}
          rows={6}
          className="w-full bg-white/[0.03] border border-white/[0.06] rounded-lg text-[12px] text-mist/80 py-2 px-3 outline-none focus:border-indigo/30 transition-all font-mono resize-y"
        />
        <p className="text-[10px] text-fog/30">JSON: {`{ "preTool": ["no_high_risk"], "postTool": [], "preFinalize": ["must_cite_basis"] }`}</p>
      </section>
    </div>
  )
}
