'use client'

import type { RuntimeSourceTruth } from '@/lib/operate/runtime-truth'

export default function SourceTruthPill({ truth }: { truth: RuntimeSourceTruth }) {
  const toneClass =
    truth.kind === 'synthetic_review'
      ? 'border-amber/20 bg-amber/[0.08] text-amber'
      : truth.kind === 'mixed'
        ? 'border-vermillion/18 bg-vermillion/[0.08] text-vermillion'
        : truth.kind === 'live'
          ? 'border-[#357f7c]/18 bg-[#357f7c]/[0.08] text-[#357f7c]'
          : 'border-black/[0.06] bg-white/70 text-[var(--fog)]'

  return (
    <span
      title={truth.description}
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] ${toneClass}`}
    >
      {truth.shortLabel}
    </span>
  )
}
