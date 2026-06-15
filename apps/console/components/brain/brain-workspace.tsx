'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Brain, Database, FlaskConical, UserRound } from 'lucide-react'
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
    <div className="mx-auto max-w-[1180px] space-y-6">
      <section className="intera-q2-panel overflow-hidden">
        <VersionContextBar />
      </section>

      <div className="space-y-5">
        <div className="space-y-2">
          <h1 className="text-[34px] font-semibold tracking-tight text-[var(--mist)]">Brain</h1>
          <p className="max-w-4xl text-[14px] leading-6 text-[var(--fog)]">
            Configure the Agent&apos;s model, memory, profile, and compact-test behavior inside the same Components workspace.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-[var(--color-border-subtle)] pb-3">
          {BRAIN_SECTIONS.map((item) => {
            const active = section === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => selectSection(item.id)}
                className={`intera-q2-button inline-flex min-h-10 items-center gap-2 border px-3.5 py-2 text-[13px] font-semibold transition ${
                  active
                    ? 'border-[rgba(53,127,124,0.28)] bg-[rgba(53,127,124,0.09)] text-[var(--color-accent-primary)]'
                    : 'border-[var(--color-border-subtle)] bg-white/80 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface-muted)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                <item.icon className="h-4 w-4" />
                <span>{item.label}</span>
              </button>
            )
          })}
        </div>

        {section === 'model' ? <ModelWorkspace /> : null}
        {section !== 'model' ? (
          <MemoryStrategyWorkspace embedded lockedSection={toMemorySection(section)} initialSection={toMemorySection(section)} />
        ) : null}
      </div>
    </div>
  )
}
