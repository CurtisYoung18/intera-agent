'use client'

import { useState } from 'react'
import { Brain, Cpu, Shield, FileText, Settings, Database } from 'lucide-react'
import FlowNode from './flow-node'
import SlidePanel from '@/components/ui/slide-panel'
import type { AgentConfigData, MemoryStrategy } from '@/app/admin/agent/types'

type Section = 'prompt' | 'model' | 'memory' | 'policy' | 'templates' | 'advanced'

interface AgentFlowProps {
  config: AgentConfigData
  mainModels: string[]
  update: (field: string, value: unknown) => void
  updateMem: (field: keyof MemoryStrategy, value: unknown) => void
}

const sectionMeta: Record<Section, { icon: React.ReactNode; title: string; subtitle: string; color: 'lavender' | 'indigo' | 'amber' | 'malachite' | 'sky' | 'gold'; span: 1 | 2 | 3 }> = {
  prompt:    { icon: <Brain className="w-5 h-5" />, title: 'System Prompt', subtitle: 'Core agent persona and behavioral rules', color: 'lavender', span: 3 },
  model:     { icon: <Cpu className="w-5 h-5" />, title: 'Model & Parameters', subtitle: 'LLM selection and tuning', color: 'indigo', span: 1 },
  memory:    { icon: <Database className="w-5 h-5" />, title: 'Memory Strategy', subtitle: 'Context management & compaction', color: 'amber', span: 1 },
  policy:    { icon: <Shield className="w-5 h-5" />, title: 'Policy Hooks', subtitle: 'Guardrails & enforcement rules', color: 'malachite', span: 1 },
  templates: { icon: <FileText className="w-5 h-5" />, title: 'Resume & Form Templates', subtitle: 'Synthetic message templates', color: 'sky', span: 2 },
  advanced:  { icon: <Settings className="w-5 h-5" />, title: 'Advanced Settings', subtitle: 'Fact extraction, token estimation, compaction fine-tuning', color: 'gold', span: 1 },
}

export default function AgentFlow({ config, mainModels, update, updateMem }: AgentFlowProps) {
  const [activeSection, setActiveSection] = useState<Section | null>(null)
  const ms = config.memoryStrategy

  const panelTitle = activeSection ? sectionMeta[activeSection].title : ''

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 animate-fade-up">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-[20px] font-semibold text-[var(--mist)] tracking-[-0.01em]">Agent Configuration</h1>
        <p className="text-[13px] text-[var(--fog)] mt-1">Click any card to edit its settings in a side panel</p>
      </div>

      {/* Card Grid */}
      <div className="grid grid-cols-3 gap-4">
        {(['prompt', 'model', 'memory', 'policy', 'templates', 'advanced'] as Section[]).map(key => (
          <FlowNode
            key={key}
            id={key}
            {...sectionMeta[key]}
            active={activeSection === key}
            onClick={() => setActiveSection(prev => prev === key ? null : key)}
          />
        ))}
      </div>

      {/* Slide Panel for editing */}
      <SlidePanel open={!!activeSection} onClose={() => setActiveSection(null)} title={panelTitle}>
        {activeSection === 'prompt' && (
          <div className="space-y-3">
            <textarea value={config.coreSystemPrompt || ''} onChange={e => update('coreSystemPrompt', e.target.value)}
              rows={22} className="glass-input-console text-[13px] leading-relaxed font-mono resize-y" placeholder="Enter system prompt…" />
          </div>
        )}

        {activeSection === 'model' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1.5"><span className="text-[11px] text-[var(--fog)]">Main Model</span>
                <select value={config.model} onChange={e => update('model', e.target.value)} className="glass-input-console text-[13px] font-mono">
                  {mainModels.map(m => <option key={m} value={m}>{m}</option>)}
                  {mainModels.length === 0 && <option value={config.model}>{config.model}</option>}
                </select>
              </label>
              <label className="space-y-1.5"><span className="text-[11px] text-[var(--fog)]">Temperature ({config.temperature})</span>
                <input type="range" min="0" max="1" step="0.1" value={config.temperature} onChange={e => update('temperature', parseFloat(e.target.value))} className="w-full accent-indigo" />
              </label>
              <NumField label="Thinking Budget" tooltip="" value={config.thinkingBudget} onChange={v => update('thinkingBudget', v)} unit="" />
              <NumField label="Max Iterations" tooltip="" value={config.maxIterations} onChange={v => update('maxIterations', v)} unit="" />
              <NumField label="Max Output Tokens" tooltip="" value={config.maxOutputTokens} onChange={v => update('maxOutputTokens', v)} unit="tokens" />
            </div>
            <div className="flex gap-4 flex-wrap">
              {(['extendedThinking'] as const).map(key => (
                <label key={key} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={!!config[key]} onChange={e => update(key, e.target.checked)} className="accent-indigo rounded" />
                  <span className="text-[12px] text-[var(--fog)]">Extended Thinking</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {activeSection === 'memory' && (
          <div className="space-y-4">
            <div className="border-b border-[var(--border-subtle)] pb-2"><span className="text-[11px] font-medium text-[var(--fog)]">Thresholds</span></div>
            <div className="grid grid-cols-2 gap-3">
              <NumField label="Auto-compact Threshold" tooltip="" value={ms.autocompactThresholdTokens} onChange={v => updateMem('autocompactThresholdTokens', v)} unit="tokens" />
              <NumField label="Warning Threshold" tooltip="" value={ms.warningThresholdTokens} onChange={v => updateMem('warningThresholdTokens', v)} unit="tokens" />
              <NumField label="Error Threshold" tooltip="" value={ms.errorThresholdTokens} onChange={v => updateMem('errorThresholdTokens', v)} unit="tokens" />
              <NumField label="Blocking Threshold" tooltip="" value={ms.blockingThresholdTokens} onChange={v => updateMem('blockingThresholdTokens', v)} unit="tokens" />
            </div>
            <div className="border-b border-[var(--border-subtle)] pb-2"><span className="text-[11px] font-medium text-[var(--fog)]">Retention</span></div>
            <div className="grid grid-cols-2 gap-3">
              <NumField label="L1 Max Messages" tooltip="" value={ms.l1MaxMessages} onChange={v => updateMem('l1MaxMessages', v)} unit="msgs" />
              <NumField label="L2 Summary Max Tokens" tooltip="" value={ms.l2SummaryMaxTokens} onChange={v => updateMem('l2SummaryMaxTokens', v)} unit="tokens" />
              <NumField label="L4 Max Historical Cases" tooltip="" value={ms.l4MaxHistoricalCases} onChange={v => updateMem('l4MaxHistoricalCases', v)} unit="cases" />
              <NumField label="Max Recent Traces" tooltip="" value={ms.maxRecentTraces} onChange={v => updateMem('maxRecentTraces', v)} unit="traces" />
            </div>
            <div className="border-b border-[var(--border-subtle)] pb-2"><span className="text-[11px] font-medium text-[var(--fog)]">Compaction</span></div>
            <label className="space-y-1.5 block"><span className="text-[11px] text-[var(--fog)]">Compact Model</span>
              <select value={ms.compactModel} onChange={e => updateMem('compactModel', e.target.value)} className="glass-input-console text-[13px] font-mono">
                {mainModels.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <NumField label="Compact Max Messages" tooltip="" value={ms.compactMaxMessages} onChange={v => updateMem('compactMaxMessages', v)} unit="msgs" />
              <NumField label="Compact Temperature" tooltip="" value={ms.compactTemperature} onChange={v => updateMem('compactTemperature', v)} unit="" step={0.1} min={0} max={1} />
              <NumField label="Compact Max Tokens" tooltip="" value={ms.compactMaxTokensCap} onChange={v => updateMem('compactMaxTokensCap', v)} unit="tokens" />
              <NumField label="Min Summary Length" tooltip="" value={ms.compactMinSummaryLength} onChange={v => updateMem('compactMinSummaryLength', v)} unit="tokens" />
              <NumField label="Keep Min" tooltip="" value={ms.compactionKeepMin} onChange={v => updateMem('compactionKeepMin', v)} unit="msgs" />
              <NumField label="Keep Ratio" tooltip="" value={ms.compactionKeepRatio} onChange={v => updateMem('compactionKeepRatio', v)} unit="" step={0.1} min={0} max={1} />
            </div>
            <div className="flex gap-4 flex-wrap pt-1">
              {(['enableAutocompact', 'enableMicrocompact', 'enableContextCollapse', 'enableSnip'] as const).map(key => (
                <label key={key} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={!!ms[key]} onChange={e => updateMem(key, e.target.checked)} className="accent-amber rounded" />
                  <span className="text-[12px] text-[var(--fog)]">{key.replace('enable', '').replace('Autocompact', 'Auto-compact').replace('Microcompact', 'Micro-compact').replace('ContextCollapse', 'Context Collapse').replace('Snip', 'Snip')}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {activeSection === 'policy' && (
          <div className="space-y-3">
            <p className="text-[12px] text-[var(--fog)]">Policies are now managed via the standalone Policy editor. Use the sidebar to configure guardrail rules, capability bindings, and enforcement hooks.</p>
          </div>
        )}

        {activeSection === 'templates' && (
          <div className="space-y-4">
            <label className="space-y-1.5 block" title="Template for synthetic user message when a human task is resolved.">
              <span className="text-[11px] text-[var(--fog)] cursor-help border-b border-dotted border-[var(--border-hover)]">Resume Prompt</span>
              <textarea value={config.resumePrompt} onChange={e => update('resumePrompt', e.target.value)} rows={10} className="glass-input-console text-[12px] font-mono resize-y" />
            </label>
          </div>
        )}

        {activeSection === 'advanced' && (
          <div className="space-y-5">
            <div>
              <h4 className="text-[11px] font-medium text-[var(--fog)]/60 uppercase tracking-[0.06em] mb-2">Fact Extraction (LLM)</h4>
              <div className="space-y-3">
                <label className="space-y-1 block"><span className="text-[11px] text-[var(--fog)]">Extraction Hint</span>
                  <textarea value={ms.factExtractionPrompt || ''} onChange={e => updateMem('factExtractionPrompt', e.target.value)} rows={3} className="glass-input-console text-[13px] resize-y w-full" placeholder="Extra context for the LLM fact extractor..." />
                </label>
              </div>
            </div>
            <div>
              <h4 className="text-[11px] font-medium text-[var(--fog)]/60 uppercase tracking-[0.06em] mb-2">Token Estimation</h4>
              <div className="grid grid-cols-2 gap-3">
                <NumField label="Tokens/Key Event" tooltip="" value={ms.tokensPerKeyEvent} onChange={v => updateMem('tokensPerKeyEvent', v)} unit="" />
                <NumField label="Tokens/Fact" tooltip="" value={ms.tokensPerFact} onChange={v => updateMem('tokensPerFact', v)} unit="" />
                <NumField label="Tokens/Tool" tooltip="" value={ms.tokensPerTool} onChange={v => updateMem('tokensPerTool', v)} unit="" />
                <NumField label="CJK Char/Token" tooltip="" value={ms.cjkCharPerToken} onChange={v => updateMem('cjkCharPerToken', v)} unit="" step={0.1} />
                <NumField label="Latin Char/Token" tooltip="" value={ms.latinCharPerToken} onChange={v => updateMem('latinCharPerToken', v)} unit="" step={0.1} />
                <NumField label="Min Token Estimate" tooltip="" value={ms.minTokenEstimate} onChange={v => updateMem('minTokenEstimate', v)} unit="tokens" />
                <NumField label="Tool Result Ratio" tooltip="" value={ms.toolResultTokenRatio} onChange={v => updateMem('toolResultTokenRatio', v)} unit="x" step={0.1} />
                <NumField label="Key Event Max Chars" tooltip="" value={ms.keyEventMaxChars} onChange={v => updateMem('keyEventMaxChars', v)} unit="chars" />
              </div>
            </div>
            <div>
              <h4 className="text-[11px] font-medium text-[var(--fog)]/60 uppercase tracking-[0.06em] mb-2">Compaction Fine-tuning</h4>
              <div className="grid grid-cols-2 gap-3">
                <NumField label="Context Window" tooltip="" value={ms.contextWindow} onChange={v => updateMem('contextWindow', v)} unit="tokens" />
                <NumField label="Output Reserved" tooltip="" value={ms.outputTokensReserved} onChange={v => updateMem('outputTokensReserved', v)} unit="tokens" />
                <NumField label="Max Key Events" tooltip="" value={ms.maxKeyEventsAfterCompact} onChange={v => updateMem('maxKeyEventsAfterCompact', v)} unit="events" />
                <NumField label="Circuit Breaker Max" tooltip="" value={ms.compactCircuitBreakerMaxFailures} onChange={v => updateMem('compactCircuitBreakerMaxFailures', v)} unit="failures" />
                <NumField label="Session Max Age" tooltip="" value={ms.sessionMemoryMaxAgeMs} onChange={v => updateMem('sessionMemoryMaxAgeMs', v)} unit="ms" />
                <NumField label="Case Retention Days" tooltip="" value={ms.caseRetentionDays} onChange={v => updateMem('caseRetentionDays', v)} unit="days" />
              </div>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <label className="space-y-1"><span className="text-[11px] text-[var(--fog)]">Compact Prompt</span>
                  <textarea value={ms.compactPrompt} onChange={e => updateMem('compactPrompt', e.target.value)} rows={4} className="glass-input-console text-[12px] font-mono resize-y" />
                </label>
                <label className="space-y-1"><span className="text-[11px] text-[var(--fog)]">Tool Result Template</span>
                  <textarea value={ms.toolResultTemplate} onChange={e => updateMem('toolResultTemplate', e.target.value)} rows={4} className="glass-input-console text-[12px] font-mono resize-y" />
                </label>
              </div>
            </div>
          </div>
        )}
      </SlidePanel>
    </div>
  )
}

// Lightweight NumField — no HoverTooltip, title attr for tooltip
function NumField({ label, tooltip, value, onChange, unit, min, max, step }: {
  label: string; tooltip: string; value: number; onChange: (v: number) => void
  unit: string; min?: number; max?: number; step?: number
}) {
  return (
    <label className="space-y-1" title={tooltip || undefined}>
      <span className="text-[11px] text-[var(--fog)]">{label}</span>
      <div className="flex items-center gap-2">
        <input type="number" value={value} onChange={e => onChange(parseFloat(e.target.value) || 0)}
          min={min} max={max} step={step}
          className="glass-input-console text-[13px] font-mono w-full" />
        {unit && <span className="text-[10px] text-[var(--smoke)] flex-shrink-0">{unit}</span>}
      </div>
    </label>
  )
}
