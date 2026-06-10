'use client'

import { AlertTriangle, CheckCircle2, ChevronRight, CircleDot, FileJson, Handshake, Search, ShieldCheck, Wrench, XCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ScenarioObservedEvidence, ScenarioReceipt, ScenarioReceiptCheck } from '@intera/shared/contracts/scenarios'

interface ScenarioReceiptPanelProps {
  receipt: ScenarioReceipt | null
  receipts?: ScenarioReceipt[]
  selectedRunId?: string | null
  onSelectReceipt?: (receipt: ScenarioReceipt) => void
  compact?: boolean
}

export function ScenarioReceiptPanel({
  receipt,
  receipts = [],
  selectedRunId,
  onSelectReceipt,
  compact = false,
}: ScenarioReceiptPanelProps) {
  if (!receipt) {
    return (
      <div className="intera-q2-panel p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[var(--color-bg-surface-muted)] text-[var(--color-text-tertiary)]">
            <FileJson size={16} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">No receipts yet</h2>
            <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">Run a Scenario to create validation evidence.</p>
          </div>
        </div>
      </div>
    )
  }

  const evidence = receipt.evidence
  const phraseChecks = receipt.checks.filter(isPhraseCheck)
  const remainingChecks = receipt.checks.filter((check) => !isPhraseCheck(check))

  return (
    <div className="intera-q2-panel overflow-hidden">
      <div className="border-b border-[var(--color-border-subtle)] px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-[var(--color-text-tertiary)]">Scenario receipt</p>
            <h2 className="mt-1 text-lg font-semibold text-[var(--color-text-primary)]">{receipt.scenarioName}</h2>
            {receipt.summary && <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{receipt.summary}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ExecutionModeBadge receipt={receipt} />
            <ReceiptStatusBadge status={receipt.status} />
          </div>
        </div>
        <div className="mt-4 grid overflow-hidden rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white/70 text-xs text-[var(--color-text-secondary)] sm:grid-cols-2">
          <span className="border-b border-[var(--color-border-subtle)] px-3 py-2 sm:border-r">Run: {receipt.runId}</span>
          <span className="border-b border-[var(--color-border-subtle)] px-3 py-2">Started: {formatDate(receipt.startedAt)}</span>
          <span className="border-b border-[var(--color-border-subtle)] px-3 py-2 sm:border-r">Execution: {executionModeLabel(receipt.executionMode)}</span>
          <span className="border-b border-[var(--color-border-subtle)] px-3 py-2">Tool mode: {receipt.toolExecutionMode}</span>
          {(receipt.completedAt ?? receipt.finishedAt) && <span className="border-b border-[var(--color-border-subtle)] px-3 py-2 sm:border-r sm:border-b-0">Completed: {formatDate(receipt.completedAt ?? receipt.finishedAt!)}</span>}
          {receipt.traceId && <span className="px-3 py-2">Trace: {receipt.traceId}</span>}
        </div>
      </div>

      <div className={`grid ${compact ? '' : 'xl:grid-cols-2'}`}>
        <EvidenceSection icon={Wrench} title="Tool calls" empty="No tool calls recorded.">
          {evidence.toolCalls.length > 0 ? (
            <div className="grid gap-2">
              {evidence.toolCalls.map((call, index) => (
                <div key={`${call.name}-${index}`} className="rounded-md border border-[var(--color-border-subtle)] bg-white/70 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-semibold text-[var(--color-text-primary)]">{call.name}</span>
                    <span className="rounded-full bg-[rgba(53,127,124,0.10)] px-2 py-0.5 font-medium text-[var(--color-accent-primary)]">{call.executionMode ?? receipt.toolExecutionMode}</span>
                  </div>
                  {call.input !== undefined && <pre className="mt-2 max-h-24 overflow-auto rounded-md bg-[var(--primitive-deep-950)] p-2 font-mono text-[11px] leading-4 text-[var(--color-workspace-text)]">{stringify(call.input)}</pre>}
                </div>
              ))}
            </div>
          ) : (
            <TokenList values={evidence.toolsCalled} tone="cyan" />
          )}
        </EvidenceSection>

        <EvidenceSection icon={Wrench} title="Tool results" empty="No tool results recorded." isEmpty={evidence.toolResults.length === 0}>
          <div className="grid gap-2">
            {evidence.toolResults.map((result, index) => (
              <div key={`${result.name}-${index}`} className="rounded-md border border-[var(--color-border-subtle)] bg-white/70 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold text-[var(--color-text-primary)]">{result.name}</span>
                  <span className="rounded-full bg-white px-2 py-0.5 text-[var(--color-text-secondary)]">{result.executionMode ?? receipt.toolExecutionMode}</span>
                  {result.evidenceState === 'stale' && <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700">stale evidence</span>}
                </div>
                {result.error && <p className="mt-2 text-xs text-red-700">{result.error}</p>}
                {result.output !== undefined && <pre className="mt-2 max-h-24 overflow-auto rounded-md bg-[var(--primitive-deep-950)] p-2 font-mono text-[11px] leading-4 text-[var(--color-workspace-text)]">{stringify(result.output)}</pre>}
              </div>
            ))}
          </div>
        </EvidenceSection>

        <EvidenceSection icon={ShieldCheck} title="Hook decisions" empty="No Hook decisions recorded." isEmpty={evidence.hookDecisions.length === 0}>
          <div className="grid gap-2">
            {evidence.hookDecisions.map((hook, index) => (
              <div key={`${hook.hookName}-${hook.checkpoint}-${index}`} className="rounded-md border border-[var(--color-border-subtle)] bg-white/70 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold text-[var(--color-text-primary)]">{hook.hookName}</span>
                  <span className="rounded-full bg-white px-2 py-0.5 text-[var(--color-text-secondary)]">{hook.checkpoint}</span>
                  <span className="rounded-full bg-[rgba(53,127,124,0.10)] px-2 py-0.5 font-medium text-[var(--color-accent-primary)]">{hook.decision}</span>
                </div>
                {hook.reason && <p className="mt-2 text-xs text-[var(--color-text-secondary)]">{hook.reason}</p>}
              </div>
            ))}
          </div>
        </EvidenceSection>

        <EvidenceSection icon={Search} title="Knowledge evidence" empty="No knowledge evidence recorded." isEmpty={evidence.knowledgeHits.length === 0}>
          <div className="grid gap-2">
            {evidence.knowledgeHits.map((hit, index) => (
              <div key={index} className="rounded-md border border-[var(--color-border-subtle)] bg-white/70 px-3 py-2">
                <p className="text-xs font-medium text-[var(--color-text-primary)]">{knowledgeTitle(hit, index)}</p>
                <pre className="mt-2 max-h-28 overflow-auto rounded-md bg-[var(--primitive-deep-950)] p-2 font-mono text-[11px] leading-4 text-[var(--color-workspace-text)]">{stringify(hit)}</pre>
              </div>
            ))}
          </div>
        </EvidenceSection>

        <EvidenceSection icon={Handshake} title="Human transfer" empty="No human transfer required." isEmpty={!evidence.humanTransfer && evidence.handoff.length === 0}>
          <div className="grid gap-2">
            <div className="flex items-center gap-2 text-sm">
              <span className={`h-2 w-2 rounded-full ${evidence.humanTransfer ? 'bg-[var(--color-signal-warning)]' : 'bg-[var(--color-text-tertiary)]'}`} />
              <span className="font-medium text-[var(--color-text-primary)]">{evidence.humanTransfer ? 'Human transfer required' : 'No transfer'}</span>
            </div>
            {evidence.handoff.map((handoff, index) => (
              <div key={index} className="rounded-md border border-[var(--color-border-subtle)] bg-white/70 px-3 py-2 text-xs text-[var(--color-text-secondary)]">
                <p>{handoff.reason ?? handoff.target ?? handoff.queue ?? 'Handoff evidence'}</p>
                {(handoff.queue || handoff.target) && <p className="mt-1 text-[var(--color-text-tertiary)]">Queue: {handoff.queue ?? 'none'} · Target: {handoff.target ?? 'none'}</p>}
              </div>
            ))}
          </div>
        </EvidenceSection>

        <EvidenceSection icon={CircleDot} title="Final status" empty="No final status recorded.">
          <div className="grid gap-2">
            <div className="rounded-md border border-[var(--color-border-subtle)] bg-white/70 px-3 py-2 text-sm text-[var(--color-text-primary)]">
              {evidence.finalStatus ?? 'Not recorded'}
            </div>
            {evidence.finalResponse && <p className="rounded-md border border-[var(--color-border-subtle)] bg-white px-3 py-2 text-sm leading-5 text-[var(--color-text-secondary)]">{evidence.finalResponse}</p>}
            {evidence.runtime?.staleEvidence?.length ? <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">Runtime recorded stale evidence that still requires reconciliation.</p> : null}
          </div>
        </EvidenceSection>

        <EvidenceSection icon={AlertTriangle} title="Phrase checks" empty="No required or forbidden phrase checks." isEmpty={phraseChecks.length === 0}>
          <CheckList checks={phraseChecks} />
        </EvidenceSection>
      </div>

      <div className="border-t border-[var(--color-border-subtle)] bg-white/35 px-5 py-4">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Expectation checks</h3>
        {remainingChecks.length === 0 ? (
          <p className="mt-2 text-xs text-[var(--color-text-tertiary)]">No additional expectation checks.</p>
        ) : (
          <CheckList checks={remainingChecks} className="mt-3" />
        )}
      </div>

      {receipts.length > 1 && onSelectReceipt && (
        <div className="border-t border-[var(--color-border-subtle)] bg-white/35 px-5 py-4">
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Recent runs</h3>
          <div className="mt-3 grid gap-2">
            {receipts.slice(0, 6).map((item) => (
              <button key={item.runId} type="button" onClick={() => onSelectReceipt(item)} className={`intera-q2-button flex items-center justify-between border px-3 py-2 text-left text-xs transition ${selectedRunId === item.runId ? 'border-[var(--color-accent-primary)] bg-[rgba(53,127,124,0.08)]' : 'border-[var(--color-border-subtle)] bg-white hover:bg-[var(--color-bg-surface-muted)]'}`}>
                <span className="min-w-0">
                  <span className="block truncate font-medium text-[var(--color-text-primary)]">{item.scenarioName}</span>
                  <span className="mt-0.5 block text-[var(--color-text-tertiary)]">{executionModeLabel(item.executionMode)} · {formatDate(item.startedAt)}</span>
                </span>
                <span className="flex items-center gap-2">
                  <ReceiptStatusIcon status={item.status} />
                  <ChevronRight size={14} className="text-[var(--color-text-tertiary)]" />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function ReceiptStatusBadge({ status }: { status: ScenarioReceipt['status'] }) {
  const className = status === 'pass'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : status === 'fail'
      ? 'border-red-200 bg-red-50 text-red-700'
      : 'border-amber-200 bg-amber-50 text-amber-700'
  return <span className={`inline-flex h-8 items-center rounded-md border px-3 text-xs font-semibold capitalize ${className}`}>{status}</span>
}

export function ReceiptStatusIcon({ status }: { status?: ScenarioReceipt['status'] }) {
  if (status === 'pass') return <CheckCircle2 size={16} className="text-emerald-600" />
  if (status === 'fail') return <XCircle size={16} className="text-red-600" />
  if (status === 'blocked') return <AlertTriangle size={16} className="text-amber-600" />
  return <AlertTriangle size={16} className="text-[var(--color-text-tertiary)]" />
}

function ExecutionModeBadge({ receipt }: { receipt: ScenarioReceipt }) {
  const runtime = receipt.executionMode === 'agentRuntime'
  const className = runtime
    ? 'border-[rgba(53,127,124,0.22)] bg-[rgba(53,127,124,0.08)] text-[var(--color-accent-primary)]'
    : 'border-amber-200 bg-amber-50 text-amber-800'
  return <span className={`inline-flex h-8 items-center rounded-md border px-3 text-xs font-semibold ${className}`}>{executionModeLabel(receipt.executionMode)}</span>
}

function EvidenceSection({
  icon: Icon,
  title,
  empty,
  isEmpty,
  children,
}: {
  icon: typeof Wrench
  title: string
  empty: string
  isEmpty?: boolean
  children: ReactNode
}) {
  const emptyState = isEmpty ?? false
  return (
    <section className="border-b border-[var(--color-border-subtle)] bg-white/45 p-4 last:border-b-0">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--color-bg-surface-muted)] text-[var(--color-accent-primary)]">
          <Icon size={14} />
        </span>
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</h3>
      </div>
      {emptyState ? <p className="text-xs text-[var(--color-text-tertiary)]">{empty}</p> : children}
    </section>
  )
}

function TokenList({ values, tone }: { values: string[]; tone?: 'cyan' }) {
  if (values.length === 0) return <p className="text-xs text-[var(--color-text-tertiary)]">No entries.</p>
  const itemClass = tone === 'cyan' ? 'border-[rgba(53,127,124,0.18)] bg-[rgba(53,127,124,0.08)] text-[var(--color-accent-primary)]' : 'border-[var(--color-border-subtle)] bg-[var(--color-bg-surface-muted)] text-[var(--color-text-secondary)]'
  return (
    <div className="flex flex-wrap gap-2">
      {values.map((value) => <span key={value} className={`rounded-full border px-2 py-1 text-xs font-medium ${itemClass}`}>{value}</span>)}
    </div>
  )
}

function CheckList({ checks, className = '' }: { checks: ScenarioReceiptCheck[]; className?: string }) {
  return (
    <div className={`grid gap-2 ${className}`}>
      {checks.map((check) => (
        <div key={check.name} className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface-muted)] px-3 py-2">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="font-medium text-[var(--color-text-primary)]">{formatCheckName(check.name)}</span>
            <span className={`rounded-full px-2 py-0.5 font-semibold ${check.passed ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{check.passed ? 'Pass' : 'Fail'}</span>
          </div>
          {check.detail && <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{check.detail}</p>}
        </div>
      ))}
    </div>
  )
}

function isPhraseCheck(check: ScenarioReceiptCheck): boolean {
  return check.name.startsWith('forbidden_phrase:') || check.name.startsWith('required_phrase:')
}

function executionModeLabel(mode: ScenarioReceipt['executionMode']): string {
  return mode === 'agentRuntime' ? 'Agent runtime' : 'Fixture validation'
}

function formatCheckName(name: string): string {
  return name.replace(/^forbidden_phrase:/, 'Forbidden phrase: ').replace(/^required_phrase:/, 'Required phrase: ').replace(/_/g, ' ')
}

function knowledgeTitle(hit: Record<string, unknown>, index: number): string {
  const title = hit.title ?? hit.name ?? hit.source
  return typeof title === 'string' && title.trim() ? title : `Knowledge hit ${index + 1}`
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}
