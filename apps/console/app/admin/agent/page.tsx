'use client'

import { useState, useEffect, useCallback } from 'react'
import { Bot, Save } from 'lucide-react'
import GlassCard from '@/components/ui/glass-card'
import { Skeleton } from '@/components/ui/skeleton'
import HoverTooltip from '@/components/ui/tooltip'

interface MemoryStrategy {
  autocompactThresholdTokens: number
  warningThresholdTokens: number
  blockingThresholdTokens: number
  l2SummaryMaxTokens: number
  compactModel: string
  enableAutocompact: boolean
  enableMicrocompact: boolean
  enableContextCollapse: boolean
  enableSnip: boolean
  l1MaxMessages: number
  l4MaxHistoricalCases: number
  maxRecentTraces: number
  caseRetentionDays: number
  keyEventExtractionPrompt: string
}

const DEFAULT_MEMORY: MemoryStrategy = {
  autocompactThresholdTokens: 13000,
  warningThresholdTokens: 20000,
  blockingThresholdTokens: 3000,
  l2SummaryMaxTokens: 2000,
  compactModel: 'MiniMax-M2.5-highspeed',
  enableAutocompact: true,
  enableMicrocompact: true,
  enableContextCollapse: true,
  enableSnip: true,
  l1MaxMessages: 12,
  l4MaxHistoricalCases: 5,
  maxRecentTraces: 20,
  caseRetentionDays: 90,
  keyEventExtractionPrompt: 'Extract key events from the conversation',
}

interface AgentConfigData {
  model: string; temperature: number; thinkingBudget: number
  maxIterations: number; systemPrompt: string; toolParallelism: boolean
  isConcurrencySafe: boolean; showThinking: boolean
  memoryStrategy: MemoryStrategy; policyHooks: string
}

interface ModelInfo {
  id: string
  name: string
  provider: string
  providerLabel: string
}

// ── Toggle Switch ───────────────────────────────────────────

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`relative inline-flex items-center cursor-pointer ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} disabled={disabled} className="sr-only peer" />
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
        memoryStrategy = typeof raw.memoryStrategy === 'string'
          ? { ...DEFAULT_MEMORY, ...JSON.parse(raw.memoryStrategy || '{}') }
          : { ...DEFAULT_MEMORY, ...(raw.memoryStrategy || {}) }
      } catch { /* use default */ }
      try {
        policyHooks = typeof raw.policyHooks === 'string' ? raw.policyHooks : JSON.stringify(raw.policyHooks || {})
      } catch { /* use default */ }
      setConfig({
        model: raw.model || 'MiniMax-M2.70-highspeed',
        temperature: raw.temperature ?? 0.5,
        thinkingBudget: raw.thinkingBudget ?? 4096,
        maxIterations: raw.maxIterations ?? 20,
        systemPrompt: raw.systemPrompt || '',
        toolParallelism: raw.toolParallelism ?? true,
        isConcurrencySafe: raw.isConcurrencySafe ?? true,
        showThinking: raw.showThinking ?? false,
        memoryStrategy,
        policyHooks,
      })

      // Available models from providers
      setAvailableModels(modelsData.models || [])
      setMainModels((modelsData.models || []).map((m: ModelInfo) => m.id))
    }).finally(() => setLoading(false))
  }, [])

  const handleSave = useCallback(async () => {
    if (!config) return
    setSaving(true); setSaved(false)
    const body = {
      ...config,
      memoryStrategy: JSON.stringify(config.memoryStrategy),
    }
    await fetch('/api/admin/agent', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    fetch('/api/admin/config-changed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerId: 'default' }) }).catch(() => {})
    setSaved(true); setSaving(false)
  }, [config])

  const update = useCallback((field: string, value: unknown) => {
    setConfig(prev => prev ? { ...prev, [field]: value } : null)
    setSaved(false)
  }, [])

  const updateMemory = useCallback((field: keyof MemoryStrategy, value: unknown) => {
    setConfig(prev => prev ? {
      ...prev,
      memoryStrategy: { ...prev.memoryStrategy, [field]: value },
    } : null)
    setSaved(false)
  }, [])

  if (loading || !config) return (
    <div className="p-8 space-y-5 max-w-3xl">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  )

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
            <select value={config.model} onChange={e => update('model', e.target.value)}
              className="glass-input-console text-[13px] font-mono">
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
        </div>
        <div className="flex gap-6">
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={config.toolParallelism} onChange={e => update('toolParallelism', e.target.checked)} className="accent-indigo rounded" /><span className="text-[12px] text-secondary">Tool Parallelism</span></label>
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={config.isConcurrencySafe} onChange={e => update('isConcurrencySafe', e.target.checked)} className="accent-indigo rounded" /><span className="text-[12px] text-secondary">Concurrency Safe</span></label>
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={config.showThinking} onChange={e => update('showThinking', e.target.checked)} className="accent-indigo rounded" /><span className="text-[12px] text-secondary">Show Thinking (Claude-style expandable)</span></label>
        </div>
      </GlassCard>

      {/* System Prompt */}
      <GlassCard className="p-5 space-y-3" glow>
        <h3 className="text-[11px] font-sans tracking-[0.08em] uppercase text-muted/50">System Prompt</h3>
        <textarea value={config.systemPrompt} onChange={e => update('systemPrompt', e.target.value)} rows={18}
          className="glass-input-console text-[13px] leading-relaxed font-mono resize-y" placeholder="Enter system prompt…" />
      </GlassCard>

      {/* ── Memory Strategy: Thresholds ──────────────────────── */}
      <GlassCard className="p-5 space-y-3">
        <h3 className="text-[11px] font-sans tracking-[0.08em] uppercase text-muted/50">Memory Strategy — Thresholds</h3>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <HoverTooltip content="When remaining context tokens drop below this value, automatic compaction triggers after each ReAct loop iteration. Lower = compacts less frequently, preserving more conversation history. Higher = compacts more aggressively, saving token costs. Implementation: checkAndCompact() compares estimatedMessageTokens against effectiveContextWindow - this threshold. Recommended: 10000–15000.">
              <span className="text-[11px] text-muted cursor-help border-b border-dotted border-[var(--border-hover)]">Auto-compact Threshold</span>
            </HoverTooltip>
            <div className="flex items-center gap-2">
              <input type="number" value={config.memoryStrategy.autocompactThresholdTokens}
                onChange={e => updateMemory('autocompactThresholdTokens', parseInt(e.target.value) || 13000)}
                className="glass-input-console text-[13px] font-mono w-28" />
              <span className="text-[10px] text-muted">tokens</span>
            </div>
          </label>
          <label className="space-y-1">
            <HoverTooltip content="When remaining tokens drop below this, a console.warn is emitted in the server logs. Does NOT trigger compaction — purely informational. Should be set higher than the auto-compact threshold to give operators advance notice. Implementation: assessCompaction() sets isWarning=true when tokens fall below this.strategy.warningThresholdTokens. Recommended: 18000–25000.">
              <span className="text-[11px] text-muted cursor-help border-b border-dotted border-[var(--border-hover)]">Warning Threshold</span>
            </HoverTooltip>
            <div className="flex items-center gap-2">
              <input type="number" value={config.memoryStrategy.warningThresholdTokens}
                onChange={e => updateMemory('warningThresholdTokens', parseInt(e.target.value) || 20000)}
                className="glass-input-console text-[13px] font-mono w-28" />
              <span className="text-[10px] text-muted">tokens</span>
            </div>
          </label>
          <label className="space-y-1">
            <HoverTooltip content="Hard safety cutoff — when context drops below this, compaction is FORCED. The next API call WOULD fail without it (context window overflow). Uses a circuit breaker: 3 consecutive failures disable compaction to prevent infinite retry loops. Implementation: assessCompaction() sets isBlocking=true when tokensRemaining <= this.strategy.blockingThresholdTokens. If isCompactCircuitBroken() returns true (3 consecutive failures), compaction is skipped. Recommended: 2000–5000.">
              <span className="text-[11px] text-muted cursor-help border-b border-dotted border-[var(--border-hover)]">Blocking Threshold</span>
            </HoverTooltip>
            <div className="flex items-center gap-2">
              <input type="number" value={config.memoryStrategy.blockingThresholdTokens}
                onChange={e => updateMemory('blockingThresholdTokens', parseInt(e.target.value) || 3000)}
                className="glass-input-console text-[13px] font-mono w-28" />
              <span className="text-[10px] text-muted">tokens</span>
            </div>
          </label>
          <label className="space-y-1">
            <HoverTooltip content="Maximum tokens for the LLM-generated conversation summary. The summary is injected into the API call with the prefix '[Case context from previous turns]'. Larger = more detailed context preservation, smaller = more space for recent messages. Implementation: buildApiMessages() truncates summary text to l2SummaryMaxTokens * 3 characters before prepending. Also used as max_tokens for the compact LLM call. Recommended: 1000–4000.">
              <span className="text-[11px] text-muted cursor-help border-b border-dotted border-[var(--border-hover)]">L2 Summary Max Tokens</span>
            </HoverTooltip>
            <div className="flex items-center gap-2">
              <input type="number" value={config.memoryStrategy.l2SummaryMaxTokens}
                onChange={e => updateMemory('l2SummaryMaxTokens', parseInt(e.target.value) || 2000)}
                className="glass-input-console text-[13px] font-mono w-28" />
              <span className="text-[10px] text-muted">tokens</span>
            </div>
          </label>
        </div>
      </GlassCard>

      {/* ── Memory Strategy: Compaction Features ─────────────── */}
      <GlassCard className="p-5 space-y-3">
        <h3 className="text-[11px] font-sans tracking-[0.08em] uppercase text-muted/50">Compaction Features</h3>

        {/* Compact Model */}
        <div className="pb-3 border-b border-[var(--border-subtle)]">
          <label className="space-y-1.5 block">
            <HoverTooltip content="The model used for LLM-driven conversation summarization during compaction. This should be a fast, cheap model (not the main reasoning model). The compact call uses maxTurns=1 and disabled thinking to minimize latency and cost. Implementation: compactConversation() routes to the correct API provider based on model prefix — MiniMax models use Anthropic SDK, DeepSeek models use fetch() to OpenAI-compatible endpoint.">
              <span className="text-[11px] text-muted cursor-help border-b border-dotted border-[var(--border-hover)]">Compact Model</span>
            </HoverTooltip>
            <select value={config.memoryStrategy.compactModel}
              onChange={e => updateMemory('compactModel', e.target.value)}
              className="glass-input-console text-[13px] font-mono mt-1 w-full max-w-xs">
              {availableModels.map(m => (
                <option key={m.id} value={m.id}>{m.name} ({m.providerLabel})</option>
              ))}
              {availableModels.length === 0 && <option value={config.memoryStrategy.compactModel}>{config.memoryStrategy.compactModel}</option>}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          <label className="flex items-center justify-between gap-3">
            <HoverTooltip content="Master switch for ALL automatic compaction. When OFF, checkAndCompact() returns { shouldCompact: false } immediately without running any token assessment or message trimming. Use this to debug compaction issues or when you want manual-only control. The summary is still maintained via recordCompaction(). Implementation: first check in checkAndCompact() — if (!enableAutocompact) return early.">
              <span className="text-[11px] text-muted cursor-help border-b border-dotted border-[var(--border-hover)]">Enable Auto Compact</span>
            </HoverTooltip>
            <Toggle checked={config.memoryStrategy.enableAutocompact}
              onChange={v => updateMemory('enableAutocompact', v)} />
          </label>
          <label className="flex items-center justify-between gap-3">
            <HoverTooltip content="Before the LLM compaction, scans messages for tool results from data-query tools (query_order_status, query_payment_channel_status, search_delay_notice, etc.) and replaces their content with '[Old tool result content cleared]'. Frees tokens WITHOUT losing case state. Critical tools (request_user_input, create_human_task, finalize_case) are NEVER cleared. Zero API cost — pure local string manipulation. Implementation: microCompact() in microCompact.ts, called before token assessment. Each cleared message saves ~ceil(content.length/3) tokens.">
              <span className="text-[11px] text-muted cursor-help border-b border-dotted border-[var(--border-hover)]">Enable Micro Compact</span>
            </HoverTooltip>
            <Toggle checked={config.memoryStrategy.enableMicrocompact}
              onChange={v => updateMemory('enableMicrocompact', v)} />
          </label>
          <label className="flex items-center justify-between gap-3">
            <HoverTooltip content="When enabled, assessCompaction() may return shouldCompact=true, triggering message trimming. When OFF, assessCompaction() ALWAYS returns shouldCompact=false — the summary is still updated but old messages are never removed. Use when you want to retain full conversation history regardless of token budget. Warning: combining this OFF + enableSnip OFF may cause context overflow. Implementation: gated in assessCompaction() — if (!enableContextCollapse) shouldCompact=false.">
              <span className="text-[11px] text-muted cursor-help border-b border-dotted border-[var(--border-hover)]">Enable Context Collapse</span>
            </HoverTooltip>
            <Toggle checked={config.memoryStrategy.enableContextCollapse}
              onChange={v => updateMemory('enableContextCollapse', v)} />
          </label>
          <label className="flex items-center justify-between gap-3">
            <HoverTooltip content="When enabled, compaction physically removes old messages from the messages array: this.messages = this.messages.slice(-keepCount). When OFF, recordCompaction() still generates a summary but leaves messages intact. Messages accumulate unbounded in the array — risk of context overflow when combined with enableContextCollapse=false. Implementation: gated in both the blocking and auto compaction paths of checkAndCompact().">
              <span className="text-[11px] text-muted cursor-help border-b border-dotted border-[var(--border-hover)]">Enable Snip</span>
            </HoverTooltip>
            <Toggle checked={config.memoryStrategy.enableSnip}
              onChange={v => updateMemory('enableSnip', v)} />
          </label>
        </div>
      </GlassCard>

      {/* ── Memory Strategy: Retention ───────────────────────── */}
      <GlassCard className="p-5 space-y-3">
        <h3 className="text-[11px] font-sans tracking-[0.08em] uppercase text-muted/50">Retention</h3>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <HoverTooltip content="Maximum recent messages kept in the L1 context window. buildApiMessages() uses l1MaxMessages * 2 as the slice limit before constructing the API request. Higher = agent sees more conversation history. Implementation: const limit = this.deps.config.memoryStrategy.l1MaxMessages * 2; const recent = this.messages.slice(-limit). Recommended: 8–20.">
              <span className="text-[11px] text-muted cursor-help border-b border-dotted border-[var(--border-hover)]">L1 Max Messages</span>
            </HoverTooltip>
            <div className="flex items-center gap-2">
              <input type="number" value={config.memoryStrategy.l1MaxMessages}
                onChange={e => updateMemory('l1MaxMessages', parseInt(e.target.value) || 12)}
                className="glass-input-console text-[13px] font-mono w-28" />
              <span className="text-[10px] text-muted">messages</span>
            </div>
          </label>
          <label className="space-y-1">
            <HoverTooltip content="Maximum historical cases loaded for context when detecting a repeat customer. Stored in CaseMemory and used to prime the agent with past resolution patterns from the same customer. Implementation: queried from caseMemory table when building the system prompt in messages/route.ts. Recommended: 3–10.">
              <span className="text-[11px] text-muted cursor-help border-b border-dotted border-[var(--border-hover)]">L4 Max Historical Cases</span>
            </HoverTooltip>
            <div className="flex items-center gap-2">
              <input type="number" value={config.memoryStrategy.l4MaxHistoricalCases}
                onChange={e => updateMemory('l4MaxHistoricalCases', parseInt(e.target.value) || 5)}
                className="glass-input-console text-[13px] font-mono w-28" />
              <span className="text-[10px] text-muted">cases</span>
            </div>
          </label>
          <label className="space-y-1">
            <HoverTooltip content="Maximum ActionTrace entries retained in memory. Traces include LLM requests, tool executions, guard evaluations, microcompact events, and compaction decisions. Used by the Console to display agent activity. Older traces are pruned during compaction. Implementation: recorded via TraceWriter.write() to ActionTrace table, queried by /api/cases/[id]/traces. Recommended: 10–50.">
              <span className="text-[11px] text-muted cursor-help border-b border-dotted border-[var(--border-hover)]">Max Recent Traces</span>
            </HoverTooltip>
            <div className="flex items-center gap-2">
              <input type="number" value={config.memoryStrategy.maxRecentTraces}
                onChange={e => updateMemory('maxRecentTraces', parseInt(e.target.value) || 20)}
                className="glass-input-console text-[13px] font-mono w-28" />
              <span className="text-[10px] text-muted">entries</span>
            </div>
          </label>
          <label className="space-y-1">
            <HoverTooltip content="Number of days to retain case data before archival. Used by background retention cron jobs. Cases with updatedAt older than this may be hard-deleted or archived. Implementation: checked against caseRetentionDays in the retention cron (scheduled task). Recommended: 30–365.">
              <span className="text-[11px] text-muted cursor-help border-b border-dotted border-[var(--border-hover)]">Case Retention Days</span>
            </HoverTooltip>
            <div className="flex items-center gap-2">
              <input type="number" value={config.memoryStrategy.caseRetentionDays}
                onChange={e => updateMemory('caseRetentionDays', parseInt(e.target.value) || 90)}
                className="glass-input-console text-[13px] font-mono w-28" />
              <span className="text-[10px] text-muted">days</span>
            </div>
          </label>
        </div>
      </GlassCard>

      {/* ── Memory Strategy: Advanced ────────────────────────── */}
      <GlassCard className="p-5 space-y-3">
        <h3 className="text-[11px] font-sans tracking-[0.08em] uppercase text-muted/50">Advanced</h3>
        <label className="space-y-1.5 block">
          <HoverTooltip content="System prompt injected when the LLM extracts key events from conversation history. Each event is tagged with source: 'heuristic' (regex-based pattern matching) or 'llm' (model-extracted). Customize for domain-specific event types like 'deposit confirmed' or 'refund requested'.">
            <span className="text-[11px] text-muted cursor-help border-b border-dotted border-[var(--border-hover)]">Key Event Extraction Prompt</span>
          </HoverTooltip>
          <textarea value={config.memoryStrategy.keyEventExtractionPrompt}
            onChange={e => updateMemory('keyEventExtractionPrompt', e.target.value)} rows={3}
            className="glass-input-console text-[12px] font-mono resize-y" />
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
