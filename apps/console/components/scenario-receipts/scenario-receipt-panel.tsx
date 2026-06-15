'use client'

import { AlertTriangle, CheckCircle2, ChevronRight, CircleDot, FileJson, Handshake, Search, ShieldCheck, Wrench, XCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { useConsoleLocale } from '@/components/locale-provider'
import type { ScenarioObservedEvidence, ScenarioReceipt, ScenarioReceiptCheck } from '@intera/shared/contracts/scenarios'

interface ScenarioReceiptPanelProps {
  receipt: ScenarioReceipt | null
  receipts?: ScenarioReceipt[]
  selectedRunId?: string | null
  onSelectReceipt?: (receipt: ScenarioReceipt) => void
  compact?: boolean
}

const RECEIPT_COPY = {
  en: {
    emptyTitle: 'No receipts yet',
    emptyBody: 'Run a Scenario to create validation evidence.',
    receiptEyebrow: 'Scenario receipt',
    run: 'Run',
    started: 'Started',
    execution: 'Execution',
    toolMode: 'Tool mode',
    completed: 'Completed',
    trace: 'Trace',
    toolCalls: 'Tool calls',
    noToolCalls: 'No tool calls recorded.',
    toolResults: 'Tool results',
    noToolResults: 'No tool results recorded.',
    staleEvidence: 'stale evidence',
    hookDecisions: 'Hook decisions',
    noHookDecisions: 'No Hook decisions recorded.',
    knowledgeEvidence: 'Knowledge evidence',
    noKnowledgeEvidence: 'No knowledge evidence recorded.',
    humanTransfer: 'Human transfer',
    noHumanTransfer: 'No human transfer required.',
    transferRequired: 'Human transfer required',
    noTransfer: 'No transfer',
    handoffEvidence: 'Handoff evidence',
    queue: 'Queue',
    target: 'Target',
    none: 'none',
    finalStatus: 'Final status',
    noFinalStatus: 'No final status recorded.',
    procedureStatus: 'Procedure status',
    procedureOutcome: 'Procedure outcome',
    notRecorded: 'Not recorded',
    staleRuntimeWarning: 'Runtime recorded stale evidence that still requires reconciliation.',
    transcriptHealth: 'Transcript health',
    providerTranscriptPersisted: 'Provider transcript persisted',
    toolPairsChecked: 'Tool pairs checked',
    toolPairsRepaired: 'Tool pairs repaired',
    orphanToolResultsDropped: 'Orphan results dropped',
    legacyRowsSkipped: 'Legacy rows skipped',
    compactPairsSummarized: 'Compact pairs summarized',
    phraseChecks: 'Phrase checks',
    noPhraseChecks: 'No required or forbidden phrase checks.',
    expectationChecks: 'Expectation checks',
    noExpectationChecks: 'No additional expectation checks.',
    recentRuns: 'Recent runs',
    noEntries: 'No entries.',
    pass: 'Pass',
    fail: 'Fail',
    knowledgeHit: (index: number) => `Knowledge hit ${index + 1}`,
    agentRuntime: 'Agent runtime',
    fixtureValidation: 'Fixture validation',
    forbiddenPhrase: 'Forbidden phrase: ',
    requiredPhrase: 'Required phrase: ',
  },
  zh: {
    emptyTitle: '还没有回执',
    emptyBody: '运行一次 Scenario 来生成验证证据。',
    receiptEyebrow: 'Scenario 回执',
    run: '运行',
    started: '开始时间',
    execution: '执行方式',
    toolMode: 'Tool 模式',
    completed: '完成时间',
    trace: 'Trace',
    toolCalls: 'Tool 调用',
    noToolCalls: '还没有记录到 Tool 调用。',
    toolResults: 'Tool 结果',
    noToolResults: '还没有记录到 Tool 结果。',
    staleEvidence: '过期证据',
    hookDecisions: 'Hook 决策',
    noHookDecisions: '还没有记录到 Hook 决策。',
    knowledgeEvidence: '知识证据',
    noKnowledgeEvidence: '还没有记录到知识证据。',
    humanTransfer: '人工接管',
    noHumanTransfer: '当前不需要人工接管。',
    transferRequired: '需要人工接管',
    noTransfer: '无需接管',
    handoffEvidence: '接管证据',
    queue: '队列',
    target: '目标',
    none: '无',
    finalStatus: '最终状态',
    noFinalStatus: '还没有记录最终状态。',
    procedureStatus: 'Procedure 状态',
    procedureOutcome: 'Procedure 结果',
    notRecorded: '未记录',
    staleRuntimeWarning: '运行时记录到了仍待对齐的过期证据。',
    transcriptHealth: 'Transcript 健康度',
    providerTranscriptPersisted: 'Provider transcript 已持久化',
    toolPairsChecked: '已检查 Tool 配对',
    toolPairsRepaired: '已修复 Tool 配对',
    orphanToolResultsDropped: '已丢弃孤立结果',
    legacyRowsSkipped: '已跳过旧行',
    compactPairsSummarized: 'Compact 已总结配对',
    phraseChecks: '短语检查',
    noPhraseChecks: '还没有必需/禁用短语检查。',
    expectationChecks: '预期检查',
    noExpectationChecks: '没有额外的预期检查。',
    recentRuns: '最近运行',
    noEntries: '暂无条目。',
    pass: '通过',
    fail: '失败',
    knowledgeHit: (index: number) => `知识命中 ${index + 1}`,
    agentRuntime: '运行时验证',
    fixtureValidation: '静态样例验证',
    forbiddenPhrase: '禁用短语：',
    requiredPhrase: '必需短语：',
  },
} as const

export function ScenarioReceiptPanel({
  receipt,
  receipts = [],
  selectedRunId,
  onSelectReceipt,
  compact = false,
}: ScenarioReceiptPanelProps) {
  const { locale } = useConsoleLocale()
  const copy = RECEIPT_COPY[locale]
  if (!receipt) {
    return (
      <div className="intera-q2-panel p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[var(--color-bg-surface-muted)] text-[var(--color-text-tertiary)]">
            <FileJson size={16} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">{copy.emptyTitle}</h2>
            <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">{copy.emptyBody}</p>
          </div>
        </div>
      </div>
    )
  }

  const evidence = receipt.evidence
  const transcriptHealth = evidence.runtime?.transcriptHealth
  const phraseChecks = receipt.checks.filter(isPhraseCheck)
  const remainingChecks = receipt.checks.filter((check) => !isPhraseCheck(check))

  return (
    <div className="intera-q2-panel overflow-hidden bg-[rgba(255,255,255,0.84)] shadow-[0_16px_36px_rgba(21,23,25,0.05)]">
      <div className="border-b border-[var(--color-border-subtle)] px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-[var(--color-text-tertiary)]">{copy.receiptEyebrow}</p>
            <h2 className="mt-1 text-lg font-semibold text-[var(--color-text-primary)]">{receipt.scenarioName}</h2>
            {receipt.summary && <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{receipt.summary}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ExecutionModeBadge receipt={receipt} />
            <ReceiptStatusBadge status={receipt.status} />
          </div>
        </div>
        <div className="mt-4 grid overflow-hidden rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white/62 text-xs text-[var(--color-text-secondary)] sm:grid-cols-2">
          <span className="border-b border-[var(--color-border-subtle)] px-3 py-2 sm:border-r">{copy.run}: {receipt.runId}</span>
          <span className="border-b border-[var(--color-border-subtle)] px-3 py-2">{copy.started}: {formatDate(receipt.startedAt, locale)}</span>
          <span className="border-b border-[var(--color-border-subtle)] px-3 py-2 sm:border-r">{copy.execution}: {executionModeLabel(receipt.executionMode, locale)}</span>
          <span className="border-b border-[var(--color-border-subtle)] px-3 py-2">{copy.toolMode}: {receipt.toolExecutionMode}</span>
          {(receipt.completedAt ?? receipt.finishedAt) && <span className="border-b border-[var(--color-border-subtle)] px-3 py-2 sm:border-r sm:border-b-0">{copy.completed}: {formatDate(receipt.completedAt ?? receipt.finishedAt!, locale)}</span>}
          {receipt.traceId && <span className="px-3 py-2">{copy.trace}: {receipt.traceId}</span>}
        </div>
      </div>

      <div className={`grid ${compact ? '' : 'xl:grid-cols-2'}`}>
        <EvidenceSection icon={Wrench} title={copy.toolCalls} empty={copy.noToolCalls}>
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

        <EvidenceSection icon={Wrench} title={copy.toolResults} empty={copy.noToolResults} isEmpty={evidence.toolResults.length === 0}>
          <div className="grid gap-2">
            {evidence.toolResults.map((result, index) => (
              <div key={`${result.name}-${index}`} className="rounded-md border border-[var(--color-border-subtle)] bg-white/70 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold text-[var(--color-text-primary)]">{result.name}</span>
                  <span className="rounded-full bg-white px-2 py-0.5 text-[var(--color-text-secondary)]">{result.executionMode ?? receipt.toolExecutionMode}</span>
                  {result.evidenceState === 'stale' && <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700">{copy.staleEvidence}</span>}
                </div>
                {result.error && <p className="mt-2 text-xs text-red-700">{result.error}</p>}
                {result.output !== undefined && <pre className="mt-2 max-h-24 overflow-auto rounded-md bg-[var(--primitive-deep-950)] p-2 font-mono text-[11px] leading-4 text-[var(--color-workspace-text)]">{stringify(result.output)}</pre>}
              </div>
            ))}
          </div>
        </EvidenceSection>

        <EvidenceSection icon={ShieldCheck} title={copy.hookDecisions} empty={copy.noHookDecisions} isEmpty={evidence.hookDecisions.length === 0}>
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

        <EvidenceSection icon={Search} title={copy.knowledgeEvidence} empty={copy.noKnowledgeEvidence} isEmpty={evidence.knowledgeHits.length === 0}>
          <div className="grid gap-2">
            {evidence.knowledgeHits.map((hit, index) => (
              <div key={index} className="rounded-md border border-[var(--color-border-subtle)] bg-white/70 px-3 py-2">
                <p className="text-xs font-medium text-[var(--color-text-primary)]">{knowledgeTitle(hit, index, locale)}</p>
                <pre className="mt-2 max-h-28 overflow-auto rounded-md bg-[var(--primitive-deep-950)] p-2 font-mono text-[11px] leading-4 text-[var(--color-workspace-text)]">{stringify(hit)}</pre>
              </div>
            ))}
          </div>
        </EvidenceSection>

        <EvidenceSection icon={Handshake} title={copy.humanTransfer} empty={copy.noHumanTransfer} isEmpty={!evidence.humanTransfer && evidence.handoff.length === 0}>
          <div className="grid gap-2">
            <div className="flex items-center gap-2 text-sm">
              <span className={`h-2 w-2 rounded-full ${evidence.humanTransfer ? 'bg-[var(--color-signal-warning)]' : 'bg-[var(--color-text-tertiary)]'}`} />
              <span className="font-medium text-[var(--color-text-primary)]">{evidence.humanTransfer ? copy.transferRequired : copy.noTransfer}</span>
            </div>
            {evidence.handoff.map((handoff, index) => (
              <div key={index} className="rounded-md border border-[var(--color-border-subtle)] bg-white/70 px-3 py-2 text-xs text-[var(--color-text-secondary)]">
                <p>{handoff.reason ?? handoff.target ?? handoff.queue ?? copy.handoffEvidence}</p>
                {(handoff.queue || handoff.target) && <p className="mt-1 text-[var(--color-text-tertiary)]">{copy.queue}: {handoff.queue ?? copy.none} · {copy.target}: {handoff.target ?? copy.none}</p>}
              </div>
            ))}
          </div>
        </EvidenceSection>

        <EvidenceSection icon={CircleDot} title={copy.finalStatus} empty={copy.noFinalStatus}>
          <div className="grid gap-2">
            <div className="rounded-md border border-[var(--color-border-subtle)] bg-white/70 px-3 py-2 text-sm text-[var(--color-text-primary)]">
              {evidence.finalStatus ?? copy.notRecorded}
            </div>
            <HealthRow label={copy.procedureStatus} value={evidence.procedureStatus ?? copy.notRecorded} />
            <HealthRow label={copy.procedureOutcome} value={evidence.procedureOutcome ?? copy.notRecorded} />
            {evidence.finalResponse && <p className="rounded-md border border-[var(--color-border-subtle)] bg-white px-3 py-2 text-sm leading-5 text-[var(--color-text-secondary)]">{evidence.finalResponse}</p>}
            {evidence.runtime?.staleEvidence?.length ? <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{copy.staleRuntimeWarning}</p> : null}
          </div>
        </EvidenceSection>

        {transcriptHealth && (
          <EvidenceSection icon={ShieldCheck} title={copy.transcriptHealth} empty={copy.noEntries}>
            <div className="grid gap-2 text-xs text-[var(--color-text-secondary)]">
              <HealthRow label={copy.providerTranscriptPersisted} value={transcriptHealth.providerTranscriptPersisted ? copy.pass : copy.fail} />
              <HealthRow label={copy.toolPairsChecked} value={String(transcriptHealth.toolPairsChecked ?? 0)} />
              <HealthRow label={copy.toolPairsRepaired} value={String(transcriptHealth.toolPairsRepaired ?? 0)} />
              <HealthRow label={copy.orphanToolResultsDropped} value={String(transcriptHealth.orphanToolResultsDropped ?? 0)} />
              <HealthRow label={copy.legacyRowsSkipped} value={String(transcriptHealth.legacyRowsSkipped ?? 0)} />
              <HealthRow label={copy.compactPairsSummarized} value={String(transcriptHealth.compactPairsSummarized ?? 0)} />
            </div>
          </EvidenceSection>
        )}

        <EvidenceSection icon={AlertTriangle} title={copy.phraseChecks} empty={copy.noPhraseChecks} isEmpty={phraseChecks.length === 0}>
          <CheckList checks={phraseChecks} locale={locale} />
        </EvidenceSection>
      </div>

      <div className="border-t border-[var(--color-border-subtle)] bg-white/35 px-5 py-4">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{copy.expectationChecks}</h3>
        {remainingChecks.length === 0 ? (
          <p className="mt-2 text-xs text-[var(--color-text-tertiary)]">{copy.noExpectationChecks}</p>
        ) : (
          <CheckList checks={remainingChecks} className="mt-3" locale={locale} />
        )}
      </div>

      {receipts.length > 1 && onSelectReceipt && (
        <div className="border-t border-[var(--color-border-subtle)] bg-white/35 px-5 py-4">
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{copy.recentRuns}</h3>
          <div className="mt-3 grid gap-2">
            {receipts.slice(0, 6).map((item) => (
              <button key={item.runId} type="button" onClick={() => onSelectReceipt(item)} className={`intera-q2-button flex items-center justify-between border px-3 py-2 text-left text-xs transition ${selectedRunId === item.runId ? 'border-[var(--color-accent-primary)] bg-[rgba(53,127,124,0.08)]' : 'border-[var(--color-border-subtle)] bg-white hover:bg-[var(--color-bg-surface-muted)]'}`}>
                <span className="min-w-0">
                  <span className="block truncate font-medium text-[var(--color-text-primary)]">{item.scenarioName}</span>
                  <span className="mt-0.5 block text-[var(--color-text-tertiary)]">{executionModeLabel(item.executionMode, locale)} · {formatDate(item.startedAt, locale)}</span>
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
  const { locale } = useConsoleLocale()
  const runtime = receipt.executionMode === 'agentRuntime'
  const className = runtime
    ? 'border-[rgba(53,127,124,0.22)] bg-[rgba(53,127,124,0.08)] text-[var(--color-accent-primary)]'
    : 'border-amber-200 bg-amber-50 text-amber-800'
  return <span className={`inline-flex h-8 items-center rounded-md border px-3 text-xs font-semibold ${className}`}>{executionModeLabel(receipt.executionMode, locale)}</span>
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
    <section className="border-b border-[var(--color-border-subtle)] bg-[rgba(255,255,255,0.28)] p-4 last:border-b-0">
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

function HealthRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-[var(--color-border-subtle)] bg-white/70 px-3 py-2">
      <span>{label}</span>
      <span className="font-mono text-[var(--color-text-primary)]">{value}</span>
    </div>
  )
}

function TokenList({ values, tone }: { values: string[]; tone?: 'cyan' }) {
  const { locale } = useConsoleLocale()
  const copy = RECEIPT_COPY[locale]
  if (values.length === 0) return <p className="text-xs text-[var(--color-text-tertiary)]">{copy.noEntries}</p>
  const itemClass = tone === 'cyan' ? 'border-[rgba(53,127,124,0.18)] bg-[rgba(53,127,124,0.08)] text-[var(--color-accent-primary)]' : 'border-[var(--color-border-subtle)] bg-[var(--color-bg-surface-muted)] text-[var(--color-text-secondary)]'
  return (
    <div className="flex flex-wrap gap-2">
      {values.map((value) => <span key={value} className={`rounded-full border px-2 py-1 text-xs font-medium ${itemClass}`}>{value}</span>)}
    </div>
  )
}

function CheckList({ checks, className = '', locale }: { checks: ScenarioReceiptCheck[]; className?: string; locale: 'en' | 'zh' }) {
  const copy = RECEIPT_COPY[locale]
  return (
    <div className={`grid gap-2 ${className}`}>
      {checks.map((check) => (
        <div key={check.name} className="rounded-md border border-[var(--color-border-subtle)] bg-white/68 px-3 py-2">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="font-medium text-[var(--color-text-primary)]">{formatCheckName(check.name, locale)}</span>
            <span className={`rounded-full px-2 py-0.5 font-semibold ${check.passed ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{check.passed ? copy.pass : copy.fail}</span>
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

function executionModeLabel(mode: ScenarioReceipt['executionMode'], locale: 'en' | 'zh'): string {
  return mode === 'agentRuntime' ? RECEIPT_COPY[locale].agentRuntime : RECEIPT_COPY[locale].fixtureValidation
}

function formatCheckName(name: string, locale: 'en' | 'zh'): string {
  return name
    .replace(/^forbidden_phrase:/, RECEIPT_COPY[locale].forbiddenPhrase)
    .replace(/^required_phrase:/, RECEIPT_COPY[locale].requiredPhrase)
    .replace(/_/g, ' ')
}

function knowledgeTitle(hit: Record<string, unknown>, index: number, locale: 'en' | 'zh'): string {
  const title = hit.title ?? hit.name ?? hit.source
  return typeof title === 'string' && title.trim() ? title : RECEIPT_COPY[locale].knowledgeHit(index)
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function formatDate(value: string, locale: 'en' | 'zh'): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(locale === 'zh' ? 'zh-CN' : undefined)
}
