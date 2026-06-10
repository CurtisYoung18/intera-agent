'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Brain, Layers, Plug, Puzzle, Search, Shield } from 'lucide-react'
import { useConsoleLocale } from '@/components/locale-provider'

const COMPONENT_SECTIONS = [
  { href: '/build/components/brain', labelKey: 'sidebar.brain', icon: Brain, color: '#8b6ff5' },
  { href: '/build/components/procedures', labelKey: 'sidebar.procedures', icon: Layers, color: '#d5963d' },
  { href: '/build/components/tools', labelKey: 'sidebar.tools', icon: Puzzle, color: '#5b8af7' },
  { href: '/build/components/hooks', labelKey: 'sidebar.hooks', icon: Shield, color: '#c9635b' },
  { href: '/build/components/knowledge', labelKey: 'sidebar.knowledge', icon: Search, color: '#357f7c' },
  { href: '/build/components/integrations', labelKey: 'sidebar.integrations', icon: Plug, color: '#8172c8' },
] as const

const COMPONENT_ROUTE_COPY = {
  en: {
    navAria: 'Components sections',
    preservedBadge: 'Existing save and test flows preserved',
    descriptions: {
      brain: 'Adjust memory, model, profile, and compact-test behavior inside the same Components workspace.',
      procedures: 'Keep the existing Procedure builder flows, but anchor them inside the Build material system and local Components navigation.',
      procedureDetail: 'Inspect and save Procedure details while staying inside the local Components route family.',
      tools: 'Open tool editing, mock-fixture, and endpoint test flows without leaving the local Components workspace.',
      hooks: 'Review Hook definitions and binding scopes with the same Build shell language used by Release and Pilot Lab.',
      knowledge: 'Keep retrieval-source editing and test flows intact while bringing the route into the same Build material family.',
      integrations: 'Channels and API-key surfaces stay in their current flows, but the route now reads as part of the Build workspace.',
    },
  },
  zh: {
    navAria: '组件分区',
    preservedBadge: '保留现有保存与测试流程',
    descriptions: {
      brain: '在同一个 Components 工作区里调整记忆、模型、画像和 compact-test 行为。',
      procedures: '保留现有 Procedure 搭建流程，但把它稳定收进 Build 的材质体系和本地 Components 导航里。',
      procedureDetail: '在本地 Components 路由体系中查看并保存 Procedure 细节。',
      tools: '在不离开本地 Components 工作区的情况下完成工具编辑、静态样例和端点测试。',
      hooks: '用与发布页和 Pilot Lab 一致的 Build 语言查看 Hook 定义和绑定范围。',
      knowledge: '保持检索源编辑和测试流程不变，同时把这条路由纳入统一的 Build 材质体系。',
      integrations: '渠道和 API Key 相关流程保持原状，但这条路由会被统一理解为 Build 工作区的一部分。',
    },
  },
} as const

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function BuildComponentsLocalNav() {
  const pathname = usePathname()
  const { locale, t } = useConsoleLocale()
  const copy = COMPONENT_ROUTE_COPY[locale]

  return (
    <nav className="flex flex-wrap gap-2" aria-label={copy.navAria}>
      {COMPONENT_SECTIONS.map((item) => {
        const active = isActive(pathname, item.href)
        const Icon = item.icon
        const label = t(item.labelKey)
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`intera-q2-button inline-flex min-h-10 items-center gap-2 border px-3 py-2 text-[13px] font-semibold transition ${
              active
                ? 'border-[rgba(53,127,124,0.28)] bg-[rgba(53,127,124,0.09)] text-[var(--color-accent-primary)]'
                : 'border-[var(--color-border-subtle)] bg-white/76 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface-muted)] hover:text-[var(--color-text-primary)]'
            }`}
          >
              <span className="flex h-7 w-7 items-center justify-center rounded-[12px] border border-white/70 bg-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
              <Icon className="h-4 w-4" style={{ color: item.color }} />
              </span>
            <span>{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

export function BuildComponentsRouteShell({
  currentLabelKey,
  descriptionKey,
  children,
}: {
  currentLabelKey: string
  descriptionKey: keyof (typeof COMPONENT_ROUTE_COPY)['en']['descriptions']
  children: ReactNode
}) {
  const { locale, t } = useConsoleLocale()
  const copy = COMPONENT_ROUTE_COPY[locale]
  const currentLabel = t(currentLabelKey)

  return (
    <div className="intera-q2-page min-h-screen px-4 py-4 text-[var(--color-text-primary)] sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-[1580px] flex-col gap-4">
        <section className="intera-q2-panel overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-[var(--color-border-subtle)] px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-[12px] font-medium text-[var(--color-text-tertiary)]">
                <span>{t('sidebar.build')}</span>
                <span className="text-[var(--color-border-strong)]">/</span>
                <span>{t('sidebar.components')}</span>
                <span className="text-[var(--color-border-strong)]">/</span>
                <span className="text-[var(--color-text-primary)]">{currentLabel}</span>
              </div>
              <p className="mt-2 max-w-3xl text-[13px] leading-6 text-[var(--color-text-secondary)]">{copy.descriptions[descriptionKey]}</p>
            </div>
            <span className="inline-flex items-center rounded-[var(--radius-control)] border border-[rgba(53,127,124,0.18)] bg-[rgba(53,127,124,0.08)] px-3 py-1.5 text-[12px] font-semibold text-[var(--color-accent-primary)]">
              {copy.preservedBadge}
            </span>
          </div>
          <div className="px-4 py-3 sm:px-5">
            <BuildComponentsLocalNav />
          </div>
        </section>

        <div className="build-components-compat-scope">{children}</div>
      </div>

      <style jsx global>{`
        .build-components-compat-scope .animate-fade-up {
          animation: none !important;
        }

        .build-components-compat-scope .glass-card {
          background: rgba(255, 252, 246, 0.82);
          border: 1px solid rgba(124, 133, 139, 0.16);
          border-radius: 16px;
          box-shadow:
            0 16px 36px rgba(21, 23, 25, 0.05),
            inset 0 1px 0 rgba(255, 255, 255, 0.72);
        }

        .build-components-compat-scope .glass-card:hover {
          transform: none;
          background: rgba(255, 253, 248, 0.92);
          border-color: rgba(53, 127, 124, 0.2);
          box-shadow:
            0 18px 40px rgba(21, 23, 25, 0.06),
            inset 0 1px 0 rgba(255, 255, 255, 0.76);
        }

        .build-components-compat-scope .glass-pill {
          background: rgba(255, 255, 255, 0.84);
          border-color: rgba(124, 133, 139, 0.16);
          color: var(--color-text-secondary);
        }

        .build-components-compat-scope .glass-input-console {
          background: rgba(255, 255, 255, 0.86);
          border-color: rgba(124, 133, 139, 0.16);
          box-shadow:
            inset 0 1px 2px rgba(21, 23, 25, 0.04),
            inset 0 1px 0 rgba(255, 255, 255, 0.72);
        }

        .build-components-compat-scope .glass-input-console:focus {
          border-color: rgba(53, 127, 124, 0.34);
          box-shadow:
            0 0 0 3px rgba(53, 127, 124, 0.08),
            inset 0 1px 2px rgba(21, 23, 25, 0.04),
            inset 0 1px 0 rgba(255, 255, 255, 0.72);
        }
      `}</style>
    </div>
  )
}
