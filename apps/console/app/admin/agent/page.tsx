'use client'

import { useState, useEffect, useCallback } from 'react'
import { Bot, Save } from 'lucide-react'
import GlassCard from '@/components/ui/glass-card'
import { Skeleton } from '@/components/ui/skeleton'
import HoverTooltip from '@/components/ui/tooltip'

interface MemoryStrategy {
  // Retention
  l1MaxMessages: number
  l2SummaryMaxTokens: number
  l4MaxHistoricalCases: number
  keyEventExtractionPrompt: string
  maxRecentTraces: number
  caseRetentionDays: number
  // Thresholds
  autocompactThresholdTokens: number
  warningThresholdTokens: number
  errorThresholdTokens: number
  blockingThresholdTokens: number
  // Features
  compactModel: string
  enableAutocompact: boolean
  enableMicrocompact: boolean
  enableContextCollapse: boolean
  enableSnip: boolean
  // Compaction fine-tuning
  compactMaxMessages: number
  compactTemperature: number
  compactMaxTokensCap: number
  compactMinSummaryLength: number
  compactionKeepMin: number
  compactionKeepRatio: number
  compactableTools: string[]
  // Fact extraction
  txnIdPattern: string
  amountPattern: string
  notReceivedKeywords: string[]
  keyEventMaxChars: number
  // Token estimation
  tokensPerKeyEvent: number
  tokensPerFact: number
  tokensPerSkill: number
  cjkCharPerToken: number
  latinCharPerToken: number
  minTokenEstimate: number
  toolResultTokenRatio: number
  // Advanced
  compactPrompt: string
  contextWindow: number
  outputTokensReserved: number
  maxKeyEventsAfterCompact: number
  compactCircuitBreakerMaxFailures: number
  sessionMemoryMaxAgeMs: number
}

const DEFAULT_MEMORY: MemoryStrategy = {
  l1MaxMessages: 12, l2SummaryMaxTokens: 2000, l4MaxHistoricalCases: 5,
  keyEventExtractionPrompt: 'Extract key events from the conversation',
  maxRecentTraces: 20, caseRetentionDays: 90,
  autocompactThresholdTokens: 13000, warningThresholdTokens: 20000,
  errorThresholdTokens: 20000, blockingThresholdTokens: 3000,
  compactModel: 'MiniMax-M2.5-highspeed',
  enableAutocompact: true, enableMicrocompact: true,
  enableContextCollapse: true, enableSnip: true,
  compactMaxMessages: 40, compactTemperature: 0.3, compactMaxTokensCap: 4096,
  compactMinSummaryLength: 20, compactionKeepMin: 4, compactionKeepRatio: 0.4,
  compactableTools: ['query_order_status','query_payment_channel_status','search_delay_notice','read_case_history','kb_hybrid_retrieve','ocr_receipt'],
  txnIdPattern: 'TX[Uu]?\\d+|[A-Z]{2,6}\\d{8,}',
  amountPattern: '(\\d+\\.?\\d*)\\s*(元|USD|EUR|JPY|₩|¥|\\$)',
  notReceivedKeywords: ['未到账','没到账','没收到','not received','not credited','missing','未入金'],
  keyEventMaxChars: 100,
  tokensPerKeyEvent: 20, tokensPerFact: 15, tokensPerSkill: 30,
  cjkCharPerToken: 1.2, latinCharPerToken: 3, minTokenEstimate: 100, toolResultTokenRatio: 3,
  compactPrompt: '',
  contextWindow: 200000, outputTokensReserved: 20000,
  maxKeyEventsAfterCompact: 5, compactCircuitBreakerMaxFailures: 3, sessionMemoryMaxAgeMs: 1800000,
}

interface AgentConfigData {
  model: string; temperature: number; thinkingBudget: number
  maxIterations: number; maxOutputTokens: number; systemPrompt: string; toolParallelism: boolean
  isConcurrencySafe: boolean; showThinking: boolean
  memoryStrategy: MemoryStrategy; policyHooks: string
  resumePrompt: string; formResponseTemplate: string
}

interface ModelInfo { id: string; name: string; provider: string; providerLabel: string }

// ── Toggle ──────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="relative inline-flex items-center cursor-pointer">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="sr-only peer" />
      <span className={`
        w-10 h-5 rounded-full transition-colors duration-200 ease-out
        peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--border-focus)]
        ${checked ? 'bg-indigo/[0.25]' : 'bg-[var(--bg-input)]'}
        after:content-[''] after:absolute after:top-[2px] after:left-[2px]
        after:w-4 after:h-4 after:rounded-full after:transition-all after:duration-200
        ${checked ? 'after:translate-x-5 after:bg-indigo' : 'after:translate-x-0 after:bg-[var(--text-muted)]'}
      `} />
    </label>
  )
}

// ── Number input with unit label ────────────────────────────

function NumField({ label, tooltip, value, onChange, unit, min, max, step }: {
  label: string; tooltip: string; value: number; onChange: (v: number) => void
  unit: string; min?: number; max?: number; step?: number
}) {
  return (
    <label className="space-y-1">
      <HoverTooltip content={tooltip}>
        <span className="text-[11px] text-muted cursor-help border-b border-dotted border-[var(--border-hover)]">{label}</span>
      </HoverTooltip>
      <div className="flex items-center gap-2">
        <input type="number" value={value} onChange={e => onChange(parseFloat(e.target.value) || 0)}
          min={min} max={max} step={step}
          className="glass-input-console text-[13px] font-mono w-28" />
        <span className="text-[10px] text-muted">{unit}</span>
      </div>
    </label>
  )
}

// ── Main Page ───────────────────────────────────────────────

export default function AgentConfigPage() {
  const [config, setConfig] = useState<AgentConfigData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([])
  const [mainModels, setMainModels] = useState<string[]>([])

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/agent').then(r => r.json()),
      fetch('/api/admin/models').then(r => r.json()),
    ]).then(([agentData, modelsData]) => {
      const raw = agentData.config || {}
      let memoryStrategy = DEFAULT_MEMORY
      let policyHooks = '{}'
      try {
        const parsed = typeof raw.memoryStrategy === 'string' ? JSON.parse(raw.memoryStrategy || '{}') : (raw.memoryStrategy || {})
        memoryStrategy = { ...DEFAULT_MEMORY, ...parsed }
        if (typeof memoryStrategy.notReceivedKeywords === 'string') {
          memoryStrategy.notReceivedKeywords = (memoryStrategy.notReceivedKeywords as unknown as string).split(',').map(s => s.trim())
        }
        if (typeof memoryStrategy.compactableTools === 'string') {
          memoryStrategy.compactableTools = (memoryStrategy.compactableTools as unknown as string).split(',').map(s => s.trim())
        }
      } catch { /* use default */ }
      try { policyHooks = typeof raw.policyHooks === 'string' ? raw.policyHooks : JSON.stringify(raw.policyHooks || {}) } catch {}
      setConfig({
        model: raw.model || 'MiniMax-M2.70-highspeed', temperature: raw.temperature ?? 0.5,
        thinkingBudget: raw.thinkingBudget ?? 4096, maxIterations: raw.maxIterations ?? 20,
        maxOutputTokens: raw.maxOutputTokens ?? 4096,
        systemPrompt: raw.systemPrompt || '', toolParallelism: raw.toolParallelism ?? true,
        isConcurrencySafe: raw.isConcurrencySafe ?? true, showThinking: raw.showThinking ?? false,
        memoryStrategy, policyHooks,
        resumePrompt: raw.resumePrompt || '',
        formResponseTemplate: raw.formResponseTemplate || '',
      })
      setAvailableModels(modelsData.models || [])
      setMainModels((modelsData.models || []).map((m: ModelInfo) => m.id))
    }).finally(() => setLoading(false))
  }, [])

  const handleSave = useCallback(async () => {
    if (!config) return
    setSaving(true); setSaved(false)
    await fetch('/api/admin/agent', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...config, memoryStrategy: JSON.stringify(config.memoryStrategy) }) })
    try {
      await fetch('/api/admin/config-changed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerId: 'default' }) })
    } catch { /* non-critical — cache will expire via TTL */ }
    setSaved(true); setSaving(false)
  }, [config])

  const update = useCallback((field: string, value: unknown) => {
    setConfig(prev => prev ? { ...prev, [field]: value } : null); setSaved(false)
  }, [])

  const updateMem = useCallback((field: keyof MemoryStrategy, value: unknown) => {
    setConfig(prev => prev ? { ...prev, memoryStrategy: { ...prev.memoryStrategy, [field]: value } } : null); setSaved(false)
  }, [])

  if (loading || !config) return (
    <div className="p-8 space-y-5 max-w-3xl"><Skeleton className="h-6 w-48" /><Skeleton className="h-32 w-full" /><Skeleton className="h-32 w-full" /></div>
  )

  const ms = config.memoryStrategy

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
          <label className="space-y-1.5"><span className="text-[11px] text-muted">Main Model</span>
            <select value={config.model} onChange={e => update('model', e.target.value)} className="glass-input-console text-[13px] font-mono">
              {mainModels.map(m => <option key={m} value={m}>{m}</option>)}
              {mainModels.length === 0 && <option value={config.model}>{config.model}</option>}
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
          <label className="space-y-1.5"><span className="text-[11px] text-muted">Max Output Tokens</span>
            <input type="number" value={config.maxOutputTokens} onChange={e => update('maxOutputTokens', parseInt(e.target.value) || 4096)} className="glass-input-console text-[13px] font-mono" />
          </label>
        </div>
        <div className="flex gap-6 flex-wrap">
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={config.toolParallelism} onChange={e => update('toolParallelism', e.target.checked)} className="accent-indigo rounded" /><span className="text-[12px] text-secondary">Tool Parallelism</span></label>
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={config.isConcurrencySafe} onChange={e => update('isConcurrencySafe', e.target.checked)} className="accent-indigo rounded" /><span className="text-[12px] text-secondary">Concurrency Safe</span></label>
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={config.showThinking} onChange={e => update('showThinking', e.target.checked)} className="accent-indigo rounded" /><span className="text-[12px] text-secondary">Show Thinking</span></label>
        </div>
      </GlassCard>

      {/* System Prompt */}
      <GlassCard className="p-5 space-y-3" glow>
        <h3 className="text-[11px] font-sans tracking-[0.08em] uppercase text-muted/50">System Prompt</h3>
        <textarea value={config.systemPrompt} onChange={e => update('systemPrompt', e.target.value)} rows={18}
          className="glass-input-console text-[13px] leading-relaxed font-mono resize-y" placeholder="Enter system prompt…" />
      </GlassCard>

      {/* Resume & Form Templates */}
      <GlassCard className="p-5 space-y-3">
        <h3 className="text-[11px] font-sans tracking-[0.08em] uppercase text-muted/50">Resume &amp; Form Templates</h3>
        <p className="text-[10px] text-muted">Customize the synthetic messages injected when a human task is resolved or a form is submitted. These templates control how the agent interprets operator notes and user form responses.</p>
        <label className="space-y-1.5 block">
          <HoverTooltip content="Template for the synthetic user message injected when a human task is resolved. The agent sees this as instructions on how to communicate the resolution to the customer. Use {verdict}, {reason}, {taskId} as placeholders.">
            <span className="text-[11px] text-muted cursor-help border-b border-dotted border-[var(--border-hover)]">Resume Prompt (after human task resolved)</span>
          </HoverTooltip>
          <textarea value={config.resumePrompt} onChange={e => update('resumePrompt', e.target.value)} rows={8}
            className="glass-input-console text-[12px] font-mono resize-y" placeholder="Empty = use built-in default…" />
        </label>
        <label className="space-y-1.5 block">
          <HoverTooltip content="Template for the synthetic user message injected when a customer submits a form. The agent uses this to understand how form field values map to case facts.">
            <span className="text-[11px] text-muted cursor-help border-b border-dotted border-[var(--border-hover)]">Form Response Template</span>
          </HoverTooltip>
          <textarea value={config.formResponseTemplate} onChange={e => update('formResponseTemplate', e.target.value)} rows={4}
            className="glass-input-console text-[12px] font-mono resize-y" placeholder="Empty = use built-in default…" />
        </label>
      </GlassCard>

      {/* ── Thresholds ──────────────────────────────────────── */}
      <GlassCard className="p-5 space-y-3">
        <h3 className="text-[11px] font-sans tracking-[0.08em] uppercase text-muted/50">Memory Strategy — Thresholds</h3>
        <div className="grid grid-cols-2 gap-3">
          <NumField label="Auto-compact Threshold" unit="tokens" value={ms.autocompactThresholdTokens}
            onChange={v => updateMem('autocompactThresholdTokens', v)}
            tooltip="When remaining context tokens drop below this value, automatic compaction triggers. checkAndCompact() compares estimatedMessageTokens against effectiveContextWindow - this threshold. Recommended: 10000–15000." />
          <NumField label="Warning Threshold" unit="tokens" value={ms.warningThresholdTokens}
            onChange={v => updateMem('warningThresholdTokens', v)}
            tooltip="When remaining tokens drop below this, a console.warn is emitted. Does NOT trigger compaction — purely informational. assessCompaction() sets isWarning=true. Should be > autocompact threshold. Recommended: 18000–25000." />
          <NumField label="Blocking Threshold" unit="tokens" value={ms.blockingThresholdTokens}
            onChange={v => updateMem('blockingThresholdTokens', v)}
            tooltip="Hard safety cutoff — when context drops below this, compaction is FORCED. Uses circuit breaker (3 consecutive failures). assessCompaction() sets isBlocking=true. Must be < autocompact. Recommended: 2000–5000." />
          <NumField label="L2 Summary Max Tokens" unit="tokens" value={ms.l2SummaryMaxTokens}
            onChange={v => updateMem('l2SummaryMaxTokens', v)}
            tooltip="Maximum tokens for the LLM-generated conversation summary. buildApiMessages() truncates summary text to this * 3 chars before prepending. Also used as max_tokens for the compact LLM call. Recommended: 1000–4000." />
        </div>
      </GlassCard>

      {/* ── Compaction Features ─────────────────────────────── */}
      <GlassCard className="p-5 space-y-3">
        <h3 className="text-[11px] font-sans tracking-[0.08em] uppercase text-muted/50">Compaction Features</h3>
        <div className="pb-3 border-b border-[var(--border-subtle)]">
          <label className="space-y-1.5 block">
            <HoverTooltip content="The model used for LLM-driven conversation summarization during compaction. Should be a fast, cheap model. compactConversation() routes to the correct API provider based on model prefix. Uses Anthropic SDK for all providers (MiniMax/DeepSeek both support Anthropic-compatible endpoints).">
              <span className="text-[11px] text-muted cursor-help border-b border-dotted border-[var(--border-hover)]">Compact Model</span>
            </HoverTooltip>
            <select value={ms.compactModel} onChange={e => updateMem('compactModel', e.target.value)} className="glass-input-console text-[13px] font-mono mt-1 w-full max-w-xs">
              {availableModels.map(m => <option key={m.id} value={m.id}>{m.name} ({m.providerLabel})</option>)}
              {availableModels.length === 0 && <option value={ms.compactModel}>{ms.compactModel}</option>}
            </select>
          </label>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          <label className="flex items-center justify-between gap-3">
            <HoverTooltip content="Master switch for ALL automatic compaction. When OFF, checkAndCompact() returns { shouldCompact: false } immediately. Use to debug compaction issues. Implementation: first check in checkAndCompact().">
              <span className="text-[11px] text-muted cursor-help border-b border-dotted border-[var(--border-hover)]">Enable Auto Compact</span>
            </HoverTooltip>
            <Toggle checked={ms.enableAutocompact} onChange={v => updateMem('enableAutocompact', v)} />
          </label>
          <label className="flex items-center justify-between gap-3">
            <HoverTooltip content="Scans messages for tool results from compactable tools (defined in compactableTools list) and replaces content with placeholder. Frees tokens WITHOUT losing case state. Zero API cost. Implementation: microCompact() in microCompact.ts, called before token assessment.">
              <span className="text-[11px] text-muted cursor-help border-b border-dotted border-[var(--border-hover)]">Enable Micro Compact</span>
            </HoverTooltip>
            <Toggle checked={ms.enableMicrocompact} onChange={v => updateMem('enableMicrocompact', v)} />
          </label>
          <label className="flex items-center justify-between gap-3">
            <HoverTooltip content="When enabled, assessCompaction() may return shouldCompact=true. When OFF, assessCompaction() ALWAYS returns shouldCompact=false — messages are never trimmed. Use to retain full history regardless of token budget.">
              <span className="text-[11px] text-muted cursor-help border-b border-dotted border-[var(--border-hover)]">Enable Context Collapse</span>
            </HoverTooltip>
            <Toggle checked={ms.enableContextCollapse} onChange={v => updateMem('enableContextCollapse', v)} />
          </label>
          <label className="flex items-center justify-between gap-3">
            <HoverTooltip content="When enabled, compaction physically removes old messages from the array. When OFF, recordCompaction() still generates a summary but leaves messages intact. Implementation: gated in both blocking and auto compaction paths of checkAndCompact().">
              <span className="text-[11px] text-muted cursor-help border-b border-dotted border-[var(--border-hover)]">Enable Snip</span>
            </HoverTooltip>
            <Toggle checked={ms.enableSnip} onChange={v => updateMem('enableSnip', v)} />
          </label>
        </div>
      </GlassCard>

      {/* ── Retention ───────────────────────────────────────── */}
      <GlassCard className="p-5 space-y-3">
        <h3 className="text-[11px] font-sans tracking-[0.08em] uppercase text-muted/50">Retention</h3>
        <div className="grid grid-cols-2 gap-3">
          <NumField label="L1 Max Messages" unit="messages" value={ms.l1MaxMessages}
            onChange={v => updateMem('l1MaxMessages', v)}
            tooltip="Maximum recent messages kept in the L1 context window. buildApiMessages() uses l1MaxMessages * 2 as the slice limit. Higher = agent sees more history. Recommended: 8–20." />
          <NumField label="L4 Max Historical Cases" unit="cases" value={ms.l4MaxHistoricalCases}
            onChange={v => updateMem('l4MaxHistoricalCases', v)}
            tooltip="Maximum historical cases loaded for context when detecting a repeat customer. Queried from Case table when building system prompt. Recommended: 3–10." />
          <NumField label="Max Recent Traces" unit="entries" value={ms.maxRecentTraces}
            onChange={v => updateMem('maxRecentTraces', v)}
            tooltip="Maximum ActionTrace entries retained in memory. Used for debugging and audit via Console /ops/cases/[id]/traces. Older traces pruned during compaction. Recommended: 10–50." />
          <NumField label="Case Retention Days" unit="days" value={ms.caseRetentionDays}
            onChange={v => updateMem('caseRetentionDays', v)}
            tooltip="Days to retain case data before archival. Used by background retention cron jobs. Recommended: 30–365." />
        </div>
      </GlassCard>

      {/* ── Fact Extraction Patterns ────────────────────────── */}
      <GlassCard className="p-5 space-y-3">
        <h3 className="text-[11px] font-sans tracking-[0.08em] uppercase text-muted/50">Fact Extraction Patterns</h3>
        <p className="text-[10px] text-muted">Regular expressions and keyword lists used by ingestUserMessageFacts() to extract case facts from user messages. Customize per region/currency/language.</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <HoverTooltip content="JavaScript RegExp pattern for extracting transaction/payment IDs from user messages. Matched case-insensitively. Example patterns: 'TX[Uu]?\\d+' for TX-prefixed IDs, '[A-Z]{2,6}\\d{8,}' for alphanumeric payment IDs. Implementation: new RegExp(this.strategy.txnIdPattern, 'i').test(message).">
              <span className="text-[11px] text-muted cursor-help border-b border-dotted border-[var(--border-hover)]">TxnId Pattern (RegExp)</span>
            </HoverTooltip>
            <input type="text" value={ms.txnIdPattern}
              onChange={e => updateMem('txnIdPattern', e.target.value)}
              className="glass-input-console text-[12px] font-mono" />
          </label>
          <label className="space-y-1">
            <HoverTooltip content="JavaScript RegExp pattern for extracting amounts and currencies from user messages. First capture group = numeric amount, second capture group = currency symbol/code. Example: '(\\d+\\.?\\d*)\\s*(元|USD|EUR|¥|\\$)' matches '500 元' and '29.99 USD'.">
              <span className="text-[11px] text-muted cursor-help border-b border-dotted border-[var(--border-hover)]">Amount Pattern (RegExp)</span>
            </HoverTooltip>
            <input type="text" value={ms.amountPattern}
              onChange={e => updateMem('amountPattern', e.target.value)}
              className="glass-input-console text-[12px] font-mono" />
          </label>
          <label className="space-y-1 col-span-2">
            <HoverTooltip content="Keywords that indicate a user is reporting a payment NOT received. Joined with | to form a case-insensitive RegExp. Add region/language-specific terms. Example: '未到账' (Chinese), 'not credited' (English), '未入金' (Japanese). Implementation: new RegExp(keywords.join('|'), 'i').test(message).">
              <span className="text-[11px] text-muted cursor-help border-b border-dotted border-[var(--border-hover)]">Not Received Keywords (one per line)</span>
            </HoverTooltip>
            <textarea value={ms.notReceivedKeywords.join('\n')}
              onChange={e => updateMem('notReceivedKeywords', e.target.value.split('\n').filter(Boolean) as any)}
              rows={4} className="glass-input-console text-[12px] font-mono resize-y" />
          </label>
          <NumField label="Key Event Max Chars" unit="chars" value={ms.keyEventMaxChars}
            onChange={v => updateMem('keyEventMaxChars', v)}
            tooltip="Maximum characters for a key event text extracted from user messages. Longer messages are truncated: message.slice(0, keyEventMaxChars). Recommended: 80–200." />
        </div>
      </GlassCard>

      {/* ── Token Estimation ────────────────────────────────── */}
      <GlassCard className="p-5 space-y-3">
        <h3 className="text-[11px] font-sans tracking-[0.08em] uppercase text-muted/50">Token Estimation</h3>
        <p className="text-[10px] text-muted">Parameters controlling estimateTokens() accuracy. These ratios determine when compaction triggers — adjust if the model's actual token usage diverges from estimates.</p>
        <div className="grid grid-cols-3 gap-3">
          <NumField label="Tokens/Key Event" unit="" value={ms.tokensPerKeyEvent}
            onChange={v => updateMem('tokensPerKeyEvent', v)} step={1}
            tooltip="Estimated tokens consumed per key event entry in memory metadata. Used in: tokens += keyEvents.length * tokensPerKeyEvent." />
          <NumField label="Tokens/Fact" unit="" value={ms.tokensPerFact}
            onChange={v => updateMem('tokensPerFact', v)} step={1}
            tooltip="Estimated tokens consumed per confirmed fact key-value pair. Used in: tokens += Object.keys(confirmedFacts).length * tokensPerFact." />
          <NumField label="Tokens/Skill" unit="" value={ms.tokensPerSkill}
            onChange={v => updateMem('tokensPerSkill', v)} step={1}
            tooltip="Estimated tokens consumed per skill execution record. Used in: tokens += skillsCalled.length * tokensPerSkill." />
          <NumField label="CJK Chars/Token" unit="chars" value={ms.cjkCharPerToken}
            onChange={v => updateMem('cjkCharPerToken', v)} step={0.1} min={0.5}
            tooltip="CJK (Chinese/Japanese/Korean) characters per token ratio. Used in: Math.ceil(cjkChars / cjkCharPerToken). Lower = over-estimate, Higher = under-estimate. Claude models: ~1.2 chars/token for CJK." />
          <NumField label="Latin Chars/Token" unit="chars" value={ms.latinCharPerToken}
            onChange={v => updateMem('latinCharPerToken', v)} step={0.5} min={1}
            tooltip="Latin/ASCII characters per token ratio. Used in: Math.ceil(otherChars / latinCharPerToken). Claude models: ~3 chars/token for English. GPT models: ~4 chars/token." />
          <NumField label="Min Token Estimate" unit="tokens" value={ms.minTokenEstimate}
            onChange={v => updateMem('minTokenEstimate', v)} step={10}
            tooltip="Minimum token estimate floor. Returns Math.max(minTokenEstimate, calculatedTokens). Prevents zero-token estimates when context is nearly empty." />
          <NumField label="Tool Result Ratio" unit="chars" value={ms.toolResultTokenRatio}
            onChange={v => updateMem('toolResultTokenRatio', v)} step={0.5}
            tooltip="Characters-per-token ratio for tool result content (mostly JSON). Used by microCompact: tokensSaved += Math.ceil(contentLength / toolResultTokenRatio)." />
        </div>
      </GlassCard>

      {/* ── Compaction Fine-tuning ──────────────────────────── */}
      <GlassCard className="p-5 space-y-3">
        <h3 className="text-[11px] font-sans tracking-[0.08em] uppercase text-muted/50">Compaction Fine-tuning</h3>
        <div className="grid grid-cols-2 gap-3">
          <NumField label="Compact Max Messages" unit="messages" value={ms.compactMaxMessages}
            onChange={v => updateMem('compactMaxMessages', v)}
            tooltip="Maximum messages sent to the compact LLM for summarization. Messages are sliced: apiMessages.slice(-compactMaxMessages). Higher = more context but higher API cost. Recommended: 20–60." />
          <NumField label="Compact Temperature" unit="" value={ms.compactTemperature}
            onChange={v => updateMem('compactTemperature', v)} step={0.1} min={0} max={2}
            tooltip="LLM temperature for the compaction call. Lower = more consistent summaries, Higher = more creative. Recommended: 0.2–0.5." />
          <NumField label="Compact Max Tokens Cap" unit="tokens" value={ms.compactMaxTokensCap}
            onChange={v => updateMem('compactMaxTokensCap', v)}
            tooltip="Absolute cap on max_tokens for the compact LLM call: Math.min(l2SummaryMaxTokens, compactMaxTokensCap). Prevents runaway token usage. Recommended: 2048–8192." />
          <NumField label="Min Summary Length" unit="chars" value={ms.compactMinSummaryLength}
            onChange={v => updateMem('compactMinSummaryLength', v)}
            tooltip="Minimum character length for a valid summary. Summaries shorter than this are rejected (treated as compaction failure, falling back to programmatic summary). Recommended: 10–50." />
          <NumField label="Keep Min Messages" unit="messages" value={ms.compactionKeepMin}
            onChange={v => updateMem('compactionKeepMin', v)}
            tooltip="Minimum number of messages to retain after compaction: Math.max(compactionKeepMin, floor(total * compactionKeepRatio)). Recommended: 2–8." />
          <NumField label="Keep Ratio" unit="" value={ms.compactionKeepRatio}
            onChange={v => updateMem('compactionKeepRatio', v)} step={0.05} min={0.1} max={1}
            tooltip="Fraction of messages to retain after compaction. Higher = keep more context, Higher token usage. Recommended: 0.3–0.6." />
        </div>
        <label className="space-y-1.5 block pt-2">
          <HoverTooltip content="List of tool names whose results can be safely cleared by MicroCompact. Non-compactable tools (request_user_input, create_human_task, finalize_case, finalize_consultation) are excluded — their results are critical for the agent. Implementation: microCompact() builds a RegExp from this list to match 'Tool <name> result:' messages.">
            <span className="text-[11px] text-muted cursor-help border-b border-dotted border-[var(--border-hover)]">Compactable Tools (one per line)</span>
          </HoverTooltip>
          <textarea value={ms.compactableTools.join('\n')}
            onChange={e => updateMem('compactableTools', e.target.value.split('\n').map(s => s.trim()).filter(Boolean) as any)}
            rows={4} className="glass-input-console text-[12px] font-mono resize-y" />
        </label>
      </GlassCard>

      {/* ── Advanced ────────────────────────────────────────── */}
      <GlassCard className="p-5 space-y-3">
        <h3 className="text-[11px] font-sans tracking-[0.08em] uppercase text-muted/50">Advanced</h3>
        <div className="grid grid-cols-2 gap-3">
          <NumField label="Context Window" unit="tokens" value={ms.contextWindow}
            onChange={v => updateMem('contextWindow', v)}
            tooltip="Total model context window size. Used in assessCompaction() to calculate available tokens: effectiveContextWindow = contextWindow - outputTokensReserved. Default: 200000 (Claude)." />
          <NumField label="Output Tokens Reserved" unit="tokens" value={ms.outputTokensReserved}
            onChange={v => updateMem('outputTokensReserved', v)}
            tooltip="Tokens reserved for model output, subtracted from context window. Ensures the model always has room to respond. Default: 20000." />
          <NumField label="Max Key Events After Compact" unit="events" value={ms.maxKeyEventsAfterCompact}
            onChange={v => updateMem('maxKeyEventsAfterCompact', v)}
            tooltip="Number of key events to retain after compaction. Older events are trimmed: keyEvents.slice(-N). Default: 5." />
          <NumField label="Circuit Breaker Max Failures" unit="failures" value={ms.compactCircuitBreakerMaxFailures}
            onChange={v => updateMem('compactCircuitBreakerMaxFailures', v)}
            tooltip="Consecutive compaction failures before the circuit breaker trips. Prevents infinite retry loops. Default: 3." />
          <NumField label="Session Memory Max Age" unit="ms" value={ms.sessionMemoryMaxAgeMs}
            onChange={v => updateMem('sessionMemoryMaxAgeMs', v)} step={60000}
            tooltip="Maximum age for session memory reuse before it's considered stale. Default: 1800000 (30 min)." />
        </div>
        <label className="space-y-1.5 block pt-2">
          <HoverTooltip content="System prompt injected when the LLM extracts key events from conversation history. Each event is tagged source:'heuristic' (regex) or source:'llm' (model). Customize for domain-specific event types.">
            <span className="text-[11px] text-muted cursor-help border-b border-dotted border-[var(--border-hover)]">Key Event Extraction Prompt</span>
          </HoverTooltip>
          <textarea value={ms.keyEventExtractionPrompt}
            onChange={e => updateMem('keyEventExtractionPrompt', e.target.value)} rows={3}
            className="glass-input-console text-[12px] font-mono resize-y" />
        </label>
        <label className="space-y-1.5 block">
          <HoverTooltip content="Custom prompt for the LLM-driven compaction summarization call. When empty, the built-in 9-section customer-service prompt is used. Override to customize summary structure for your vertical (finance, e-commerce, gaming, etc.). The prompt should instruct the model to output analysis and summary tags.">
            <span className="text-[11px] text-muted cursor-help border-b border-dotted border-[var(--border-hover)]">Compact Prompt (empty = use built-in)</span>
          </HoverTooltip>
          <textarea value={ms.compactPrompt}
            onChange={e => updateMem('compactPrompt', e.target.value)} rows={8}
            className="glass-input-console text-[12px] font-mono resize-y" placeholder="Leave empty to use the built-in 9-section customer-service prompt…" />
        </label>
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
