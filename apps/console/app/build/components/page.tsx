'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowRight, Search, Puzzle, Shield, Plug, Layers, Brain } from 'lucide-react'
import { useConsoleLocale } from '@/components/locale-provider'
import { BuildComponentsLocalNav } from './_components/components-route-shell'

const COMPONENT_ITEMS = [
  { href: '/build/components/brain', icon: Brain, labelKey: 'sidebar.brain', color: '#8b6ff5' },
  { href: '/build/components/procedures', icon: Layers, labelKey: 'sidebar.procedures', color: '#d4912e' },
  { href: '/build/components/tools', icon: Puzzle, labelKey: 'sidebar.tools', color: '#5b8af7' },
  { href: '/build/components/hooks', icon: Shield, labelKey: 'sidebar.hooks', color: '#e64539' },
  { href: '/build/components/knowledge', icon: Search, labelKey: 'sidebar.knowledge', color: '#14b8a6' },
  { href: '/build/components/integrations', icon: Plug, labelKey: 'sidebar.integrations', color: '#7c3aed' },
]

const COMPONENTS_PAGE_COPY = {
  en: {
    heroDescription:
      'Keep Brain, Procedures, Tools, Hooks, Knowledge, and Integrations inside one local Build hub with shared material, restrained chips, and stable save or test flows.',
    localOnlyTitle: 'Local only',
    localOnlyBody: 'Components stays a Build-local hub. It does not become top-level global nav again.',
    flowSafeTitle: 'Flow-safe',
    flowSafeBody: 'Existing save, test, and detail editors remain intact under the updated Build shell language.',
    tableComponent: 'Component',
    tableWhat: 'What you can do here',
    tableRoute: 'Route',
    insideWorkspace: 'Inside Components workspace',
    openDescription: (label: string) =>
      `Open ${label.toLowerCase()} controls while keeping the shared Build shell, local navigation, and editor-specific save or test flows intact.`,
    openRoute: 'Open route',
  },
  zh: {
    heroDescription:
      '把 Brain、Procedures、Tools、Hooks、Knowledge 和 Integrations 收进同一个本地 Build hub，复用统一材质、克制 chip 和稳定的保存/测试流程。',
    localOnlyTitle: '仅限 Build 内部',
    localOnlyBody: 'Components 继续作为 Build 内部工作区存在，不再恢复成全局一级导航。',
    flowSafeTitle: '流程不变',
    flowSafeBody: '现有保存、测试和细节编辑器都会在新的 Build 壳层语言下原样保留。',
    tableComponent: '组件',
    tableWhat: '这里可以做什么',
    tableRoute: '入口',
    insideWorkspace: '位于 Components 工作区',
    openDescription: (label: string) =>
      `在保留共享 Build 壳层、本地导航和各编辑器原有保存/测试流程的前提下，打开 ${label} 控制面。`,
    openRoute: '打开入口',
  },
} as const

function isActive(pathname: string, href: string) {
  return pathname === href
}

export default function BuildComponentsPage() {
  const { locale, t } = useConsoleLocale()
  const pathname = usePathname()
  const copy = COMPONENTS_PAGE_COPY[locale]

  return (
    <main className="intera-q2-page min-h-screen px-5 py-6 sm:px-8">
      <div className="mx-auto flex max-w-[1380px] flex-col gap-4">
        <section className="intera-q2-panel overflow-hidden">
          <div className="flex flex-col gap-4 border-b border-[var(--color-border-subtle)] px-5 py-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[13px] font-medium text-[var(--color-text-tertiary)]">
                <span>{t('sidebar.build')}</span>
                <span className="text-[var(--color-border-strong)]">/</span>
                <span className="text-[var(--color-text-primary)]">{t('sidebar.components')}</span>
              </div>
              <h1 className="mt-4 text-[30px] font-semibold leading-[1.08] text-[var(--color-text-primary)] sm:text-[34px]">{t('sidebar.components')}</h1>
              <p className="mt-2 max-w-3xl text-[15px] leading-6 text-[var(--color-text-secondary)]">
                {copy.heroDescription}
              </p>
            </div>
            <div className="grid gap-2 text-[12px] text-[var(--color-text-secondary)] sm:grid-cols-2">
              <div className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white/76 px-4 py-3 shadow-[0_10px_24px_rgba(21,23,25,0.04)]">
                <p className="font-semibold text-[var(--color-text-primary)]">{copy.localOnlyTitle}</p>
                <p className="mt-1 leading-5">{copy.localOnlyBody}</p>
              </div>
              <div className="rounded-[var(--radius-control)] border border-[rgba(53,127,124,0.18)] bg-[rgba(53,127,124,0.08)] px-4 py-3 text-[var(--color-accent-primary)] shadow-[0_10px_24px_rgba(21,23,25,0.04)]">
                <p className="font-semibold">{copy.flowSafeTitle}</p>
                <p className="mt-1 leading-5">{copy.flowSafeBody}</p>
              </div>
            </div>
          </div>

          <div className="px-5 py-4">
            <BuildComponentsLocalNav />
          </div>
        </section>

        <section className="intera-q2-panel overflow-hidden">
          <div className="hidden grid-cols-[minmax(230px,0.85fr)_minmax(0,1fr)_150px] border-b border-[var(--color-border-subtle)] bg-[rgba(255,255,255,0.48)] px-5 py-3 text-[12px] font-semibold text-[var(--color-text-tertiary)] md:grid">
            <span>{copy.tableComponent}</span>
            <span>{copy.tableWhat}</span>
            <span>{copy.tableRoute}</span>
          </div>
          <div className="divide-y divide-[var(--color-border-subtle)]">
            {COMPONENT_ITEMS.map((item) => {
              const active = isActive(pathname, item.href)
              const label = t(item.labelKey)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`group grid gap-3 px-5 py-4 transition-colors md:grid-cols-[minmax(230px,0.85fr)_minmax(0,1fr)_150px] md:items-center ${
                    active
                      ? 'bg-[rgba(53,127,124,0.08)]'
                      : 'bg-[rgba(255,255,255,0.62)] hover:bg-[rgba(255,255,255,0.88)]'
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-3 text-[14px] font-semibold text-[var(--color-text-primary)]">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] border border-white/70 bg-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.76)]">
                      <item.icon className="h-4.5 w-4.5" style={{ color: item.color }} />
                    </span>
                    <div className="min-w-0">
                      <span className="block">{label}</span>
                      <span className="mt-1 block text-[11px] font-medium text-[var(--color-text-tertiary)]">{copy.insideWorkspace}</span>
                    </div>
                  </div>
                  <p className="text-[13px] leading-5 text-[var(--color-text-secondary)]">
                    {copy.openDescription(label)}
                  </p>
                  <span className="inline-flex w-fit items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white/82 px-2.5 py-1 text-[11px] font-semibold text-[var(--color-text-secondary)]">
                    {copy.openRoute}
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              )
            })}
          </div>
        </section>
      </div>
    </main>
  )
}
