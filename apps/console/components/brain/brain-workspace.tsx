'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Brain, Database } from 'lucide-react'
import VersionContextBar from '@/components/admin/version-context-bar'
import { useConsoleLocale } from '@/components/locale-provider'
import MemoryStrategyWorkspace from '@/components/memory/memory-strategy-workspace'
import ModelWorkspace from '@/components/brain/model-workspace'

type BrainSection = 'model' | 'memory'

const BRAIN_COPY = {
  en: {
    title: 'Brain',
    description: "Configure the Agent's model and memory inside the same Components workspace.",
    sections: {
      model: {
        label: 'Model',
        description: 'Primary model, generation controls, and core prompt.',
      },
      memory: {
        label: 'Memory',
        description: 'Compaction, long-term memory, and fact extraction behavior.',
      },
    },
  },
  zh: {
    title: '大脑',
    description: '在同一个 Components 工作区里配置 Agent 的模型与记忆。',
    sections: {
      model: {
        label: '模型',
        description: '主模型、生成控制与核心提示词。',
      },
      memory: {
        label: '记忆',
        description: '压缩、长期记忆与事实提取行为。',
      },
    },
  },
} as const

function sectionFromMode(mode: string | null): BrainSection {
  if (mode === 'model' || mode === 'prompt' || mode === 'settings') return 'model'
  if (mode === 'profile' || mode === 'compact-test' || mode === 'compact' || mode === 'test') return 'memory'
  if (mode === 'memory') return 'memory'
  return 'model'
}

export default function BrainWorkspace() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { locale } = useConsoleLocale()
  const copy = BRAIN_COPY[locale]
  const initialSection = useMemo(() => sectionFromMode(searchParams.get('mode')), [searchParams])
  const [section, setSection] = useState<BrainSection>(initialSection)
  const sections = useMemo(
    () => [
      {
        id: 'model' as const,
        label: copy.sections.model.label,
        description: copy.sections.model.description,
        icon: Brain,
      },
      {
        id: 'memory' as const,
        label: copy.sections.memory.label,
        description: copy.sections.memory.description,
        icon: Database,
      },
    ],
    [copy],
  )

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
          <h1 className="text-[34px] font-semibold tracking-tight text-[var(--mist)]">{copy.title}</h1>
          <p className="max-w-4xl text-[14px] leading-6 text-[var(--fog)]">{copy.description}</p>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-[var(--color-border-subtle)] pb-3">
          {sections.map((item) => {
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
        {section === 'memory' ? <MemoryStrategyWorkspace embedded /> : null}
      </div>
    </div>
  )
}
