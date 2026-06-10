'use client'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import VersionContextBar from '@/components/admin/version-context-bar'
import MemoryStrategyWorkspace from '@/components/memory/memory-strategy-workspace'
import ModelPage from '@/app/admin/model/page'

type BrainSection = 'model' | 'memory' | 'profile' | 'compact-test'

function sectionFromMode(mode: string | null): BrainSection {
  if (mode === 'model' || mode === 'prompt' || mode === 'settings') return 'model'
  if (mode === 'profile') return 'profile'
  if (mode === 'compact-test' || mode === 'compact' || mode === 'test') return 'compact-test'
  if (mode === 'memory') return 'memory'
  return 'model'
}

export default function BrainWorkspace() {
  const searchParams = useSearchParams()
  const initialSection = useMemo(() => sectionFromMode(searchParams.get('mode')), [searchParams])

  if (initialSection === 'model') {
    return <ModelPage />
  }

  return (
    <div>
      <VersionContextBar />
      <main className="mx-auto max-w-7xl px-6 py-7 sm:px-8">
        <MemoryStrategyWorkspace initialSection={initialSection} />
      </main>
    </div>
  )
}
