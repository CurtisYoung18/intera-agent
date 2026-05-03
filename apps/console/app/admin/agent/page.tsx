'use client'

import { useState, useEffect, useCallback } from 'react'
import { Bot, Save } from 'lucide-react'
import GlassCard from '@/components/ui/glass-card'
import { Skeleton } from '@/components/ui/skeleton'

interface AgentConfigData {
  model: string; temperature: number; thinkingBudget: number
  maxIterations: number; systemPrompt: string; toolParallelism: boolean
  isConcurrencySafe: boolean; memoryStrategy: string; policyHooks: string
}

const MODELS = ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-haiku-4-5-20251001', 'MiniMax-M2.70-highspeed']

export default function AgentConfigPage() {
  const [config, setConfig] = useState<AgentConfigData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/admin/agent').then(r => r.json()).then(d => {
      setConfig(d.config || { model: 'claude-sonnet-4-20250514', temperature: 0.5, thinkingBudget: 4096, maxIterations: 20, systemPrompt: '', toolParallelism: true, isConcurrencySafe: true, memoryStrategy: '{}', policyHooks: '{}' })
    }).finally(() => setLoading(false))
  }, [])

  const handleSave = useCallback(async () => {
    if (!config) return
    setSaving(true); setSaved(false)
    await fetch('/api/admin/agent', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) })
    fetch('/api/admin/config-changed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerId: 'default' }) }).catch(() => {})
    setSaved(true); setSaving(false)
  }, [config])

  const update = useCallback((field: string, value: unknown) => {
    setConfig(prev => prev ? { ...prev, [field]: value } : null)
    setSaved(false)
  }, [])

  if (loading || !config) return <div className="p-8 space-y-5 max-w-3xl"><Skeleton className="h-6 w-48" /><Skeleton className="h-32 w-full" /><Skeleton className="h-32 w-full" /></div>

  return (
    <div className="max-w-3xl mx-auto px-8 py-8 animate-fade-up space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-[18px] font-semibold text-primary tracking-[-0.01em]">Agent Config</h1>
          <p className="text-[13px] text-secondary mt-1">System prompt, model selection, and loop parameters</p>
        </div>
        <button onClick={handleSave} disabled={saving}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-300 ${
            saved ? 'bg-malachite/[0.08] border border-malachite/20 text-malachite'
            : 'bg-indigo/[0.08] border border-indigo/20 text-indigo hover:bg-indigo/[0.15] hover:shadow-glow-blue'
          } disabled:opacity-50`}>
          <Save className="w-4 h-4" />{saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
        </button>
      </div>

      {/* Model & Parameters */}
      <GlassCard className="p-5 space-y-4">
        <h3 className="text-[11px] font-sans tracking-[0.08em] uppercase text-muted/50">Model & Parameters</h3>
        <div className="grid grid-cols-2 gap-4">
          <label className="space-y-1.5"><span className="text-[11px] text-muted">Model</span>
            <select value={config.model} onChange={e => update('model', e.target.value)}
              className="glass-input-console text-[13px] font-mono">
              {MODELS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="space-y-1.5"><span className="text-[11px] text-muted">Temperature ({config.temperature})</span>
            <input type="range" min="0" max="1" step="0.1" value={config.temperature} onChange={e => update('temperature', parseFloat(e.target.value))} className="w-full accent-indigo" />
          </label>
          <label className="space-y-1.5"><span className="text-[11px] text-muted">Thinking Budget</span>
            <input type="number" value={config.thinkingBudget} onChange={e => update('thinkingBudget', parseInt(e.target.value) || 0)} className="glass-input-console text-[13px] font-mono" />
          </label>
          <label className="space-y-1.5"><span className="text-[11px] text-muted">Max Iterations</span>
            <input type="number" value={config.maxIterations} onChange={e => update('maxIterations', parseInt(e.target.value) || 1)} className="glass-input-console text-[13px] font-mono" />
          </label>
        </div>
        <div className="flex gap-6">
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={config.toolParallelism} onChange={e => update('toolParallelism', e.target.checked)} className="accent-indigo rounded" /><span className="text-[12px] text-secondary">Tool Parallelism</span></label>
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={config.isConcurrencySafe} onChange={e => update('isConcurrencySafe', e.target.checked)} className="accent-indigo rounded" /><span className="text-[12px] text-secondary">Concurrency Safe</span></label>
        </div>
      </GlassCard>

      {/* System Prompt */}
      <GlassCard className="p-5 space-y-3" glow>
        <h3 className="text-[11px] font-sans tracking-[0.08em] uppercase text-muted/50">System Prompt</h3>
        <textarea value={config.systemPrompt} onChange={e => update('systemPrompt', e.target.value)} rows={18}
          className="glass-input-console text-[13px] leading-relaxed font-mono resize-y" placeholder="Enter system prompt…" />
      </GlassCard>

      {/* Memory Strategy */}
      <GlassCard className="p-5 space-y-3">
        <h3 className="text-[11px] font-sans tracking-[0.08em] uppercase text-muted/50">Memory Strategy</h3>
        <textarea value={config.memoryStrategy} onChange={e => update('memoryStrategy', e.target.value)} rows={8}
          className="glass-input-console text-[12px] font-mono resize-y" />
        <p className="text-[10px] text-muted">JSON: l1MaxMessages, autocompactThresholdTokens, enableSnip, enableMicrocompact, etc.</p>
      </GlassCard>

      {/* Policy Hooks */}
      <GlassCard className="p-5 space-y-3">
        <h3 className="text-[11px] font-sans tracking-[0.08em] uppercase text-muted/50">Policy Hooks</h3>
        <textarea value={config.policyHooks} onChange={e => update('policyHooks', e.target.value)} rows={5}
          className="glass-input-console text-[12px] font-mono resize-y" />
        <p className="text-[10px] text-muted">JSON: preTool / postTool / preFinalize string arrays</p>
      </GlassCard>
    </div>
  )
}
