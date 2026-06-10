'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Brain, Database, FlaskConical, ScrollText, UserRound } from 'lucide-react'
import VersionContextBar from '@/components/admin/version-context-bar'
import MemoryStrategyWorkspace, { type BrainMemorySection } from '@/components/memory/memory-strategy-workspace'
import ModelWorkspace from '@/components/brain/model-workspace'

type BrainSection = 'model' | 'memory' | 'profile' | 'compact-test'

const BRAIN_SECTIONS: Array<{
  id: BrainSection
  label: string
  description: string
  icon: typeof Brain
}> = [
  {
    id: 'model',
    label: 'Model',
    description: 'Primary model, generation controls, and core prompt.',
    icon: Brain,
  },
  {
    id: 'memory',
    label: 'Memory',
    description: 'Strategy, thresholds, preserve rules, and extraction behavior.',
    icon: Database,
  },
  {
    id: 'profile',
    label: 'Profile',
    description: 'Long-term profile promotion separate from ProcedureRun state.',
    icon: UserRound,
  },
  {
    id: 'compact-test',
    label: 'Compact Test',
    description: 'Dry-run a fixed fixture before publishing any memory changes.',
    icon: FlaskConical,
  },
]

function sectionFromMode(mode: string | null): BrainSection {
  if (mode === 'model' || mode === 'prompt' || mode === 'settings') return 'model'
  if (mode === 'profile') return 'profile'
  if (mode === 'compact-test' || mode === 'compact' || mode === 'test') return 'compact-test'
  if (mode === 'memory') return 'memory'
  return 'model'
}

function toMemorySection(section: Exclude<BrainSection, 'model'>): BrainMemorySection {
  return section
}

export default function BrainWorkspace() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const initialSection = useMemo(() => sectionFromMode(searchParams.get('mode')), [searchParams])
  const [section, setSection] = useState<BrainSection>(initialSection)

  useEffect(() => {
    setSection(initialSection)
  }, [initialSection])

  const selectSection = (nextSection: BrainSection) => {
    setSection(nextSection)
    const next = new URLSearchParams(Array.from(searchParams.entries()))
    next.set('mode', nextSection)
    router.replace(`/build/components/brain?${next.toString()}`, { scroll: false })
  }

  return (
    <div>
      <VersionContextBar />
      <main className="mx-auto max-w-7xl px-6 py-7 sm:px-8">
        <div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fog)]">
                Build / Components / Brain
              </p>
              <h1 className="mt-2 text-[26px] font-semibold tracking-tight text-[var(--mist)]">
                Brain workspace
              </h1>
              <p className="mt-2 text-[13px] leading-relaxed text-[var(--fog)]">
                Configure the Agent&apos;s model, prompt boundary, memory behavior, profile promotion, and compact-test workflow inside one native Build workspace.
              </p>
            </div>
            <div className="rounded-lg border border-black/[0.08] bg-white/70 px-4 py-3 text-[12px] leading-5 text-[var(--fog)]">
              Procedure runtime state stays outside confirmed facts and profile memory.
            </div>
          </div>

          <div className="grid gap-2 rounded-lg border border-black/[0.08] bg-white/65 p-1 sm:grid-cols-4">
            {BRAIN_SECTIONS.map((item) => {
              const active = section === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => selectSection(item.id)}
                  className={`flex min-h-[72px] items-start gap-3 rounded-md px-3 py-2.5 text-left transition ${
                    active ? 'bg-white shadow-sm ring-1 ring-black/[0.08]' : 'hover:bg-white/70'
                  }`}
                >
                  <item.icon className={`mt-0.5 h-4 w-4 ${active ? 'text-cyan-700' : 'text-[var(--fog)]'}`} />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold text-[var(--mist)]">{item.label}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-[var(--fog)]">{item.description}</span>
                  </span>
                </button>
              )
            })}
          </div>

          {section === 'model' ? <ModelWorkspace /> : null}
          {section !== 'model' ? (
            <MemoryStrategyWorkspace embedded lockedSection={toMemorySection(section)} initialSection={toMemorySection(section)} />
          ) : null}
        </div>
      </main>
    </div>
  )
}
