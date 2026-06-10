'use client'

import type { RuntimeSourceTruth } from '@/lib/operate/runtime-truth'
import { useConsoleLocale } from '@/components/locale-provider'

export default function SourceTruthPill({ truth }: { truth: RuntimeSourceTruth }) {
  const { locale } = useConsoleLocale()
  const isZh = locale === 'zh'
  const toneClass =
    truth.kind === 'synthetic_review'
      ? 'border-amber/20 bg-amber/[0.08] text-amber'
      : truth.kind === 'mixed'
        ? 'border-vermillion/18 bg-vermillion/[0.08] text-vermillion'
        : truth.kind === 'live'
          ? 'border-[#357f7c]/18 bg-[#357f7c]/[0.08] text-[#357f7c]'
          : 'border-black/[0.06] bg-white/70 text-[var(--fog)]'

  const label = (() => {
    if (!isZh) return truth.shortLabel
    if (truth.kind === 'synthetic_review') return '试跑导出'
    if (truth.kind === 'mixed') return '混合来源'
    if (truth.kind === 'live') return '实时运行'
    return '来源未知'
  })()

  return (
    <span
      title={truth.description}
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] ${toneClass}`}
    >
      {label}
    </span>
  )
}
