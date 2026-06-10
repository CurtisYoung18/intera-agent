import type { ReactNode } from 'react'
import InteraLogo from '@intera/shared/ui/intera-logo'

type StatusTone = 'neutral' | 'success' | 'warning' | 'danger'

const STATUS_TONE_CLASS: Record<StatusTone, string> = {
  neutral: 'border-white/70 bg-white/74 text-[var(--fog)]',
  success: 'border-[#357f7c]/18 bg-[#357f7c]/[0.08] text-[#2a6b69]',
  warning: 'border-amber/18 bg-amber/[0.08] text-amber',
  danger: 'border-vermillion/18 bg-vermillion/[0.08] text-vermillion',
}

export function ConsoleAuthShell({
  badge = 'Context Lens · Agent Studio',
  headline,
  description,
  statusLabel,
  statusTone = 'neutral',
  statusDetail,
  panelEyebrow,
  panelTitle,
  panelDescription,
  panelWidthClassName = 'max-w-[420px]',
  children,
}: {
  badge?: string
  headline: ReactNode
  description: ReactNode
  statusLabel: string
  statusTone?: StatusTone
  statusDetail?: ReactNode
  panelEyebrow: string
  panelTitle: ReactNode
  panelDescription: ReactNode
  panelWidthClassName?: string
  children: ReactNode
}) {
  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-[linear-gradient(180deg,#f7f5ef_0%,#f1eee7_48%,#ece8df_100%)] px-4 py-4 text-[var(--mist)] sm:px-6 lg:px-8">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.055]"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(26,24,20,0.95) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />
      <div className="pointer-events-none absolute inset-x-[-8%] top-[-12%] h-[36rem] rounded-full bg-[radial-gradient(circle,rgba(53,127,124,0.16)_0%,rgba(53,127,124,0.04)_36%,transparent_72%)] blur-3xl" />
      <div className="pointer-events-none absolute bottom-[-20%] right-[-8%] h-[30rem] w-[30rem] rounded-full bg-[radial-gradient(circle,rgba(91,138,247,0.14)_0%,rgba(91,138,247,0.02)_34%,transparent_72%)] blur-3xl" />

      <div className="relative mx-auto grid min-h-[calc(100dvh-2rem)] max-w-[1180px] gap-5 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
        <aside className="relative overflow-hidden rounded-[34px] border border-white/72 bg-[rgba(255,252,246,0.78)] px-6 py-7 shadow-[0_24px_60px_rgba(21,23,25,0.08),inset_0_1px_0_rgba(255,255,255,0.72)] backdrop-blur-[22px] sm:px-8 sm:py-8 lg:px-10 lg:py-10">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.45),transparent_46%),radial-gradient(circle_at_bottom_right,rgba(53,127,124,0.1),transparent_34%)]" />
          <div className="relative flex h-full flex-col justify-between gap-10">
            <div className="space-y-8">
              <span className="inline-flex w-fit items-center rounded-full border border-white/70 bg-white/[0.8] px-3.5 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[#357f7c] shadow-[0_8px_24px_rgba(21,23,25,0.04)]">
                {badge}
              </span>

              <div className="rounded-[28px] border border-white/70 bg-white/[0.66] p-5 shadow-[0_14px_32px_rgba(21,23,25,0.05),inset_0_1px_0_rgba(255,255,255,0.75)] sm:p-6">
                <InteraLogo size={88} mode="idle" theme="light" showTag loop />
              </div>

              <div className="max-w-[34rem]">
                <h1 className="text-balance font-serif text-[clamp(2rem,4vw,3.3rem)] font-normal leading-[0.98] tracking-[-0.03em] text-[var(--mist)]">
                  {headline}
                </h1>
                <p className="mt-4 max-w-xl text-[15px] leading-7 text-[var(--fog)]">{description}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-[12px] font-medium shadow-[0_8px_18px_rgba(21,23,25,0.04)] ${STATUS_TONE_CLASS[statusTone]}`}
              >
                <span className="h-2 w-2 rounded-full bg-current opacity-75" />
                {statusLabel}
              </span>
              {statusDetail ? <span className="text-[12px] text-[var(--fog)]">{statusDetail}</span> : null}
            </div>
          </div>
        </aside>

        <section className="flex items-center">
          <div className="w-full rounded-[32px] border border-white/75 bg-[rgba(255,253,249,0.84)] px-5 py-6 shadow-[0_24px_60px_rgba(21,23,25,0.08),inset_0_1px_0_rgba(255,255,255,0.74)] backdrop-blur-[20px] sm:px-7 sm:py-8">
            <div className={`mx-auto w-full ${panelWidthClassName}`}>
              <div className="mb-6">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[#357f7c]">
                  {panelEyebrow}
                </p>
                <h2 className="mt-3 text-balance font-serif text-[clamp(2rem,4vw,2.8rem)] font-normal leading-[1.02] tracking-[-0.03em] text-[var(--mist)]">
                  {panelTitle}
                </h2>
                <p className="mt-3 text-[14px] leading-6 text-[var(--fog)]">{panelDescription}</p>
              </div>
              {children}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
