import Link from 'next/link'

export default function BuildReleasePage() {
  return (
    <main className="mx-auto max-w-5xl px-8 py-10">
      <section className="rounded-2xl border border-black/[0.08] bg-white/70 p-8 shadow-[var(--shadow-card)]">
        <p className="text-[11px] text-[var(--fog)] uppercase tracking-wide">Build</p>
        <h1 className="mt-2 text-[28px] font-semibold text-[var(--mist)]">Release</h1>
        <p className="mt-2 text-[13px] text-[var(--fog)]">Release command-center is arriving soon. Use the sections below while we transition IA routes.</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Link
            href="/build/pilot-lab"
            className="rounded-xl border border-black/[0.08] bg-gradient-to-br from-white/70 to-white/40 px-4 py-3 text-[13px] text-[var(--mist)]"
          >
            Open Pilot Lab
          </Link>
          <Link
            href="/build/components"
            className="rounded-xl border border-black/[0.08] bg-gradient-to-br from-white/70 to-white/40 px-4 py-3 text-[13px] text-[var(--mist)]"
          >
            Open Components
          </Link>
        </div>
      </section>
    </main>
  )
}
