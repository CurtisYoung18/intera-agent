'use client'

import { Fragment, type ReactNode } from 'react'
import type { TranslateFn } from '@/lib/i18n/types'
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  Bot,
  Braces,
  CheckCircle2,
  CircleDot,
  Compass,
  Cpu,
  Database,
  GitBranch,
  Globe,
  Layers,
  MessageSquareText,
  Package,
  PlugZap,
  Radar,
  RefreshCw,
  Rocket,
  Search,
  ShieldCheck,
  SplitSquareHorizontal,
  User,
  UserCheck,
  Workflow,
  Zap,
  Wrench,
} from 'lucide-react'

function FlowSpine({ className }: { className?: string }) {
  return (
    <div className={`flex flex-col items-center ${className ?? ''}`} aria-hidden>
      <svg width="22" height="36" viewBox="0 0 22 36" className="opacity-95">
        <defs>
          <linearGradient id="guide-spine" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgba(139,111,245,0.35)" />
            <stop offset="45%" stopColor="rgba(91,138,247,0.55)" />
            <stop offset="100%" stopColor="rgba(46,160,74,0.25)" />
          </linearGradient>
        </defs>
        <path
          d="M11 4v26"
          fill="none"
          stroke="url(#guide-spine)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="5 10"
          className="guide-beam-vertical"
        />
      </svg>
    </div>
  )
}

function GlowNode({
  step,
  icon: Icon,
  accentFrom,
  accentTo,
  title,
  children,
}: {
  step: number
  icon: typeof Bot
  accentFrom: string
  accentTo: string
  title: string
  children: ReactNode
}) {
  return (
    <div
      className="guide-flow-node relative overflow-hidden rounded-2xl border border-black/[0.06] bg-gradient-to-br from-white/72 via-white/48 to-[var(--void)]/35 px-5 py-4 shadow-[var(--shadow-card)] backdrop-blur-md"
      style={{ ['--guide-pulse-delay' as string]: `${step * 0.22}s` }}
    >
      <div className={`pointer-events-none absolute inset-px rounded-[calc(1rem-1px)] opacity-85 bg-gradient-to-br ${accentFrom} ${accentTo}`} aria-hidden />
      <div className="relative flex items-start gap-3">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-white/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] ring-1 ring-black/[0.04]">
          <Icon className="h-[22px] w-[22px] text-[var(--mist)]/[0.88]" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-md bg-black/[0.04] px-2 font-mono text-[10px] font-bold tabular-nums text-[var(--fog)]">
              {String(step).padStart(2, '0')}
            </span>
            <h4 className="text-[13px] font-semibold tracking-tight text-[var(--mist)]">{title}</h4>
          </div>
          <div className="space-y-1.5 text-[12px] leading-relaxed text-[var(--mist)]/[0.78]">{children}</div>
        </div>
      </div>
    </div>
  )
}

/** Stage nudge pipeline when the model emits text-only (no tools). */
export function StageNudgeFlowDiagram({ t }: { t: TranslateFn }) {
  return (
    <div className="relative mx-auto max-w-xl">
      <div className="pointer-events-none absolute -left-[min(28%,120px)] top-24 hidden h-48 w-48 rounded-full bg-lavender/[0.06] blur-3xl md:block" aria-hidden />
      <GlowNode step={1} icon={MessageSquareText} accentFrom="from-indigo/[0.07]" accentTo="to-transparent" title={t('guide.flow.step1.title')}>
        <p>{t('guide.flow.step1.body')}</p>
        {t('guide.flow.step1.detail') ? (
          <p className="mt-2 rounded-lg border border-black/[0.06] bg-black/[0.02] px-3 py-2 text-[11px] italic text-[var(--fog)]">{t('guide.flow.step1.detail')}</p>
        ) : null}
      </GlowNode>
      <FlowSpine />

      <div className="grid gap-3 sm:grid-cols-2">
        <div
          className="guide-flow-node relative rounded-2xl border border-amber/20 bg-gradient-to-br from-amber/[0.08] to-transparent px-4 py-3 shadow-[var(--shadow-card)]"
          style={{ ['--guide-pulse-delay' as string]: '0.32s' }}
        >
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-amber/[0.88]">
            <Wrench className="h-3.5 w-3.5" aria-hidden />
            {t('guide.flow.checkSkills.label')}
          </div>
          <p className="text-[12px] text-[var(--mist)]/[0.8]">{t('guide.flow.checkSkills.body')}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="rounded-md border border-vermillion/20 bg-vermillion/[0.06] px-2 py-0.5 text-[10px] font-medium text-vermillion/90">{t('guide.flow.checkSkills.met')}</span>
            <span className="rounded-md border border-black/[0.06] bg-white/50 px-2 py-0.5 text-[10px] text-[var(--fog)]">{t('guide.flow.checkSkills.chip')}</span>
          </div>
        </div>
        <div
          className="guide-flow-node relative rounded-2xl border border-sky/25 bg-gradient-to-br from-sky/[0.07] to-transparent px-4 py-3 shadow-[var(--shadow-card)]"
          style={{ ['--guide-pulse-delay' as string]: '0.44s' }}
        >
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-sky/[0.9]">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            {t('guide.flow.checkEvidence.label')}
          </div>
          <p className="text-[12px] text-[var(--mist)]/[0.8]">{t('guide.flow.checkEvidence.body')}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="rounded-md border border-vermillion/20 bg-vermillion/[0.06] px-2 py-0.5 text-[10px] font-medium text-vermillion/90">{t('guide.flow.checkEvidence.met')}</span>
            <span className="rounded-md border border-black/[0.06] bg-white/50 px-2 py-0.5 text-[10px] text-[var(--fog)]">{t('guide.flow.checkEvidence.chip')}</span>
          </div>
        </div>
      </div>

      <div className="flex justify-center py-1">
        <ArrowDown className="h-5 w-5 text-[var(--smoke)]/40" strokeWidth={2} aria-hidden />
      </div>

      <GlowNode step={2} icon={PlugZap} accentFrom="from-lavender/[0.1]" accentTo="to-transparent" title={t('guide.flow.step3.title')}>
        <div
          data-guide-shine="true"
          className="relative rounded-xl border border-lavender/20 bg-black/[0.02] px-3 py-2.5 font-mono text-[11px] leading-snug text-[var(--mist)]/[0.85]"
          style={{ ['--guide-shine-delay' as string]: '0.6s' }}
        >
          <p className="whitespace-pre-wrap text-[var(--fog)]">{t('guide.flow.step3.quote')}</p>
        </div>
      </GlowNode>

      <FlowSpine />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="relative rounded-xl border border-indigo/[0.12] bg-white/42 px-4 py-3 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
          <div className="mb-1 flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-indigo/[0.75]">
            <CircleDot className="h-3.5 w-3.5" aria-hidden />
            {t('guide.flow.counter.label')}
          </div>
          <p className="font-semibold text-[15px] tabular-nums text-[var(--mist)]">{t('guide.flow.counter.valueLabel')}</p>
          <p className="mt-1 text-[11px] text-[var(--smoke)]">{t('guide.flow.counter.hint')}</p>
        </div>
        <div className="relative rounded-xl border border-malachite/[0.15] bg-malachite/[0.05] px-4 py-3 text-center">
          <div className="mb-1 flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-malachite/[0.82]">
            <Workflow className="h-3.5 w-3.5" aria-hidden />
            {t('guide.flow.loop.badge')}
          </div>
          <p className="text-[13px] font-medium text-[var(--mist)]">{t('guide.flow.loop.label')}</p>
          <span className="mt-2 inline-block rounded-md bg-black/[0.04] px-2 py-1 text-[11px] text-[var(--fog)]">{t('guide.flow.loop.continueCta')}</span>
        </div>
      </div>

      <FlowSpine />

      <div
        className="guide-flow-node relative rounded-2xl border border-vermillion/[0.25] bg-gradient-to-br from-vermillion/[0.07] to-transparent px-5 py-4 shadow-[var(--shadow-card)]"
        style={{ ['--guide-pulse-delay' as string]: '0.95s' }}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-white/70 ring-1 ring-vermillion/15">
            <AlertTriangle className="h-[22px] w-[22px] text-vermillion" strokeWidth={2} />
          </div>
          <div>
            <h4 className="text-[13px] font-semibold text-[var(--mist)]">{t('guide.flow.fuse.title')}</h4>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--mist)]/[0.78]">{t('guide.flow.fuse.body')}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full bg-vermillion/[0.1] px-3 py-1 text-[11px] font-semibold text-vermillion/90">{t('guide.flow.fuse.badge')}</span>
              <span className="rounded-full border border-black/[0.06] bg-white/55 px-3 py-1 text-[11px] text-[var(--fog)]">{t('guide.flow.fuse.follow')}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Facts merge into CaseMemory → Stage gates → transitions. */
export function FactsEvidenceDiagram({ t }: { t: TranslateFn }) {
  return (
    <div className="relative mx-auto max-w-[920px]">
      <div className="pointer-events-none absolute right-0 top-0 h-40 w-40 rounded-full bg-indigo/[0.05] blur-3xl" aria-hidden />

      {/* Inflows */}
      <div className="grid gap-4 md:grid-cols-2">
        <div
          className="relative overflow-hidden rounded-2xl border border-indigo/[0.14] bg-gradient-to-br from-indigo/[0.06] to-transparent p-5 shadow-[var(--shadow-card)]"
          data-guide-shine="true"
          style={{ ['--guide-shine-delay' as string]: '0.2s' }}
        >
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-indigo/[0.75]">
            <User className="h-4 w-4" aria-hidden />
            {t('guide.facts.inUser.title')}
          </div>
          <p className="mt-2 text-[12px] text-[var(--mist)]/[0.78]">{t('guide.facts.inUser.body')}</p>
          <dl className="mt-4 space-y-2 rounded-xl bg-white/48 p-3 font-mono text-[11px] ring-1 ring-black/[0.04]">
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--fog)]">txnId</dt>
              <dd className="text-malachite/90">FACT</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--fog)]">amount</dt>
              <dd className="text-malachite/90">FACT</dd>
            </div>
          </dl>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-sky/[0.2] bg-gradient-to-br from-sky/[0.06] to-transparent p-5 shadow-[var(--shadow-card)]">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-sky/[0.78]">
            <Cpu className="h-4 w-4" aria-hidden />
            {t('guide.facts.inSkill.title')}
          </div>
          <p className="mt-2 text-[12px] text-[var(--mist)]/[0.78]">{t('guide.facts.inSkill.body')}</p>
          <dl className="mt-4 space-y-2 rounded-xl bg-white/48 p-3 font-mono text-[11px] ring-1 ring-black/[0.04]">
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--fog)]">orderStatus</dt>
              <dd className="text-indigo/90">EVIDENCE</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--fog)]">channelStatus</dt>
              <dd className="text-indigo/90">EVIDENCE</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="relative z-[1] flex justify-center py-3">
        <div className="flex items-center gap-3">
          <div className="hidden h-px w-12 bg-gradient-to-r from-transparent to-indigo/25 sm:block" aria-hidden />
          <ArrowDown className="h-6 w-6 text-[var(--smoke)]/45" strokeWidth={2} />
          <div className="hidden h-px w-12 bg-gradient-to-l from-transparent to-sky/25 sm:block" aria-hidden />
        </div>
      </div>

      {/* Vault */}
      <div className="guide-flow-node relative mx-auto max-w-lg rounded-2xl border border-black/[0.07] bg-gradient-to-b from-white/65 to-[var(--void)]/40 p-5 shadow-[var(--shadow-card)] backdrop-blur-md" style={{ ['--guide-pulse-delay' as string]: '0.15s' }}>
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fog)]">
          <Package className="h-4 w-4 text-lavender/80" aria-hidden />
          {t('guide.facts.vault.title')}
        </div>
        <p className="mt-2 text-[12px] text-[var(--mist)]/[0.75]">{t('guide.facts.vault.body')}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-black/[0.06] bg-black/[0.025] p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--fog)]">{t('guide.facts.vault.colFacts')}</p>
            <p className="mt-2 text-[12px] leading-relaxed text-[var(--mist)]/[0.82]">{t('guide.facts.vault.factsLine')}</p>
          </div>
          <div className="rounded-xl border border-black/[0.06] bg-black/[0.025] p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--fog)]">{t('guide.facts.vault.colSkills')}</p>
            <p className="mt-2 text-[12px] leading-relaxed text-[var(--mist)]/[0.82]">{t('guide.facts.vault.skillsLine')}</p>
          </div>
        </div>
      </div>

      <div className="flex justify-center py-3">
        <ArrowDown className="h-6 w-6 text-[var(--smoke)]/45" strokeWidth={2} />
      </div>

      {/* Stage gate */}
      <div className="rounded-2xl border border-amber/[0.18] bg-gradient-to-br from-amber/[0.05] to-transparent p-5 shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-amber/[0.85]">
          <Bot className="h-4 w-4" aria-hidden />
          {t('guide.facts.gate.title')}
        </div>
        <p className="mt-2 text-[12px] text-[var(--mist)]/[0.78]">{t('guide.facts.gate.body')}</p>
        <ul className="mt-4 space-y-2 text-[12px]">
          <li className="flex items-start gap-2 rounded-lg bg-white/42 px-3 py-2 ring-1 ring-black/[0.04]">
            <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-malachite/80" aria-hidden />
            <span className="text-[var(--mist)]/[0.82]">{t('guide.facts.gate.row1')}</span>
          </li>
          <li className="flex items-start gap-2 rounded-lg bg-white/42 px-3 py-2 ring-1 ring-black/[0.04]">
            <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-malachite/80" aria-hidden />
            <span className="text-[var(--mist)]/[0.82]">{t('guide.facts.gate.row2')}</span>
          </li>
          <li className="flex items-start gap-2 rounded-lg bg-vermillion/[0.05] px-3 py-2 ring-1 ring-vermillion/15">
            <Braces className="mt-0.5 h-4 w-4 flex-shrink-0 text-vermillion/75" aria-hidden />
            <span className="text-[var(--mist)]/[0.82]">{t('guide.facts.gate.row3')}</span>
          </li>
        </ul>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-[var(--fog)]">
          <span className="rounded-md border border-black/[0.06] bg-black/[0.03] px-2 py-1 italic text-[var(--smoke)]">{t('guide.facts.gate.badge')}</span>
          <span className="text-[var(--smoke)]">{t('guide.facts.gate.outcomes')}</span>
        </div>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-malachite/[0.18] bg-gradient-to-br from-malachite/[0.06] to-transparent p-5">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-malachite/[0.85]">
            <GitBranch className="h-4 w-4" aria-hidden />
            {t('guide.facts.transAuto.title')}
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-[var(--mist)]/[0.8]">{t('guide.facts.transAuto.body')}</p>
        </div>
        <div className="rounded-2xl border border-lavender/[0.2] bg-gradient-to-br from-lavender/[0.06] to-transparent p-5">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-lavender/[0.85]">
            <Workflow className="h-4 w-4" aria-hidden />
            {t('guide.facts.transEval.title')}
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-[var(--mist)]/[0.8]">{t('guide.facts.transEval.body')}</p>
        </div>
      </div>
    </div>
  )
}

/** User message → Core Agent ReAct Loop → QA (no tool_use) vs create Case (dispatch_case_agent/propose_cases) → sub-agent dispatch. */
export function IntentRoutingFlowDiagram({ t }: { t: TranslateFn }) {
  return (
    <div className="relative mx-auto max-w-xl">
      <p className="mb-6 text-[12px] leading-relaxed text-[var(--fog)]">{t('guide.intentDiag.caption')}</p>
      <GlowNode step={1} icon={User} accentFrom="from-indigo/[0.07]" accentTo="to-transparent" title={t('guide.intentDiag.s1.title')}>
        <p>{t('guide.intentDiag.s1.body')}</p>
      </GlowNode>
      <FlowSpine />
      <GlowNode step={2} icon={Bot} accentFrom="from-sky/[0.09]" accentTo="to-transparent" title={t('guide.intentDiag.s2.title')}>
        <p>{t('guide.intentDiag.s2.body')}</p>
      </GlowNode>
      <FlowSpine />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="relative overflow-hidden rounded-2xl border border-malachite/[0.14] bg-gradient-to-br from-malachite/[0.06] to-transparent p-4 shadow-[var(--shadow-card)]">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-malachite/[0.85]">
            <MessageSquareText className="h-3.5 w-3.5" aria-hidden />
            {t('guide.intentDiag.qa.title')}
          </div>
          <p className="text-[12px] leading-relaxed text-[var(--mist)]/[0.8]">{t('guide.intentDiag.qa.body')}</p>
        </div>
        <div className="relative overflow-hidden rounded-2xl border border-indigo/[0.15] bg-gradient-to-br from-indigo/[0.07] to-transparent p-4 shadow-[var(--shadow-card)]">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-indigo/[0.8]">
            <Layers className="h-3.5 w-3.5" aria-hidden />
            {t('guide.intentDiag.caseBranch.title')}
          </div>
          <p className="text-[12px] leading-relaxed text-[var(--mist)]/[0.8]">{t('guide.intentDiag.caseBranch.body')}</p>
          <div className="mt-3 space-y-2 rounded-xl bg-white/42 p-3 ring-1 ring-black/[0.04]">
            <div className="flex items-start gap-2">
              <CircleDot className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber/80" aria-hidden />
              <span className="text-[11px] text-[var(--mist)]/[0.78]">{t('guide.intentDiag.caseBranch.grey')}</span>
            </div>
            <div className="flex items-start gap-2">
              <Zap className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-malachite/80" aria-hidden />
              <span className="text-[11px] text-[var(--mist)]/[0.78]">{t('guide.intentDiag.caseBranch.green')}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-center py-2">
        <ArrowDown className="h-5 w-5 text-[var(--smoke)]/40" strokeWidth={2} aria-hidden />
      </div>

      <GlowNode step={3} icon={Radar} accentFrom="from-lavender/[0.1]" accentTo="to-transparent" title={t('guide.intentDiag.s3.title')}>
        <p>{t('guide.intentDiag.s3.body')}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-black/[0.06] bg-white/45 px-3 py-2 text-[11px] text-[var(--fog)]">
          <span className="font-semibold text-[var(--mist)]/[0.88]">{t('guide.intentDiag.strip.label')}</span>
          <span className="hidden text-[var(--smoke)]/50 sm:inline" aria-hidden>
            —
          </span>
          <span>{t('guide.intentDiag.strip.detail')}</span>
        </div>
      </GlowNode>

      <div className="mt-6 flex justify-center gap-4 text-[11px] text-[var(--fog)]">
        <SplitSquareHorizontal className="h-4 w-4 shrink-0 text-indigo/50" aria-hidden />
        <span className="max-w-[18rem] text-center leading-snug">{t('guide.intentDiag.uiHint')}</span>
      </div>
    </div>
  )
}

/** Coarse lanes inside one harness turn once the Case is running. */
export function AgentTurnPipelineDiagram({ t }: { t: TranslateFn }) {
  const StepMini = ({
    n,
    icon: Icon,
    title,
    body,
    tint,
  }: {
    n: number
    icon: typeof Layers
    title: string
    body: string
    tint: string
  }) => (
    <div className="relative min-w-[140px] flex-1 rounded-xl border border-black/[0.06] bg-gradient-to-br from-white/72 to-[var(--void)]/35 p-4 shadow-[var(--shadow-card)] backdrop-blur-sm">
      <div className={`pointer-events-none absolute inset-px rounded-[calc(0.75rem-1px)] bg-gradient-to-br ${tint}`} aria-hidden />
      <div className="relative">
        <div className="mb-2 inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-md bg-black/[0.04] px-2 font-mono text-[10px] font-bold text-[var(--fog)]">
          {String(n).padStart(2, '0')}
        </div>
        <div className="mb-2 flex items-center gap-2">
          <Icon className="h-4 w-4 text-[var(--mist)]/[0.75]" strokeWidth={2} aria-hidden />
          <span className="text-[13px] font-semibold tracking-tight text-[var(--mist)]">{title}</span>
        </div>
        <p className="text-[11px] leading-relaxed text-[var(--mist)]/[0.75]">{body}</p>
      </div>
    </div>
  )

  return (
    <div className="relative mx-auto">
      <p className="mb-6 text-[12px] leading-relaxed text-[var(--fog)]">{t('guide.turnDiag.caption')}</p>
      <div className="flex flex-wrap items-stretch justify-center gap-3 md:flex-nowrap">
        <StepMini n={1} icon={Layers} title={t('guide.turnDiag.s1.title')} body={t('guide.turnDiag.s1.body')} tint="from-indigo/[0.05] to-transparent" />
        <div className="hidden items-center px-1 md:flex" aria-hidden>
          <ArrowRight className="h-4 w-4 text-[var(--smoke)]/35" strokeWidth={2} />
        </div>
        <StepMini n={2} icon={Workflow} title={t('guide.turnDiag.s2.title')} body={t('guide.turnDiag.s2.body')} tint="from-amber/[0.06] to-transparent" />
        <div className="hidden items-center px-1 md:flex" aria-hidden>
          <ArrowRight className="h-4 w-4 text-[var(--smoke)]/35" strokeWidth={2} />
        </div>
        <StepMini n={3} icon={Bot} title={t('guide.turnDiag.s3.title')} body={t('guide.turnDiag.s3.body')} tint="from-lavender/[0.07] to-transparent" />
        <div className="hidden items-center px-1 md:flex" aria-hidden>
          <ArrowRight className="h-4 w-4 text-[var(--smoke)]/35" strokeWidth={2} />
        </div>
        <StepMini n={4} icon={ShieldCheck} title={t('guide.turnDiag.s4.title')} body={t('guide.turnDiag.s4.body')} tint="from-sky/[0.06] to-transparent" />
        <div className="hidden items-center px-1 md:flex" aria-hidden>
          <ArrowRight className="h-4 w-4 text-[var(--smoke)]/35" strokeWidth={2} />
        </div>
        <StepMini n={5} icon={PlugZap} title={t('guide.turnDiag.s5.title')} body={t('guide.turnDiag.s5.body')} tint="from-malachite/[0.06] to-transparent" />
      </div>
      <p className="mt-5 rounded-xl border border-indigo/[0.1] bg-indigo/[0.03] px-4 py-3 text-[12px] leading-relaxed text-[var(--mist)]/[0.78]">{t('guide.turnDiag.loopHint')}</p>
    </div>
  )
}

/** Case lifecycle stages: created → collecting → investigating → waiting_human → resolved. */
export function CaseLifecycleDiagram({ t }: { t: TranslateFn }) {
  const stages = [
    { key: 'created', icon: CircleDot, color: 'from-indigo/[0.06] to-transparent', border: 'border-indigo/[0.15]', dot: 'bg-indigo' },
    { key: 'collecting', icon: User, color: 'from-sky/[0.06] to-transparent', border: 'border-sky/[0.18]', dot: 'bg-sky' },
    { key: 'investigating', icon: Search, color: 'from-amber/[0.06] to-transparent', border: 'border-amber/[0.2]', dot: 'bg-amber' },
    { key: 'waiting_human', icon: UserCheck, color: 'from-lavender/[0.06] to-transparent', border: 'border-lavender/[0.2]', dot: 'bg-lavender' },
    { key: 'resolved', icon: CheckCircle2, color: 'from-malachite/[0.06] to-transparent', border: 'border-malachite/[0.18]', dot: 'bg-malachite' },
  ]

  return (
    <div className="relative mx-auto max-w-4xl">
      {/* Stage row */}
      <div className="flex flex-wrap items-start justify-center gap-2 md:flex-nowrap">
        {stages.map((s, i) => (
          <Fragment key={s.key}>
            {i > 0 && (
              <div className="flex items-center pt-6 md:pt-7" aria-hidden>
                <ArrowRight className="h-4 w-4 text-[var(--smoke)]/35" strokeWidth={2} />
              </div>
            )}
            <div
              className={`relative min-w-[110px] flex-1 rounded-2xl border ${s.border} bg-gradient-to-br ${s.color} p-4 text-center shadow-[var(--shadow-card)] backdrop-blur-sm`}
              style={{ ['--guide-pulse-delay' as string]: `${i * 0.15}s` }}
            >
              <div className={`mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-xl ${s.dot} bg-opacity-10`}>
                <s.icon className="h-[18px] w-[18px] text-[var(--mist)]/[0.75]" strokeWidth={2} />
              </div>
              <p className="text-[12px] font-semibold text-[var(--mist)]">{t(`guide.lifecycle.stage.${s.key}`)}</p>
              <p className="mt-1 text-[10px] leading-snug text-[var(--fog)]">{t(`guide.lifecycle.driver.${s.key}`)}</p>
            </div>
          </Fragment>
        ))}
      </div>

      {/* Escalation path */}
      <div className="mt-4 flex items-center justify-center gap-3">
        <div className="flex items-center gap-2 rounded-xl border border-vermillion/[0.18] bg-vermillion/[0.05] px-3 py-2 text-[11px]">
          <AlertTriangle className="h-3.5 w-3.5 text-vermillion/80" />
          <span className="text-[var(--mist)]/[0.8]">{t('guide.lifecycle.escalated')}</span>
        </div>
        <span className="text-[10px] text-[var(--smoke)]">{t('guide.lifecycle.or')}</span>
        <div className="flex items-center gap-2 rounded-xl border border-indigo/[0.12] bg-indigo/[0.04] px-3 py-2 text-[11px]">
          <RefreshCw className="h-3.5 w-3.5 text-indigo/70" />
          <span className="text-[var(--mist)]/[0.8]">{t('guide.lifecycle.reopen')}</span>
        </div>
      </div>
    </div>
  )
}

/** Sub-agent dispatch: Core Agent → Orchestrator → parallel sub-agents → result merge. */
export function SubAgentDispatchDiagram({ t }: { t: TranslateFn }) {
  return (
    <div className="relative mx-auto max-w-2xl">
      <GlowNode step={1} icon={Bot} accentFrom="from-indigo/[0.07]" accentTo="to-transparent" title={t('guide.sub.s1.title')}>
        <p>{t('guide.sub.s1.body')}</p>
      </GlowNode>
      <FlowSpine />
      <GlowNode step={2} icon={Rocket} accentFrom="from-lavender/[0.09]" accentTo="to-transparent" title={t('guide.sub.s2.title')}>
        <p>{t('guide.sub.s2.body')}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="rounded-md border border-black/[0.06] bg-white/50 px-2 py-0.5 text-[10px] text-[var(--fog)]">{t('guide.sub.s2.chip1')}</span>
          <span className="rounded-md border border-black/[0.06] bg-white/50 px-2 py-0.5 text-[10px] text-[var(--fog)]">{t('guide.sub.s2.chip2')}</span>
        </div>
      </GlowNode>
      <FlowSpine />

      {/* Parallel sub-agent cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="relative overflow-hidden rounded-2xl border border-sky/[0.2] bg-gradient-to-br from-sky/[0.05] to-transparent p-4 shadow-[var(--shadow-card)]" style={{ ['--guide-pulse-delay' as string]: '0.3s' }}>
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-sky/[0.85]">
            <Search className="h-3.5 w-3.5" aria-hidden />
            {t('guide.sub.agent1.name')}
          </div>
          <p className="text-[11px] leading-relaxed text-[var(--mist)]/[0.75]">{t('guide.sub.agent1.body')}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            <code className="rounded-md bg-white/50 px-1.5 py-0.5 text-[10px] font-mono text-[var(--fog)]">MiniMax-M2.7</code>
            <code className="rounded-md bg-white/50 px-1.5 py-0.5 text-[10px] font-mono text-[var(--fog)]">3 iters</code>
          </div>
        </div>
        <div className="relative overflow-hidden rounded-2xl border border-amber/[0.2] bg-gradient-to-br from-amber/[0.05] to-transparent p-4 shadow-[var(--shadow-card)]" style={{ ['--guide-pulse-delay' as string]: '0.4s' }}>
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-amber/[0.85]">
            <Database className="h-3.5 w-3.5" aria-hidden />
            {t('guide.sub.agent2.name')}
          </div>
          <p className="text-[11px] leading-relaxed text-[var(--mist)]/[0.75]">{t('guide.sub.agent2.body')}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            <code className="rounded-md bg-white/50 px-1.5 py-0.5 text-[10px] font-mono text-[var(--fog)]">MiniMax-M2.7</code>
            <code className="rounded-md bg-white/50 px-1.5 py-0.5 text-[10px] font-mono text-[var(--fog)]">2 iters</code>
          </div>
        </div>
      </div>

      <div className="flex justify-center py-3">
        <ArrowDown className="h-6 w-6 text-[var(--smoke)]/45" strokeWidth={2} />
      </div>

      {/* SSE event timeline */}
      <div className="rounded-2xl border border-black/[0.07] bg-gradient-to-br from-white/65 to-[var(--void)]/40 p-5 shadow-[var(--shadow-card)] backdrop-blur-md" style={{ ['--guide-pulse-delay' as string]: '0.55s' }}>
        <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--fog)]">
          <Globe className="h-4 w-4 text-indigo/70" aria-hidden />
          {t('guide.sub.events.title')}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono">
          <span className="rounded-md bg-sky/[0.08] px-2 py-1 text-sky/90">sub_agent_start</span>
          <span className="text-[var(--smoke)]/40">→</span>
          <span className="rounded-md bg-indigo/[0.06] px-2 py-1 text-indigo/80">progress</span>
          <span className="text-[var(--smoke)]/40">→</span>
          <span className="rounded-md bg-malachite/[0.08] px-2 py-1 text-malachite/90">complete</span>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-[var(--fog)]">{t('guide.sub.events.body')}</p>
      </div>

      <div className="flex justify-center py-3">
        <ArrowDown className="h-6 w-6 text-[var(--smoke)]/45" strokeWidth={2} />
      </div>

      {/* Merge result */}
      <div className="rounded-2xl border border-malachite/[0.18] bg-gradient-to-br from-malachite/[0.06] to-transparent p-4 text-center shadow-[var(--shadow-card)]">
        <CheckCircle2 className="mx-auto mb-1 h-5 w-5 text-malachite/80" />
        <p className="text-[12px] font-semibold text-[var(--mist)]">{t('guide.sub.merge.title')}</p>
        <p className="mt-1 text-[11px] text-[var(--fog)]">{t('guide.sub.merge.body')}</p>
      </div>
    </div>
  )
}
